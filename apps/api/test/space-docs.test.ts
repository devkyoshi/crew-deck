import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

function upload(spaceId: string, cookie: string, file: { name: string; body: Buffer; type?: string }, folder?: string, slug = 'acme') {
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
    url: `/api/v1/spaces/${spaceId}/files${folder ? `?folder=${folder}` : ''}`,
    headers: { host: `${slug}.localhost:3000`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    cookies: { cd_session: cookie },
    payload: body,
  });
}
const fetchFile = (url: string, slug = 'acme') =>
  t.app.inject({ method: 'GET', url, headers: { host: `${slug}.localhost:3000` } });

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['member', 'member'],
    ['member2', 'member'],
    ['viewer', 'member'],
    ['outsider', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`doc-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.gx = await ensureUser({ orgId: ids.globex, email: uniqueEmail('doc-gx', 'globex.test'), role: 'owner' });
  c.gx = await signInAs(t.app, 'globex', u.gx);
});

const key = () => `D${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
async function space(visibility: 'open' | 'private' = 'private') {
  const res = await send('POST', '/spaces', c.owner!, {
    key: key(),
    name: 'Docs',
    visibility,
    members: [
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.member2!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
}
const folder = async (sp: Json, name: string, parentId: string | null = null, cookie = c.member!) => {
  const res = await send('POST', `/spaces/${sp.id}/folders`, cookie, { name, parentId });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const browse = async (sp: Json, folderId?: string, cookie = c.member!) =>
  (await send('GET', `/spaces/${sp.id}/documents${folderId ? `?folder=${folderId}` : ''}`, cookie)).json() as Json;

describe('folders', () => {
  it('nest, are listed in order, and keep one name per level', async () => {
    const sp = await space();
    const specs = await folder(sp, 'Specs');
    await folder(sp, 'Contracts');
    const drafts = await folder(sp, 'Drafts', specs.id);
    expect((await send('POST', `/spaces/${sp.id}/folders`, c.member!, { name: 'specs' })).statusCode).toBe(409);
    expect((await send('POST', `/spaces/${sp.id}/folders`, c.member!, { name: 'a/b' })).statusCode).toBe(400);
    // The same name is fine one level down.
    await folder(sp, 'Specs', specs.id);

    const top = await browse(sp);
    expect(top.folders.map((f: Json) => f.name)).toEqual(['Contracts', 'Specs']);
    const inside = await browse(sp, specs.id);
    expect(inside.path).toEqual([{ id: specs.id, name: 'Specs' }]);
    expect(inside.folders.map((f: Json) => f.name)).toEqual(['Drafts', 'Specs']);
    expect((await browse(sp, drafts.id)).path.map((p: Json) => p.name)).toEqual(['Specs', 'Drafts']);
  });

  it('can be renamed and moved, but never into themselves, and not beyond the depth limit', async () => {
    const sp = await space();
    const a = await folder(sp, 'A');
    const b = await folder(sp, 'B', a.id);
    expect((await send('PATCH', `/folders/${a.id}`, c.member!, { parentId: b.id })).statusCode).toBe(422);
    expect((await send('PATCH', `/folders/${a.id}`, c.member!, { parentId: a.id })).statusCode).toBe(422);
    expect((await send('PATCH', `/folders/${b.id}`, c.member!, { name: 'Renamed' })).json().name).toBe('Renamed');
    expect((await send('PATCH', `/folders/${b.id}`, c.member!, { parentId: null })).json().parentId).toBeNull();

    let parent: string | null = null;
    for (let i = 0; i < 8; i++) parent = (await folder(sp, `L${i}`, parent)).id;
    const tooDeep = await send('POST', `/spaces/${sp.id}/folders`, c.member!, { name: 'L8', parentId: parent });
    expect(tooDeep.statusCode).toBe(422);
    expect(tooDeep.json().code).toBe('too_deep');
  });

  it('are changed only by their maker or a space admin, and only admins delete full ones', async () => {
    const sp = await space();
    const mine = await folder(sp, 'Mine');
    expect((await send('POST', `/spaces/${sp.id}/folders`, c.viewer!, { name: 'No' })).statusCode).toBe(403);
    expect((await send('PATCH', `/folders/${mine.id}`, c.member2!, { name: 'Theirs' })).statusCode).toBe(403);
    expect((await send('PATCH', `/folders/${mine.id}`, c.owner!, { name: 'Admin renamed' })).statusCode).toBe(200);

    expect((await upload(sp.id, c.member!, { name: 'a.txt', body: Buffer.from('hello') }, mine.id)).statusCode).toBe(200);
    const full = await send('DELETE', `/folders/${mine.id}`, c.member!);
    expect(full.statusCode).toBe(403);
    const gone = await send('DELETE', `/folders/${mine.id}`, c.owner!);
    expect(gone.json()).toMatchObject({ ok: true, folders: 1, files: 1 });
    const empty = await folder(sp, 'Empty');
    expect((await send('DELETE', `/folders/${empty.id}`, c.member!)).statusCode).toBe(200);
  });
});

describe('files', () => {
  it('upload into a folder, download by a signed link, and rename on name clashes', async () => {
    const sp = await space();
    const f = await folder(sp, 'Specs');
    const res = await upload(sp.id, c.member!, { name: 'plan.pdf', body: Buffer.from('%PDF-1.4 hello') }, f.id);
    expect(res.statusCode, res.body).toBe(200);
    const file = res.json();
    expect(file).toMatchObject({ name: 'plan.pdf', folderId: f.id, size: 14 });

    const dl = await fetchFile(file.url);
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('%PDF-1.4 hello');
    expect(dl.headers['content-disposition']).toContain('attachment');
    // The link works only on its own workspace.
    expect((await fetchFile(file.url, 'globex')).statusCode).toBe(404);

    const second = (await upload(sp.id, c.member2!, { name: 'plan.pdf', body: Buffer.from('other') }, f.id)).json();
    expect(second.name).toBe('plan (2).pdf');
    const top = (await upload(sp.id, c.member!, { name: 'readme.txt', body: Buffer.from('x') })).json();
    expect(top.folderId).toBeNull();

    const listed = await browse(sp, f.id, c.viewer!);
    expect(listed.files.map((x: Json) => x.name).sort()).toEqual(['plan (2).pdf', 'plan.pdf']);
    expect(listed.permissions).toMatchObject({ add: false, delete: false });
    expect((await browse(sp)).files.map((x: Json) => x.name)).toEqual(['readme.txt']);
  });

  it('refuse programs, empty files, viewers, strangers and folders of another space', async () => {
    const sp = await space();
    const other = await space();
    const foreign = await folder(other, 'Elsewhere');
    expect((await upload(sp.id, c.member!, { name: 'setup.exe', body: Buffer.from('MZ\x90\x00') })).statusCode).toBe(415);
    expect((await upload(sp.id, c.member!, { name: 'empty.txt', body: Buffer.alloc(0) })).statusCode).toBe(422);
    expect((await upload(sp.id, c.viewer!, { name: 'a.txt', body: Buffer.from('x') })).statusCode).toBe(403);
    expect((await upload(sp.id, c.outsider!, { name: 'a.txt', body: Buffer.from('x') })).statusCode).toBe(404);
    expect((await upload(sp.id, c.gx!, { name: 'a.txt', body: Buffer.from('x') }, undefined, 'globex')).statusCode).toBe(404);
    expect((await upload(sp.id, c.member!, { name: 'a.txt', body: Buffer.from('x') }, foreign.id)).statusCode).toBe(422);
    expect((await send('GET', `/spaces/${sp.id}/documents`, c.outsider!)).statusCode).toBe(404);
    expect((await send('GET', `/spaces/${sp.id}/documents`, c.gx!, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('GET', `/spaces/${sp.id}/documents?folder=${foreign.id}`, c.member!)).statusCode).toBe(404);
  });

  it('are renamed, moved and deleted by their uploader or a space admin', async () => {
    const sp = await space();
    const f = await folder(sp, 'Archive');
    const file = (await upload(sp.id, c.member!, { name: 'notes.txt', body: Buffer.from('n') })).json();
    expect((await send('PATCH', `/space-files/${file.id}`, c.member2!, { name: 'x.txt' })).statusCode).toBe(403);
    expect((await send('DELETE', `/space-files/${file.id}`, c.viewer!)).statusCode).toBe(403);
    const moved = await send('PATCH', `/space-files/${file.id}`, c.member!, { name: 'minutes.txt', folderId: f.id });
    expect(moved.json()).toMatchObject({ name: 'minutes.txt', folderId: f.id });
    expect((await send('PATCH', `/space-files/${file.id}`, c.member!, { folderId: randomUUID() })).statusCode).toBe(422);
    expect((await send('PATCH', `/space-files/${file.id}`, c.owner!, { folderId: null })).json().folderId).toBeNull();

    expect((await send('DELETE', `/space-files/${file.id}`, c.owner!)).statusCode).toBe(200);
    expect((await fetchFile(file.url)).statusCode).toBe(404);
    expect((await send('DELETE', `/space-files/${file.id}`, c.owner!)).statusCode).toBe(404);
  });

  it('count toward the workspace storage', async () => {
    const sp = await space();
    const { storageBytes } = await import('../src/plans/index.js');
    const { appDb } = await import('./helpers.js');
    const read = async () => {
      const conn = appDb();
      try {
        return await storageBytes(conn.db.tenant(ids.acme));
      } finally {
        await conn.close();
      }
    };
    const before = await read();
    const file = (await upload(sp.id, c.member!, { name: 'big.txt', body: Buffer.alloc(5000, 'a') })).json();
    expect(await read()).toBe(before + 5000);
    await send('DELETE', `/space-files/${file.id}`, c.owner!);
    expect(await read()).toBe(before);
  });
});
