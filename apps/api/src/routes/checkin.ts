import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { loadSettings, zoneFor, type WorkSettings } from '../checkin/service.js';
import { withTenant, type Tx } from '../db/client.js';
import { holidays, memberships, sites, users, workDayEdits, workDays } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { addDays, isRealDate, isoWeekday, localDate, weekOf } from '../lib/time.js';
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

type WorkDay = typeof workDays.$inferSelect;

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

export async function checkinRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function context(tx: Tx, actor: Actor) {
    const settings = await loadSettings(tx, actor.orgId);
    const [me] = await tx
      .select({ tz: users.timezone })
      .from(users)
      .where(eq(users.id, actor.userId));
    const tz = zoneFor(me?.tz, settings);
    const now = new Date();
    return { settings, tz, now, today: localDate(now, tz) };
  }

  const requireModule = (s: WorkSettings) => {
    if (!s.checkinEnabled) throw disabled();
  };

  async function siteList(tx: Tx, orgId: string) {
    return tx
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(eq(sites.orgId, orgId))
      .orderBy(asc(sql`lower(${sites.name})`));
  }

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

  async function buildToday(tx: Tx, actor: Actor) {
    const { settings, tz, now, today } = await context(tx, actor);
    const siteRows = await siteList(tx, actor.orgId);
    const siteName = (id: string | null) => siteRows.find((s) => s.id === id)?.name ?? null;

    const [open] = await tx
      .select()
      .from(workDays)
      .where(
        and(
          eq(workDays.orgId, actor.orgId),
          eq(workDays.userId, actor.userId),
          isNotNull(workDays.checkinAt),
          isNull(workDays.checkoutAt),
        ),
      )
      .orderBy(desc(workDays.date))
      .limit(1);
    const [todayRow] = await tx
      .select()
      .from(workDays)
      .where(
        and(
          eq(workDays.orgId, actor.orgId),
          eq(workDays.userId, actor.userId),
          eq(workDays.date, today),
        ),
      );
    const [holiday] = await tx
      .select({ name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.orgId, actor.orgId), eq(holidays.date, today)));

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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { settings, now, today } = await context(tx, actor);
        requireModule(settings);
        const [open] = await tx
          .select({ id: workDays.id })
          .from(workDays)
          .where(
            and(
              eq(workDays.orgId, actor.orgId),
              eq(workDays.userId, actor.userId),
              isNotNull(workDays.checkinAt),
              isNull(workDays.checkoutAt),
            ),
          );
        if (open) throw new AppError(409, 'already_checked_in', 'You are already checked in');

        const [existing] = await tx
          .select()
          .from(workDays)
          .where(
            and(
              eq(workDays.orgId, actor.orgId),
              eq(workDays.userId, actor.userId),
              eq(workDays.date, today),
            ),
          );
        if (existing?.checkinAt) {
          throw new AppError(
            409,
            'already_checked_out',
            'You already checked out today. Use a correction to change your times.',
          );
        }

        const b = req.body;
        const siteRows = await siteList(tx, actor.orgId);
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
          await tx
            .update(workDays)
            .set(values)
            .where(and(eq(workDays.id, existing.id), eq(workDays.orgId, actor.orgId)));
        } else {
          await tx
            .insert(workDays)
            .values({ orgId: actor.orgId, userId: actor.userId, date: today, ...values });
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { settings, now } = await context(tx, actor);
        requireModule(settings);
        const [open] = await tx
          .select()
          .from(workDays)
          .where(
            and(
              eq(workDays.orgId, actor.orgId),
              eq(workDays.userId, actor.userId),
              isNotNull(workDays.checkinAt),
              isNull(workDays.checkoutAt),
            ),
          )
          .orderBy(desc(workDays.date))
          .limit(1);
        if (!open) throw new AppError(409, 'not_checked_in', 'You are not checked in');
        const note = req.body.note || open.note || null;
        if (settings.requireNote && !(req.body.note || open.note)) {
          throw new AppError(400, 'validation_error', 'Add a note about what you did', {
            note: 'A note is required when checking out',
          });
        }
        const at = now < open.checkinAt! ? open.checkinAt! : now;
        await tx
          .update(workDays)
          .set({ checkoutAt: at, note, updatedAt: now })
          .where(and(eq(workDays.id, open.id), eq(workDays.orgId, actor.orgId)));
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
        const rows = await tx
          .select()
          .from(workDays)
          .where(
            and(
              eq(workDays.orgId, actor.orgId),
              eq(workDays.userId, actor.userId),
              gte(workDays.date, dates[0]!),
              lte(workDays.date, dates[6]!),
            ),
          );
        const hol = await tx
          .select({ date: holidays.date, name: holidays.name })
          .from(holidays)
          .where(
            and(
              eq(holidays.orgId, actor.orgId),
              gte(holidays.date, dates[0]!),
              lte(holidays.date, dates[6]!),
            ),
          );
        const siteRows = await siteList(tx, actor.orgId);
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
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
          const [row] = await tx
            .select()
            .from(workDays)
            .where(
              and(
                eq(workDays.orgId, actor.orgId),
                eq(workDays.userId, actor.userId),
                eq(workDays.date, d.date),
              ),
            );
          if (!row) {
            if (d.location) {
              await tx.insert(workDays).values({
                orgId: actor.orgId,
                userId: actor.userId,
                date: d.date,
                plannedLocation: d.location,
                source: 'plan',
              });
            }
          } else if (!row.checkinAt && !d.location) {
            await tx
              .delete(workDays)
              .where(and(eq(workDays.id, row.id), eq(workDays.orgId, actor.orgId)));
          } else {
            await tx
              .update(workDays)
              .set({ plannedLocation: d.location, updatedAt: new Date() })
              .where(and(eq(workDays.id, row.id), eq(workDays.orgId, actor.orgId)));
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

        const filters: SQL[] = [];
        if (q.group) {
          filters.push(
            sql`and exists (select 1 from group_members gm where gm.group_id = ${q.group} and gm.org_id = ${actor.orgId} and gm.user_id = u.id)`,
          );
        }
        if (q.space) {
          // Visibility rules apply: a space the caller cannot see is "not found".
          const space = await resolveSpace(tx, actor, q.space);
          filters.push(sql`and (
            exists (select 1 from space_members sm where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId}
                      and sm.principal_type = 'user' and sm.principal_id = u.id)
            or exists (select 1 from space_members sm join group_members gm on gm.group_id = sm.principal_id and gm.org_id = sm.org_id
                      where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId} and sm.principal_type = 'group' and gm.user_id = u.id)
          )`);
        }
        if (q.q) {
          const p = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          filters.push(
            sql`and (lower(coalesce(u.name, '')) like lower(${p}) or lower(u.email) like lower(${p}))`,
          );
        }

        const rows = await tx.execute<{
          id: string;
          name: string | null;
          email: string;
          avatar_url: string | null;
          job_title: string | null;
          reports_to: string | null;
          location_type: string | null;
          planned_location: string | null;
          checkin_at: Date | null;
          checkout_at: Date | null;
          auto_closed: boolean | null;
          site_name: string | null;
          holiday_name: string | null;
        }>(sql`
          select u.id, u.name, u.email, u.avatar_url, u.job_title, m.reports_to,
                 wd.location_type, wd.planned_location, wd.checkin_at, wd.checkout_at, wd.auto_closed,
                 s.name as site_name, h.name as holiday_name
          from memberships m
          join users u on u.id = m.user_id
          left join work_days wd on wd.org_id = m.org_id and wd.user_id = u.id
               and wd.date = (now() at time zone u.timezone)::date
          left join sites s on s.id = wd.site_id and s.org_id = wd.org_id
          left join holidays h on h.org_id = m.org_id and h.date = (now() at time zone u.timezone)::date
          where m.org_id = ${actor.orgId} and m.status = 'active'
          ${sql.join(filters, sql` `)}
          order by lower(coalesce(u.name, u.email)), u.id
          limit 1000`);

        const isAdmin = can(actor, 'attendance.viewAll');
        const items = rows.map((x) => {
          const state: 'in' | 'out' | 'leave' | 'holiday' | 'planned' | 'none' =
            x.checkin_at && !x.checkout_at
              ? 'in'
              : x.checkout_at
                ? 'out'
                : x.planned_location === 'leave'
                  ? 'leave'
                  : x.holiday_name
                    ? 'holiday'
                    : x.planned_location
                      ? 'planned'
                      : 'none';
          const location =
            state === 'in' || state === 'out'
              ? x.location_type
              : state === 'leave'
                ? 'leave'
                : state === 'holiday'
                  ? 'holiday'
                  : state === 'planned'
                    ? x.planned_location
                    : null;
          // Teammates see status only. Exact times go to the person, their manager and admins.
          const seesTimes = can(actor, 'workday.viewTimes', {
            isSelf: x.id === actor.userId,
            isManager: x.reports_to === actor.userId,
          });
          return {
            id: x.id,
            name: x.name,
            email: x.email,
            avatarUrl: x.avatar_url,
            jobTitle: x.job_title,
            state,
            location,
            siteName: x.site_name,
            holiday: x.holiday_name,
            checkinAt: seesTimes ? x.checkin_at : null,
            checkoutAt: seesTimes ? x.checkout_at : null,
            autoClosed: seesTimes ? (x.auto_closed ?? false) : null,
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
    tx: Tx,
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
    const conds: SQL[] = [
      eq(workDays.orgId, actor.orgId),
      gte(workDays.date, from),
      lte(workDays.date, to),
    ];
    if (q.userId) {
      if (q.userId !== actor.userId && !isAdmin) {
        const [report] = await tx
          .select({ id: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, actor.orgId),
              eq(memberships.userId, q.userId),
              eq(memberships.reportsTo, actor.userId),
            ),
          );
        if (!report) throw forbidden();
      }
      conds.push(eq(workDays.userId, q.userId));
    } else if (q.scope === 'all') {
      if (!isAdmin) throw forbidden();
    } else if (q.scope === 'reports') {
      conds.push(
        inArray(
          workDays.userId,
          tx
            .select({ id: memberships.userId })
            .from(memberships)
            .where(
              and(eq(memberships.orgId, actor.orgId), eq(memberships.reportsTo, actor.userId)),
            ),
        ),
      );
    } else {
      conds.push(eq(workDays.userId, actor.userId));
    }
    const where = and(...conds);

    const query = tx
      .select({
        day: workDays,
        name: users.name,
        email: users.email,
        timezone: users.timezone,
        siteName: sites.name,
        edited: sql<boolean>`exists (select 1 from work_day_edits e where e.work_day_id = ${workDays.id} and e.org_id = ${workDays.orgId})`,
      })
      .from(workDays)
      .innerJoin(users, eq(users.id, workDays.userId))
      .leftJoin(sites, and(eq(sites.id, workDays.siteId), eq(sites.orgId, workDays.orgId)))
      .where(where)
      .orderBy(
        desc(workDays.date),
        asc(sql`lower(coalesce(${users.name}, ${users.email}))`),
        asc(workDays.id),
      );
    const rows = paging
      ? await query.limit(paging.pageSize).offset(offsetOf(paging))
      : await query.limit(50_000);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(workDays)
      .where(where);

    return {
      settings,
      from,
      to,
      total: count?.n ?? 0,
      items: rows.map((x) => ({
        ...presentDay(x.day, x.siteName ?? null, zoneFor(x.timezone, settings)),
        userId: x.day.userId,
        name: x.name,
        email: x.email,
        timezone: zoneFor(x.timezone, settings),
        source: x.day.source,
        edited: x.edited,
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
    tx: Tx,
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
    const [person] = await tx
      .select({ tz: users.timezone })
      .from(users)
      .where(eq(users.id, target.userId));
    const tz = zoneFor(person?.tz, settings);
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
      const [site] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, b.siteId), eq(sites.orgId, actor.orgId)));
      if (!site)
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
      await tx
        .update(workDays)
        .set(values)
        .where(and(eq(workDays.id, old.id), eq(workDays.orgId, actor.orgId)));
      id = old.id;
    } else {
      const [created] = await tx
        .insert(workDays)
        .values({ orgId: actor.orgId, userId: target.userId, date: target.date, ...values })
        .returning({ id: workDays.id });
      id = created!.id;
    }
    const pick = (o: Record<string, unknown>) =>
      Object.fromEntries(changedKeys.map((k) => [k, o[k]]));
    await tx.insert(workDayEdits).values({
      orgId: actor.orgId,
      workDayId: id,
      editedBy: actor.userId,
      oldValues: pick(before as Record<string, unknown>),
      newValues: pick(after as Record<string, unknown>),
      reason: b.reason,
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

  async function canCorrect(tx: Tx, actor: Actor, userId: string) {
    const [m] = await tx
      .select({ reportsTo: memberships.reportsTo })
      .from(memberships)
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId)));
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(workDays)
          .where(and(eq(workDays.id, req.params.id), eq(workDays.orgId, actor.orgId)));
        // Days of people you may not manage look like they do not exist.
        if (!row || !(await canCorrect(tx, actor, row.userId))) throw notFound('Day');
        await applyCorrection(
          tx,
          actor,
          { userId: row.userId, date: row.date, existing: row },
          req.body,
        );
        const [fresh] = await tx.select().from(workDays).where(eq(workDays.id, row.id));
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        if (!(await canCorrect(tx, actor, userId))) throw forbidden();
        const [existing] = await tx
          .select()
          .from(workDays)
          .where(
            and(
              eq(workDays.orgId, actor.orgId),
              eq(workDays.userId, userId),
              eq(workDays.date, date),
            ),
          );
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
        const [row] = await tx
          .select({ userId: workDays.userId })
          .from(workDays)
          .where(and(eq(workDays.id, req.params.id), eq(workDays.orgId, actor.orgId)));
        if (!row || !(await canCorrect(tx, actor, row.userId))) throw notFound('Day');
        const items = await tx
          .select({
            id: workDayEdits.id,
            reason: workDayEdits.reason,
            oldValues: workDayEdits.oldValues,
            newValues: workDayEdits.newValues,
            editedAt: workDayEdits.editedAt,
            editorName: users.name,
            editorEmail: users.email,
          })
          .from(workDayEdits)
          .innerJoin(users, eq(users.id, workDayEdits.editedBy))
          .where(
            and(eq(workDayEdits.workDayId, req.params.id), eq(workDayEdits.orgId, actor.orgId)),
          )
          .orderBy(desc(workDayEdits.editedAt));
        return { items };
      });
    },
  );
}
