import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDb, caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let ids: Awaited<ReturnType<typeof tenantIds>>;
let brightlyId = '';
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

beforeAll(async () => {
  ids = await tenantIds();
  const admin = adminDb();
  try {
    brightlyId = (await admin.db.global.organizations.find({})).find((o) => o.slug === 'brightly')!.id;
  } finally {
    await admin.close();
  }
  for (const [name, role] of [
    ['owner', 'owner'],
    ['member', 'member'],
    ['viewer', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`ver-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.gx = await ensureUser({ orgId: ids.globex, email: uniqueEmail('ver-gx', 'globex.test'), role: 'owner' });
  c.gx = await signInAs(t.app, 'globex', u.gx);
  u.free = await ensureUser({ orgId: brightlyId, email: uniqueEmail('ver-free', 'brightly.test'), role: 'owner' });
  c.free = await signInAs(t.app, 'brightly', u.free);
});

const key = () => `V${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
async function space(cookie = c.owner!, slug = 'acme', members = true) {
  const res = await send(
    'POST',
    '/spaces',
    cookie,
    {
      key: key(),
      name: 'Releases',
      ...(members
        ? {
            members: [
              { type: 'user', id: u.member!.id, role: 'member' },
              { type: 'user', id: u.viewer!.id, role: 'viewer' },
            ],
          }
        : {}),
    },
    slug,
  );
  expect(res.statusCode, res.body).toBe(200);
  const sp = res.json() as Json;
  const statuses = (await send('GET', `/spaces/${sp.id}/statuses`, cookie, undefined, slug)).json().items as Json[];
  return { sp, done: statuses.find((s) => s.category === 'done')!, todo: statuses.find((s) => s.category === 'todo')! };
}
const mkVersion = async (sp: Json, body: Json = {}, cookie = c.member!) => {
  const res = await send('POST', `/spaces/${sp.id}/versions`, cookie, { name: `v${Math.random().toString(36).slice(2, 6)}`, ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const item = async (sp: Json, body: Json = {}) => {
  const res = await send('POST', `/spaces/${sp.id}/items`, c.member!, { type: 'story', title: 'Story', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const patch = async (it: Json, payload: Json) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/v1/items/${it.id}`,
    headers: { host: 'acme.localhost:3000', 'if-match': ((await send('GET', `/items/${it.id}`, c.member!)).json() as Json).updatedAt },
    cookies: { cd_session: c.member! },
    payload,
  });
const get = async (id: string) => (await send('GET', `/items/${id}`, c.member!)).json() as Json;

describe('versions', () => {
  it('are created by members, named once, dated sensibly, and hidden from other workspaces', async () => {
    const { sp } = await space();
    expect((await send('POST', `/spaces/${sp.id}/versions`, c.viewer!, { name: 'v1' })).statusCode).toBe(403);
    const v = await mkVersion(sp, { name: 'v1.0', releaseDate: '2026-12-01' });
    expect(v).toMatchObject({ name: 'v1.0', state: 'unreleased', total: 0, done: 0 });
    expect((await send('POST', `/spaces/${sp.id}/versions`, c.member!, { name: 'V1.0' })).statusCode).toBe(409);
    const bad = await send('POST', `/spaces/${sp.id}/versions`, c.member!, { name: 'v2', startDate: '2026-12-05', releaseDate: '2026-12-01' });
    expect(bad.statusCode).toBe(422);

    const list = (await send('GET', `/spaces/${sp.id}/versions`, c.viewer!)).json();
    expect(list.items).toHaveLength(1);
    expect(list.feature).toBe(true);
    expect(list.permissions).toMatchObject({ manage: false, release: false });
    expect((await send('GET', `/spaces/${sp.id}/versions`, c.gx!, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('PATCH', `/versions/${v.id}`, c.gx!, { name: 'x' }, 'globex')).statusCode).toBe(404);

    const renamed = await send('PATCH', `/versions/${v.id}`, c.member!, { name: 'v1.1' });
    expect(renamed.json().name).toBe('v1.1');
    expect((await send('DELETE', `/versions/${v.id}`, c.viewer!)).statusCode).toBe(403);
    expect((await send('DELETE', `/versions/${v.id}`, c.member!)).statusCode).toBe(200);
  });

  it('are an upgrade on the Free plan', async () => {
    const { sp } = await space(c.free, 'brightly', false);
    const res = await send('POST', `/spaces/${sp.id}/versions`, c.free!, { name: 'v1' }, 'brightly');
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('feature_locked');
    const list = (await send('GET', `/spaces/${sp.id}/versions`, c.free!, undefined, 'brightly')).json();
    expect(list).toMatchObject({ items: [], feature: false });
  });

  it('attach to items, count progress, filter, and are checked against the space', async () => {
    const { sp, done } = await space();
    const other = await space();
    const v1 = await mkVersion(sp, { name: 'one' });
    const foreign = await mkVersion(other.sp, { name: 'elsewhere' });
    const a = await item(sp, { fixVersionIds: [v1.id] });
    const b = await item(sp, { type: 'bug', title: 'Bug', fixVersionIds: [v1.id], affectsVersionIds: [v1.id] });
    const loose = await item(sp);
    expect(a.fixVersions).toEqual([{ id: v1.id, name: 'one', state: 'unreleased' }]);
    expect(b.affectsVersions).toHaveLength(1);

    const wrong = await send('POST', `/spaces/${sp.id}/items`, c.member!, { type: 'story', title: 'No', fixVersionIds: [foreign.id] });
    expect(wrong.statusCode).toBe(422);
    expect((await patch(loose, { fixVersionIds: [foreign.id] })).statusCode).toBe(422);
    expect((await patch(loose, { fixVersionIds: [v1.id] })).json().fixVersions).toHaveLength(1);
    expect((await patch(loose, { fixVersionIds: [] })).json().fixVersions).toHaveLength(0);

    expect((await patch(a, { statusId: done.id })).statusCode).toBe(200);
    const list = (await send('GET', `/spaces/${sp.id}/versions`, c.member!)).json();
    expect(list.items[0]).toMatchObject({ total: 2, done: 1, open: 1 });

    const filtered = (await send('GET', `/spaces/${sp.id}/list?version=${v1.id}`, c.member!)).json().items as Json[];
    expect(filtered.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    const none = (await send('GET', `/spaces/${sp.id}/list?version=none`, c.member!)).json().items as Json[];
    expect(none.map((i) => i.id)).toEqual([loose.id]);
  });

  it('release moves unfinished work on or drops it, once, and only for admins', async () => {
    const { sp, done } = await space();
    const v1 = await mkVersion(sp, { name: 'one' });
    const v2 = await mkVersion(sp, { name: 'two' });
    const shipped = await item(sp, { title: 'Shipped', fixVersionIds: [v1.id] });
    const open = await item(sp, { title: 'Open', fixVersionIds: [v1.id] });
    await patch(shipped, { statusId: done.id });

    expect((await send('POST', `/versions/${v1.id}/release`, c.member!, {})).statusCode).toBe(403);
    expect((await send('POST', `/versions/${v1.id}/release`, c.owner!, { moveOpenTo: v1.id })).statusCode).toBe(422);
    const res = await send('POST', `/versions/${v1.id}/release`, c.owner!, { moveOpenTo: v2.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ moved: 1, removed: 0 });
    expect((await get(open.id)).fixVersions.map((v: Json) => v.name)).toEqual(['two']);
    expect((await get(shipped.id)).fixVersions.map((v: Json) => v.name)).toEqual(['one']);
    const list = (await send('GET', `/spaces/${sp.id}/versions`, c.member!)).json().items as Json[];
    const released = list.find((v) => v.id === v1.id)!;
    expect(released.state).toBe('released');
    expect(released.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await send('POST', `/versions/${v1.id}/release`, c.owner!, {})).statusCode).toBe(409);
    expect((await send('PATCH', `/versions/${v1.id}`, c.member!, { state: 'unreleased' })).statusCode).toBe(409);
    // A released version can still be hidden away.
    expect((await send('PATCH', `/versions/${v1.id}`, c.member!, { state: 'archived' })).json().state).toBe('archived');

    // Releasing with no destination just takes unfinished work out.
    const v3 = await mkVersion(sp, { name: 'three' });
    const stray = await item(sp, { fixVersionIds: [v3.id] });
    expect((await send('POST', `/versions/${v3.id}/release`, c.owner!, {})).json()).toMatchObject({ moved: 0, removed: 1 });
    expect((await get(stray.id)).fixVersions).toEqual([]);
  });

  it('give release notes grouped by type, leaving out work that did not ship', async () => {
    const { sp, done } = await space();
    const v = await mkVersion(sp, { name: 'notes' });
    const story = await item(sp, { title: 'A story', fixVersionIds: [v.id] });
    const bug = await item(sp, { type: 'bug', title: 'A bug', fixVersionIds: [v.id] });
    const skipped = await item(sp, { title: 'Skipped', fixVersionIds: [v.id] });
    const pending = await item(sp, { title: 'Pending', fixVersionIds: [v.id] });
    for (const it of [story, bug]) await patch(it, { statusId: done.id });
    await patch(skipped, { statusId: done.id, resolution: 'wont_do' });
    const notes = (await send('GET', `/versions/${v.id}/notes`, c.viewer!)).json();
    expect(notes.groups.map((g: Json) => [g.type, g.items.map((i: Json) => i.title)])).toEqual([
      ['story', ['A story']],
      ['bug', ['A bug']],
    ]);
    expect(notes.notShipped.map((i: Json) => i.title).sort()).toEqual(['Pending', 'Skipped']);
    void pending;
  });

  it('are removed from items when deleted, and copied by duplicate but not by transfer', async () => {
    const { sp } = await space();
    const to = await space();
    const v = await mkVersion(sp, { name: 'gone' });
    const a = await item(sp, { fixVersionIds: [v.id] });
    const dup = (await send('POST', `/items/${a.id}/duplicate`, c.member!, {})).json();
    expect(dup.fixVersions).toHaveLength(1);
    const moved = (await send('POST', `/items/${a.id}/transfer`, c.member!, { spaceId: to.sp.id })).json();
    expect(moved.fixVersions).toEqual([]);
    expect((await send('DELETE', `/versions/${v.id}`, c.member!)).statusCode).toBe(200);
    expect((await get(dup.id)).fixVersions).toEqual([]);
  });
});

describe('components', () => {
  it('are managed by admins, named once, and visible to everyone in the space', async () => {
    const { sp } = await space();
    const make = (payload: Json, cookie = c.owner!) => send('POST', `/spaces/${sp.id}/components`, cookie, payload);
    expect((await make({ name: 'API' }, c.member!)).statusCode).toBe(403);
    const api = await make({ name: 'API', leadId: u.member!.id });
    expect(api.statusCode, api.body).toBe(200);
    expect(api.json().lead.id).toBe(u.member!.id);
    expect((await make({ name: 'api' })).statusCode).toBe(409);
    // Someone who cannot open the space cannot lead it.
    expect((await make({ name: 'Web', leadId: u.gx!.id })).statusCode).toBe(422);
    const list = (await send('GET', `/spaces/${sp.id}/components`, c.viewer!)).json();
    expect(list.items).toHaveLength(1);
    expect(list.permissions.manageComponents).toBe(false);
    expect((await send('GET', `/spaces/${sp.id}/components`, c.gx!, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('PATCH', `/components/${api.json().id}`, c.member!, { name: 'x' })).statusCode).toBe(403);
    expect((await send('PATCH', `/components/${api.json().id}`, c.owner!, { name: 'Backend' })).json().name).toBe('Backend');
  });

  it('hand new work to the default assignee, unless someone is chosen', async () => {
    const { sp } = await space();
    const comp = (
      await send('POST', `/spaces/${sp.id}/components`, c.owner!, { name: 'Billing', defaultAssigneeId: u.member!.id })
    ).json();
    const auto = await item(sp, { componentIds: [comp.id] });
    expect(auto.assignee?.id).toBe(u.member!.id);
    expect(auto.components).toEqual([{ id: comp.id, name: 'Billing' }]);
    const chosen = await item(sp, { componentIds: [comp.id], assigneeId: u.owner!.id });
    expect(chosen.assignee.id).toBe(u.owner!.id);
    const plain = await item(sp);
    expect(plain.assignee).toBeNull();

    const filtered = (await send('GET', `/spaces/${sp.id}/list?component=${comp.id}`, c.member!)).json().items as Json[];
    expect(filtered.map((i) => i.id).sort()).toEqual([auto.id, chosen.id].sort());
    expect((await patch(plain, { componentIds: [comp.id] })).json().components).toHaveLength(1);
    expect((await send('DELETE', `/components/${comp.id}`, c.owner!)).statusCode).toBe(200);
    expect((await get(plain.id)).components).toEqual([]);
  });
});
