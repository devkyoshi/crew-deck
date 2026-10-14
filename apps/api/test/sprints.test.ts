import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotActiveSprints } from '../src/work/sprints.js';
import { adminDb, caller, createOrg, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Space = { id: string; key: string };

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};

const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function scrumSpace(extra: Json = {}, cookie = c.owner!, slug = 'acme'): Promise<Space> {
  const key = `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const res = await send('POST', '/spaces', cookie, {
    key,
    name: 'Sprints',
    boardType: 'scrum',
    members: [
      { type: 'user', id: u.sadmin!.id, role: 'admin' },
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
    ...extra,
  }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
const mkItem = async (sp: Space, body: Json = {}, cookie = c.member!) => {
  const res = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'story', title: 'Story', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const mkSprint = async (sp: Space, body: Json = {}, cookie = c.member!) => {
  const res = await send('POST', `/spaces/${sp.id}/sprints`, cookie, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const toSprint = (itemIds: string[], sprintId: string | null, cookie = c.member!) =>
  send('POST', '/items/sprint', cookie, { ids: itemIds, sprintId });
const doneStatus = async (sp: Space) =>
  ((await send('GET', `/spaces/${sp.id}/statuses`, c.owner!)).json().items as Json[]).find((s) => s.category === 'done')!;
/** Moves an item to Done, using its latest version (joining a sprint changes it). */
const finish = async (item: Json, statusId: string) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/v1/items/${item.id}`,
    headers: { host: 'acme.localhost:3000', 'if-match': (await send('GET', `/items/${item.id}`, c.member!)).json().updatedAt },
    cookies: { cd_session: c.member! },
    payload: { statusId },
  });

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['sadmin', 'member'],
    ['member', 'member'],
    ['viewer', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`sp-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.gx = await ensureUser({ orgId: ids.globex, email: uniqueEmail('sp-gx', 'globex.test'), role: 'owner' });
  c.gx = await signInAs(t.app, 'globex', u.gx);
});

describe('planning', () => {
  it('needs a Scrum board, and lets members (not viewers) plan sprints', async () => {
    const kanban = await send('POST', '/spaces', c.owner!, { key: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, name: 'K' });
    expect((await send('GET', `/spaces/${kanban.json().id}/backlog`, c.owner!)).statusCode).toBe(422);

    const sp = await scrumSpace();
    const s1 = await mkSprint(sp);
    expect(s1).toMatchObject({ name: `${sp.key} Sprint 1`, state: 'planned' });
    expect((await send('POST', `/spaces/${sp.id}/sprints`, c.viewer!, {})).statusCode).toBe(403);
    const a = await mkItem(sp, { estimate: 3 });
    await mkItem(sp, { estimate: 5 });
    expect((await toSprint([a.id], s1.id)).statusCode).toBe(200);
    expect((await toSprint([a.id], s1.id, c.viewer!)).statusCode).toBe(403);

    const backlog = (await send('GET', `/spaces/${sp.id}/backlog`, c.viewer!)).json();
    expect(backlog.sprints[0]).toMatchObject({ id: s1.id, summary: { count: 1, points: 3 } });
    expect(backlog.backlog.summary).toMatchObject({ count: 1, points: 5 });
    expect(backlog.permissions).toMatchObject({ create: false, start: false });
    const epic = await mkItem(sp, { type: 'epic' });
    expect((await toSprint([epic.id], s1.id)).statusCode).toBe(422);
  });
});

describe('running a sprint', () => {
  it('starts only for space admins, with dates and work, one at a time', async () => {
    const sp = await scrumSpace();
    const s1 = await mkSprint(sp);
    const s2 = await mkSprint(sp);
    const a = await mkItem(sp, { estimate: 3 });
    const b = await mkItem(sp, { estimate: 5 });

    expect((await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, {})).statusCode).toBe(422); // no dates
    expect((await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(9) })).json().code).toBe('empty_sprint');
    await toSprint([a.id, b.id], s1.id);
    expect((await send('POST', `/sprints/${s1.id}/start`, c.member!, { startDate: today(), endDate: plusDays(9) })).statusCode).toBe(403);
    const started = await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(9) });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toMatchObject({ state: 'active', items: 2, points: 8 });

    // A second sprint cannot start while one runs.
    const c2 = await mkItem(sp);
    await toSprint([c2.id], s2.id);
    expect((await send('POST', `/sprints/${s2.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(9) })).statusCode).toBe(409);

    // The board shows the running sprint only.
    const board = (await send('GET', `/spaces/${sp.id}/board`, c.member!)).json();
    expect(board.sprint).toMatchObject({ id: s1.id });
    const keys = board.columns.flatMap((col: Json) => col.items.map((i: Json) => i.key));
    expect(keys.sort()).toEqual([a.key, b.key].sort());
  });

  it('allows only one running sprint even when two start at once', async () => {
    const sp = await scrumSpace();
    const [s1, s2] = [await mkSprint(sp), await mkSprint(sp)];
    await toSprint([(await mkItem(sp)).id], s1.id);
    await toSprint([(await mkItem(sp)).id], s2.id);
    const body = { startDate: today(), endDate: plusDays(5) };
    const results = await Promise.all([
      send('POST', `/sprints/${s1.id}/start`, c.sadmin!, body),
      send('POST', `/sprints/${s2.id}/start`, c.sadmin!, body),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('completes: done work stays, the rest moves on with a carry-over, and the report adds up', async () => {
    const sp = await scrumSpace();
    const s1 = await mkSprint(sp);
    const done = await mkItem(sp, { estimate: 3, title: 'Done one' });
    const open = await mkItem(sp, { estimate: 5, title: 'Open one' });
    await toSprint([done.id, open.id], s1.id);
    await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(9) });
    const late = await mkItem(sp, { estimate: 2, title: 'Added late' });
    await toSprint([late.id], s1.id);
    expect((await finish(done, (await doneStatus(sp)).id)).statusCode).toBe(200);

    expect((await send('POST', `/sprints/${s1.id}/complete`, c.member!, {})).statusCode).toBe(403);
    const res = await send('POST', `/sprints/${s1.id}/complete`, c.sadmin!, { destination: 'new' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ state: 'closed', completed: 1, moved: 2, movedTo: { name: `${sp.key} Sprint 2` } });

    const openNow = (await send('GET', `/items/${open.id}`, c.member!)).json();
    expect(openNow).toMatchObject({ sprintId: res.json().movedTo.id, carryOverCount: 1 });
    expect((await send('GET', `/items/${done.id}`, c.member!)).json().sprintId).toBe(s1.id);

    const report = (await send('GET', `/sprints/${s1.id}/report`, c.viewer!)).json();
    expect(report.completed.map((i: Json) => i.title)).toEqual(['Done one']);
    expect(report.notCompleted.map((i: Json) => i.title).sort()).toEqual(['Added late', 'Open one']);
    expect(report.addedAfterStart.map((i: Json) => i.title)).toEqual(['Added late']);

    expect((await send('PATCH', `/sprints/${s1.id}`, c.member!, { name: 'x' })).statusCode).toBe(409);
    expect((await send('POST', `/sprints/${s1.id}/complete`, c.sadmin!, {})).statusCode).toBe(409);
    expect((await toSprint([open.id], s1.id)).statusCode).toBe(409);
  });

  it('can send unfinished work to the backlog or to a planned sprint', async () => {
    const sp = await scrumSpace();
    const [s1, s2] = [await mkSprint(sp), await mkSprint(sp)];
    const x = await mkItem(sp);
    await toSprint([x.id], s1.id);
    await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(3) });
    const res = await send('POST', `/sprints/${s1.id}/complete`, c.sadmin!, { destination: s2.id });
    expect(res.json().movedTo.id).toBe(s2.id);
    await send('POST', `/sprints/${s2.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(3) });
    await send('POST', `/sprints/${s2.id}/complete`, c.sadmin!, { destination: 'backlog' });
    const item = (await send('GET', `/items/${x.id}`, c.member!)).json();
    expect(item).toMatchObject({ sprintId: null, carryOverCount: 2 });
  });
});

describe('burndown', () => {
  it('matches the recorded history: ideal line, remaining points and scope changes', async () => {
    const sp = await scrumSpace();
    const s1 = await mkSprint(sp);
    const a = await mkItem(sp, { estimate: 3 });
    const b = await mkItem(sp, { estimate: 5 });
    await toSprint([a.id, b.id], s1.id);
    await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(4) });
    expect((await finish(a, (await doneStatus(sp)).id)).statusCode).toBe(200);
    const added = await mkItem(sp, { estimate: 2, title: 'Scope creep' });
    await toSprint([added.id], s1.id);
    await snapshotActiveSprints(t.db);
    await snapshotActiveSprints(t.db); // idempotent: still one row for today

    const res = await send('GET', `/sprints/${s1.id}/burndown`, c.member!);
    expect(res.statusCode, res.body).toBe(200);
    const bd = res.json();
    expect(bd.startPoints).toBe(8);
    expect(bd.ideal.map((p: Json) => p.points)).toEqual([8, 6, 4, 2, 0]);
    // Today: 8 - 3 done + 2 added = 7 remaining, of 10 in total.
    expect(bd.actual).toEqual([{ date: today(), points: 7, total: 10 }]);
    expect(bd.scopeChanges).toEqual([expect.objectContaining({ kind: 'added', points: 2, title: 'Scope creep' })]);

    const admin = adminDb();
    try {
      expect(await admin.db.global.all.sprintSnapshots.count({ sprintId: s1.id })).toBe(1);
    } finally {
      await admin.close();
    }
  });
});

describe('plans, board type and isolation', () => {
  it('needs scrum_sprints to start and burndown_reports for the chart', async () => {
    const { org, slug, owner } = await createOrg('spr');
    const admin = adminDb();
    try {
      await admin.db.global.organizations.updateOne({ id: org.id }, { planKey: 'team' });
    } finally {
      await admin.close();
    }
    const cookie = await signInAs(t.app, slug, owner);
    const sp = (await send('POST', '/spaces', cookie, { key: 'TEAMS', name: 'T', boardType: 'scrum' }, slug)).json();
    const s1 = (await send('POST', `/spaces/${sp.id}/sprints`, cookie, {}, slug)).json();
    const item = (await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'x' }, slug)).json();
    await send('POST', '/items/sprint', cookie, { ids: [item.id], sprintId: s1.id }, slug);
    expect((await send('POST', `/sprints/${s1.id}/start`, cookie, { startDate: today(), endDate: plusDays(2) }, slug)).statusCode).toBe(200);
    expect((await send('GET', `/sprints/${s1.id}/burndown`, cookie, undefined, slug)).statusCode).toBe(402);

    // Free cannot make Scrum spaces at all.
    await (async () => {
      const a2 = adminDb();
      try {
        await a2.db.global.organizations.updateOne({ id: org.id }, { planKey: 'free' });
      } finally {
        await a2.close();
      }
    })();
    expect((await send('POST', '/spaces', cookie, { key: 'FREES', name: 'F', boardType: 'scrum' }, slug)).statusCode).toBe(402);
  });

  it('switches board type only without a running sprint; back to Kanban returns planned work to the backlog', async () => {
    const sp = await scrumSpace();
    const [s1, s2] = [await mkSprint(sp), await mkSprint(sp)];
    const a = await mkItem(sp);
    const b = await mkItem(sp);
    await toSprint([a.id], s1.id);
    await toSprint([b.id], s2.id);
    await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(3) });
    expect((await send('PUT', `/spaces/${sp.id}/board-type`, c.sadmin!, { type: 'kanban' })).statusCode).toBe(409);
    expect((await send('PUT', `/spaces/${sp.id}/board-type`, c.member!, { type: 'kanban' })).statusCode).toBe(403);
    await send('POST', `/sprints/${s1.id}/complete`, c.sadmin!, { destination: 'backlog' });
    const res = await send('PUT', `/spaces/${sp.id}/board-type`, c.sadmin!, { type: 'kanban' });
    expect(res.json()).toEqual({ type: 'kanban', movedToBacklog: 1 });
    expect((await send('GET', `/items/${b.id}`, c.member!)).json().sprintId).toBeNull();
    expect((await send('PUT', `/spaces/${sp.id}/board-type`, c.sadmin!, { type: 'scrum' })).json().type).toBe('scrum');
  });

  it('keeps sprints inside their workspace', async () => {
    const sp = await scrumSpace();
    const s1 = await mkSprint(sp);
    for (const url of [`/sprints/${s1.id}/report`, `/sprints/${s1.id}/burndown`]) {
      expect((await send('GET', url, c.gx!, undefined, 'globex')).statusCode).toBe(404);
    }
    expect((await send('PATCH', `/sprints/${s1.id}`, c.gx!, { name: 'x' }, 'globex')).statusCode).toBe(404);
    expect((await send('POST', `/sprints/${s1.id}/start`, c.gx!, {}, 'globex')).statusCode).toBe(404);
    const item = await mkItem(sp);
    const gxSpace = (await send('POST', '/spaces', c.gx!, { key: `G${Math.random().toString(36).slice(2, 6).toUpperCase()}`, name: 'G', boardType: 'scrum' }, 'globex')).json();
    const gxSprint = (await send('POST', `/spaces/${gxSpace.id}/sprints`, c.gx!, {}, 'globex')).json();
    expect((await send('POST', '/items/sprint', c.gx!, { ids: [item.id], sprintId: gxSprint.id }, 'globex')).statusCode).toBe(404);
    expect((await toSprint([item.id], gxSprint.id)).statusCode).toBe(422);
  });

  it('tells the space when a sprint starts', async () => {
    const sp = await scrumSpace();
    const s1 = await mkSprint(sp);
    await toSprint([(await mkItem(sp)).id], s1.id);
    await send('POST', `/sprints/${s1.id}/start`, c.sadmin!, { startDate: today(), endDate: plusDays(3) });
    const items = (await send('GET', '/notifications', c.member!)).json().items as Json[];
    expect(items.find((n) => n.type === 'sprint_started' && n.data.sprintId === s1.id)?.text).toContain(`started ${s1.name}`);
  });
});
