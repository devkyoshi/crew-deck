import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanFileName, signFileUrl } from '../src/storage/index.js';
import { adminDb, caller, createOrg, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Space = { id: string; key: string };

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
]);
const DEV_SECRET = 'development-only-file-link-secret-not-for-production';

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
let space: Space;

const send = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

/** Uploads one file as multipart/form-data. */
function upload(itemId: string, cookie: string, file: { name: string; body: Buffer; type?: string }, slug = 'acme') {
  const boundary = `----cd${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return t.app.inject({
    method: 'POST',
    url: `/api/v1/items/${itemId}/attachments`,
    headers: { host: `${slug}.localhost:3000`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    cookies: { cd_session: cookie },
    payload: body,
  });
}

const fetchFile = (url: string, slug = 'acme') =>
  t.app.inject({ method: 'GET', url, headers: { host: `${slug}.localhost:3000` } });

async function mkSpace(cookie: string, slug = 'acme', extra: Json = {}): Promise<Space> {
  const key = `F${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const res = await send('POST', '/spaces', cookie, { key, name: 'Files', ...extra }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
const mkItem = async (sp: Space, cookie: string, slug = 'acme') => {
  const res = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'With files' }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['member', 'member'],
    ['other', 'member'],
    ['viewer', 'member'],
    ['outsider', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`at-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.globex = await ensureUser({ orgId: ids.globex, email: uniqueEmail('at-gx', 'globex.test'), role: 'owner' });
  c.globex = await signInAs(t.app, 'globex', u.globex);
  space = await mkSpace(c.owner!, 'acme', {
    visibility: 'private',
    members: [
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.other!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
});

describe('attachments', () => {
  it('uploads an image, lists it with a signed link, serves it inline, and records it', async () => {
    const item = await mkItem(space, c.member!);
    const res = await upload(item.id, c.member!, { name: 'site photo.png', body: PNG, type: 'image/png' });
    expect(res.statusCode, res.body).toBe(200);
    const a = res.json();
    expect(a).toMatchObject({ name: 'site photo.png', mime: 'image/png', isImage: true, size: PNG.length });

    const list = (await send('GET', `/items/${item.id}/attachments`, c.viewer!)).json();
    expect(list.items).toHaveLength(1);
    expect(list.permissions.add).toBe(false);
    expect(list.items[0].permissions.delete).toBe(false);

    const file = await fetchFile(list.items[0].url);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['content-disposition']).toMatch(/^inline;/);
    expect(file.headers['cache-control']).toBe('private, max-age=600');
    expect(file.rawPayload.equals(PNG)).toBe(true);

    const events = (await send('GET', `/items/${item.id}/activity`, c.member!)).json().items;
    expect(events[0]).toMatchObject({ kind: 'attachment_added', newValue: { name: 'site photo.png' } });
  });

  it('downloads anything that is not a real image, whatever it claims to be', async () => {
    const item = await mkItem(space, c.member!);
    const svg = await upload(item.id, c.member!, {
      name: 'logo.svg',
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      type: 'image/svg+xml',
    });
    expect(svg.statusCode, svg.body).toBe(200);
    expect(svg.json().isImage).toBe(false);
    const file = await fetchFile(svg.json().url);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('refuses programs and scripts, empty files, and viewers or outsiders', async () => {
    const item = await mkItem(space, c.member!);
    const exe = await upload(item.id, c.member!, { name: 'invoice.pdf', body: Buffer.from('MZ\x90\x00binary') });
    expect(exe.statusCode).toBe(415);
    const sh = await upload(item.id, c.member!, { name: 'run.sh', body: Buffer.from('echo hi') });
    expect(sh.statusCode).toBe(415);
    const empty = await upload(item.id, c.member!, { name: 'empty.txt', body: Buffer.alloc(0) });
    expect(empty.statusCode).toBe(422);
    expect((await upload(item.id, c.viewer!, { name: 'a.txt', body: Buffer.from('x') })).statusCode).toBe(403);
    expect((await upload(item.id, c.outsider!, { name: 'a.txt', body: Buffer.from('x') })).statusCode).toBe(404);
    expect((await send('GET', `/items/${item.id}/attachments`, c.member!)).json().items).toHaveLength(0);
  });

  it('cleans names so they cannot point anywhere', async () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Windows\\system32\\evil.dll')).toBe('evil.dll');
    expect(cleanFileName('..')).toBe('file');
    expect(cleanFileName('a\u0000b<>.txt')).toBe('ab.txt');
    const item = await mkItem(space, c.member!);
    const res = await upload(item.id, c.member!, { name: '../../secret.txt', body: Buffer.from('hello') });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().name).toBe('secret.txt');
  });

  it('lets uploaders and admins delete, not other members, and the link stops working', async () => {
    const item = await mkItem(space, c.member!);
    const a = (await upload(item.id, c.member!, { name: 'notes.txt', body: Buffer.from('notes') })).json();
    expect((await send('DELETE', `/attachments/${a.id}`, c.other!)).statusCode).toBe(403);
    expect((await send('DELETE', `/attachments/${a.id}`, c.viewer!)).statusCode).toBe(403);
    expect((await send('DELETE', `/attachments/${a.id}`, c.member!)).statusCode).toBe(200);
    expect((await fetchFile(a.url)).statusCode).toBe(404);
    const b = (await upload(item.id, c.member!, { name: 'more.txt', body: Buffer.from('more') })).json();
    expect((await send('DELETE', `/attachments/${b.id}`, c.owner!)).statusCode).toBe(200);
  });

  it('keeps workspaces apart: no access to another tenant’s attachment or link', async () => {
    const item = await mkItem(space, c.member!);
    const a = (await upload(item.id, c.member!, { name: 'ours.txt', body: Buffer.from('ours') })).json();
    expect((await send('GET', `/attachments/${a.id}`, c.globex!, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('DELETE', `/attachments/${a.id}`, c.globex!, undefined, 'globex')).statusCode).toBe(404);
    // A valid link only works at its own workspace's address.
    expect((await fetchFile(a.url, 'globex')).statusCode).toBe(404);
    // Even a link correctly signed for the other workspace finds nothing there.
    const forged = signFileUrl(DEV_SECRET, { attachmentId: a.id, orgId: ids.globex });
    expect((await fetchFile(forged, 'globex')).statusCode).toBe(404);
    // Files are stored under the uploader's workspace.
    const admin = adminDb();
    try {
      const doc = await admin.db.global.all.attachments.findOne({ id: a.id });
      expect(doc!.storageKey.startsWith(`${ids.acme}/`)).toBe(true);
    } finally {
      await admin.close();
    }
  });

  it('rejects tampered and expired links', async () => {
    const item = await mkItem(space, c.member!);
    const a = (await upload(item.id, c.member!, { name: 'x.txt', body: Buffer.from('x') })).json();
    expect((await fetchFile(a.url)).statusCode).toBe(200);
    expect((await fetchFile(`${a.url.slice(0, -2)}xx`)).statusCode).toBe(404);
    expect((await fetchFile(a.url.replace(/e=(\d+)/, (_m: string, e: string) => `e=${Number(e) + 3600}`))).statusCode).toBe(404);
    const old = signFileUrl(DEV_SECRET, { attachmentId: a.id, orgId: ids.acme }, Date.now() - 60 * 60 * 1000);
    expect((await fetchFile(old)).statusCode).toBe(404);
    // A link without a workspace address (the bare API host) opens nothing.
    expect((await t.app.inject({ method: 'GET', url: a.url, headers: { host: 'localhost:4000' } })).statusCode).toBe(404);
  });
});

describe('attachment limits', () => {
  it('enforces the plan’s file size and storage limits, and counts storage in usage', async () => {
    const { org, slug, owner } = await createOrg('files');
    const admin = adminDb();
    try {
      await admin.db.global.organizations.updateOne(
        { id: org.id },
        { planKey: 'free', limitOverrides: { max_attachment_mb: 1, storage_mb: 2, spaces: 10, work_items: 100 } },
      );
    } finally {
      await admin.close();
    }
    const cookie = await signInAs(t.app, slug, owner);
    const sp = await mkSpace(cookie, slug);
    const item = await mkItem(sp, cookie, slug);
    const MB = 1024 * 1024;

    const big = await upload(item.id, cookie, { name: 'big.bin', body: Buffer.alloc(MB + 10, 1) }, slug);
    expect(big.statusCode, big.body).toBe(413);
    expect((await send('GET', `/items/${item.id}/attachments`, cookie, undefined, slug)).json()).toMatchObject({
      items: [],
      maxFileMb: 1,
    });

    for (const n of [1, 2]) {
      const ok = await upload(item.id, cookie, { name: `part${n}.bin`, body: Buffer.alloc(MB - 100, 1) }, slug);
      expect(ok.statusCode, ok.body).toBe(200);
    }
    const over = await upload(item.id, cookie, { name: 'part3.bin', body: Buffer.alloc(1000, 1) }, slug);
    expect(over.statusCode).toBe(402);
    expect(over.json().code).toBe('plan_limit');

    const usage = (await send('GET', '/plan', cookie, undefined, slug)).json();
    expect(usage.usage.storage_mb).toBe(2);
  });
});
