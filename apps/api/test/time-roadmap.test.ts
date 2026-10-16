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
const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
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
    ['member2', 'member'],
    ['viewer', 'member'],
    ['outsider', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`tr-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.free = await ensureUser({ orgId: brightlyId, email: uniqueEmail('tr-free', 'brightly.test'), role: 'owner' });
  c.free = await signInAs(t.app, 'brightly', u.free);
});

const key = () => `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
async function space() {
  const res = await send('POST', '/spaces', c.owner!, {
    key: key(),
    name: 'Time',
    visibility: 'private',
    members: [
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.member2!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
}
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
const ymd = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('time tracking', () => {
  it('plans time on an item and brings the remaining time down as work is logged', async () => {
    const sp = await space();
    const a = await item(sp, { originalMinutes: 480 });
    expect(a.time).toEqual({ original: 480, remaining: 480, spent: 0 });

    const log = await send('POST', `/items/${a.id}/worklogs`, c.member!, { minutes: 90, note: 'Wiring it up' });
    expect(log.statusCode, log.body).toBe(200);
    expect(log.json()).toMatchObject({ minutes: 90, note: 'Wiring it up', permissions: { edit: true, delete: true } });
    expect((await get(a.id)).time).toEqual({ original: 480, remaining: 390, spent: 90 });

    // Saying what is left overrides the automatic change.
    await send('POST', `/items/${a.id}/worklogs`, c.member2!, { minutes: 30, remainingMinutes: 60 });
    expect((await get(a.id)).time).toEqual({ original: 480, remaining: 60, spent: 120 });

    const list = (await send('GET', `/items/${a.id}/worklogs`, c.viewer!)).json();
    expect(list.total).toBe(120);
    expect(list.items).toHaveLength(2);
    expect(list.permissions.add).toBe(false);
    const activity = (await send('GET', `/items/${a.id}/activity`, c.member!)).json().items as Json[];
    expect(activity.some((e) => e.field === 'timeLogged')).toBe(true);
  });

  it('rejects bad time, future days, viewers and strangers', async () => {
    const sp = await space();
    const a = await item(sp);
    const log = (payload: Json, cookie = c.member!) => send('POST', `/items/${a.id}/worklogs`, cookie, payload);
    expect((await log({ minutes: 0 })).statusCode).toBe(400);
    expect((await log({ minutes: 1441 })).statusCode).toBe(400);
    expect((await log({ minutes: 30, date: ymd(2) })).statusCode).toBe(422);
    expect((await log({ minutes: 30, date: ymd(-3) })).statusCode).toBe(200);
    expect((await log({ minutes: 30 }, c.viewer!)).statusCode).toBe(403);
    expect((await log({ minutes: 30 }, c.outsider!)).statusCode).toBe(404);
    // No planned time: logging does not invent a remaining time.
    expect((await get(a.id)).time).toEqual({ original: null, remaining: null, spent: 30 });
  });

  it('are edited by their author, removed by the author or an admin, and give time back', async () => {
    const sp = await space();
    const a = await item(sp, { originalMinutes: 120 });
    const mine = (await send('POST', `/items/${a.id}/worklogs`, c.member!, { minutes: 60 })).json();
    expect((await send('PATCH', `/worklogs/${mine.id}`, c.member2!, { minutes: 5 })).statusCode).toBe(403);
    expect((await send('PATCH', `/worklogs/${mine.id}`, c.owner!, { minutes: 5 })).statusCode).toBe(403);
    expect((await send('PATCH', `/worklogs/${mine.id}`, c.member!, { minutes: 45, note: 'Less than I thought' })).json()).toMatchObject({ minutes: 45 });
    expect((await send('DELETE', `/worklogs/${mine.id}`, c.member2!)).statusCode).toBe(403);
    expect((await send('DELETE', `/worklogs/${mine.id}`, c.owner!)).statusCode).toBe(200);
    // 120 planned, 60 taken off when logged, 60 given back when removed.
    expect((await get(a.id)).time).toEqual({ original: 120, remaining: 120, spent: 0 });
    expect((await send('DELETE', `/worklogs/${mine.id}`, c.owner!)).statusCode).toBe(404);
  });

  it('keeps start before due', async () => {
    const sp = await space();
    const a = await item(sp, { startDate: ymd(1), dueDate: ymd(5) });
    expect((await patch(a, { dueDate: ymd(0) })).statusCode).toBe(422);
    expect((await patch(a, { startDate: ymd(2), dueDate: ymd(3) })).statusCode).toBe(200);
    expect((await get(a.id)).startDate).toBe(ymd(2));
  });
});

describe('roadmap', () => {
  it('lists epics with dates, progress and time, and the versions with release dates', async () => {
    const sp = await space();
    const epic = await item(sp, { type: 'epic', title: 'Big', startDate: ymd(-10), dueDate: ymd(20) });
    const statuses = (await send('GET', `/spaces/${sp.id}/statuses`, c.owner!)).json().items as Json[];
    const done = statuses.find((s) => s.category === 'done')!;
    const s1 = await item(sp, { title: 'Done one', parentId: epic.id, estimate: 3, originalMinutes: 60 });
    await item(sp, { title: 'Open one', parentId: epic.id, estimate: 2, originalMinutes: 30 });
    await patch(s1, { statusId: done.id });
    await send('POST', `/items/${s1.id}/worklogs`, c.member!, { minutes: 45 });
    await send('POST', `/spaces/${sp.id}/versions`, c.member!, { name: 'v1', releaseDate: ymd(30) });

    const res = await send('GET', `/spaces/${sp.id}/roadmap`, c.viewer!);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.permissions.edit).toBe(false);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      key: epic.key,
      startDate: ymd(-10),
      dueDate: ymd(20),
      progress: { total: 2, done: 1, points: 5, donePoints: 3, plannedMinutes: 90, spentMinutes: 45 },
    });
    expect(body.versions).toEqual([expect.objectContaining({ name: 'v1', releaseDate: ymd(30) })]);
    expect((await send('GET', `/spaces/${sp.id}/roadmap`, c.outsider!)).statusCode).toBe(404);
  });

  it('is an upgrade on the Free plan', async () => {
    const res = await send('POST', '/spaces', c.free!, { key: key(), name: 'Free' }, 'brightly');
    const body = (await send('GET', `/spaces/${res.json().id}/roadmap`, c.free!, undefined, 'brightly')).json();
    expect(body).toMatchObject({ enabled: false, items: [] });
  });
});

describe('calendar', () => {
  it('returns items due in the range and releases dated in it', async () => {
    const sp = await space();
    const inside = await item(sp, { title: 'Inside', dueDate: ymd(3) });
    await item(sp, { title: 'Outside', dueDate: ymd(40) });
    await item(sp, { title: 'No date' });
    await send('POST', `/spaces/${sp.id}/versions`, c.member!, { name: 'cal', releaseDate: ymd(4) });
    const res = await send('GET', `/spaces/${sp.id}/calendar?from=${ymd(0)}&to=${ymd(10)}`, c.viewer!);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items.map((i: Json) => i.id)).toEqual([inside.id]);
    expect(res.json().releases.map((r: Json) => r.name)).toEqual(['cal']);
    expect((await send('GET', `/spaces/${sp.id}/calendar?from=${ymd(0)}&to=${ymd(100)}`, c.viewer!)).statusCode).toBe(422);
    expect((await send('GET', `/spaces/${sp.id}/calendar?from=${ymd(0)}&to=${ymd(5)}`, c.outsider!)).statusCode).toBe(404);
  });
});
