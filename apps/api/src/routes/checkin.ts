import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { loadSettings, zoneFor, type WorkSettings } from '../checkin/service.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { WorkDayDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { addDays, isRealDate, isoWeekday, isValidTimezone, localDate, weekOf } from '../lib/time.js';
import { can, type Actor } from '../permissions/can.js';
import { resolveSpace } from './spaces.js';

const isoDate = z.string().refine(isRealDate, 'Use a real date as YYYY-MM-DD');
const idParam = z.object({ id: z.string().uuid() });
const uuid = z.string().uuid();
const checkinLocation = z.enum(['onsite', 'remote', 'offsite']);
const planLocation = z.enum(['onsite', 'remote', 'offsite', 'leave']);
const noteSchema = z.string().trim().max(500);
const MAX_RANGE_DAYS = 366;
// Excel needs a byte-order mark to read a CSV as UTF-8.
const BOM = String.fromCharCode(0xfeff);

type WorkDay = WorkDayDoc;

const disabled = () =>
  new AppError(404, 'module_disabled', 'Check-in is switched off for this workspace');

const hours = (a: Date | null, b: Date | null) =>
  a && b ? Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 100) / 100 : null;

/** Local time of day as HH:MM in `tz`. */
const localTime = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

/** Spreadsheet cells that start with these characters can run as formulas when opened. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const personName = (u: { name: string | null; email: string }) => (u.name ?? u.email).toLowerCase();

export async function checkinRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function context(tx: TenantDb, actor: Actor) {
    const settings = await loadSettings(tx, actor.orgId);
    const me = (await tx.users([actor.userId])).get(actor.userId);
    const tz = zoneFor(me?.timezone, settings);
    const now = new Date();
    return { settings, tz, now, today: localDate(now, tz) };
  }

  const requireModule = (s: WorkSettings) => {
    if (!s.checkinEnabled) throw disabled();
  };

  async function siteList(tx: TenantDb) {
    return (await tx.sites.find({}, { sort: { nameLower: 1 } })).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  /** The person's open (checked in, not out) day, latest first. */
  const openDay = (tx: TenantDb, userId: string) =>
    tx.workDays.findOne({ userId, checkinAt: { $ne: null }, checkoutAt: null }, { sort: { date: -1 } });

  const presentDay = (d: WorkDay, siteName: string | null, tz: string) => ({
    id: d.id,
    date: d.date,
    plannedLocation: d.plannedLocation,
    locationType: d.locationType,
    siteId: d.siteId,
    siteName,
    checkinAt: d.checkinAt,
    checkoutAt: d.checkoutAt,
    checkinLocal: d.checkinAt ? localTime(d.checkinAt, tz) : null,
    checkoutLocal: d.checkoutAt ? localTime(d.checkoutAt, tz) : null,
    note: d.note,
    autoClosed: d.autoClosed,
    hours: hours(d.checkinAt, d.checkoutAt),
  });

  async function buildToday(tx: TenantDb, actor: Actor) {
    const { settings, tz, now, today } = await context(tx, actor);
    const siteRows = await siteList(tx);
    const siteName = (id: string | null) => siteRows.find((s) => s.id === id)?.name ?? null;

    const open = await openDay(tx, actor.userId);
    const todayRow = await tx.workDays.findOne({ userId: actor.userId, date: today });
    const holiday = await tx.holidays.findOne({ date: today });

    const day = open ?? todayRow ?? null;
    let status: 'checked_in' | 'checked_out' | 'leave' | 'holiday' | 'not_in' = 'not_in';
    if (open) status = 'checked_in';
    else if (todayRow?.checkoutAt) status = 'checked_out';
    else if (todayRow?.plannedLocation === 'leave') status = 'leave';
    else if (holiday) status = 'holiday';

    return {
      enabled: settings.checkinEnabled,
      now: now.toISOString(),
      date: today,
      timezone: tz,
      isWorkday: settings.workDays.includes(isoWeekday(today)),
      holiday: holiday?.name ?? null,
      status,
      workDay: day ? presentDay(day, siteName(day.siteId), tz) : null,
      settings: {
        requireNote: settings.requireNote,
        workStart: settings.workStart,
        workEnd: settings.workEnd,
      },
      sites: siteRows,
    };
  }

  // ---- Me: today, check in, check out ------------------------------------------------------
  r.get('/me/today', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, (tx) => buildToday(tx, actor));
  });

  r.post(
    '/checkin',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          locationType: checkinLocation,
          siteId: uuid.optional(),
          note: noteSchema.optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { settings, now, today } = await context(tx, actor);
        requireModule(settings);
        if (await openDay(tx, actor.userId)) {
          throw new AppError(409, 'already_checked_in', 'You are already checked in');
        }

        const existing = await tx.workDays.findOne({ userId: actor.userId, date: today });
        if (existing?.checkinAt) {
          throw new AppError(
            409,
            'already_checked_out',
            'You already checked out today. Use a correction to change your times.',
          );
        }

        const b = req.body;
        const siteRows = await siteList(tx);
        let siteId: string | null = null;
        if (b.locationType === 'onsite' && siteRows.length > 0) {
          if (!b.siteId) {
            throw new AppError(400, 'validation_error', 'Choose a site', {
              siteId: 'Choose where you are working',
            });
          }
          if (!siteRows.some((s) => s.id === b.siteId)) {
            throw new AppError(400, 'validation_error', 'Unknown site', {
              siteId: 'That site does not exist',
            });
          }
          siteId = b.siteId;
        }

        const values = {
          locationType: b.locationType,
          siteId,
          checkinAt: now,
          note: b.note || null,
          source: 'web' as const,
          updatedAt: now,
        };
        if (existing) {
          await tx.workDays.updateOne({ id: existing.id }, values);
        } else {
          await tx.workDays.insert({ userId: actor.userId, date: today, ...values });
        }
        return buildToday(tx, actor);
      });
    },
  );

  r.post(
    '/checkout',
    {
      preHandler: requireAuth,
      schema: { body: z.object({ note: noteSchema.optional() }).default({}) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { settings, now } = await context(tx, actor);
        requireModule(settings);
        const open = await openDay(tx, actor.userId);
        if (!open) throw new AppError(409, 'not_checked_in', 'You are not checked in');
        const note = req.body.note || open.note || null;
        if (settings.requireNote && !(req.body.note || open.note)) {
          throw new AppError(400, 'validation_error', 'Add a note about what you did', {
            note: 'A note is required when checking out',
          });
        }
        const at = now < open.checkinAt! ? open.checkinAt! : now;
        await tx.workDays.updateOne({ id: open.id }, { checkoutAt: at, note, updatedAt: now });
        return buildToday(tx, actor);
      });
    },
  );

  // ---- Me: the week and the plan -----------------------------------------------------------
  r.get(
    '/me/week',
    { preHandler: requireAuth, schema: { querystring: z.object({ date: isoDate.optional() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { settings, tz, today } = await context(tx, actor);
        const dates = weekOf(req.query.date ?? today);
        const range = { $gte: dates[0]!, $lte: dates[6]! };
        const rows = await tx.workDays.find({ userId: actor.userId, date: range });
        const hol = await tx.holidays.find({ date: range });
        const siteRows = await siteList(tx);
        return {
          today,
          timezone: tz,
          days: dates.map((date) => {
            const row = rows.find((x) => x.date === date);
            return {
              date,
              weekday: isoWeekday(date),
              isWorkday: settings.workDays.includes(isoWeekday(date)),
              isPast: date < today,
              holiday: hol.find((h) => h.date === date)?.name ?? null,
              plannedLocation: row?.plannedLocation ?? null,
              workDay: row
                ? presentDay(row, siteRows.find((s) => s.id === row.siteId)?.name ?? null, tz)
                : null,
            };
          }),
        };
      });
    },
  );

  r.put(
    '/me/plan',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          days: z
            .array(z.object({ date: isoDate, location: planLocation.nullable() }))
            .min(1)
            .max(14),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { settings, today } = await context(tx, actor);
        requireModule(settings);
        const seen = new Set<string>();
        for (const d of req.body.days) {
          if (seen.has(d.date))
            throw new AppError(400, 'validation_error', 'Duplicate date', {
              days: `Duplicate date ${d.date}`,
            });
          seen.add(d.date);
          if (d.date < today) {
            throw new AppError(
              400,
              'past_date',
              'You can only plan today or later. Use a correction for past days.',
              {
                days: 'Plans cannot be in the past',
              },
            );
          }
          if (d.date > addDays(today, 120)) {
            throw new AppError(400, 'validation_error', 'That is too far ahead', {
              days: 'Plan up to 4 months ahead',
            });
          }
        }
        for (const d of req.body.days) {
          const row = await tx.workDays.findOne({ userId: actor.userId, date: d.date });
          if (!row) {
            if (d.location) {
              await tx.workDays.insert({
                userId: actor.userId,
                date: d.date,
                plannedLocation: d.location,
                source: 'plan',
              });
            }
          } else if (!row.checkinAt && !d.location) {
            await tx.workDays.deleteOne({ id: row.id });
          } else {
            await tx.workDays.updateOne(
              { id: row.id },
              { plannedLocation: d.location, updatedAt: new Date() },
            );
          }
        }
        return { ok: true };
      });
    },
  );

  // ---- Team board --------------------------------------------------------------------------
  r.get(
    '/team/status',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          group: uuid.optional(),
          space: z.string().min(1).max(64).optional(),
          q: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const settings = await loadSettings(tx, actor.orgId);
        requireModule(settings);

        let members = await tx.memberships.find({ status: 'active' });
        if (q.group) {
          const inGroup = new Set(
            (await tx.groupMembers.find({ groupId: q.group })).map((g) => g.userId),
          );
          members = members.filter((m) => inGroup.has(m.userId));
        }
        if (q.space) {
          // Visibility rules apply: a space the caller cannot see is "not found".
          const space = await resolveSpace(tx, actor, q.space);
          const entries = await tx.spaceMembers.find({ spaceId: space.id });
          const groupIds = entries.filter((e) => e.principalType === 'group').map((e) => e.principalId);
          const links = groupIds.length ? await tx.groupMembers.find({ groupId: { $in: groupIds } }) : [];
          const inSpace = new Set([
            ...entries.filter((e) => e.principalType === 'user').map((e) => e.principalId),
            ...links.map((l) => l.userId),
          ]);
          members = members.filter((m) => inSpace.has(m.userId));
        }
        const people = await tx.users(members.map((m) => m.userId));
        let rows = members.flatMap((m) => {
          const u = people.get(m.userId);
          return u ? [{ m, u }] : [];
        });
        if (q.q) {
          const needle = q.q.toLowerCase();
          rows = rows.filter(({ u }) =>
            [u.name, u.email].some((v) => v?.toLowerCase().includes(needle)),
          );
        }
        rows.sort((a, b) => personName(a.u).localeCompare(personName(b.u)) || a.u.id.localeCompare(b.u.id));
        rows = rows.slice(0, 1000);

        // "Today" is each person's own local date.
        const now = new Date();
        const dateOf = new Map(
          rows.map(({ u }) => [u.id, localDate(now, isValidTimezone(u.timezone) ? u.timezone : 'UTC')]),
        );
        const dates = [...new Set(dateOf.values())];
        const days = await tx.workDays.find({
          userId: { $in: rows.map(({ u }) => u.id) },
          date: { $in: dates },
        });
        const dayOf = new Map(days.map((d) => [`${d.userId}:${d.date}`, d]));
        const hols = await tx.holidays.find({ date: { $in: dates } });
        const holByDate = new Map(hols.map((h) => [h.date, h.name]));
        const siteRows = await tx.sites.find({
          id: { $in: [...new Set(days.map((d) => d.siteId).filter((x): x is string => !!x))] },
        });
        const siteById = new Map(siteRows.map((s) => [s.id, s.name]));

        const isAdmin = can(actor, 'attendance.viewAll');
        const items = rows.map(({ m, u }) => {
          const date = dateOf.get(u.id)!;
          const wd = dayOf.get(`${u.id}:${date}`);
          const holidayName = holByDate.get(date) ?? null;
          const state: 'in' | 'out' | 'leave' | 'holiday' | 'planned' | 'none' =
            wd?.checkinAt && !wd.checkoutAt
              ? 'in'
              : wd?.checkoutAt
                ? 'out'
                : wd?.plannedLocation === 'leave'
                  ? 'leave'
                  : holidayName
                    ? 'holiday'
                    : wd?.plannedLocation
                      ? 'planned'
                      : 'none';
          const location =
            state === 'in' || state === 'out'
              ? (wd?.locationType ?? null)
              : state === 'leave'
                ? 'leave'
                : state === 'holiday'
                  ? 'holiday'
                  : state === 'planned'
                    ? (wd?.plannedLocation ?? null)
                    : null;
          // Teammates see status only. Exact times go to the person, their manager and admins.
          const seesTimes = can(actor, 'workday.viewTimes', {
            isSelf: u.id === actor.userId,
            isManager: m.reportsTo === actor.userId,
          });
          return {
            id: u.id,
            name: u.name,
            email: u.email,
            avatarUrl: u.avatarUrl,
            jobTitle: u.jobTitle,
            state,
            location,
            siteName: wd?.siteId ? (siteById.get(wd.siteId) ?? null) : null,
            holiday: holidayName,
            checkinAt: seesTimes ? (wd?.checkinAt ?? null) : null,
            checkoutAt: seesTimes ? (wd?.checkoutAt ?? null) : null,
            autoClosed: seesTimes ? (wd?.autoClosed ?? false) : null,
          };
        });
        const counts: Record<string, number> = {};
        for (const i of items)
          counts[i.location ?? 'none'] = (counts[i.location ?? 'none'] ?? 0) + 1;
        return { items, counts, total: items.length, canSeeAll: isAdmin };
      });
    },
  );

  // ---- History, corrections and export -----------------------------------------------------
  const historyQuery = pageQuery.extend({
    userId: uuid.optional(),
    scope: z.enum(['me', 'reports', 'all']).default('me'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  });

  async function historyRows(
    tx: TenantDb,
    actor: Actor,
    q: { userId?: string; scope: 'me' | 'reports' | 'all'; from?: string; to?: string },
    paging?: { page: number; pageSize: number },
  ) {
    const settings = await loadSettings(tx, actor.orgId);
    const { today } = await context(tx, actor);
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -29);
    if (from > to)
      throw new AppError(400, 'validation_error', 'The start date is after the end date', {
        from: 'Must not be after the end',
      });
    if (addDays(from, MAX_RANGE_DAYS) < to) {
      throw new AppError(400, 'validation_error', 'That range is too long', {
        from: `At most ${MAX_RANGE_DAYS} days at a time`,
      });
    }

    const isAdmin = can(actor, 'attendance.viewAll');
    const filter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
    if (q.userId) {
      if (q.userId !== actor.userId && !isAdmin) {
        const report = await tx.memberships.exists({ userId: q.userId, reportsTo: actor.userId });
        if (!report) throw forbidden();
      }
      filter.userId = q.userId;
    } else if (q.scope === 'all') {
      if (!isAdmin) throw forbidden();
    } else if (q.scope === 'reports') {
      const reports = await tx.memberships.find({ reportsTo: actor.userId }, { projection: { userId: 1 } });
      filter.userId = { $in: reports.map((m) => m.userId) };
    } else {
      filter.userId = actor.userId;
    }

    const all = await tx.workDays.find(filter, { limit: 50_000 });
    const people = await tx.users(all.map((d) => d.userId));
    const sorted = all
      .flatMap((d) => {
        const u = people.get(d.userId);
        return u ? [{ d, u }] : [];
      })
      .sort(
        (a, b) =>
          (a.d.date < b.d.date ? 1 : a.d.date > b.d.date ? -1 : 0) ||
          personName(a.u).localeCompare(personName(b.u)) ||
          a.d.id.localeCompare(b.d.id),
      );
    const page = paging ? sorted.slice(offsetOf(paging), offsetOf(paging) + paging.pageSize) : sorted;

    const siteRows = await tx.sites.find({
      id: { $in: [...new Set(page.map((x) => x.d.siteId).filter((s): s is string => !!s))] },
    });
    const siteById = new Map(siteRows.map((s) => [s.id, s.name]));
    const edited = new Set(
      (await tx.workDayEdits.find({ workDayId: { $in: page.map((x) => x.d.id) } }, { projection: { workDayId: 1 } })).map(
        (e) => e.workDayId,
      ),
    );

    return {
      settings,
      from,
      to,
      total: sorted.length,
      items: page.map(({ d, u }) => ({
        ...presentDay(d, d.siteId ? (siteById.get(d.siteId) ?? null) : null, zoneFor(u.timezone, settings)),
        userId: d.userId,
        name: u.name,
        email: u.email,
        timezone: zoneFor(u.timezone, settings),
        source: d.source,
        edited: edited.has(d.id),
      })),
    };
  }

  r.get(
    '/work-days',
    { preHandler: requireAuth, schema: { querystring: historyQuery } },
    async (req) => {
      const actor = actorOf(req);
      const { page, pageSize, ...q } = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const out = await historyRows(tx, actor, q, { page, pageSize });
        return { items: out.items, total: out.total, from: out.from, to: out.to, page, pageSize };
      });
    },
  );

  r.get(
    '/work-days/export',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          from: isoDate.optional(),
          to: isoDate.optional(),
          userId: uuid.optional(),
        }),
      },
    },
    async (req, reply) => {
      const actor = actorOf(req);
      if (!can(actor, 'attendance.export')) throw forbidden();
      const csv = await withTenant(deps.db, actor.orgId, async (tx) => {
        assertFeature(await loadPlan(tx, actor.orgId), 'attendance_export', 'Attendance export');
        const out = await historyRows(tx, actor, { scope: 'all', ...req.query });
        const head = [
          'Date',
          'Name',
          'Email',
          'Location',
          'Site',
          'Check-in',
          'Check-out',
          'Hours',
          'Auto-closed',
          'Edited',
          'Note',
        ];
        const lines = out.items.map((i) =>
          [
            i.date,
            i.name ?? '',
            i.email,
            i.locationType ?? (i.plannedLocation ? `planned ${i.plannedLocation}` : ''),
            i.siteName ?? '',
            i.checkinLocal ? `${i.date} ${i.checkinLocal}` : '',
            i.checkoutLocal ? `${i.date} ${i.checkoutLocal}` : '',
            i.hours ?? '',
            i.autoClosed ? 'yes' : 'no',
            i.edited ? 'yes' : 'no',
            i.note ?? '',
          ]
            .map(csvCell)
            .join(','),
        );
        return {
          text: [head.join(','), ...lines].join('\r\n') + '\r\n',
          from: out.from,
          to: out.to,
        };
      });
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="status-log-${csv.from}-to-${csv.to}.csv"`,
        );
      // The BOM makes Excel read the file as UTF-8.
      return `${BOM}${csv.text}`;
    },
  );

  const correctionFields = {
    locationType: planLocation.optional(),
    siteId: uuid.nullable().optional(),
    checkinAt: z.coerce.date().optional(),
    checkoutAt: z.coerce.date().nullable().optional(),
    note: noteSchema.nullable().optional(),
    reason: z.string().trim().min(3, 'Say why you are changing this').max(300),
  };

  /** Applies a correction to an existing or new day, with the history row and audit entry. */
  async function applyCorrection(
    tx: TenantDb,
    actor: Actor,
    target: { userId: string; date: string; existing: WorkDay | null },
    b: {
      locationType?: string;
      siteId?: string | null;
      checkinAt?: Date;
      checkoutAt?: Date | null;
      note?: string | null;
      reason: string;
    },
  ) {
    const settings = await loadSettings(tx, actor.orgId);
    requireModule(settings);
    const person = (await tx.users([target.userId])).get(target.userId);
    const tz = zoneFor(person?.timezone, settings);
    const now = new Date();
    const old = target.existing;

    const checkinAt = b.checkinAt ?? old?.checkinAt ?? null;
    const checkoutAt = b.checkoutAt === undefined ? (old?.checkoutAt ?? null) : b.checkoutAt;
    if (checkinAt && localDate(checkinAt, tz) !== target.date) {
      throw new AppError(400, 'validation_error', 'Check-in must be on the same day', {
        checkinAt: 'Must be on this day',
      });
    }
    if (checkinAt && checkinAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new AppError(400, 'validation_error', 'Times cannot be in the future', {
        checkinAt: 'Cannot be in the future',
      });
    }
    if (checkoutAt && !checkinAt) {
      throw new AppError(400, 'validation_error', 'Add a check-in time first', {
        checkoutAt: 'There is no check-in on this day',
      });
    }
    if (checkoutAt && checkinAt && checkoutAt < checkinAt) {
      throw new AppError(400, 'validation_error', 'Check-out is before check-in', {
        checkoutAt: 'Must be after check-in',
      });
    }
    if (checkoutAt && checkoutAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new AppError(400, 'validation_error', 'Times cannot be in the future', {
        checkoutAt: 'Cannot be in the future',
      });
    }
    if (b.siteId) {
      if (!(await tx.sites.exists({ id: b.siteId })))
        throw new AppError(400, 'validation_error', 'Unknown site', {
          siteId: 'That site does not exist',
        });
    }

    const next = {
      locationType: (b.locationType ??
        old?.locationType ??
        (checkinAt ? 'remote' : null)) as WorkDay['locationType'],
      siteId: b.siteId === undefined ? (old?.siteId ?? null) : b.siteId,
      checkinAt,
      checkoutAt,
      note: b.note === undefined ? (old?.note ?? null) : b.note,
    };
    const snapshot = (d: Partial<typeof next> | null) =>
      d
        ? {
            locationType: d.locationType ?? null,
            siteId: d.siteId ?? null,
            checkinAt: d.checkinAt ? d.checkinAt.toISOString() : null,
            checkoutAt: d.checkoutAt ? d.checkoutAt.toISOString() : null,
            note: d.note ?? null,
          }
        : {};
    const before = snapshot(old);
    const after = snapshot(next);
    const changedKeys = Object.keys(after).filter(
      (k) =>
        JSON.stringify((before as Record<string, unknown>)[k]) !==
        JSON.stringify((after as Record<string, unknown>)[k]),
    );
    if (changedKeys.length === 0)
      throw new AppError(400, 'validation_error', 'Nothing was changed');

    const values = {
      ...next,
      // A person changing the check-out time means it is no longer the automatic one.
      autoClosed: old?.autoClosed && b.checkoutAt === undefined ? old.autoClosed : false,
      source: 'edit' as const,
      updatedAt: now,
    };
    let id: string;
    if (old) {
      await tx.workDays.updateOne({ id: old.id }, values);
      id = old.id;
    } else {
      const created = await tx.workDays.insert({
        userId: target.userId,
        date: target.date,
        ...values,
      });
      id = created.id;
    }
    const pick = (o: Record<string, unknown>) =>
      Object.fromEntries(changedKeys.map((k) => [k, o[k]]));
    await tx.workDayEdits.insert({
      workDayId: id,
      editedBy: actor.userId,
      oldValues: pick(before as Record<string, unknown>),
      newValues: pick(after as Record<string, unknown>),
      reason: b.reason,
      editedAt: new Date(),
    });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: old ? 'workday.edited' : 'workday.created_by_correction',
      targetType: 'work_day',
      targetId: id,
      before: pick(before as Record<string, unknown>),
      after: {
        ...pick(after as Record<string, unknown>),
        userId: target.userId,
        date: target.date,
        reason: b.reason,
      },
    });
    return id;
  }

  async function canCorrect(tx: TenantDb, actor: Actor, userId: string) {
    const m = await tx.memberships.findOne({ userId });
    if (!m) throw notFound('Person');
    return can(actor, 'workday.editOthers', {
      isSelf: userId === actor.userId,
      isManager: m.reportsTo === actor.userId,
    });
  }

  r.patch(
    '/work-days/:id',
    {
      preHandler: requireAuth,
      schema: { params: idParam, body: z.object(correctionFields).strict() },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const row = await tx.workDays.get(req.params.id);
        // Days of people you may not manage look like they do not exist.
        if (!row || !(await canCorrect(tx, actor, row.userId))) throw notFound('Day');
        await applyCorrection(
          tx,
          actor,
          { userId: row.userId, date: row.date, existing: row },
          req.body,
        );
        const fresh = await tx.workDays.get(row.id);
        return {
          id: fresh!.id,
          date: fresh!.date,
          hours: hours(fresh!.checkinAt, fresh!.checkoutAt),
        };
      });
    },
  );

  // For a day that has no record at all (for example, a forgotten check-in).
  r.post(
    '/work-days',
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({
            ...correctionFields,
            userId: uuid.optional(),
            date: isoDate,
            checkinAt: z.coerce.date(),
          })
          .strict(),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { userId = actor.userId, date, ...rest } = req.body;
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        if (!(await canCorrect(tx, actor, userId))) throw forbidden();
        const existing = await tx.workDays.findOne({ userId, date });
        const id = await applyCorrection(
          tx,
          actor,
          { userId, date, existing: existing ?? null },
          rest,
        );
        return { id };
      });
    },
  );

  r.get(
    '/work-days/:id/edits',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const row = await tx.workDays.get(req.params.id);
        if (!row || !(await canCorrect(tx, actor, row.userId))) throw notFound('Day');
        const edits = await tx.workDayEdits.find({ workDayId: req.params.id }, { sort: { editedAt: -1 } });
        const editors = await tx.users(edits.map((e) => e.editedBy));
        const items = edits.map((e) => ({
          id: e.id,
          reason: e.reason,
          oldValues: e.oldValues,
          newValues: e.newValues,
          editedAt: e.editedAt,
          editorName: editors.get(e.editedBy)?.name ?? null,
          editorEmail: editors.get(e.editedBy)?.email ?? '',
        }));
        return { items };
      });
    },
  );
}
