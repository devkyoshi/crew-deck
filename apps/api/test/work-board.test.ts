import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import { adminDb, caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';
import { runRebalance } from '../src/work/jobs.js';
import { rebalanceColumn } from '../src/work/service.js';

const rebalanceJobs: { orgId: string; spaceId: string; statusId: string }[] = [];
const t = makeApp({ enqueueRebalance: (job) => void rebalanceJobs.push(job) });
const call = caller(t.app);
afterAll(() => t.close());

// Response bodies are checked field by field, so loose typing keeps the tests readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Space = { id: string; key: string };
type U = { id: string; email: string };

let ids: Awaited<ReturnType<typeof tenantIds>>;
let owner: U, member: U, other: U, viewer: U, globexOwner: U;
const c = { owner: '', member: '', other: '', viewer: '', globex: '' };
let seq = 0;
const newKey = () => `B${Math.random().toString(36).slice(2, 6).toUpperCase()}${seq++ % 10}`;

const send = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: Json,
  slug = 'acme',
) => call({ method, url, slug, cookie, payload });

async function mkSpace(extra: Json = {}): Promise<Space> {
  const res = await send('POST', '/spaces', c.owner, {
    key: newKey(),
    name: 'Board',
    members: [
      { type: 'user', id: member.id, role: 'member' },
      { type: 'user', id: other.id, role: 'member' },
      { type: 'user', id: viewer.id, role: 'viewer' },
    ],
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
const statuses = async (sp: Space): Promise<Json[]> =>
  (await send('GET', `/spaces/${sp.id}/statuses`, c.owner)).json().items;
const statusNamed = async (sp: Space, name: string) => (await statuses(sp)).find((s) => s.name === name)!;
const mkItem = async (sp: Space, body: Json = {}, cookie = c.owner) => {
  const res = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'Item', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const move = (item: Json, cookie: string, body: Json, version: string = item.updatedAt, slug = 'acme') =>
  t.app.inject({
    method: 'POST',
    url: `/api/v1/items/${item.id}/move`,
    headers: { host: `${slug}.localhost:3000`, 'if-match': version },
    cookies: { cd_session: cookie },
    payload: body,
  });
const board = async (sp: Space, qs = '', cookie = c.owner): Promise<Json> =>
  (await send('GET', `/spaces/${sp.id}/board${qs}`, cookie)).json();
const titlesIn = (b: Json, statusId: string) =>
  b.columns.find((col: Json) => col.statusId === statusId).items.map((i: Json) => i.title);

beforeAll(async () => {
  ids = await tenantIds();
  const mk = (name: string, role: 'owner' | 'member' = 'member') =>
    ensureUser({ orgId: ids.acme, email: uniqueEmail(`wb-${name}`), role });
  owner = await mk('owner', 'owner');
  member = await mk('member');
  other = await mk('other');
  viewer = await mk('viewer');
  globexOwner = await ensureUser({ orgId: ids.globex, email: uniqueEmail('wb-gx', 'globex.test'), role: 'owner' });
  c.owner = await signInAs(t.app, 'acme', owner);
  c.member = await signInAs(t.app, 'acme', member);
  c.other = await signInAs(t.app, 'acme', other);
  c.viewer = await signInAs(t.app, 'acme', viewer);
  c.globex = await signInAs(t.app, 'globex', globexOwner);
});

describe('moving cards', () => {
  it('places a card between, above and below its neighbours in the same column', async () => {
    const sp = await mkSpace();
    const a = await mkItem(sp, { title: 'A' });
    const b = await mkItem(sp, { title: 'B' });
    const cc = await mkItem(sp, { title: 'C' });
    const todo = await statusNamed(sp, 'To Do');
    // C goes between A and B.
    let res = await move(cc, c.owner, { statusId: todo.id, afterItemId: a.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(titlesIn(await board(sp), todo.id)).toEqual(['A', 'C', 'B']);
    // B goes to the very top.
    res = await move(b, c.owner, { statusId: todo.id, beforeItemId: a.id });
    expect(titlesIn(await board(sp), todo.id)).toEqual(['B', 'A', 'C']);
    // A goes to the bottom (no neighbour = the end).
    res = await move(a, c.owner, { statusId: todo.id });
    expect(titlesIn(await board(sp), todo.id)).toEqual(['B', 'C', 'A']);
    expect((await res.json()).rank).toBeTruthy();
  });

  it('moves across columns, into an empty one, and sets and clears resolved_at', async () => {
    const sp = await mkSpace();
    const [todo, progress, done] = await Promise.all(['To Do', 'In Progress', 'Done'].map((n) => statusNamed(sp, n)));
    const x = await mkItem(sp, { title: 'X' });
    const y = await mkItem(sp, { title: 'Y' });
    let res = await move(x, c.owner, { statusId: progress!.id });
    expect(res.json().status.name).toBe('In Progress');
    expect(res.json().wip).toEqual({ limit: null, count: 1 });
    res = await move(y, c.owner, { statusId: progress!.id, beforeItemId: x.id });
    expect(titlesIn(await board(sp), progress!.id)).toEqual(['Y', 'X']);
    const finished = await move(res.json(), c.owner, { statusId: done!.id });
    expect(finished.json().resolvedAt).not.toBeNull();
    const reopened = await move(finished.json(), c.owner, { statusId: todo!.id });
    expect(reopened.json().resolvedAt).toBeNull();
  });

  it('keeps resolved_at when a finished card is only reordered inside Done', async () => {
    const sp = await mkSpace();
    const done = await statusNamed(sp, 'Done');
    const a = await mkItem(sp, { title: 'A', statusId: done.id });
    const b = await mkItem(sp, { title: 'B', statusId: done.id });
    const res = await move(b, c.owner, { statusId: done.id, beforeItemId: a.id });
    expect(res.json().resolvedAt).toBe(b.resolvedAt);
  });

  it('reports WIP usage and never blocks a move over the limit', async () => {
    const sp = await mkSpace();
    const progress = await statusNamed(sp, 'In Progress');
    await send('PATCH', `/statuses/${progress.id}`, c.owner, { wipLimit: 1 });
    const a = await mkItem(sp, { title: 'A' });
    const b = await mkItem(sp, { title: 'B' });
    await move(a, c.owner, { statusId: progress.id });
    const over = await move(b, c.owner, { statusId: progress.id });
    expect(over.statusCode).toBe(200);
    expect(over.json().wip).toEqual({ limit: 1, count: 2 });
  });

  it('requires If-Match and answers 412 for a stale move', async () => {
    const sp = await mkSpace();
    const todo = await statusNamed(sp, 'To Do');
    const a = await mkItem(sp, { title: 'A' });
    const noHeader = await t.app.inject({
      method: 'POST',
      url: `/api/v1/items/${a.id}/move`,
      headers: { host: 'acme.localhost:3000' },
      cookies: { cd_session: c.owner },
      payload: { statusId: todo.id },
    });
    expect(noHeader.statusCode).toBe(428);
    expect((await move(a, c.owner, { statusId: todo.id })).statusCode).toBe(200);
    const again = await move(a, c.owner, { statusId: todo.id });
    expect(again.statusCode).toBe(412);
    expect(again.json().code).toBe('stale');
  });

  it('rejects a neighbour that is not in the target column, or in another space', async () => {
    const sp = await mkSpace();
    const [todo, progress] = await Promise.all(['To Do', 'In Progress'].map((n) => statusNamed(sp, n)));
    const a = await mkItem(sp, { title: 'A' });
    const inProgress = await mkItem(sp, { title: 'P', statusId: progress!.id });
    const wrongColumn = await move(a, c.owner, { statusId: todo!.id, afterItemId: inProgress.id });
    expect(wrongColumn.statusCode).toBe(422);
    expect(wrongColumn.json().code).toBe('invalid_neighbor');
    const elsewhere = await mkItem(await mkSpace(), { title: 'Elsewhere' });
    expect((await move(a, c.owner, { statusId: todo!.id, afterItemId: elsewhere.id })).statusCode).toBe(422);
    expect((await move(a, c.owner, { statusId: todo!.id, afterItemId: a.id })).statusCode).toBe(422);
    const both = await move(a, c.owner, { statusId: todo!.id, afterItemId: elsewhere.id, beforeItemId: inProgress.id });
    expect(both.statusCode).toBe(400);
  });

  it('rejects a status from another space and keeps tenants apart', async () => {
    const sp = await mkSpace();
    const a = await mkItem(sp, { title: 'A' });
    const foreign = await statusNamed(await mkSpace(), 'To Do');
    expect((await move(a, c.owner, { statusId: foreign.id })).statusCode).toBe(422);
    const todo = await statusNamed(sp, 'To Do');
    expect((await move(a, c.globex, { statusId: todo.id }, a.updatedAt, 'globex')).statusCode).toBe(404);
  });

  it('is allowed for members, refused for viewers', async () => {
    const sp = await mkSpace();
    const done = await statusNamed(sp, 'Done');
    const a = await mkItem(sp, { title: 'A' }, c.other);
    expect((await move(a, c.viewer, { statusId: done.id })).statusCode).toBe(403);
    expect((await move(a, c.member, { statusId: done.id })).statusCode).toBe(200);
  });

  it('lets simultaneous drops into the same gap all succeed with distinct, ordered ranks', async () => {
    const sp = await mkSpace();
    const progress = await statusNamed(sp, 'In Progress');
    const first = await mkItem(sp, { title: 'First', statusId: progress.id });
    await mkItem(sp, { title: 'Last', statusId: progress.id });
    const movers = await Promise.all(Array.from({ length: 6 }, (_, i) => mkItem(sp, { title: `M${i}` })));
    const results = await Promise.all(
      movers.map((m) => move(m, c.owner, { statusId: progress.id, afterItemId: first.id })),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    const b = await board(sp);
    const col = b.columns.find((x: Json) => x.statusId === progress.id).items as Json[];
    expect(col).toHaveLength(8);
    expect(new Set(col.map((i) => i.rank)).size).toBe(8);
    expect(col[0]?.title).toBe('First');
    expect(col.at(-1)!.title).toBe('Last');
    const ranks = col.map((i) => i.rank);
    expect(ranks).toEqual([...ranks].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)));
  });

  it('changes the swimlane field on drop: assignee, priority and epic', async () => {
    const sp = await mkSpace();
    const progress = await statusNamed(sp, 'In Progress');
    const epic = await mkItem(sp, { type: 'epic', title: 'Epic' });
    const story = await mkItem(sp, { type: 'story', title: 'Story' });
    let res = await move(story, c.owner, {
      statusId: progress.id,
      assigneeId: member.id,
      priority: 'highest',
      epicId: epic.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ assignee: { id: member.id }, priority: 'highest', parent: { id: epic.id } });
    res = await move(res.json(), c.owner, { statusId: progress.id, assigneeId: null, epicId: null });
    expect(res.json().assignee).toBeNull();
    expect(res.json().parent).toBeNull();
    // A subtask cannot be dropped under an epic lane.
    const sub = await mkItem(sp, { type: 'subtask', title: 'Sub', parentId: story.id });
    expect((await move(sub, c.owner, { statusId: progress.id, epicId: epic.id })).statusCode).toBe(422);
  });

  it('queues a rank rebalance when a rank grows long, and rebalancing keeps the exact order', async () => {
    const sp = await mkSpace();
    const todo = await statusNamed(sp, 'To Do');
    const a = await mkItem(sp, { title: 'A' });
    const bItem = await mkItem(sp, { title: 'B' });
    const cItem = await mkItem(sp, { title: 'C' });
    // Two very close, already long ranks: a key between them is longer still.
    const admin = adminDb();
    try {
      const items = admin.db.tenant(ids.acme).workItems;
      await items.updateOne({ id: a.id }, { rank: 'a0' + 'V'.repeat(45) });
      await items.updateOne({ id: bItem.id }, { rank: 'a0' + 'V'.repeat(44) + 'W' });
    } finally {
      await admin.close();
    }
    const before = rebalanceJobs.length;
    const res = await move(cItem, c.owner, { statusId: todo.id, afterItemId: a.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rank.length).toBeGreaterThan(40);
    expect(rebalanceJobs.length).toBe(before + 1);
    const job = rebalanceJobs.at(-1)!;
    expect(job).toMatchObject({ orgId: ids.acme, spaceId: sp.id, statusId: todo.id });

    const orderBefore = titlesIn(await board(sp), todo.id);
    expect(orderBefore).toEqual(['A', 'C', 'B']);
    await runRebalance(t.db, job);
    const after = await board(sp);
    expect(titlesIn(after, todo.id)).toEqual(orderBefore);
    const col = after.columns.find((x: Json) => x.statusId === todo.id).items as Json[];
    expect(Math.max(...col.map((i) => i.rank.length))).toBeLessThan(10);
  });
});

describe('bulk changes', () => {
  it('moves, assigns, labels and deletes several items at once', async () => {
    const sp = await mkSpace();
    const progress = await statusNamed(sp, 'In Progress');
    const items = await Promise.all([1, 2, 3].map((n) => mkItem(sp, { title: `Bulk ${n}` })));
    const idsAll = items.map((i) => i.id);

    let res = await send('POST', '/items/bulk', c.owner, { action: 'move', ids: idsAll, statusId: progress.id });
    expect(res.json()).toEqual({ updated: 3, failed: [] });
    expect(titlesIn(await board(sp), progress.id)).toEqual(['Bulk 1', 'Bulk 2', 'Bulk 3']);

    res = await send('POST', '/items/bulk', c.owner, { action: 'assign', ids: idsAll, assigneeId: member.id });
    expect(res.json().updated).toBe(3);
    const label = (await send('POST', `/spaces/${sp.id}/labels`, c.owner, { name: 'urgent', color: 'red' })).json();
    res = await send('POST', '/items/bulk', c.owner, { action: 'label', ids: idsAll, labelId: label.id });
    expect(res.json().updated).toBe(3);
    let got = (await send('GET', `/items/${items[0]!.id}`, c.owner)).json();
    expect(got.assignee.id).toBe(member.id);
    expect(got.labels.map((l: Json) => l.name)).toEqual(['urgent']);
    await send('POST', '/items/bulk', c.owner, { action: 'label', ids: idsAll, labelId: label.id, mode: 'remove' });
    got = (await send('GET', `/items/${items[0]!.id}`, c.owner)).json();
    expect(got.labels).toEqual([]);

    res = await send('POST', '/items/bulk', c.owner, { action: 'delete', ids: idsAll });
    expect(res.json().updated).toBe(3);
    expect(titlesIn(await board(sp), progress.id)).toEqual([]);
  });

  it('applies per-item permissions: a member deletes only their own', async () => {
    const sp = await mkSpace();
    const mine = await mkItem(sp, { title: 'Mine' }, c.member);
    const theirs = await mkItem(sp, { title: 'Theirs' }, c.other);
    const res = await send('POST', '/items/bulk', c.member, { action: 'delete', ids: [mine.id, theirs.id] });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(1);
    expect(res.json().failed).toEqual([expect.objectContaining({ id: theirs.id, key: theirs.key })]);
    expect((await send('GET', `/items/${theirs.id}`, c.owner)).statusCode).toBe(200);
    expect((await send('GET', `/items/${mine.id}`, c.owner)).statusCode).toBe(404);
  });

  it('refuses viewers, more than 100 items, mixed spaces and other tenants', async () => {
    const sp = await mkSpace();
    const a = await mkItem(sp, { title: 'A' });
    const done = await statusNamed(sp, 'Done');
    const viewerTry = await send('POST', '/items/bulk', c.viewer, { action: 'move', ids: [a.id], statusId: done.id });
    expect(viewerTry.json().updated).toBe(0);
    expect(viewerTry.json().failed).toHaveLength(1);

    const tooMany = Array.from({ length: 101 }, () => '00000000-0000-4000-8000-000000000000');
    expect((await send('POST', '/items/bulk', c.owner, { action: 'delete', ids: tooMany })).statusCode).toBe(400);

    const b = await mkItem(await mkSpace(), { title: 'B' });
    const mixed = await send('POST', '/items/bulk', c.owner, { action: 'delete', ids: [a.id, b.id] });
    expect(mixed.statusCode).toBe(422);
    expect(mixed.json().code).toBe('multiple_spaces');

    const gx = await send('POST', '/items/bulk', c.globex, { action: 'delete', ids: [a.id] }, 'globex');
    expect(gx.statusCode).toBe(404);
    expect((await send('GET', `/items/${a.id}`, c.owner)).statusCode).toBe(200);
  });
});

describe('labels', () => {
  it('lets members create, space admins manage, and keeps names unique per space', async () => {
    const sp = await mkSpace();
    const made = await send('POST', `/spaces/${sp.id}/labels`, c.member, { name: 'Frontend', color: 'sky' });
    expect(made.statusCode, made.body).toBe(200);
    const dup = await send('POST', `/spaces/${sp.id}/labels`, c.other, { name: 'frontend' });
    expect(dup.statusCode).toBe(409);
    expect((await send('POST', `/spaces/${sp.id}/labels`, c.viewer, { name: 'Nope' })).statusCode).toBe(403);
    const id = made.json().id;
    expect((await send('PATCH', `/labels/${id}`, c.member, { name: 'FE' })).statusCode).toBe(403);
    const renamed = await send('PATCH', `/labels/${id}`, c.owner, { name: 'FE', color: 'teal' });
    expect(renamed.json()).toMatchObject({ name: 'FE', color: 'teal' });
    const list = (await send('GET', `/spaces/${sp.id}/labels`, c.viewer)).json().items;
    expect(list.map((l: Json) => l.name)).toEqual(['FE']);
    // The same name can exist in another space.
    expect((await send('POST', `/spaces/${(await mkSpace()).id}/labels`, c.owner, { name: 'FE' })).statusCode).toBe(200);
  });

  it('shows labels on items and cards, and refuses labels from another space', async () => {
    const sp = await mkSpace();
    const [a, b] = await Promise.all(['alpha', 'beta'].map(async (name) => (await send('POST', `/spaces/${sp.id}/labels`, c.owner, { name })).json()));
    const item = await mkItem(sp, { title: 'Labelled', labelIds: [b.id, a.id] });
    expect(item.labels.map((l: Json) => l.name)).toEqual(['alpha', 'beta']);
    const cards = (await board(sp)).columns.flatMap((col: Json) => col.items);
    expect(cards[0].labels).toHaveLength(2);

    const updated = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: { host: 'acme.localhost:3000', 'if-match': item.updatedAt },
      cookies: { cd_session: c.owner },
      payload: { labelIds: [a.id] },
    });
    expect(updated.json().labels.map((l: Json) => l.name)).toEqual(['alpha']);

    const foreign = (await send('POST', `/spaces/${(await mkSpace()).id}/labels`, c.owner, { name: 'foreign' })).json();
    const bad = await send('POST', `/spaces/${sp.id}/items`, c.owner, { type: 'task', title: 'x', labelIds: [foreign.id] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('invalid_label');
  });

  it('deleting a label removes it from items but keeps the items', async () => {
    const sp = await mkSpace();
    const label = (await send('POST', `/spaces/${sp.id}/labels`, c.owner, { name: 'temp' })).json();
    const item = await mkItem(sp, { title: 'Keep me', labelIds: [label.id] });
    const res = await send('DELETE', `/labels/${label.id}`, c.owner);
    expect(res.json()).toEqual({ deleted: true, removedFrom: 1 });
    expect((await send('GET', `/items/${item.id}`, c.owner)).json().labels).toEqual([]);
  });

  it('is invisible across tenants', async () => {
    const sp = await mkSpace();
    const label = (await send('POST', `/spaces/${sp.id}/labels`, c.owner, { name: 'private' })).json();
    expect((await send('GET', `/spaces/${sp.id}/labels`, c.globex, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('PATCH', `/labels/${label.id}`, c.globex, { name: 'x' }, 'globex')).statusCode).toBe(404);
    expect((await send('DELETE', `/labels/${label.id}`, c.globex, undefined, 'globex')).statusCode).toBe(404);
  });
});

describe('board filters', () => {
  it('filters by assignee, mine, type, priority, label, epic, due date and text, and combines them', async () => {
    const sp = await mkSpace();
    const label = (await send('POST', `/spaces/${sp.id}/labels`, c.owner, { name: 'api' })).json();
    const epic = await mkItem(sp, { type: 'epic', title: 'The epic' });
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await mkItem(sp, { type: 'story', title: 'Alpha story', assigneeId: member.id, priority: 'high', parentId: epic.id, labelIds: [label.id], dueDate: day(-2) });
    await mkItem(sp, { type: 'bug', title: 'Beta bug', assigneeId: other.id, priority: 'highest', dueDate: day(3) });
    await mkItem(sp, { type: 'task', title: 'Gamma task', priority: 'low' });
    const all = (b: Json) => b.columns.flatMap((col: Json) => col.items.map((i: Json) => i.title)).sort();
    const q = async (qs: string) => all(await board(sp, `?${qs}`));

    expect(await q(`assignee=${member.id}`)).toEqual(['Alpha story']);
    expect(await q(`assignee=${member.id},${other.id}`)).toEqual(['Alpha story', 'Beta bug']);
    expect(await q('assignee=none')).toEqual(['Gamma task']);
    expect(await q(`assignee=${member.id},none`)).toEqual(['Alpha story', 'Gamma task']);
    expect(all(await (async () => (await send('GET', `/spaces/${sp.id}/board?mine=1`, c.member)).json())())).toEqual(['Alpha story']);
    expect(await q('type=bug')).toEqual(['Beta bug']);
    expect(await q('type=story,task')).toEqual(['Alpha story', 'Gamma task']);
    expect(await q('priority=highest,low')).toEqual(['Beta bug', 'Gamma task']);
    expect(await q(`label=${label.id}`)).toEqual(['Alpha story']);
    expect(await q(`epic=${epic.id}`)).toEqual(['Alpha story']);
    expect(await q('epic=none')).toEqual(['Beta bug', 'Gamma task']);
    expect(await q('due=overdue')).toEqual(['Alpha story']);
    expect(await q('due=week')).toEqual(['Beta bug']);
    expect(await q('due=none')).toEqual(['Gamma task']);
    expect(await q('q=gamm')).toEqual(['Gamma task']);
    expect(await q('recent=1')).toHaveLength(3);
    expect(await q('type=bug&priority=high')).toEqual([]);
    const filtered = await board(sp, '?type=bug');
    expect(filtered.filtered).toBe(true);
    expect((await board(sp)).filtered).toBe(false);
  });

  it('rejects bad filter values and counts WIP across the whole column, not just the matches', async () => {
    const sp = await mkSpace();
    expect((await send('GET', `/spaces/${sp.id}/board?assignee=not-a-uuid`, c.owner)).statusCode).toBe(400);
    expect((await send('GET', `/spaces/${sp.id}/board?type=saga`, c.owner)).statusCode).toBe(400);
    expect((await send('GET', `/spaces/${sp.id}/board?due=someday`, c.owner)).statusCode).toBe(400);
    await mkItem(sp, { title: 'One', type: 'bug' });
    await mkItem(sp, { title: 'Two', type: 'task' });
    const b = await board(sp, '?type=bug');
    const col = b.columns[0];
    expect(col.total).toBe(1);
    expect(col.wipCount).toBe(2);
  });

  it('pages a filtered column with the same filters', async () => {
    const sp = await mkSpace();
    for (let i = 0; i < 53; i++) await mkItem(sp, { title: `Bug ${i}`, type: 'bug' });
    await mkItem(sp, { title: 'A task', type: 'task' });
    const b = await board(sp, '?type=bug');
    const col = b.columns[0];
    expect(col.items).toHaveLength(50);
    const more = (await send('GET', `/spaces/${sp.id}/board/columns/${col.statusId}?type=bug&cursor=${col.nextCursor}`, c.owner)).json();
    expect(more.items.map((i: Json) => i.type)).toEqual(['bug', 'bug', 'bug']);
  });
});

describe('a large board', () => {
  it('serves 500 items within a sensible time and pages each column', async () => {
    const sp = await mkSpace();
    const sts = await statuses(sp);
    const admin = adminDb();
    try {
      const spaceId = sp.id;
      let n = 0;
      for (const st of sts) {
        const perColumn = st.name === 'Done' ? 100 : 133;
        const ranks = generateNKeysBetween(null, null, perColumn);
        await admin.db.tenant(ids.acme).workItems.insert(
          ranks.map((rank, i) => ({
            spaceId,
            number: ++n,
            type: 'task' as const,
            title: `Bulk ${st.name} ${i}`,
            statusId: st.id,
            reporterId: owner.id,
            rank,
            resolvedAt: st.category === 'done' ? new Date() : null,
          })),
        );
      }
      await admin.db.tenant(ids.acme).spaceCounters.updateOne({ spaceId }, { lastNumber: n });
    } finally {
      await admin.close();
    }
    const started = Date.now();
    const b = await board(sp);
    const elapsed = Date.now() - started;
    expect(b.columns.map((col: Json) => col.items.length)).toEqual([50, 50, 50, 50]);
    expect(b.columns.reduce((sum: number, col: Json) => sum + col.total, 0)).toBe(499);
    expect(elapsed).toBeLessThan(2500);
    // The next key carries on from the seeded counter.
    expect((await mkItem(sp, { title: 'After bulk' })).number).toBe(500);
  });
});

describe('rank rebalancing of existing data', () => {
  it('spreads equal ranks apart without changing their order', async () => {
    const sp = await mkSpace();
    const todo = await statusNamed(sp, 'To Do');
    const a = await mkItem(sp, { title: 'A' });
    const b = await mkItem(sp, { title: 'B' });
    const admin = adminDb();
    try {
      // Force a tie, which a plain between-keys call cannot split.
      const tenant = admin.db.tenant(ids.acme);
      await tenant.workItems.updateOne({ id: b.id }, { rank: a.rank });
      await rebalanceColumn(tenant, sp.id, todo.id);
      expect(await tenant.workItems.get(a.id)).toBeTruthy();
    } finally {
      await admin.close();
    }
    const col = (await board(sp)).columns.find((x: Json) => x.statusId === todo.id).items as Json[];
    expect(new Set(col.map((i) => i.rank)).size).toBe(2);
    // And a move next to a tied neighbour no longer blows up.
    const third = await mkItem(sp, { title: 'C' });
    expect((await move(third, c.owner, { statusId: todo.id, afterItemId: a.id })).statusCode).toBe(200);
    const statusRows = await statuses(sp);
    expect(statusRows.length).toBeGreaterThan(0);
  });
});
