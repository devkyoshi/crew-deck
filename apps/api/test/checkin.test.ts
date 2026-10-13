import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  adminDb,
  appDb,
  caller,
  createOrg,
  ensureUser,
  makeApp,
  signInAs,
  tenantIds,
  uniqueEmail,
} from './helpers.js';
import { autoCloseOrg } from '../src/checkin/service.js';
import { auditLogs, users, workDayEdits, workDays } from '../src/db/schema.js';
import { addDays, localDate, zonedTimeToUtc } from '../src/lib/time.js';

const t = makeApp();
const call = caller(t.app);
let slug: string, orgId: string, domain: string;
let ownerC: string, adminC: string;
let globexC: string;

type P = { id: string; email: string; cookie: string; tz: string };

async function person(opts: { tz?: string; role?: 'member' | 'admin' } = {}): Promise<P> {
  const tz = opts.tz ?? 'UTC';
  const u = await ensureUser({
    orgId,
    email: uniqueEmail('ci', domain),
    role: opts.role ?? 'member',
  });
  const db = adminDb();
  try {
    await db.db.update(users).set({ timezone: tz }).where(eq(users.id, u.id));
  } finally {
    await db.close();
  }
  return { id: u.id, email: u.email, cookie: await signInAs(t.app, slug, u), tz };
}

const get = (url: string, cookie: string, s = slug) =>
  call({ method: 'GET', url, slug: s, cookie });
const post = (url: string, cookie: string, payload: object = {}, s = slug) =>
  call({ method: 'POST', url, slug: s, cookie, payload });
const patch = (url: string, cookie: string, payload: object, s = slug) =>
  call({ method: 'PATCH', url, slug: s, cookie, payload });
const put = (url: string, cookie: string, payload: object, s = slug) =>
  call({ method: 'PUT', url, slug: s, cookie, payload });
const todayIn = (tz: string) => localDate(new Date(), tz);
const hh = (d: string, time: string, tz = 'UTC') => zonedTimeToUtc(d, time, tz).toISOString();

async function dayRow(userId: string, date: string) {
  const db = adminDb();
  try {
    return (
      await db.db
        .select()
        .from(workDays)
        .where(and(eq(workDays.userId, userId), eq(workDays.date, date)))
    )[0];
  } finally {
    await db.close();
  }
}

async function auditFor(action: string, targetId: string) {
  const db = adminDb();
  try {
    return await db.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)));
  } finally {
    await db.close();
  }
}

beforeAll(async () => {
  const org = await createOrg('chk');
  slug = org.slug;
  orgId = org.org.id;
  domain = `${slug}.test`;
  ownerC = await signInAs(t.app, slug, org.owner);
  const admin = await ensureUser({ orgId, email: uniqueEmail('cadm', domain), role: 'admin' });
  adminC = await signInAs(t.app, slug, admin);
  const ids = await tenantIds();
  const g = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('cglob', 'globex.test'),
    role: 'owner',
  });
  globexC = await signInAs(t.app, 'globex', g);
  await t.app.ready();
});
afterAll(() => t.close());

describe('checking in and out', () => {
  it('starts as not checked in, then checks in and out', async () => {
    const p = await person();
    const start = (await get('/me/today', p.cookie)).json();
    expect(start).toMatchObject({
      enabled: true,
      status: 'not_in',
      workDay: null,
      date: todayIn('UTC'),
    });
    expect(start.settings).toMatchObject({ requireNote: false, workStart: '09:00' });

    const inRes = await post('/checkin', p.cookie, {
      locationType: 'remote',
      note: 'Working from home',
    });
    expect(inRes.statusCode).toBe(200);
    expect(inRes.json()).toMatchObject({
      status: 'checked_in',
      workDay: { locationType: 'remote', note: 'Working from home', checkoutAt: null },
    });
    expect(inRes.json().workDay.checkinAt).toBeTruthy();

    const out = await post('/checkout', p.cookie, { note: 'Shipped the report' });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toMatchObject({
      status: 'checked_out',
      workDay: { note: 'Shipped the report', autoClosed: false },
    });
    expect(out.json().workDay.hours).toBeGreaterThanOrEqual(0);
  });

  it('refuses double check-ins, checking out when not in, and checking in again after checking out', async () => {
    const p = await person();
    expect((await post('/checkout', p.cookie)).json().code).toBe('not_checked_in');
    await post('/checkin', p.cookie, { locationType: 'offsite' });
    const again = await post('/checkin', p.cookie, { locationType: 'remote' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('already_checked_in');
    await post('/checkout', p.cookie);
    expect((await post('/checkout', p.cookie)).json().code).toBe('not_checked_in');
    const late = await post('/checkin', p.cookie, { locationType: 'remote' });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('already_checked_out');
  });

  it('validates input and requires a session', async () => {
    const p = await person();
    expect((await post('/checkin', p.cookie, { locationType: 'leave' })).statusCode).toBe(400);
    expect((await post('/checkin', p.cookie, { locationType: 'moon' })).statusCode).toBe(400);
    expect(
      (await post('/checkin', p.cookie, { locationType: 'remote', note: 'x'.repeat(501) }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call({ method: 'POST', url: '/checkin', slug, payload: { locationType: 'remote' } }))
        .statusCode,
    ).toBe(401);
    expect((await call({ method: 'GET', url: '/me/today', slug })).statusCode).toBe(401);
  });

  it('uses the person’s own timezone for what “today” is', async () => {
    const east = await person({ tz: 'Pacific/Kiritimati' }); // UTC+14
    const west = await person({ tz: 'Pacific/Pago_Pago' }); // UTC-11
    const e = (await post('/checkin', east.cookie, { locationType: 'remote' })).json();
    const w = (await post('/checkin', west.cookie, { locationType: 'remote' })).json();
    // 25 hours apart, so at any instant their calendar dates differ.
    expect(e.date > w.date).toBe(true);
    expect(e.date).toBe(todayIn('Pacific/Kiritimati'));
    expect(w.date).toBe(todayIn('Pacific/Pago_Pago'));
    expect((await dayRow(east.id, e.date))?.checkinAt).toBeTruthy();
    expect(e.timezone).toBe('Pacific/Kiritimati');
    // Shown to the person in their own clock.
    expect(e.workDay.checkinLocal).toMatch(/^\d\d:\d\d$/);
  });

  it('checks out an overnight session on the day it started', async () => {
    const p = await person();
    const yesterday = addDays(todayIn('UTC'), -1);
    const db = adminDb();
    try {
      await db.db.insert(workDays).values({
        orgId,
        userId: p.id,
        date: yesterday,
        locationType: 'remote',
        checkinAt: new Date(Date.now() - 6 * 3600_000),
      });
    } finally {
      await db.close();
    }
    const today = (await get('/me/today', p.cookie)).json();
    expect(today.status).toBe('checked_in'); // still open from yesterday
    expect(today.workDay.date).toBe(yesterday);
    const out = await post('/checkout', p.cookie);
    expect(out.statusCode).toBe(200);
    expect((await dayRow(p.id, yesterday))?.checkoutAt).toBeTruthy();
    // And a new check-in today is allowed once it is closed.
    expect((await post('/checkin', p.cookie, { locationType: 'remote' })).statusCode).toBe(200);
  });
});

describe('sites and required notes (isolated workspace)', () => {
  it('requires a site for onsite check-ins once sites exist, and validates it', async () => {
    const org = await createOrg('chs');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const me = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('s', `${org.slug}.test`),
      role: 'member',
    });
    const mc = await signInAs(t.app, org.slug, me);
    // No sites yet: onsite works without one.
    expect((await post('/checkin', mc, { locationType: 'onsite' }, org.slug)).statusCode).toBe(200);
    await post('/checkout', mc, {}, org.slug);

    const site = (
      await post('/sites', owner, { name: 'Head office', address: '1 Main St' }, org.slug)
    ).json();
    const other = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('s2', `${org.slug}.test`),
      role: 'member',
    });
    const oc = await signInAs(t.app, org.slug, other);
    const missing = await post('/checkin', oc, { locationType: 'onsite' }, org.slug);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().fields.siteId).toBeTruthy();
    expect(
      (
        await post(
          '/checkin',
          oc,
          { locationType: 'onsite', siteId: '00000000-0000-4000-8000-000000000000' },
          org.slug,
        )
      ).statusCode,
    ).toBe(400);
    const ok = await post('/checkin', oc, { locationType: 'onsite', siteId: site.id }, org.slug);
    expect(ok.json().workDay).toMatchObject({ siteId: site.id, siteName: 'Head office' });

    // Remote and offsite never need one.
    const third = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('s3', `${org.slug}.test`),
      role: 'member',
    });
    expect(
      (
        await post(
          '/checkin',
          await signInAs(t.app, org.slug, third),
          { locationType: 'remote' },
          org.slug,
        )
      ).statusCode,
    ).toBe(200);
  });

  it('requires a note at check-out when the workspace says so', async () => {
    const org = await createOrg('chn');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const base = {
      timezone: 'UTC',
      workDays: [1, 2, 3, 4, 5],
      workStart: '09:00',
      workEnd: '17:30',
      autoCloseTime: '20:00',
      checkinEnabled: true,
    };
    expect(
      (await put('/settings/work', owner, { ...base, requireNote: true }, org.slug)).statusCode,
    ).toBe(200);
    const me = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('n', `${org.slug}.test`),
      role: 'member',
    });
    const mc = await signInAs(t.app, org.slug, me);
    await post('/checkin', mc, { locationType: 'remote' }, org.slug);
    const noNote = await post('/checkout', mc, {}, org.slug);
    expect(noNote.statusCode).toBe(400);
    expect(noNote.json().fields.note).toBeTruthy();
    expect((await post('/checkout', mc, { note: '   ' }, org.slug)).statusCode).toBe(400);
    expect((await post('/checkout', mc, { note: 'Reviewed PRs' }, org.slug)).statusCode).toBe(200);
  });

  it('can be switched off per workspace', async () => {
    const org = await createOrg('chd');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const base = {
      timezone: 'UTC',
      workDays: [1, 2, 3, 4, 5],
      workStart: '09:00',
      workEnd: '17:30',
      autoCloseTime: '20:00',
      requireNote: false,
    };
    await put('/settings/work', owner, { ...base, checkinEnabled: false }, org.slug);
    const state = (await get('/me/today', owner, org.slug)).json();
    expect(state.enabled).toBe(false);
    for (const [method, url] of [
      ['POST', '/checkin'],
      ['POST', '/checkout'],
      ['GET', '/team/status'],
    ] as const) {
      const res = await call({
        method,
        url,
        slug: org.slug,
        cookie: owner,
        payload: method === 'POST' ? { locationType: 'remote' } : undefined,
      });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().code).toBe('module_disabled');
    }
    expect(
      (
        await put(
          '/me/plan',
          owner,
          { days: [{ date: todayIn('UTC'), location: 'remote' }] },
          org.slug,
        )
      ).statusCode,
    ).toBe(404);
  });
});

describe('weekly plan, leave and holidays', () => {
  it('plans ahead, shows the week, and clears plans', async () => {
    const p = await person();
    const today = todayIn('UTC');
    const d1 = addDays(today, 1),
      d2 = addDays(today, 2);
    expect(
      (
        await put('/me/plan', p.cookie, {
          days: [
            { date: d1, location: 'remote' },
            { date: d2, location: 'onsite' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const week = (await get(`/me/week?date=${d1}`, p.cookie)).json();
    expect(week.days).toHaveLength(7);
    expect(week.days.find((d: { date: string }) => d.date === d1).plannedLocation).toBe('remote');
    expect(week.days.find((d: { date: string }) => d.date === d2).plannedLocation).toBe('onsite');
    expect(week.days[0].weekday).toBe(1); // Monday first

    await put('/me/plan', p.cookie, { days: [{ date: d1, location: null }] });
    expect(await dayRow(p.id, d1)).toBeUndefined();
    expect((await dayRow(p.id, d2))?.plannedLocation).toBe('onsite');
  });

  it('rejects plans in the past, duplicates, bad dates and far-future dates', async () => {
    const p = await person();
    const today = todayIn('UTC');
    const body = (days: object[]) => put('/me/plan', p.cookie, { days });
    expect((await body([{ date: addDays(today, -1), location: 'remote' }])).json().code).toBe(
      'past_date',
    );
    expect(
      (
        await body([
          { date: today, location: 'remote' },
          { date: today, location: 'onsite' },
        ])
      ).statusCode,
    ).toBe(400);
    expect((await body([{ date: '2026-02-30', location: 'remote' }])).statusCode).toBe(400);
    expect((await body([{ date: addDays(today, 500), location: 'remote' }])).statusCode).toBe(400);
    expect((await body([])).statusCode).toBe(400);
    expect((await body([{ date: today, location: 'holiday' }])).statusCode).toBe(400);
  });

  it('shows planned leave as leave, and a check-in overrides the plan', async () => {
    const p = await person();
    const today = todayIn('UTC');
    await put('/me/plan', p.cookie, { days: [{ date: today, location: 'leave' }] });
    expect((await get('/me/today', p.cookie)).json().status).toBe('leave');
    // Changing their mind: checking in turns the day into a working day, and the plan is kept for reference.
    const res = await post('/checkin', p.cookie, { locationType: 'remote' });
    expect(res.json()).toMatchObject({
      status: 'checked_in',
      workDay: { locationType: 'remote', plannedLocation: 'leave' },
    });
  });

  it('applies workspace holidays, but still lets people check in on one', async () => {
    const org = await createOrg('chh');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const me = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('h', `${org.slug}.test`),
      role: 'member',
    });
    const mc = await signInAs(t.app, org.slug, me);
    const today = todayIn('UTC');
    expect(
      (await post('/holidays', owner, { date: today, name: 'Founders Day' }, org.slug)).statusCode,
    ).toBe(200);
    const state = (await get('/me/today', mc, org.slug)).json();
    expect(state).toMatchObject({ status: 'holiday', holiday: 'Founders Day' });
    expect((await post('/checkin', mc, { locationType: 'remote' }, org.slug)).json().status).toBe(
      'checked_in',
    );
  });
});

describe('team board and who sees exact times', () => {
  it('shows status to teammates but exact times only to the person, their manager and admins', async () => {
    const manager = await person();
    const report = await person();
    const mate = await person();
    expect(
      (await patch(`/members/${report.id}`, adminC, { reportsTo: manager.id })).statusCode,
    ).toBe(200);
    await post('/checkin', report.cookie, { locationType: 'remote' });
    await post('/checkin', mate.cookie, { locationType: 'offsite' });

    const find = async (cookie: string, id: string) =>
      (await get('/team/status', cookie)).json().items.find((i: { id: string }) => i.id === id);

    for (const [who, cookie] of [
      ['self', report.cookie],
      ['manager', manager.cookie],
      ['admin', adminC],
      ['owner', ownerC],
    ] as const) {
      const row = await find(cookie, report.id);
      expect(row, who).toMatchObject({ state: 'in', location: 'remote' });
      expect(row.checkinAt, `${who} sees the time`).toBeTruthy();
    }
    const asMate = await find(mate.cookie, report.id);
    expect(asMate).toMatchObject({
      state: 'in',
      location: 'remote',
      checkinAt: null,
      checkoutAt: null,
      autoClosed: null,
    });
    // Nobody else's exact time is visible to the manager either.
    expect((await find(manager.cookie, mate.id)).checkinAt).toBeNull();
    // Everyone sees their own.
    expect((await find(mate.cookie, mate.id)).checkinAt).toBeTruthy();
  });

  it('groups by state and location, counts them, and drops deactivated people', async () => {
    const a = await person(),
      b = await person(),
      c = await person(),
      d = await person();
    await post('/checkin', a.cookie, { locationType: 'onsite' });
    await post('/checkin', b.cookie, { locationType: 'remote' });
    await post('/checkout', b.cookie);
    await put('/me/plan', c.cookie, { days: [{ date: todayIn('UTC'), location: 'leave' }] });
    const board = (await get('/team/status', a.cookie)).json();
    const state = (id: string) => board.items.find((i: { id: string }) => i.id === id);
    expect(state(a.id)).toMatchObject({ state: 'in', location: 'onsite' });
    expect(state(b.id)).toMatchObject({ state: 'out', location: 'remote' });
    expect(state(c.id)).toMatchObject({ state: 'leave', location: 'leave' });
    expect(state(d.id)).toMatchObject({ state: 'none', location: null });
    expect(board.counts.onsite).toBeGreaterThanOrEqual(1);
    expect(board.total).toBe(board.items.length);

    await post(`/members/${a.id}/deactivate`, adminC);
    expect(
      (await get('/team/status', b.cookie)).json().items.some((i: { id: string }) => i.id === a.id),
    ).toBe(false);
  });

  it('filters by group and by space, respecting space visibility', async () => {
    const inGroup = await person(),
      outside = await person();
    const group = (
      await post('/groups', adminC, { name: `Board ${Math.random().toString(36).slice(2, 7)}` })
    ).json();
    await put(`/groups/${group.id}/members`, adminC, { userIds: [inGroup.id] });
    const board = (await get(`/team/status?group=${group.id}`, outside.cookie)).json();
    expect(board.items.map((i: { id: string }) => i.id)).toEqual([inGroup.id]);

    const key = `B${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const space = (
      await post('/spaces', adminC, {
        key,
        name: 'Board space',
        visibility: 'private',
        members: [{ type: 'group', id: group.id, role: 'member' }],
      })
    ).json();
    const viaGroup = (await get(`/team/status?space=${space.id}`, adminC)).json();
    expect(viaGroup.items.map((i: { id: string }) => i.id)).toContain(inGroup.id);
    expect(viaGroup.items.some((i: { id: string }) => i.id === outside.id)).toBe(false);
    // A private space the caller cannot see is "not found".
    expect((await get(`/team/status?space=${space.id}`, outside.cookie)).statusCode).toBe(404);
    expect((await get('/team/status?group=not-a-uuid', adminC)).statusCode).toBe(400);
  });

  it('never shows another workspace’s people', async () => {
    const mine = await person();
    const board = (await get('/team/status', globexC, 'globex')).json();
    expect(board.items.some((i: { id: string }) => i.id === mine.id)).toBe(false);
    expect((await get('/me/today', mine.cookie, 'globex')).statusCode).toBe(401);
  });
});

describe('history, scopes and permissions', () => {
  it('lets people see their own history, managers their reports, admins everyone, and nobody else', async () => {
    const manager = await person(),
      report = await person(),
      other = await person();
    await patch(`/members/${report.id}`, adminC, { reportsTo: manager.id });
    await post('/checkin', report.cookie, { locationType: 'remote' });
    await post('/checkin', other.cookie, { locationType: 'remote' });

    const mine = (await get('/work-days', report.cookie)).json();
    expect(mine.items.every((i: { userId: string }) => i.userId === report.id)).toBe(true);
    expect(mine.items[0]).toMatchObject({
      locationType: 'remote',
      edited: false,
      autoClosed: false,
    });

    expect((await get(`/work-days?userId=${report.id}`, manager.cookie)).statusCode).toBe(200);
    const reports = (await get('/work-days?scope=reports', manager.cookie)).json();
    expect(reports.items.every((i: { userId: string }) => i.userId === report.id)).toBe(true);
    expect((await get(`/work-days?userId=${other.id}`, manager.cookie)).statusCode).toBe(403);
    expect((await get(`/work-days?userId=${report.id}`, other.cookie)).statusCode).toBe(403);
    expect((await get('/work-days?scope=all', manager.cookie)).statusCode).toBe(403);
    const all = (await get('/work-days?scope=all&pageSize=100', adminC)).json();
    expect(new Set(all.items.map((i: { userId: string }) => i.userId)).size).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('paginates, defaults to 30 days, and rejects bad ranges', async () => {
    const p = await person();
    const db = adminDb();
    try {
      await db.db.insert(workDays).values(
        Array.from({ length: 12 }, (_, i) => ({
          orgId,
          userId: p.id,
          date: addDays(todayIn('UTC'), -i - 1),
          locationType: 'remote' as const,
          checkinAt: new Date(Date.now() - (i + 1) * 86_400_000),
          checkoutAt: new Date(Date.now() - (i + 1) * 86_400_000 + 8 * 3600_000),
        })),
      );
    } finally {
      await db.close();
    }
    const page1 = (await get('/work-days?pageSize=5&page=1', p.cookie)).json();
    const page3 = (await get('/work-days?pageSize=5&page=3', p.cookie)).json();
    expect(page1.total).toBe(12);
    expect(page1.items).toHaveLength(5);
    expect(page3.items).toHaveLength(2);
    expect(page1.items[0].date > page1.items[4].date).toBe(true); // newest first
    expect(page1.items[0].hours).toBe(8);
    expect((await get('/work-days?from=2026-02-01&to=2026-01-01', p.cookie)).statusCode).toBe(400);
    expect((await get('/work-days?from=2020-01-01&to=2026-01-01', p.cookie)).statusCode).toBe(400);
    expect((await get('/work-days?from=2026-02-30', p.cookie)).statusCode).toBe(400);
  });
});

describe('corrections', () => {
  async function pastDay(p: P, daysAgo = 2) {
    const date = addDays(todayIn(p.tz), -daysAgo);
    const db = adminDb();
    try {
      const [row] = await db.db
        .insert(workDays)
        .values({
          orgId,
          userId: p.id,
          date,
          locationType: 'remote',
          checkinAt: new Date(hh(date, '09:00', p.tz)),
          checkoutAt: new Date(hh(date, '17:00', p.tz)),
        })
        .returning();
      return row!;
    } finally {
      await db.close();
    }
  }

  it('lets people correct their own day with a reason, and records the history and audit entry', async () => {
    const p = await person();
    const day = await pastDay(p);
    const res = await patch(`/work-days/${day.id}`, p.cookie, {
      checkoutAt: hh(day.date, '18:30'),
      note: 'Stayed late',
      reason: 'Forgot to check out on time',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hours).toBe(9.5);
    const row = await dayRow(p.id, day.date);
    expect(row).toMatchObject({ source: 'edit', note: 'Stayed late', autoClosed: false });

    const edits = (await get(`/work-days/${day.id}/edits`, p.cookie)).json().items;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ reason: 'Forgot to check out on time' });
    expect(edits[0].oldValues.checkoutAt).toContain('17:00');
    expect(edits[0].newValues.checkoutAt).toContain('18:30');
    expect(await auditFor('workday.edited', day.id)).toHaveLength(1);
    expect(
      (await get('/work-days', p.cookie)).json().items.find((i: { id: string }) => i.id === day.id)
        .edited,
    ).toBe(true);
  });

  it('requires a reason and a real change, and validates the times', async () => {
    const p = await person();
    const day = await pastDay(p);
    const url = `/work-days/${day.id}`;
    expect((await patch(url, p.cookie, { note: 'x' })).statusCode).toBe(400); // no reason
    expect((await patch(url, p.cookie, { note: 'x', reason: '  ' })).statusCode).toBe(400);
    expect((await patch(url, p.cookie, { reason: 'because', note: day.note })).statusCode).toBe(
      400,
    ); // nothing changed
    expect(
      (await patch(url, p.cookie, { checkoutAt: hh(day.date, '08:00'), reason: 'typo fix' })).json()
        .fields.checkoutAt,
    ).toBeTruthy();
    expect(
      (
        await patch(url, p.cookie, {
          checkinAt: hh(addDays(day.date, 1), '09:00'),
          reason: 'typo fix',
        })
      ).statusCode,
    ).toBe(400); // different day
    expect(
      (
        await patch(url, p.cookie, {
          checkoutAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
          reason: 'future',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await patch(url, p.cookie, { locationType: 'holiday', reason: 'nope nope' })).statusCode,
    ).toBe(400);
    expect((await patch(url, p.cookie, { orgId: 'x', reason: 'nope nope' })).statusCode).toBe(400); // unknown field
  });

  it('lets managers and admins correct, but not teammates, and hides other people’s days', async () => {
    const manager = await person(),
      report = await person(),
      mate = await person();
    await patch(`/members/${report.id}`, adminC, { reportsTo: manager.id });
    const day = await pastDay(report);
    const edit = (cookie: string) =>
      patch(`/work-days/${day.id}`, cookie, {
        note: `by ${Math.random()}`,
        reason: 'fixing a typo',
      });
    expect((await edit(mate.cookie)).statusCode).toBe(404); // looks like it does not exist
    expect((await edit(manager.cookie)).statusCode).toBe(200);
    expect((await edit(adminC)).statusCode).toBe(200);
    expect((await edit(ownerC)).statusCode).toBe(200);
    expect((await get(`/work-days/${day.id}/edits`, mate.cookie)).statusCode).toBe(404);
    expect(
      (await get(`/work-days/${day.id}/edits`, manager.cookie)).json().items.length,
    ).toBeGreaterThanOrEqual(3);
    // Cross-tenant.
    expect(
      (await patch(`/work-days/${day.id}`, globexC, { note: 'x', reason: 'attack' }, 'globex'))
        .statusCode,
    ).toBe(404);
  });

  it('creates a missing day (a forgotten check-in) with a reason', async () => {
    const p = await person(),
      mate = await person();
    const date = addDays(todayIn('UTC'), -3);
    const body = {
      date,
      checkinAt: hh(date, '09:15'),
      checkoutAt: hh(date, '17:45'),
      locationType: 'onsite',
      reason: 'Forgot to check in',
    };
    expect((await post('/work-days', mate.cookie, { ...body, userId: p.id })).statusCode).toBe(403);
    const ok = await post('/work-days', p.cookie, body);
    expect(ok.statusCode).toBe(200);
    expect(await dayRow(p.id, date)).toMatchObject({ locationType: 'onsite', source: 'edit' });
    expect(await auditFor('workday.created_by_correction', ok.json().id)).toHaveLength(1);
    expect(
      (
        await post('/work-days', p.cookie, {
          ...body,
          date: addDays(todayIn('UTC'), 4),
          checkinAt: hh(addDays(todayIn('UTC'), 4), '09:00'),
          checkoutAt: undefined,
        })
      ).statusCode,
    ).toBe(400); // future
  });

  it('keeps edit history append-only for the application role', async () => {
    const p = await person();
    const day = await pastDay(p);
    await patch(`/work-days/${day.id}`, p.cookie, { note: 'first', reason: 'adding a note' });
    const app = appDb();
    try {
      await expect(
        app.db.execute(sql`update work_day_edits set reason = 'tampered'`),
      ).rejects.toThrow();
      await expect(app.db.execute(sql`delete from work_day_edits`)).rejects.toThrow();
    } finally {
      await app.close();
    }
    const db = adminDb();
    try {
      expect(
        await db.db.select().from(workDayEdits).where(eq(workDayEdits.workDayId, day.id)),
      ).toHaveLength(1);
    } finally {
      await db.close();
    }
  });
});

describe('automatic check-out', () => {
  it('closes forgotten check-outs after the auto-close time in the person’s own timezone', async () => {
    const colombo = await person({ tz: 'Asia/Colombo' });
    const date = todayIn('Asia/Colombo');
    const checkin = new Date(zonedTimeToUtc(date, '09:00', 'Asia/Colombo'));
    const db = adminDb();
    try {
      await db.db
        .insert(workDays)
        .values({ orgId, userId: colombo.id, date, locationType: 'remote', checkinAt: checkin });
    } finally {
      await db.close();
    }
    const app = appDb();
    try {
      const before = zonedTimeToUtc(date, '19:59', 'Asia/Colombo');
      const after = zonedTimeToUtc(date, '20:01', 'Asia/Colombo');
      const countBefore = await autoCloseOrg(app.db, orgId, before);
      expect((await dayRow(colombo.id, date))?.checkoutAt).toBeNull();
      expect(countBefore).toBeGreaterThanOrEqual(0);
      const closed = await autoCloseOrg(app.db, orgId, after);
      expect(closed).toBeGreaterThanOrEqual(1);
      const row = await dayRow(colombo.id, date);
      expect(row?.checkoutAt?.toISOString()).toBe(
        zonedTimeToUtc(date, '20:00', 'Asia/Colombo').toISOString(),
      );
      expect(row).toMatchObject({ autoClosed: true, source: 'auto' });
      // Idempotent.
      expect(await autoCloseOrg(app.db, orgId, after)).toBe(0);
    } finally {
      await app.close();
    }
    expect(
      await auditFor('workday.auto_closed', (await dayRow(colombo.id, date))!.id),
    ).toHaveLength(1);
    const view = (await get('/me/today', colombo.cookie)).json();
    expect(view.status).toBe('checked_out');
    expect(view.workDay.autoClosed).toBe(true);
  });

  it('closes old days, never goes backwards for late check-ins, and respects the workspace setting', async () => {
    const org = await createOrg('cha');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const base = {
      timezone: 'UTC',
      workDays: [1, 2, 3, 4, 5],
      workStart: '09:00',
      workEnd: '17:30',
      requireNote: false,
      checkinEnabled: true,
    };
    await put('/settings/work', owner, { ...base, autoCloseTime: '18:00' }, org.slug);
    const a = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('a', `${org.slug}.test`),
      role: 'member',
    });
    const late = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('l', `${org.slug}.test`),
      role: 'member',
    });
    const yesterday = addDays(todayIn('UTC'), -1);
    const db = adminDb();
    try {
      await db.db.insert(workDays).values([
        {
          orgId: org.org.id,
          userId: a.id,
          date: yesterday,
          locationType: 'remote',
          checkinAt: new Date(zonedTimeToUtc(yesterday, '08:00', 'UTC')),
        },
        // Checked in at 21:00, after the 18:00 cut-off: closed at the check-in itself (zero hours).
        {
          orgId: org.org.id,
          userId: late.id,
          date: yesterday,
          locationType: 'remote',
          checkinAt: new Date(zonedTimeToUtc(yesterday, '21:00', 'UTC')),
        },
      ]);
    } finally {
      await db.close();
    }
    const app = appDb();
    try {
      expect(await autoCloseOrg(app.db, org.org.id, new Date())).toBe(2);
    } finally {
      await app.close();
    }
    const rows = adminDb();
    try {
      const all = await rows.db.select().from(workDays).where(eq(workDays.orgId, org.org.id));
      const ra = all.find((r) => r.userId === a.id)!;
      const rl = all.find((r) => r.userId === late.id)!;
      expect(ra.checkoutAt?.toISOString()).toBe(
        zonedTimeToUtc(yesterday, '18:00', 'UTC').toISOString(),
      );
      expect(rl.checkoutAt?.toISOString()).toBe(rl.checkinAt?.toISOString());
    } finally {
      await rows.close();
    }
  });

  it('only touches the workspace it is asked about', async () => {
    const other = await createOrg('chx');
    const p = await ensureUser({
      orgId: other.org.id,
      email: uniqueEmail('x', `${other.slug}.test`),
      role: 'member',
    });
    const yesterday = addDays(todayIn('UTC'), -1);
    const db = adminDb();
    try {
      await db.db.insert(workDays).values({
        orgId: other.org.id,
        userId: p.id,
        date: yesterday,
        locationType: 'remote',
        checkinAt: new Date(zonedTimeToUtc(yesterday, '08:00', 'UTC')),
      });
    } finally {
      await db.close();
    }
    const app = appDb();
    try {
      await autoCloseOrg(app.db, orgId, new Date()); // a different workspace
    } finally {
      await app.close();
    }
    expect((await dayRow(p.id, yesterday))?.checkoutAt).toBeNull();
  });
});

describe('export', () => {
  it('is admin-only and produces a safe CSV', async () => {
    const p = await person();
    const manager = await person();
    await patch(`/members/${p.id}`, adminC, { name: 'Zed "The Great", Jr', reportsTo: manager.id });
    await post('/checkin', p.cookie, {
      locationType: 'remote',
      note: '=HYPERLINK("http://evil.example","click")',
    });
    const csvRes = await get('/work-days/export', adminC);
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.headers['content-disposition']).toMatch(
      /attachment; filename="status-log-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const csv = csvRes.body;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads UTF-8
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'Date,Name,Email,Location,Site,Check-in,Check-out,Hours,Auto-closed,Edited,Note',
    );
    const mine = lines.find((l) => l.includes(p.email))!;
    // Formula injection neutralised and quotes escaped.
    expect(mine).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(mine).toContain('"Zed ""The Great"", Jr"');
    for (const [who, cookie] of [
      ['manager', manager.cookie],
      ['member', p.cookie],
    ] as const) {
      expect((await get('/work-days/export', cookie)).statusCode, who).toBe(403);
    }
    expect((await get('/work-days/export?from=2026-01-01&to=2026-01-02', ownerC)).statusCode).toBe(
      200,
    );
    expect((await get('/work-days/export?from=2020-01-01&to=2026-01-02', adminC)).statusCode).toBe(
      400,
    );
    // Another workspace's export never includes these people.
    expect((await get('/work-days/export', globexC, 'globex')).body).not.toContain(p.email);
  });
});

describe('settings, sites and holidays', () => {
  const settingsBody = {
    timezone: 'Europe/London',
    workDays: [1, 2, 3, 4],
    workStart: '08:30',
    workEnd: '16:30',
    autoCloseTime: '19:00',
    requireNote: true,
    checkinEnabled: true,
  };

  it('is readable by everyone, writable by admins, validated, and audited', async () => {
    const org = await createOrg('chz');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const m = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('m', `${org.slug}.test`),
      role: 'member',
    });
    const mc = await signInAs(t.app, org.slug, m);
    const defaults = (await get('/settings/work', mc, org.slug)).json();
    expect(defaults.settings).toMatchObject({
      timezone: 'UTC',
      workDays: [1, 2, 3, 4, 5],
      workStart: '09:00',
      autoCloseTime: '20:00',
      checkinEnabled: true,
    });

    expect((await put('/settings/work', mc, settingsBody, org.slug)).statusCode).toBe(403);
    const ok = await put('/settings/work', owner, settingsBody, org.slug);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings).toMatchObject({
      timezone: 'Europe/London',
      workDays: [1, 2, 3, 4],
      workStart: '08:30',
      requireNote: true,
    });
    expect((await get('/settings/work', mc, org.slug)).json().settings.workEnd).toBe('16:30');
    const audit = (await get('/audit-logs?action=settings.work_updated', owner, org.slug)).json();
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0].before.timezone).toBe('UTC');

    for (const bad of [
      { ...settingsBody, timezone: 'Mars/Base' },
      { ...settingsBody, workDays: [] },
      { ...settingsBody, workDays: [0, 8] },
      { ...settingsBody, workStart: '17:00', workEnd: '09:00' },
      { ...settingsBody, workStart: '9:00' },
      { ...settingsBody, autoCloseTime: '25:00' },
    ]) {
      expect(
        (await put('/settings/work', owner, bad, org.slug)).statusCode,
        JSON.stringify(bad),
      ).toBe(400);
    }
    // Duplicate days collapse.
    expect(
      (
        await put('/settings/work', owner, { ...settingsBody, workDays: [3, 1, 1, 2] }, org.slug)
      ).json().settings.workDays,
    ).toEqual([1, 2, 3]);
  });

  it('manages sites: unique names, protected while in use, admin only', async () => {
    const org = await createOrg('chy');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const m = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('m', `${org.slug}.test`),
      role: 'member',
    });
    const mc = await signInAs(t.app, org.slug, m);
    expect((await post('/sites', mc, { name: 'Nope' }, org.slug)).statusCode).toBe(403);
    const hq = (await post('/sites', owner, { name: 'HQ', address: '1 Road' }, org.slug)).json();
    const dup = await post('/sites', owner, { name: 'hq' }, org.slug);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('name_taken');
    expect(
      (await patch(`/sites/${hq.id}`, owner, { address: '2 Road' }, org.slug)).json().address,
    ).toBe('2 Road');
    expect((await patch(`/sites/${hq.id}`, mc, { address: 'x' }, org.slug)).statusCode).toBe(403);
    expect((await patch(`/sites/${hq.id}`, owner, {}, org.slug)).statusCode).toBe(400);
    expect(
      (await get('/sites', mc, org.slug)).json().items.map((s: { name: string }) => s.name),
    ).toEqual(['HQ']);

    await post('/checkin', mc, { locationType: 'onsite', siteId: hq.id }, org.slug);
    const inUse = await call({
      method: 'DELETE',
      url: `/sites/${hq.id}`,
      slug: org.slug,
      cookie: owner,
    });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().code).toBe('site_in_use');
    const spare = (await post('/sites', owner, { name: 'Spare' }, org.slug)).json();
    expect(
      (await call({ method: 'DELETE', url: `/sites/${spare.id}`, slug: org.slug, cookie: mc }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'DELETE', url: `/sites/${spare.id}`, slug: org.slug, cookie: owner }))
        .statusCode,
    ).toBe(200);
    // Other workspaces cannot reach these.
    expect(
      (await call({ method: 'DELETE', url: `/sites/${hq.id}`, slug: 'globex', cookie: globexC }))
        .statusCode,
    ).toBe(404);
    expect((await patch(`/sites/${hq.id}`, globexC, { name: 'Hacked' }, 'globex')).statusCode).toBe(
      404,
    );
  });

  it('manages holidays: unique dates, filtering by year, admin only, audited', async () => {
    const org = await createOrg('chv');
    const owner = await signInAs(t.app, org.slug, org.owner);
    const m = await ensureUser({
      orgId: org.org.id,
      email: uniqueEmail('m', `${org.slug}.test`),
      role: 'member',
    });
    const mc = await signInAs(t.app, org.slug, m);
    expect(
      (await post('/holidays', mc, { date: '2027-01-01', name: 'New Year' }, org.slug)).statusCode,
    ).toBe(403);
    const ny = (
      await post('/holidays', owner, { date: '2027-01-01', name: 'New Year' }, org.slug)
    ).json();
    await post('/holidays', owner, { date: '2026-12-25', name: 'Christmas' }, org.slug);
    const dup = await post('/holidays', owner, { date: '2027-01-01', name: 'Again' }, org.slug);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('date_taken');
    expect(
      (await post('/holidays', owner, { date: '2027-02-30', name: 'Bad' }, org.slug)).statusCode,
    ).toBe(400);
    expect(
      (await get('/holidays?year=2027', mc, org.slug))
        .json()
        .items.map((h: { name: string }) => h.name),
    ).toEqual(['New Year']);
    expect(
      (await get('/holidays', mc, org.slug)).json().items.map((h: { date: string }) => h.date),
    ).toEqual(['2026-12-25', '2027-01-01']);
    expect(
      (await patch(`/holidays/${ny.id}`, owner, { name: 'New Year’s Day' }, org.slug)).json().name,
    ).toBe('New Year’s Day');
    expect(
      (await patch(`/holidays/${ny.id}`, owner, { date: '2026-12-25' }, org.slug)).statusCode,
    ).toBe(409);
    expect(
      (await call({ method: 'DELETE', url: `/holidays/${ny.id}`, slug: org.slug, cookie: mc }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'DELETE', url: `/holidays/${ny.id}`, slug: org.slug, cookie: owner }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'DELETE', url: `/holidays/${ny.id}`, slug: org.slug, cookie: owner }))
        .statusCode,
    ).toBe(404);
    expect(await auditFor('holiday.deleted', ny.id)).toHaveLength(1);
  });
});

describe('who someone reports to', () => {
  it('is set by admins, validated, loop-free, and audited', async () => {
    const a = await person(),
      b = await person(),
      c = await person();
    expect((await patch(`/members/${b.id}`, a.cookie, { reportsTo: a.id })).statusCode).toBe(403); // members cannot
    expect((await patch(`/members/${b.id}`, adminC, { reportsTo: a.id })).json().reportsTo).toBe(
      a.id,
    );
    expect((await get(`/members/${b.id}`, adminC)).json().reportsToName).toBeTruthy();
    expect((await patch(`/members/${c.id}`, adminC, { reportsTo: b.id })).statusCode).toBe(200);
    // Loops: a -> b would close a -> ... a.
    expect((await patch(`/members/${a.id}`, adminC, { reportsTo: c.id })).statusCode).toBe(400);
    expect((await patch(`/members/${a.id}`, adminC, { reportsTo: a.id })).statusCode).toBe(400);
    expect(
      (
        await patch(`/members/${a.id}`, adminC, {
          reportsTo: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(400);
    const gone = await person();
    await post(`/members/${gone.id}/deactivate`, adminC);
    expect((await patch(`/members/${a.id}`, adminC, { reportsTo: gone.id })).statusCode).toBe(400);
    expect(
      (await patch(`/members/${b.id}`, adminC, { reportsTo: null })).json().reportsTo,
    ).toBeNull();
    expect((await auditFor('member.manager_changed', b.id)).length).toBe(2);
  });
});

describe('database guarantees', () => {
  it('rejects impossible rows: checkout before check-in, duplicate days, cross-tenant sites', async () => {
    const p = await person();
    const date = addDays(todayIn('UTC'), -9);
    const db = adminDb();
    try {
      const base = { orgId, userId: p.id, date };
      await expect(
        db.db.insert(workDays).values({
          ...base,
          checkinAt: new Date('2026-01-02T10:00:00Z'),
          checkoutAt: new Date('2026-01-02T09:00:00Z'),
        }),
      ).rejects.toThrow();
      await expect(
        db.db.insert(workDays).values({ ...base, checkoutAt: new Date() }),
      ).rejects.toThrow(); // checkout without check-in
      await db.db.insert(workDays).values(base);
      await expect(db.db.insert(workDays).values(base)).rejects.toThrow(); // one row per person per day
      const ids = await tenantIds();
      const [otherSite] = await db.db.execute<{ id: string }>(
        sql`insert into sites (org_id, name) values (${ids.globex}, ${'S' + Math.random()}) returning id`,
      );
      await expect(
        db.db.insert(workDays).values({ ...base, date: addDays(date, 1), siteId: otherSite!.id }),
      ).rejects.toThrow(); // a site from another workspace
    } finally {
      await db.close();
    }
  });
});
