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
const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['member', 'member'],
    ['viewer', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`wf-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.gx = await ensureUser({ orgId: ids.globex, email: uniqueEmail('wf-gx', 'globex.test'), role: 'owner' });
  c.gx = await signInAs(t.app, 'globex', u.gx);
});

const key = () => `W${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
async function space() {
  const res = await send('POST', '/spaces', c.owner!, {
    key: key(),
    name: 'Workflow',
    members: [
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
  expect(res.statusCode, res.body).toBe(200);
  const sp = res.json() as Json;
  const statuses = ((await send('GET', `/spaces/${sp.id}/statuses`, c.owner!)).json().items as Json[]);
  const by = (name: string) => statuses.find((s) => s.name === name)!;
  return { sp, todo: by('To Do'), doing: by('In Progress'), review: by('In Review'), done: by('Done') };
}
const item = async (sp: Json, body: Json = {}) => {
  const res = await send('POST', `/spaces/${sp.id}/items`, c.member!, { type: 'story', title: 'Story', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const get = async (id: string) => (await send('GET', `/items/${id}`, c.member!)).json() as Json;
/** A request carrying the item's latest version, as the web app sends it. */
const withVersion = async (method: 'PATCH' | 'POST', url: string, it: Json, payload: Json, cookie = c.member!) =>
  t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { host: 'acme.localhost:3000', 'if-match': (await get(it.id)).updatedAt },
    cookies: { cd_session: cookie },
    payload,
  });
const patch = (it: Json, payload: Json, cookie = c.member!) => withVersion('PATCH', `/items/${it.id}`, it, payload, cookie);

describe('workflow rules', () => {
  it('are open by default, then limit moves from the statuses that list targets', async () => {
    const { sp, todo, doing, review, done } = await space();
    const open = (await send('GET', `/spaces/${sp.id}/workflow`, c.viewer!)).json();
    expect(open).toMatchObject({ restricted: false, transitions: {}, permissions: { manage: false } });

    const a = await item(sp);
    // Only admins write rules.
    const rules = { restricted: true, transitions: { [todo.id]: [doing.id], [doing.id]: [review.id, done.id, todo.id] } };
    expect((await send('PUT', `/spaces/${sp.id}/workflow`, c.member!, rules)).statusCode).toBe(403);
    expect((await send('PUT', `/spaces/${sp.id}/workflow`, c.owner!, rules)).statusCode).toBe(200);

    const no = await patch(a, { statusId: done.id });
    expect(no.statusCode).toBe(422);
    expect(no.json().code).toBe('transition_not_allowed');
    expect(no.json().message).toContain('To Do');
    expect((await patch(a, { statusId: doing.id })).statusCode).toBe(200);
    expect((await patch(a, { statusId: done.id })).statusCode).toBe(200);
    // Done is not listed as a source, so it is unrestricted.
    expect((await patch(a, { statusId: todo.id })).statusCode).toBe(200);
  });

  it('applies to moves and bulk moves, reporting each refused item', async () => {
    const { sp, todo, doing, done } = await space();
    await send('PUT', `/spaces/${sp.id}/workflow`, c.owner!, { restricted: true, transitions: { [todo.id]: [doing.id] } });
    const a = await item(sp);
    const b = await item(sp);
    const mv = await withVersion('POST', `/items/${a.id}/move`, a, { statusId: done.id });
    expect(mv.statusCode).toBe(422);
    const bulk = await send('POST', '/items/bulk', c.member!, { action: 'move', ids: [a.id, b.id], statusId: done.id });
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect(bulk.json().updated).toBe(0);
    expect(bulk.json().failed).toHaveLength(2);
    const ok = await send('POST', '/items/bulk', c.member!, { action: 'move', ids: [a.id, b.id], statusId: doing.id });
    expect(ok.json()).toMatchObject({ updated: 2, failed: [] });
  });

  it('refuses statuses from another space and is private to the workspace', async () => {
    const { sp, todo } = await space();
    const other = await space();
    const bad = await send('PUT', `/spaces/${sp.id}/workflow`, c.owner!, { restricted: true, transitions: { [todo.id]: [other.todo.id] } });
    expect(bad.statusCode).toBe(422);
    expect((await send('GET', `/spaces/${sp.id}/workflow`, c.gx!, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('PUT', `/spaces/${sp.id}/workflow`, c.gx!, { restricted: false, transitions: {} }, 'globex')).statusCode).toBe(404);
  });
});

describe('resolution', () => {
  it('is set with a Done status, can be changed there, and clears when work reopens', async () => {
    const { sp, todo, done } = await space();
    const a = await item(sp);
    expect((await get(a.id)).resolution).toBeNull();
    expect((await patch(a, { resolution: 'wont_do' })).statusCode).toBe(422);
    expect((await patch(a, { statusId: done.id })).json().resolution).toBe('done');
    expect((await patch(a, { resolution: 'duplicate' })).json().resolution).toBe('duplicate');
    expect((await patch(a, { statusId: todo.id })).json().resolution).toBeNull();
    const b = await item(sp);
    expect((await patch(b, { statusId: done.id, resolution: 'cannot_reproduce' })).json().resolution).toBe('cannot_reproduce');
  });
});

describe('dependencies', () => {
  it('count open blockers and open blocked items, and the Blocked filter finds them', async () => {
    const { sp, done } = await space();
    const blocker = await item(sp, { title: 'Blocker' });
    const waiting = await item(sp, { title: 'Waiting' });
    const link = await send('POST', `/items/${blocker.id}/links`, c.member!, { target: waiting.id, linkType: 'blocks' });
    expect(link.statusCode, link.body).toBe(200);
    expect(await get(waiting.id)).toMatchObject({ blockedBy: 1, blocks: 0 });
    expect(await get(blocker.id)).toMatchObject({ blockedBy: 0, blocks: 1 });

    const blocked = (await send('GET', `/spaces/${sp.id}/list?types=cards&blocked=1`, c.member!)).json();
    expect((blocked.items as Json[]).map((i) => i.id)).toEqual([waiting.id]);

    // Finishing the blocker clears the badge on the item it was holding up.
    expect((await patch(blocker, { statusId: done.id })).statusCode).toBe(200);
    expect(await get(waiting.id)).toMatchObject({ blockedBy: 0 });
  });
});

describe('checklists', () => {
  it('belong to the item, show progress, and need distinct entries', async () => {
    const { sp } = await space();
    const a = await item(sp);
    expect((await get(a.id)).checklist).toMatchObject({ total: 0, done: 0, items: [] });
    const list = [
      { id: 'a', text: 'Write it', done: true },
      { id: 'b', text: 'Review it', done: false },
    ];
    const saved = await patch(a, { checklist: list });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().checklist).toMatchObject({ total: 2, done: 1, items: list });
    expect((await patch(a, { checklist: [list[0], list[0]] })).statusCode).toBe(422);
    expect((await patch(a, { checklist: [{ id: 'x', text: '', done: false }] })).statusCode).toBe(400);
    // A viewer cannot change it.
    expect((await patch(a, { checklist: [] }, c.viewer!)).statusCode).toBe(403);
    const activity = (await send('GET', `/items/${a.id}/activity`, c.member!)).json().items as Json[];
    expect(activity.some((e) => e.field === 'checklist')).toBe(true);
    // Duplicating copies it with fresh entry ids.
    const copy = (await send('POST', `/items/${a.id}/duplicate`, c.member!, {})).json();
    expect(copy.checklist).toMatchObject({ total: 2, done: 1 });
    expect(copy.checklist.items[0].id).not.toBe('a');
  });

  it('can be started from a template that admins manage', async () => {
    const { sp } = await space();
    const make = (payload: Json, cookie = c.owner!) => send('POST', `/spaces/${sp.id}/checklist-templates`, cookie, payload);
    expect((await make({ name: 'Release', items: ['Tag', 'Notes'] }, c.member!)).statusCode).toBe(403);
    const created = await make({ name: 'Release', items: ['Tag', 'Notes'] });
    expect(created.statusCode, created.body).toBe(200);
    expect((await make({ name: 'release', items: ['x'] })).statusCode).toBe(409);
    expect((await make({ name: 'Empty', items: [] })).statusCode).toBe(400);
    const list = (await send('GET', `/spaces/${sp.id}/checklist-templates`, c.viewer!)).json();
    expect(list.items).toEqual([{ id: created.json().id, name: 'Release', items: ['Tag', 'Notes'] }]);
    expect((await send('GET', `/spaces/${sp.id}/checklist-templates`, c.gx!, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('DELETE', `/checklist-templates/${created.json().id}`, c.member!)).statusCode).toBe(403);
    expect((await send('DELETE', `/checklist-templates/${created.json().id}`, c.owner!)).statusCode).toBe(200);
  });
});
