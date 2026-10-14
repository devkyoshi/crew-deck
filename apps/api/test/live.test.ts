import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp({ liveTiming: { heartbeatMs: 200, recheckMs: 300 } });
const call = caller(t.app);
let port = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
let space: { id: string; key: string };
let gxSpace: { id: string; key: string };

const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

interface Stream {
  status: number;
  events: { event: string; data: Json }[];
  ended: boolean;
  close: () => void;
  waitFor: (pred: (e: { event: string; data: Json }) => boolean, ms?: number) => Promise<{ event: string; data: Json }>;
}

/** Opens an event stream the way a browser would (session cookie, workspace host). */
function openStream(spaceRef: string, cookie: string, slug = 'acme'): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: `/api/v1/spaces/${spaceRef}/events`, headers: { host: `${slug}.localhost:3000`, cookie: `cd_session=${cookie}` } },
      (res) => {
        const s: Stream = {
          status: res.statusCode ?? 0,
          events: [],
          ended: false,
          close: () => req.destroy(),
          waitFor: (pred, ms = 2000) =>
            new Promise((ok, fail) => {
              const started = Date.now();
              const tick = () => {
                const hit = s.events.find(pred);
                if (hit) return ok(hit);
                if (Date.now() - started > ms) return fail(new Error(`no matching event in ${ms} ms: ${JSON.stringify(s.events)}`));
                setTimeout(tick, 20);
              };
              tick();
            }),
        };
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (event && data) s.events.push({ event, data: JSON.parse(data) as Json });
          }
        });
        res.on('end', () => (s.ended = true));
        res.on('close', () => (s.ended = true));
        resolve(s);
      },
    );
    req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
  });
}

beforeAll(async () => {
  const ids = await tenantIds();
  for (const name of ['owner', 'member', 'outsider']) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`lv-${name}`), role: name === 'owner' ? 'owner' : 'member' });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.gx = await ensureUser({ orgId: ids.globex, email: uniqueEmail('lv-gx', 'globex.test'), role: 'owner' });
  c.gx = await signInAs(t.app, 'globex', u.gx);
  const res = await send('POST', '/spaces', c.owner!, {
    key: `L${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    name: 'Live',
    visibility: 'private',
    members: [{ type: 'user', id: u.member!.id, role: 'member' }],
  });
  space = res.json();
  gxSpace = (await send('POST', '/spaces', c.gx!, { key: `G${Math.random().toString(36).slice(2, 7).toUpperCase()}`, name: 'G' }, 'globex')).json();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  port = (t.app.server.address() as AddressInfo).port;
});
afterAll(() => t.close());

describe('live updates', () => {
  it('tells an open board about a change within a second', async () => {
    const s = await openStream(space.key, c.member!);
    expect(s.status).toBe(200);
    await s.waitFor((e) => e.event === 'ready');
    const started = Date.now();
    const item = (await send('POST', `/spaces/${space.id}/items`, c.owner!, { type: 'task', title: 'Live one' })).json();
    const change = await s.waitFor((e) => e.event === 'change' && e.data.itemIds.includes(item.id), 1000);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(change.data).toMatchObject({ spaceId: space.id, actorId: u.owner!.id });
    expect(change.data.kinds).toContain('created');
    s.close();
  });

  it('refuses people who cannot open the space, and keeps workspaces apart', async () => {
    const denied = await openStream(space.key, c.outsider!);
    expect(denied.status).toBe(404);
    denied.close();
    const gx = await openStream(gxSpace.key, c.gx!, 'globex');
    await gx.waitFor((e) => e.event === 'ready');
    // The acme space's id at the globex address finds nothing.
    const cross = await openStream(space.id, c.gx!, 'globex');
    expect(cross.status).toBe(404);
    cross.close();
    await send('POST', `/spaces/${space.id}/items`, c.owner!, { type: 'task', title: 'Not for globex' });
    await new Promise((r) => setTimeout(r, 400));
    expect(gx.events.filter((e) => e.event === 'change')).toEqual([]);
    gx.close();
  });

  it('announces nothing when a change fails', async () => {
    const s = await openStream(space.key, c.member!);
    await s.waitFor((e) => e.event === 'ready');
    const item = (await send('POST', `/spaces/${space.id}/items`, c.owner!, { type: 'task', title: 'Stale' })).json();
    await s.waitFor((e) => e.event === 'change' && e.data.itemIds.includes(item.id));
    const before = s.events.length;
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: { host: 'acme.localhost:3000', 'if-match': '2000-01-01T00:00:00.000Z' },
      cookies: { cd_session: c.owner! },
      payload: { title: 'Never saved' },
    });
    expect(res.statusCode).toBe(412);
    await new Promise((r) => setTimeout(r, 400));
    expect(s.events.slice(before).filter((e) => e.event === 'change')).toEqual([]);
    s.close();
  });

  it('closes the stream when access is taken away', async () => {
    const s = await openStream(space.key, c.member!);
    await s.waitFor((e) => e.event === 'ready');
    const members = (await send('GET', `/spaces/${space.id}/members`, c.owner!)).json().items as Json[];
    const entry = members.find((m) => m.principalId === u.member!.id)!;
    expect((await send('DELETE', `/spaces/${space.id}/members/${entry.id}`, c.owner!)).statusCode).toBe(200);
    await s.waitFor((e) => e.event === 'revoked', 2000);
    await new Promise((r) => setTimeout(r, 100));
    expect(s.ended).toBe(true);
  });

  it('sends heartbeats so proxies keep the stream open', async () => {
    const raw: string[] = [];
    await new Promise<void>((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/api/v1/spaces/${space.key}/events`, headers: { host: 'acme.localhost:3000', cookie: `cd_session=${c.owner!}` } },
        (res) => {
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          expect(res.headers['x-accel-buffering']).toBe('no');
          res.setEncoding('utf8');
          res.on('data', (d: string) => raw.push(d));
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 500);
        },
      );
      req.on('error', () => undefined);
    });
    expect(raw.join('')).toContain(': ping');
  });
});
