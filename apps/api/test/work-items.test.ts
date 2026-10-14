import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  adminDb,
  caller,
  createOrg,
  ensureUser,
  makeApp,
  signInAs,
  tenantIds,
  uniqueEmail,
} from './helpers.js';
import { organizations, workItems } from '../src/db/schema.js';
import { withTenant } from '../src/db/client.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// Response bodies are checked field by field, so loose typing keeps the tests readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Space = { id: string; key: string };

let ids: Awaited<ReturnType<typeof tenantIds>>;
let owner: { id: string; email: string };
let spaceAdmin: { id: string; email: string };
let member: { id: string; email: string };
let other: { id: string; email: string };
let viewer: { id: string; email: string };
let outsider: { id: string; email: string };
let globexOwner: { id: string; email: string };
const c = { owner: '', spaceAdmin: '', member: '', other: '', viewer: '', outsider: '', globex: '' };
let space: Space;

let seq = 0;
const newKey = () => `W${Math.random().toString(36).slice(2, 6).toUpperCase()}${seq++ % 10}`;

async function mkSpace(extra: Json = {}, cookie = c.owner, slug = 'acme'): Promise<Space> {
  const res = await call({
    method: 'POST',
    url: '/spaces',
    slug,
    cookie,
    payload: { key: newKey(), name: 'Work', ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const send = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: Json,
  slug = 'acme',
) => call({ method, url, slug, cookie, payload });

const mkItem = async (sp: Space, cookie: string, body: Json = {}, slug = 'acme') => {
  const res = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'Do it', ...body }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};

/** PATCH with the item's current updated_at as If-Match. */
const patchItem = (item: Json, cookie: string, payload: Json, slug = 'acme', version = item.updatedAt) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/v1/items/${item.id}`,
    headers: { host: `${slug}.localhost:3000`, 'if-match': version },
    cookies: { cd_session: cookie },
    payload,
  });

const statuses = async (sp: Space, cookie = c.owner): Promise<Json[]> =>
  (await send('GET', `/spaces/${sp.id}/statuses`, cookie)).json().items;

beforeAll(async () => {
  ids = await tenantIds();
  const mk = (name: string, role: 'owner' | 'admin' | 'member' = 'member', orgId = ids.acme) =>
    ensureUser({ orgId, email: uniqueEmail(`wi-${name}`), role });
  owner = await mk('owner', 'owner');
  spaceAdmin = await mk('sadmin');
  member = await mk('member');
  other = await mk('other');
  viewer = await mk('viewer');
  outsider = await mk('outsider');
  globexOwner = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('wi-gx', 'globex.test'),
    role: 'owner',
  });
  c.owner = await signInAs(t.app, 'acme', owner);
  c.spaceAdmin = await signInAs(t.app, 'acme', spaceAdmin);
  c.member = await signInAs(t.app, 'acme', member);
  c.other = await signInAs(t.app, 'acme', other);
  c.viewer = await signInAs(t.app, 'acme', viewer);
  c.outsider = await signInAs(t.app, 'acme', outsider);
  c.globex = await signInAs(t.app, 'globex', globexOwner);
  space = await mkSpace({
    visibility: 'private',
    members: [
      { type: 'user', id: spaceAdmin.id, role: 'admin' },
      { type: 'user', id: member.id, role: 'member' },
      { type: 'user', id: other.id, role: 'member' },
      { type: 'user', id: viewer.id, role: 'viewer' },
    ],
  });
});

describe('new spaces', () => {
  it('start with a Kanban board and the four default statuses', async () => {
    const list = await statuses(space);
    expect(list.map((s) => [s.name, s.category])).toEqual([
      ['To Do', 'todo'],
      ['In Progress', 'in_progress'],
      ['In Review', 'in_progress'],
      ['Done', 'done'],
    ]);
    const board = (await send('GET', `/spaces/${space.id}/board`, c.owner)).json();
    expect(board.board.type).toBe('kanban');
    expect(board.board.settings.doneRetentionDays).toBe(14);
    expect(board.columns).toHaveLength(4);
    expect(board.permissions.createItem).toBe(true);
  });

  it('refuses Scrum for now, after the plan check', async () => {
    const res = await send('POST', '/spaces', c.owner, { key: newKey(), name: 'S', boardType: 'scrum' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('not_available');
  });
});

describe('creating items', () => {
  it('gives sequential keys per space and puts new items in the first To do status', async () => {
    const sp = await mkSpace();
    const a = await mkItem(sp, c.owner, { title: 'First' });
    const b = await mkItem(sp, c.owner, { title: 'Second' });
    expect(a.key).toBe(`${sp.key}-1`);
    expect(b.key).toBe(`${sp.key}-2`);
    expect(a.status.name).toBe('To Do');
    expect(a.reporter.id).toBe(owner.id);
    expect(a.rank < b.rank).toBe(true);
  });

  it('never repeats or skips a number under concurrent creates', async () => {
    const sp = await mkSpace();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        send('POST', `/spaces/${sp.id}/items`, c.owner, { type: 'task', title: `Parallel ${i}` }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(200));
    const numbers = results.map((r) => r.json().number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const ranks = results.map((r) => r.json().rank);
    expect(new Set(ranks).size).toBe(20);
  });

  it('numbers are per space, so two spaces can both have item 1', async () => {
    const a = await mkItem(await mkSpace(), c.owner);
    const b = await mkItem(await mkSpace(), c.owner);
    expect([a.number, b.number]).toEqual([1, 1]);
  });

  it('validates the body', async () => {
    const res = await send('POST', `/spaces/${space.id}/items`, c.owner, { type: 'task', title: '  ' });
    expect(res.statusCode).toBe(400);
    expect((await send('POST', `/spaces/${space.id}/items`, c.owner, { type: 'saga', title: 'x' })).statusCode).toBe(400);
  });

  it('keeps plain-text descriptions round-trip', async () => {
    const it = await mkItem(space, c.owner, { description: 'Line one\nLine two' });
    expect(it.description).toBe('Line one\nLine two');
  });

  it('sets resolved_at when created straight into Done', async () => {
    const done = (await statuses(space)).find((s) => s.category === 'done')!;
    const it = await mkItem(space, c.owner, { statusId: done.id });
    expect(it.resolvedAt).not.toBeNull();
  });

  it('rejects a status from another space', async () => {
    const otherSpace = await mkSpace();
    const foreign = (await statuses(otherSpace))[0]!;
    const res = await send('POST', `/spaces/${space.id}/items`, c.owner, {
      type: 'task',
      title: 'x',
      statusId: foreign.id,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('assignees', () => {
  it('offers only people who can open a private space, and filters by search', async () => {
    const res = (await send('GET', `/spaces/${space.id}/assignees`, c.member)).json().items as Json[];
    const idsSeen = res.map((u) => u.id);
    expect(idsSeen).toEqual(expect.arrayContaining([member.id, viewer.id, spaceAdmin.id, owner.id]));
    expect(idsSeen).not.toContain(outsider.id);
    const filtered = (
      await send('GET', `/spaces/${space.id}/assignees?q=${encodeURIComponent(member.email.slice(0, 12))}`, c.member)
    ).json().items as Json[];
    expect(filtered.map((u) => u.id)).toContain(member.id);
    expect(filtered.map((u) => u.id)).not.toContain(viewer.id);
    expect((await send('GET', `/spaces/${space.id}/assignees`, c.outsider)).statusCode).toBe(404);
  });
});

describe('hierarchy', () => {
  it('allows epic > story > subtask and nothing deeper', async () => {
    const epic = await mkItem(space, c.owner, { type: 'epic', title: 'Epic' });
    const story = await mkItem(space, c.owner, { type: 'story', title: 'Story', parentId: epic.id });
    const sub = await mkItem(space, c.owner, { type: 'subtask', title: 'Sub', parentId: story.id });
    expect(story.parent).toMatchObject({ id: epic.id, type: 'epic' });
    expect(sub.parent.id).toBe(story.id);
    const deeper = await send('POST', `/spaces/${space.id}/items`, c.owner, {
      type: 'subtask',
      title: 'Too deep',
      parentId: sub.id,
    });
    expect(deeper.statusCode).toBe(422);
    expect(deeper.json().code).toBe('invalid_hierarchy');
  });

  it.each([
    ['an epic with a parent', { type: 'epic' }, 'story'],
    ['a subtask without a parent', { type: 'subtask' }, null],
    ['a task under a task', { type: 'task' }, 'task'],
    ['a story under a subtask', { type: 'story' }, 'subtask'],
    ['a subtask under an epic', { type: 'subtask' }, 'epic'],
  ])('rejects %s', async (_name, body, parentType) => {
    let parentId: string | undefined;
    if (parentType) {
      const needsParent = parentType === 'subtask';
      const base = needsParent ? await mkItem(space, c.owner) : null;
      const p = await mkItem(space, c.owner, {
        type: parentType,
        title: 'Parent',
        ...(base ? { parentId: base.id } : {}),
      });
      parentId = p.id;
    }
    const res = await send('POST', `/spaces/${space.id}/items`, c.owner, {
      title: 'Child',
      ...body,
      ...(parentId ? { parentId } : {}),
    });
    expect(res.statusCode, res.body).toBe(422);
  });

  it('rejects a parent from another space', async () => {
    const foreign = await mkItem(await mkSpace(), c.owner, { type: 'epic', title: 'Elsewhere' });
    const res = await send('POST', `/spaces/${space.id}/items`, c.owner, {
      type: 'story',
      title: 'x',
      parentId: foreign.id,
    });
    expect(res.statusCode).toBe(422);
  });

  it('cannot change an epic with stories into a task', async () => {
    const epic = await mkItem(space, c.owner, { type: 'epic', title: 'E' });
    await mkItem(space, c.owner, { type: 'story', title: 'S', parentId: epic.id });
    const res = await patchItem(epic, c.owner, { type: 'task' });
    expect(res.statusCode).toBe(422); // a task may hold only subtasks: stories would be stranded
    expect(res.json().code).toBe('invalid_hierarchy');
  });
});

describe('updating items', () => {
  it('requires If-Match and answers 412 for a stale write', async () => {
    const it = await mkItem(space, c.owner);
    const noHeader = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${it.id}`,
      headers: { host: 'acme.localhost:3000' },
      cookies: { cd_session: c.owner },
      payload: { title: 'x' },
    });
    expect(noHeader.statusCode).toBe(428);

    const first = await patchItem(it, c.owner, { title: 'Renamed' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().title).toBe('Renamed');
    const staleWrite = await patchItem(it, c.owner, { title: 'Lost update' });
    expect(staleWrite.statusCode).toBe(412);
    expect(staleWrite.json().code).toBe('stale');
    const now = (await send('GET', `/items/${it.id}`, c.owner)).json();
    expect(now.title).toBe('Renamed');
  });

  it('lets only one of two simultaneous edits win', async () => {
    const it = await mkItem(space, c.owner);
    const [a, b] = await Promise.all([
      patchItem(it, c.owner, { title: 'A' }),
      patchItem(it, c.member, { title: 'B' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 412]);
  });

  it('sets and clears resolved_at when moving into and out of Done', async () => {
    const list = await statuses(space);
    const done = list.find((s) => s.category === 'done')!;
    const todo = list.find((s) => s.category === 'todo')!;
    let it = await mkItem(space, c.owner);
    expect(it.resolvedAt).toBeNull();
    it = (await patchItem(it, c.owner, { statusId: done.id })).json();
    expect(it.resolvedAt).not.toBeNull();
    it = (await patchItem(it, c.owner, { statusId: todo.id })).json();
    expect(it.resolvedAt).toBeNull();
  });

  it('updates fields and finds the item by key', async () => {
    const it = await mkItem(space, c.owner);
    const res = await patchItem(it, c.owner, {
      priority: 'highest',
      assigneeId: member.id,
      estimate: 5,
      dueDate: '2030-01-31',
    });
    expect(res.statusCode, res.body).toBe(200);
    const byKey = (await send('GET', `/items/${it.key.toLowerCase()}`, c.owner)).json();
    expect(byKey).toMatchObject({
      id: it.id,
      priority: 'highest',
      estimate: 5,
      dueDate: '2030-01-31',
      assignee: { id: member.id },
    });
  });

  it('will not assign someone without access to a private space', async () => {
    const it = await mkItem(space, c.owner);
    const res = await patchItem(it, c.owner, { assigneeId: outsider.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_assignee');
  });

  it('shows subtask progress on the parent', async () => {
    const list = await statuses(space);
    const done = list.find((s) => s.category === 'done')!;
    const story = await mkItem(space, c.owner, { type: 'story', title: 'Parent' });
    const s1 = await mkItem(space, c.owner, { type: 'subtask', parentId: story.id, title: 's1' });
    await mkItem(space, c.owner, { type: 'subtask', parentId: story.id, title: 's2' });
    await patchItem(s1, c.owner, { statusId: done.id });
    const parent = (await send('GET', `/items/${story.id}`, c.owner)).json();
    expect(parent.subtasks).toEqual({ total: 2, done: 1 });
    const subs = (await send('GET', `/items/${story.id}/subtasks`, c.owner)).json();
    expect(subs.items.map((s: Json) => s.title)).toEqual(['s1', 's2']);
  });
});

describe('deleting items', () => {
  it('soft-deletes the item and its subtasks and hides them everywhere', async () => {
    const story = await mkItem(space, c.owner, { type: 'story', title: 'Doomed' });
    const sub = await mkItem(space, c.owner, { type: 'subtask', parentId: story.id, title: 'Doomed sub' });
    const res = await send('DELETE', `/items/${story.id}`, c.owner);
    expect(res.json()).toEqual({ deleted: 2, subtasks: 1 });
    expect((await send('GET', `/items/${story.id}`, c.owner)).statusCode).toBe(404);
    expect((await send('GET', `/items/${sub.key}`, c.owner)).statusCode).toBe(404);
    // History is kept: the rows still exist, only flagged.
    const a = adminDb();
    try {
      const rows = await a.db.select().from(workItems).where(eq(workItems.id, story.id));
      expect(rows[0]?.deletedAt).not.toBeNull();
    } finally {
      await a.close();
    }
  });

  it('deleting an epic keeps its stories but detaches them', async () => {
    const epic = await mkItem(space, c.owner, { type: 'epic', title: 'Gone' });
    const story = await mkItem(space, c.owner, { type: 'story', title: 'Stays', parentId: epic.id });
    await send('DELETE', `/items/${epic.id}`, c.owner);
    const kept = (await send('GET', `/items/${story.id}`, c.owner)).json();
    expect(kept.parent).toBeNull();
  });

  it('keeps numbers unique after a delete (never reused)', async () => {
    const sp = await mkSpace();
    const a = await mkItem(sp, c.owner);
    await send('DELETE', `/items/${a.id}`, c.owner);
    const b = await mkItem(sp, c.owner);
    expect(b.number).toBe(2);
  });
});

describe('permissions', () => {
  it('viewers can read but not create, edit or delete', async () => {
    const it = await mkItem(space, c.member);
    expect((await send('GET', `/items/${it.key}`, c.viewer)).statusCode).toBe(200);
    expect((await send('POST', `/spaces/${space.id}/items`, c.viewer, { type: 'task', title: 'x' })).statusCode).toBe(403);
    expect((await patchItem(it, c.viewer, { title: 'x' })).statusCode).toBe(403);
    expect((await send('DELETE', `/items/${it.id}`, c.viewer)).statusCode).toBe(403);
    const board = (await send('GET', `/spaces/${space.id}/board`, c.viewer)).json();
    expect(board.permissions).toMatchObject({ createItem: false, manageBoard: false });
  });

  it('members delete only what they reported; space admins delete anything', async () => {
    const theirs = await mkItem(space, c.other);
    expect((await send('DELETE', `/items/${theirs.id}`, c.member)).statusCode).toBe(403);
    const mine = await mkItem(space, c.member);
    expect((await send('DELETE', `/items/${mine.id}`, c.member)).statusCode).toBe(200);
    expect((await send('DELETE', `/items/${theirs.id}`, c.spaceAdmin)).statusCode).toBe(200);
  });

  it('members can edit anyone’s item', async () => {
    const it = await mkItem(space, c.other);
    expect((await patchItem(it, c.member, { title: 'Edited by a teammate' })).statusCode).toBe(200);
  });

  it('hides a private space’s items from people outside it', async () => {
    const it = await mkItem(space, c.owner);
    expect((await send('GET', `/items/${it.key}`, c.outsider)).statusCode).toBe(404);
    expect((await send('GET', `/spaces/${space.id}/board`, c.outsider)).statusCode).toBe(404);
    expect((await send('GET', `/spaces/${space.id}/statuses`, c.outsider)).statusCode).toBe(404);
    expect((await send('POST', `/spaces/${space.id}/items`, c.outsider, { type: 'task', title: 'x' })).statusCode).toBe(404);
  });

  it('lets anyone in the workspace read an open space but not write to it', async () => {
    const open = await mkSpace({ visibility: 'open' });
    const it = await mkItem(open, c.owner);
    expect((await send('GET', `/items/${it.key}`, c.outsider)).statusCode).toBe(200);
    expect((await send('POST', `/spaces/${open.id}/items`, c.outsider, { type: 'task', title: 'x' })).statusCode).toBe(403);
  });

  it('makes an archived space read-only', async () => {
    const sp = await mkSpace();
    const it = await mkItem(sp, c.owner);
    const archived = await send('POST', `/spaces/${sp.id}/archive`, c.owner);
    expect(archived.statusCode, archived.body).toBe(200);
    expect((await send('POST', `/spaces/${sp.id}/items`, c.owner, { type: 'task', title: 'x' })).statusCode).toBe(409);
    expect((await patchItem(it, c.owner, { title: 'x' })).statusCode).toBe(409);
    expect((await send('GET', `/items/${it.id}`, c.owner)).statusCode).toBe(200);
  });
});

describe('statuses', () => {
  it('lets space admins add, rename, recolor and set a WIP limit', async () => {
    const sp = await mkSpace();
    const created = await send('POST', `/spaces/${sp.id}/statuses`, c.owner, {
      name: 'Blocked',
      category: 'in_progress',
      color: 'red',
      wipLimit: 3,
    });
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().id;
    const names = (await statuses(sp)).map((s) => s.name);
    expect(names).toEqual(['To Do', 'In Progress', 'In Review', 'Blocked', 'Done']);
    const patched = await send('PATCH', `/statuses/${id}`, c.owner, { name: 'On hold', color: 'amber', wipLimit: null });
    expect(patched.json()).toMatchObject({ name: 'On hold', color: 'amber', wipLimit: null });
    const dup = await send('POST', `/spaces/${sp.id}/statuses`, c.owner, { name: 'on hold', category: 'todo' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('name_taken');
  });

  it('stops at 12 statuses', async () => {
    const sp = await mkSpace();
    for (let i = 0; i < 8; i++) {
      const res = await send('POST', `/spaces/${sp.id}/statuses`, c.owner, { name: `Extra ${i}`, category: 'in_progress' });
      expect(res.statusCode, res.body).toBe(200);
    }
    const over = await send('POST', `/spaces/${sp.id}/statuses`, c.owner, { name: 'One too many', category: 'todo' });
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe('status_limit');
  });

  it('keeps at least one status in every category', async () => {
    const sp = await mkSpace();
    const list = await statuses(sp);
    const todo = list.find((s) => s.category === 'todo')!;
    const done = list.find((s) => s.category === 'done')!;
    expect((await send('DELETE', `/statuses/${todo.id}`, c.owner)).statusCode).toBe(422);
    expect((await send('PATCH', `/statuses/${done.id}`, c.owner, { category: 'todo' })).statusCode).toBe(422);
  });

  it('needs a replacement to delete a status that has items, and moves them', async () => {
    const sp = await mkSpace();
    const list = await statuses(sp);
    const review = list.find((s) => s.name === 'In Review')!;
    const progress = list.find((s) => s.name === 'In Progress')!;
    const it = await mkItem(sp, c.owner, { statusId: review.id });
    const noReplacement = await send('DELETE', `/statuses/${review.id}`, c.owner);
    expect(noReplacement.statusCode).toBe(422);
    expect(noReplacement.json().code).toBe('replacement_required');
    const ok = await send('DELETE', `/statuses/${review.id}?replace_with=${progress.id}`, c.owner);
    expect(ok.json()).toEqual({ deleted: true, moved: 1 });
    const moved = (await send('GET', `/items/${it.id}`, c.owner)).json();
    expect(moved.status.name).toBe('In Progress');
    expect((await statuses(sp)).map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('sets resolved_at when items move to a Done replacement', async () => {
    const sp = await mkSpace();
    const list = await statuses(sp);
    const done = list.find((s) => s.category === 'done')!;
    const extra = (
      await send('POST', `/spaces/${sp.id}/statuses`, c.owner, { name: 'Shipped', category: 'done' })
    ).json();
    const it = await mkItem(sp, c.owner, { statusId: extra.id });
    await send('DELETE', `/statuses/${extra.id}?replace_with=${done.id}`, c.owner);
    expect((await send('GET', `/items/${it.id}`, c.owner)).json().status.id).toBe(done.id);
  });

  it('reorders only with the complete set of ids', async () => {
    const sp = await mkSpace();
    const list = await statuses(sp);
    const reversed = [...list].reverse().map((s) => s.id);
    const bad = await send('PUT', `/spaces/${sp.id}/statuses/order`, c.owner, { ids: reversed.slice(1) });
    expect(bad.statusCode).toBe(422);
    const ok = await send('PUT', `/spaces/${sp.id}/statuses/order`, c.owner, { ids: reversed });
    expect(ok.json().items.map((s: Json) => s.id)).toEqual(reversed);
  });

  it('only space admins manage statuses and the board', async () => {
    const sp = await mkSpace({
      members: [
        { type: 'user', id: member.id, role: 'member' },
        { type: 'user', id: viewer.id, role: 'viewer' },
        { type: 'user', id: spaceAdmin.id, role: 'admin' },
      ],
    });
    const body = { name: 'Nope', category: 'todo' };
    expect((await send('POST', `/spaces/${sp.id}/statuses`, c.member, body)).statusCode).toBe(403);
    expect((await send('POST', `/spaces/${sp.id}/statuses`, c.viewer, body)).statusCode).toBe(403);
    expect((await send('POST', `/spaces/${sp.id}/statuses`, c.spaceAdmin, { ...body, name: 'Yes' })).statusCode).toBe(200);
    const board = (await send('GET', `/spaces/${sp.id}/board`, c.member)).json();
    expect((await send('PATCH', `/boards/${board.board.id}`, c.member, { settings: { swimlane: 'assignee' } })).statusCode).toBe(403);
    const ok = await send('PATCH', `/boards/${board.board.id}`, c.spaceAdmin, {
      settings: { swimlane: 'assignee', doneRetentionDays: 7 },
    });
    expect(ok.json().settings).toMatchObject({ swimlane: 'assignee', doneRetentionDays: 7 });
  });
});

describe('the board', () => {
  it('groups cards by status in rank order, with totals and a load-more cursor', async () => {
    const sp = await mkSpace();
    for (let i = 0; i < 55; i++) await mkItem(sp, c.owner, { title: `Card ${i}` });
    const board = (await send('GET', `/spaces/${sp.id}/board`, c.owner)).json();
    const todo = board.columns.find((col: Json) => col.statusId === board.statuses[0].id);
    expect(todo.items).toHaveLength(50);
    expect(todo.total).toBe(55);
    expect(todo.nextCursor).not.toBeNull();
    expect(todo.items[0].title).toBe('Card 0');
    const more = (
      await send('GET', `/spaces/${sp.id}/board/columns/${todo.statusId}?cursor=${todo.nextCursor}`, c.owner)
    ).json();
    expect(more.items.map((i: Json) => i.title)).toEqual(
      Array.from({ length: 5 }, (_, i) => `Card ${50 + i}`),
    );
    expect(more.nextCursor).toBeNull();
  });

  it('shows stories, tasks and bugs only: epics and subtasks stay off the board', async () => {
    const sp = await mkSpace();
    const epic = await mkItem(sp, c.owner, { type: 'epic', title: 'Epic' });
    const story = await mkItem(sp, c.owner, { type: 'story', title: 'Story', parentId: epic.id });
    await mkItem(sp, c.owner, { type: 'subtask', title: 'Sub', parentId: story.id });
    await mkItem(sp, c.owner, { type: 'bug', title: 'Bug' });
    const board = (await send('GET', `/spaces/${sp.id}/board`, c.owner)).json();
    const titles = board.columns.flatMap((col: Json) => col.items.map((i: Json) => i.title)).sort();
    expect(titles).toEqual(['Bug', 'Story']);
    expect(board.columns[0].items.find((i: Json) => i.title === 'Story').subtasks).toEqual({ total: 1, done: 0 });
  });

  it('hides Done items older than the retention window but keeps them in the list', async () => {
    const sp = await mkSpace();
    const done = (await statuses(sp)).find((s) => s.category === 'done')!;
    const old = await mkItem(sp, c.owner, { title: 'Old', statusId: done.id });
    await mkItem(sp, c.owner, { title: 'Recent', statusId: done.id });
    const a = adminDb();
    try {
      await withTenant(a.db, ids.acme, (tx) =>
        tx.update(workItems).set({ resolvedAt: new Date(Date.now() - 30 * 86_400_000) }).where(eq(workItems.id, old.id)),
      );
    } finally {
      await a.close();
    }
    const board = (await send('GET', `/spaces/${sp.id}/board`, c.owner)).json();
    const col = board.columns.find((x: Json) => x.statusId === done.id);
    expect(col.items.map((i: Json) => i.title)).toEqual(['Recent']);
    expect(col.total).toBe(1);
    const list = (await send('GET', `/spaces/${sp.id}/items?q=old`, c.owner)).json();
    expect(list.items.map((i: Json) => i.title)).toContain('Old');
  });

  it('lists items with filters and pages', async () => {
    const sp = await mkSpace();
    await mkItem(sp, c.owner, { title: 'Alpha bug', type: 'bug', priority: 'high' });
    await mkItem(sp, c.owner, { title: 'Beta task', assigneeId: member.id });
    await mkItem(sp, c.owner, { title: 'Gamma task' });
    const q = async (qs: string) => (await send('GET', `/spaces/${sp.id}/items?${qs}`, c.owner)).json();
    expect((await q('type=bug')).items.map((i: Json) => i.title)).toEqual(['Alpha bug']);
    expect((await q('assignee=none')).items).toHaveLength(2);
    expect((await q(`assignee=${member.id}`)).items.map((i: Json) => i.title)).toEqual(['Beta task']);
    expect((await q('q=gam')).items.map((i: Json) => i.title)).toEqual(['Gamma task']);
    const page = await q('limit=2');
    expect(page.items.map((i: Json) => i.title)).toEqual(['Gamma task', 'Beta task']);
    expect((await q(`limit=2&cursor=${page.nextCursor}`)).items.map((i: Json) => i.title)).toEqual(['Alpha bug']);
  });
});

describe('tenant isolation', () => {
  it('keeps one workspace’s spaces, items and statuses invisible to another', async () => {
    const it = await mkItem(space, c.owner);
    for (const url of [`/items/${it.id}`, `/items/${it.key}`, `/spaces/${space.id}/board`, `/spaces/${space.id}/items`, `/spaces/${space.id}/statuses`]) {
      expect((await send('GET', url, c.globex, undefined, 'globex')).statusCode, url).toBe(404);
    }
    expect((await patchItem(it, c.globex, { title: 'hacked' }, 'globex')).statusCode).toBe(404);
    expect((await send('DELETE', `/items/${it.id}`, c.globex, undefined, 'globex')).statusCode).toBe(404);
    const status = (await statuses(space))[0]!;
    expect((await send('PATCH', `/statuses/${status.id}`, c.globex, { name: 'x' }, 'globex')).statusCode).toBe(404);
    expect((await send('DELETE', `/statuses/${status.id}`, c.globex, undefined, 'globex')).statusCode).toBe(404);
    expect((await send('POST', `/spaces/${space.id}/items`, c.globex, { type: 'task', title: 'x' }, 'globex')).statusCode).toBe(404);
  });

  it('lets both workspaces have a space with the same key and item 1', async () => {
    const key = newKey();
    const mine = await send('POST', '/spaces', c.owner, { key, name: 'Same' });
    const theirs = await send('POST', '/spaces', c.globex, { key, name: 'Same' }, 'globex');
    expect(mine.statusCode).toBe(200);
    expect(theirs.statusCode).toBe(200);
    const a = await mkItem(mine.json(), c.owner);
    const b = await mkItem(theirs.json(), c.globex, {}, 'globex');
    expect(a.key).toBe(b.key);
    expect((await send('GET', `/items/${a.key}`, c.owner)).json().id).toBe(a.id);
    expect((await send('GET', `/items/${a.key}`, c.globex, undefined, 'globex')).json().id).toBe(b.id);
  });

  it('is enforced by the database: a tenant cannot see or insert rows for another', async () => {
    const it = await mkItem(space, c.owner);
    const { appDb } = await import('./helpers.js');
    const app = appDb();
    try {
      await withTenant(app.db, ids.globex, async (tx) => {
        expect(await tx.select().from(workItems).where(eq(workItems.id, it.id))).toHaveLength(0);
      });
      await expect(
        withTenant(app.db, ids.globex, (tx) =>
          tx.update(workItems).set({ title: 'x' }).where(eq(workItems.id, it.id)).returning(),
        ).then((rows) => rows.length),
      ).resolves.toBe(0);
      await expect(
        withTenant(app.db, ids.globex, (tx) =>
          tx.insert(workItems).values({
            orgId: ids.acme,
            spaceId: space.id,
            number: 9999,
            type: 'task',
            title: 'smuggled',
            statusId: it.statusId,
            reporterId: owner.id,
            rank: 'a0',
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});

describe('plan limits', () => {
  it('stops creating at the Free plan cap and never counts deleted items', async () => {
    const { org, slug, owner: o } = await createOrg('wilimit');
    const a = adminDb();
    try {
      await a.db
        .update(organizations)
        .set({ planKey: 'free', limitOverrides: { work_items: 3 } })
        .where(eq(organizations.id, org.id));
    } finally {
      await a.close();
    }
    const cookie = await signInAs(t.app, slug, o);
    const sp = (await send('POST', '/spaces', cookie, { key: 'LIM', name: 'Limited' }, slug)).json();
    const made = [];
    for (let i = 0; i < 3; i++) made.push(await mkItem(sp, cookie, { title: `n${i}` }, slug));
    const over = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'over' }, slug);
    expect(over.statusCode).toBe(402);
    expect(over.json()).toMatchObject({ code: 'plan_limit', fields: { limit: 'work_items', plan: 'free' } });
    // Existing items stay fully editable at the cap.
    expect((await patchItem(made[0]!, cookie, { title: 'still editable' }, slug)).statusCode).toBe(200);
    // Deleting frees a slot.
    await send('DELETE', `/items/${made[1]!.id}`, cookie, undefined, slug);
    expect((await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'fits' }, slug)).statusCode).toBe(200);
    const plan = (await send('GET', '/plan', cookie, undefined, slug)).json();
    expect(plan.usage.work_items).toBe(3);
  });

  it('seeds the work limits on the plans', async () => {
    const { org, slug, owner: o } = await createOrg('wiplans');
    const cookie = await signInAs(t.app, slug, o);
    const plans = (await send('GET', '/plan', cookie, undefined, slug)).json().plans as Json[];
    const by = Object.fromEntries(plans.map((p) => [p.key, p]));
    expect(by.free.limits).toMatchObject({ work_items: 250, max_attachment_mb: 5 });
    expect(by.free.features).toEqual([]);
    expect(by.team.limits.work_items).toBeUndefined();
    expect(by.team.features).toEqual(expect.arrayContaining(['scrum_sprints', 'shared_filters']));
    expect(by.team.features).not.toContain('burndown_reports');
    expect(by.business.features).toContain('burndown_reports');
    expect(org.id).toBeTruthy();
  });

  it('answers a Scrum space with an upgrade prompt on Free', async () => {
    const { org, slug, owner: o } = await createOrg('wiscrum');
    const a = adminDb();
    try {
      await a.db.update(organizations).set({ planKey: 'free' }).where(eq(organizations.id, org.id));
    } finally {
      await a.close();
    }
    const cookie = await signInAs(t.app, slug, o);
    const res = await send('POST', '/spaces', cookie, { key: 'SCR', name: 'Scrum', boardType: 'scrum' }, slug);
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('feature_locked');
  });
});
