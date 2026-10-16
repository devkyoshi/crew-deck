import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../src/messaging/events.js';
import { linksIn, parsePreview, runLinkPreviews } from '../src/messaging/link-preview.js';
import { assertFetchable, fetchPage, isPrivateAddress, safeLookup } from '../src/messaging/ssrf.js';
import { createOrg, makeApp } from './helpers.js';

describe('isPrivateAddress', () => {
  const blocked = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.8',
    '198.18.0.1',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
    'not-an-ip',
    '',
  ];
  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.255.255',
    '192.169.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ];

  it.each(blocked)('refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(allowed)('allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertFetchable', () => {
  it.each([
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost/admin',
    'http://app.localhost/',
    'http://user:pass@example.com/',
    'https://example.com:8443/',
    'http://example.com:22/',
    'not a url',
  ])('refuses %s', (u) => expect(() => assertFetchable(u)).toThrow());

  it('accepts ordinary web addresses', () => {
    expect(assertFetchable('https://example.com/a?b=1').hostname).toBe('example.com');
    expect(assertFetchable('http://example.com:80/').port).toBe('');
  });
});

describe('safeLookup', () => {
  it('refuses names that resolve to internal addresses', async () => {
    const err = await new Promise<unknown>((resolve) =>
      safeLookup('localhost', {}, (e) => resolve(e)),
    );
    expect(err).toBeInstanceOf(Error);
  });
});

describe('linksIn', () => {
  it('collects link marks and bare addresses once each, at most three, skipping unfetchable ones', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a',
              marks: [{ type: 'link', attrs: { href: 'https://a.example/x' } }],
            },
          ],
        },
      ],
    };
    expect(
      linksIn(
        doc,
        'https://a.example/x and https://b.example/y, plus http://169.254.169.254/ and https://c.example, https://d.example, https://e.example',
      ),
    ).toEqual(['https://a.example/x', 'https://b.example/y', 'https://c.example']);
    expect(linksIn(null, 'no links here')).toEqual([]);
  });
});

describe('parsePreview', () => {
  it('reads Open Graph tags in either attribute order and decodes entities', () => {
    const html = `<html><head><title>Plain title</title>
      <meta content="Cats &amp; dogs" property="og:title">
      <meta property="og:description" content="Pets &quot;at home&quot;">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Pet Blog"></head><body></body></html>`;
    expect(parsePreview({ url: 'https://pets.example/post/1', html })).toEqual({
      url: 'https://pets.example/post/1',
      title: 'Cats & dogs',
      description: 'Pets "at home"',
      imageUrl: 'https://pets.example/img/cover.png',
      siteName: 'Pet Blog',
    });
  });

  it('falls back to the page title and host, and ignores non-web image addresses', () => {
    const p = parsePreview({
      url: 'https://x.example/',
      html: '<title> Hello  there </title><meta property="og:image" content="javascript:alert(1)">',
    });
    expect(p).toMatchObject({
      title: 'Hello there',
      description: null,
      imageUrl: null,
      siteName: 'x.example',
    });
  });
});

describe('fetchPage', () => {
  let server: http.Server;
  let port: number;
  const page =
    '<html><head><title>Local page</title><meta property="og:description" content="from a test server"></head></html>';
  // Reaches the test server by name; production always uses the guarded lookup.
  const lookup = ((
    _h: string,
    o: { all?: boolean },
    cb: (e: null, a: unknown, f?: number) => void,
  ) =>
    o?.all
      ? cb(null, [{ address: '127.0.0.1', family: 4 }])
      : cb(null, '127.0.0.1', 4)) as unknown as typeof safeLookup;
  const opts = () => ({ lookup, skipUrlChecks: true, timeoutMs: 1500, maxBytes: 4096 });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok')
        return void res.writeHead(200, { 'content-type': 'text/html' }).end(page);
      if (req.url === '/redirect') return void res.writeHead(302, { location: '/ok' }).end();
      if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
      if (req.url === '/json')
        return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":1}');
      if (req.url === '/missing')
        return void res.writeHead(404, { 'content-type': 'text/html' }).end('nope');
      if (req.url === '/huge') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return void res.end(`<title>Huge</title>${'x'.repeat(100_000)}`);
      }
      if (req.url === '/slow') return void setTimeout(() => res.end(page), 5000);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('reads a page, follows redirects, and stops at a small size', async () => {
    expect((await fetchPage(`http://page.test:${port}/ok`, opts())).html).toContain('Local page');
    expect((await fetchPage(`http://page.test:${port}/redirect`, opts())).url).toContain('/ok');
    const big = await fetchPage(`http://page.test:${port}/huge`, opts());
    expect(big.html.length).toBeLessThanOrEqual(4096);
    expect(big.html).toContain('<title>Huge</title>');
  });

  it('refuses redirect loops, other content types, errors and slow servers', async () => {
    await expect(fetchPage(`http://page.test:${port}/loop`, opts())).rejects.toThrow(/redirect/i);
    await expect(fetchPage(`http://page.test:${port}/json`, opts())).rejects.toThrow();
    await expect(fetchPage(`http://page.test:${port}/missing`, opts())).rejects.toThrow(/404/);
    await expect(
      fetchPage(`http://page.test:${port}/slow`, { ...opts(), timeoutMs: 400 }),
    ).rejects.toThrow();
  });

  it('never connects to internal addresses when called the normal way', async () => {
    await expect(fetchPage(`http://127.0.0.1:${port}/ok`)).rejects.toThrow();
    await expect(fetchPage(`http://localhost:${port}/ok`)).rejects.toThrow();
    // A public-looking name that resolves inside is stopped by the guarded lookup.
    await expect(
      fetchPage(`http://page.test:${port}/ok`, { skipUrlChecks: true, timeoutMs: 800 }),
    ).rejects.toThrow();
  });
});

describe('runLinkPreviews', () => {
  const t = makeApp();
  afterAll(() => t.close());

  it('stores previews on the message, uses the cache, and remembers failures', async () => {
    const org = await createOrg('lp');
    const db = t.db.tenant(org.org.id);
    const ch = await db.channels.insert({ type: 'public', name: 'lp-room' });
    const msg = await db.messages.insert({
      channelId: ch.id,
      seq: 1,
      authorId: org.owner.id,
      body: { type: 'doc', content: [] },
      bodyText: 'links',
      metadata: { previews: [], previewsPending: true },
    });
    const events = new MemoryEventSink();
    const calls: string[] = [];
    const fetchFake = async (url: string) => {
      calls.push(url);
      if (url.includes('bad')) throw new Error('boom');
      return {
        url,
        html: '<title>Cached title</title><meta property="og:description" content="desc">',
      };
    };
    const job = {
      orgId: org.org.id,
      messageId: msg.id,
      urls: ['https://good.example/a', 'https://bad.example/b'],
    };
    await runLinkPreviews({ db: t.db, events, fetch: fetchFake }, job);
    let stored = await db.messages.get(msg.id);
    expect(stored!.metadata).toMatchObject({
      previewsPending: false,
      previews: [{ url: 'https://good.example/a', title: 'Cached title' }],
    });
    expect(
      events.log.some(
        (e) =>
          e.event === 'message:updated' &&
          (e.payload as { previews: unknown[] }).previews.length === 1,
      ),
    ).toBe(true);

    // The second time the cache answers, including the remembered failure.
    calls.length = 0;
    await runLinkPreviews({ db: t.db, events, fetch: fetchFake }, job);
    expect(calls).toEqual([]);
    stored = await db.messages.get(msg.id);
    expect((stored!.metadata as { previews: unknown[] }).previews).toHaveLength(1);
    // The cache belongs to the workspace: another workspace fetches for itself.
    const other = await createOrg('lp2');
    const otherDb = t.db.tenant(other.org.id);
    expect(await otherDb.linkPreviews.count({})).toBe(0);
  });
});
