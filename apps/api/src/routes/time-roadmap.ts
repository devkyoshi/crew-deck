import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { WorklogDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { DATE_RE, isRealDate, localDate } from '../lib/time.js';
import { can, type Actor } from '../permissions/can.js';
import { hasFeature, loadPlan } from '../plans/index.js';
import { recordActivity } from '../work/activity.js';
import { assertWritable, hydrateItems, presentItem, resolveItem, type SpaceRow } from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const uuidParam = z.object({ id: z.string().uuid() });
const date = z.string().regex(DATE_RE, 'Use the format YYYY-MM-DD').refine(isRealDate, 'That date does not exist');
const logBody = z.object({
  /** Time worked, in minutes (up to 24 hours at a time). */
  minutes: z.number().int().min(1, 'Enter the time worked').max(1440),
  date: date.optional(),
  note: z.string().trim().max(500).default(''),
  /** What is left on the item after this work. Left out, the remaining time goes down by `minutes`. */
  remainingMinutes: z.number().int().min(0).max(60_000).nullable().optional(),
});

/** Time worked on items, the roadmap of epics and versions, and the calendar of due dates. */
export async function timeRoadmapRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Work logs ------------------------------------------------------------------------------------------

  const presentLogs = async (t: TenantDb, actor: Actor, space: SpaceRow, rows: WorklogDoc[]) => {
    const people = await t.users(rows.map((w) => w.userId));
    const writable = space.status === 'active';
    return rows.map((w) => {
      const u = people.get(w.userId);
      const ctx = { ...spaceCtx(space), isAuthor: w.userId === actor.userId };
      return {
        id: w.id,
        itemId: w.itemId,
        minutes: w.minutes,
        date: w.date,
        note: w.note,
        createdAt: w.createdAt,
        user: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null,
        permissions: {
          edit: writable && can(actor, 'worklog.editOwn', ctx),
          delete: writable && (can(actor, 'worklog.editOwn', ctx) || can(actor, 'worklog.deleteAny', ctx)),
        },
      };
    });
  };

  r.get('/items/:id/worklogs', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { row, space } = await resolveItem(t, actor, req.params.id);
      const rows = await t.worklogs.find({ itemId: row.id }, { sort: { date: -1, createdAt: -1, id: 1 } });
      return {
        items: await presentLogs(t, actor, space, rows),
        total: rows.reduce((s, w) => s + w.minutes, 0),
        permissions: { add: space.status === 'active' && can(actor, 'worklog.add', spaceCtx(space)) },
      };
    });
  });

  r.post(
    '/items/:id/worklogs',
    { preHandler: requireAuth, schema: { params: idParam, body: logBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { row, space } = await resolveItem(t, actor, req.params.id);
        if (!can(actor, 'worklog.add', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const settings = await t.tenantSettings.findOne({});
        const today = localDate(new Date(), settings?.timezone ?? 'UTC');
        const day = b.date ?? today;
        if (day > today) {
          throw new AppError(422, 'future_date', 'Time cannot be logged for a day that has not happened', { date: 'Choose today or earlier' });
        }
        const log = await t.worklogs.insert({
          spaceId: space.id,
          itemId: row.id,
          userId: actor.userId,
          minutes: b.minutes,
          date: day,
          note: b.note,
          createdAt: new Date(),
        });
        // The time left shrinks by what was worked, unless the person says what is left.
        const before = row.remainingMinutes ?? row.originalMinutes ?? null;
        const remaining = b.remainingMinutes !== undefined ? b.remainingMinutes : before === null ? null : Math.max(0, before - b.minutes);
        await t.workItems.updateOne({ id: row.id }, { remainingMinutes: remaining, updatedAt: new Date() });
        await recordActivity(t, {
          item: row,
          actorId: actor.userId,
          kind: 'updated',
          field: 'timeLogged',
          oldValue: null,
          newValue: { minutes: b.minutes, date: day, note: b.note.slice(0, 280) },
        });
        return (await presentLogs(t, actor, space, [log]))[0]!;
      });
    },
  );

  async function loadLog(t: TenantDb, actor: Actor, id: string) {
    const log = await t.worklogs.get(id);
    if (!log) throw notFound('Work log');
    const hit = await resolveItem(t, actor, log.itemId).catch(() => {
      throw notFound('Work log');
    });
    return { log, ...hit };
  }

  r.patch(
    '/worklogs/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: uuidParam,
        body: z
          .object({ minutes: logBody.shape.minutes, date, note: z.string().trim().max(500) })
          .partial()
          .strict()
          .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { log, space } = await loadLog(t, actor, req.params.id);
        if (!can(actor, 'worklog.editOwn', { ...spaceCtx(space), isAuthor: log.userId === actor.userId })) throw forbidden();
        assertWritable(space);
        const settings = await t.tenantSettings.findOne({});
        if (req.body.date && req.body.date > localDate(new Date(), settings?.timezone ?? 'UTC')) {
          throw new AppError(422, 'future_date', 'Time cannot be logged for a day that has not happened', { date: 'Choose today or earlier' });
        }
        await t.worklogs.updateOne({ id: log.id }, req.body);
        // Working less (or more) than first logged moves the time left by the difference.
        if (req.body.minutes !== undefined && req.body.minutes !== log.minutes) {
          const item = await t.workItems.findOne({ id: log.itemId }, { projection: { remainingMinutes: 1 } });
          if (item && item.remainingMinutes !== null && item.remainingMinutes !== undefined) {
            await t.workItems.updateOne(
              { id: log.itemId },
              { remainingMinutes: Math.max(0, item.remainingMinutes + log.minutes - req.body.minutes), updatedAt: new Date() },
            );
          }
        }
        return (await presentLogs(t, actor, space, [(await t.worklogs.get(log.id))!]))[0]!;
      });
    },
  );

  r.delete('/worklogs/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const { log, row, space } = await loadLog(t, actor, req.params.id);
      const ctx = { ...spaceCtx(space), isAuthor: log.userId === actor.userId };
      if (!can(actor, 'worklog.editOwn', ctx) && !can(actor, 'worklog.deleteAny', ctx)) throw forbidden();
      assertWritable(space);
      await t.worklogs.deleteOne({ id: log.id });
      // The time comes back onto what is left, so removing a mistake does not lose planned time.
      if (row.remainingMinutes !== null && row.remainingMinutes !== undefined) {
        await t.workItems.updateOne({ id: row.id }, { remainingMinutes: row.remainingMinutes + log.minutes, updatedAt: new Date() });
      }
      await recordActivity(t, {
        item: row,
        actorId: actor.userId,
        kind: 'updated',
        field: 'timeLogged',
        oldValue: { minutes: log.minutes, date: log.date },
        newValue: null,
      });
      return { ok: true };
    });
  });

  // ---- Roadmap --------------------------------------------------------------------------------------------

  /** Epics and versions with their dates and progress, for the timeline. */
  r.get('/spaces/:id/roadmap', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const plan = await loadPlan(t, actor.orgId);
      const enabled = hasFeature(plan, 'roadmap');
      const canEdit = space.status === 'active' && can(actor, 'item.edit', spaceCtx(space));
      if (!enabled) return { enabled, items: [], versions: [], permissions: { edit: canEdit } };

      const epics = await t.workItems.find({ spaceId: space.id, type: 'epic', deletedAt: null }, { sort: { startDate: 1, number: 1 } });
      const kids = epics.length
        ? await t.workItems.find(
            { parentId: { $in: epics.map((e) => e.id) }, deletedAt: null },
            { projection: { parentId: 1, resolvedAt: 1, estimate: 1, originalMinutes: 1, id: 1 } },
          )
        : [];
      const logged = kids.length
        ? await t.worklogs.aggregate<{ _id: string; minutes: number }>([
            { $match: { itemId: { $in: kids.map((k) => k.id) } } },
            { $group: { _id: '$itemId', minutes: { $sum: '$minutes' } } },
          ])
        : [];
      const spentBy = new Map(logged.map((l) => [l._id, l.minutes]));
      const stats = new Map<string, { total: number; done: number; points: number; donePoints: number; plannedMinutes: number; spentMinutes: number }>();
      for (const k of kids) {
        const s = stats.get(k.parentId!) ?? { total: 0, done: 0, points: 0, donePoints: 0, plannedMinutes: 0, spentMinutes: 0 };
        s.total++;
        s.points += Number(k.estimate ?? 0);
        s.plannedMinutes += k.originalMinutes ?? 0;
        s.spentMinutes += spentBy.get(k.id) ?? 0;
        if (k.resolvedAt) {
          s.done++;
          s.donePoints += Number(k.estimate ?? 0);
        }
        stats.set(k.parentId!, s);
      }
      const rows = await hydrateItems(t, epics);
      const versions = await t.versions.find({ spaceId: space.id, state: { $ne: 'archived' } }, { sort: { releaseDate: 1, createdAt: 1 } });
      return {
        enabled,
        items: rows.map((e) => ({
          ...presentItem(e, space.key),
          progress: stats.get(e.id) ?? { total: 0, done: 0, points: 0, donePoints: 0, plannedMinutes: 0, spentMinutes: 0 },
        })),
        versions: versions.map((v) => ({ id: v.id, name: v.name, state: v.state, startDate: v.startDate, releaseDate: v.releaseDate })),
        permissions: { edit: canEdit },
      };
    });
  });

  // ---- Calendar -------------------------------------------------------------------------------------------

  r.get(
    '/spaces/:id/calendar',
    {
      preHandler: requireAuth,
      schema: { params: idParam, querystring: z.object({ from: date, to: date }) },
    },
    async (req) => {
      const actor = actorOf(req);
      const { from, to } = req.query;
      if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 62) {
        throw new AppError(422, 'invalid_range', 'Ask for up to two months at a time', { to: 'Choose a shorter range' });
      }
      return withTenant(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        const docs = await t.workItems.find(
          { spaceId: space.id, deletedAt: null, dueDate: { $gte: from, $lte: to } },
          { sort: { dueDate: 1, number: 1 }, limit: 1000 },
        );
        const versions = await t.versions.find({ spaceId: space.id, releaseDate: { $gte: from, $lte: to }, state: { $ne: 'archived' } });
        const rows = await hydrateItems(t, docs);
        return {
          items: rows.map((i) => presentItem(i, space.key)),
          releases: versions.map((v) => ({ id: v.id, name: v.name, state: v.state, date: v.releaseDate })),
        };
      });
    },
  );
}
