import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDb, caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';
import { categoryAt, createdVsResolved, cumulativeFlow, cycleTimes, percentile, type Tracked } from '../src/work/flow.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const d = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const card = (over: Partial<Tracked> & Pick<Tracked, 'createdAt'>): Tracked => ({
  id: Math.random().toString(36),
  key: 'X-1',
  title: 'Card',
  type: 'story',
  resolvedAt: null,
  current: 'todo',
  start: 'todo',
  moves: [],
  ...over,
});

describe('flow calculations', () => {
  const a = card({
    createdAt: d('2026-03-01'),
    start: 'todo',
    current: 'done',
    resolvedAt: d('2026-03-05'),
    moves: [
      { at: d('2026-03-03'), from: 'todo', to: 'in_progress' },
      { at: d('2026-03-05'), from: 'in_progress', to: 'done' },
    ],
  });
  const b = card({ createdAt: d('2026-03-04') });

  it('knows which category a card was in at any moment', () => {
    expect(categoryAt(a, d('2026-02-28'))).toBeNull();
    expect(categoryAt(a, d('2026-03-02'))).toBe('todo');
    expect(categoryAt(a, d('2026-03-03') + 1)).toBe('in_progress');
    expect(categoryAt(a, d('2026-03-09'))).toBe('done');
    expect(categoryAt(b, d('2026-03-09'))).toBe('todo');
  });

  it('counts cards per category at the end of each day', () => {
    const rows = cumulativeFlow([a, b], ['2026-03-02', '2026-03-04', '2026-03-05'], 'UTC', d('2026-04-01'));
    expect(rows).toEqual([
      { date: '2026-03-02', todo: 1, in_progress: 0, done: 0 },
      { date: '2026-03-04', todo: 1, in_progress: 1, done: 0 },
      { date: '2026-03-05', todo: 1, in_progress: 0, done: 1 },
    ]);
  });

  it('counts created and resolved per day and keeps the open total', () => {
    const rows = createdVsResolved([a, b], ['2026-03-03', '2026-03-04', '2026-03-05'], 'UTC');
    expect(rows).toEqual([
      { date: '2026-03-03', created: 0, resolved: 0, open: 1 },
      { date: '2026-03-04', created: 1, resolved: 0, open: 2 },
      { date: '2026-03-05', created: 0, resolved: 1, open: 1 },
    ]);
  });

  it('measures cycle time from first In progress, lead time from creation, and percentiles', () => {
    const c = cycleTimes([a, b], d('2026-03-01'), d('2026-03-10'));
    expect(c.points).toHaveLength(1);
    expect(c.points[0]).toMatchObject({ days: 2, leadDays: 4, rolling: 2 });
    expect(c.summary).toMatchObject({ count: 1, average: 2, p50: 2, p85: 2 });
    expect(percentile([1, 2, 3, 4, 10], 85)).toBe(10);
    expect(percentile([1, 2, 3, 4, 10], 50)).toBe(3);
    expect(percentile([], 50)).toBeNull();
    // A card finished before the window is not counted.
    expect(cycleTimes([a], d('2026-03-06'), d('2026-03-10')).summary.count).toBe(0);
  });
});

describe('report endpoint', () => {
  let ids: Awaited<ReturnType<typeof tenantIds>>;
  let brightlyId = '';
  const u: Record<string, { id: string; email: string }> = {};
  const c: Record<string, string> = {};
  const send = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: Json, slug = 'acme') =>
    call({ method, url, slug, cookie, payload });

  beforeAll(async () => {
    ids = await tenantIds();
    const admin = adminDb();
    try {
      brightlyId = (await admin.db.global.organizations.find({})).find((o) => o.slug === 'brightly')!.id;
    } finally {
      await admin.close();
    }
    u.owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('fr-owner'), role: 'owner' });
    c.owner = await signInAs(t.app, 'acme', u.owner);
    u.outsider = await ensureUser({ orgId: ids.acme, email: uniqueEmail('fr-out'), role: 'member' });
    c.outsider = await signInAs(t.app, 'acme', u.outsider);
    u.free = await ensureUser({ orgId: brightlyId, email: uniqueEmail('fr-free', 'brightly.test'), role: 'owner' });
    c.free = await signInAs(t.app, 'brightly', u.free);
  });

  const mk = async (cookie: string, slug: string, boardType: 'kanban' | 'scrum') => {
    const res = await send(
      'POST',
      '/spaces',
      cookie,
      { key: `F${Math.random().toString(36).slice(2, 6).toUpperCase()}`, name: 'Flow', boardType, visibility: 'private' },
      slug,
    );
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Json;
  };

  it('computes live numbers from what happened, for Kanban and Scrum', async () => {
    const sp = await mk(c.owner!, 'acme', 'scrum');
    const statuses = (await send('GET', `/spaces/${sp.id}/statuses`, c.owner!)).json().items as Json[];
    const done = statuses.find((s) => s.category === 'done')!;
    const doing = statuses.find((s) => s.category === 'in_progress')!;
    const made = (await send('POST', `/spaces/${sp.id}/items`, c.owner!, { type: 'story', title: 'One', estimate: 3 })).json();
    await send('POST', `/spaces/${sp.id}/items`, c.owner!, { type: 'story', title: 'Two' });
    const move = async (statusId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/items/${made.id}/move`,
        headers: {
          host: 'acme.localhost:3000',
          'if-match': ((await send('GET', `/items/${made.id}`, c.owner!)).json() as Json).updatedAt,
        },
        cookies: { cd_session: c.owner! },
        payload: { statusId },
      });
    expect((await move(doing.id)).statusCode).toBe(200);
    expect((await move(done.id)).statusCode).toBe(200);

    const res = await send('GET', `/spaces/${sp.id}/reports?days=7`, c.owner!);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.flow).toHaveLength(7);
    expect(body.flow.at(-1)).toMatchObject({ todo: 1, in_progress: 0, done: 1 });
    expect(body.throughput.at(-1)).toMatchObject({ created: 2, resolved: 1, open: 1 });
    expect(body.cycle.summary.count).toBe(1);
    expect(body.velocity).toEqual([]);

    const kanban = await mk(c.owner!, 'acme', 'kanban');
    expect((await send('GET', `/spaces/${kanban.id}/reports`, c.owner!)).json().velocity).toBeNull();
  });

  it('are an upgrade on lower plans and private to people who can open the space', async () => {
    const free = await mk(c.free!, 'brightly', 'kanban');
    const locked = await send('GET', `/spaces/${free.id}/reports`, c.free!, undefined, 'brightly');
    expect(locked.statusCode).toBe(402);
    expect((await send('GET', `/spaces/${free.id}/reports/access`, c.free!, undefined, 'brightly')).json()).toEqual({ enabled: false });

    const sp = await mk(c.owner!, 'acme', 'kanban');
    expect((await send('GET', `/spaces/${sp.id}/reports`, c.outsider!)).statusCode).toBe(404);
    expect((await send('GET', `/spaces/${sp.id}/reports?days=3`, c.owner!)).statusCode).toBe(400);
  });
});
