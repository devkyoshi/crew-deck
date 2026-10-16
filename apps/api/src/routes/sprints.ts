import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { generateNKeysBetween } from 'fractional-indexing';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { isDuplicateKey, withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { SprintDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { DATE_RE, isRealDate, localDate } from '../lib/time.js';
import { can, type Actor } from '../permissions/can.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { recordActivity } from '../work/activity.js';
import { notifyOne } from '../work/notify.js';
import { assertWritable, hydrateItems, loadBoard, presentItem, resolveItem, type SpaceRow } from '../work/service.js';
import { daysBetween, points, setItemsSprint, snapshotSprint, SPRINT_ITEM_TYPES } from '../work/sprints.js';
import { resolveSpace, spaceCtx } from './spaces.js';
import { liveTouch } from '../lib/live.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const uuidParam = z.object({ id: z.string().uuid() });
const date = z.string().regex(DATE_RE, 'Use the format YYYY-MM-DD').refine(isRealDate, 'That date does not exist');

const sprintBody = z.object({
  name: z.string().trim().min(1, 'Name the sprint').max(80),
  goal: z.string().trim().max(500).nullable(),
  startDate: date.nullable(),
  endDate: date.nullable(),
});

const conflict = (message: string) => new AppError(409, 'conflict', message);

async function assertScrum(t: TenantDb, space: SpaceRow) {
  const board = await loadBoard(t, space.id);
  if (board.type !== 'scrum') {
    throw new AppError(422, 'not_scrum', 'This space uses a Kanban board. Switch it to Scrum to plan sprints.');
  }
  return board;
}

/** A sprint and its space, if the caller can open the space. */
async function resolveSprint(t: TenantDb, actor: Actor, id: string) {
  const sprint = await t.sprints.get(id);
  if (!sprint) throw notFound('Sprint');
  const space = await resolveSpace(t, actor, sprint.spaceId).catch(() => {
    throw notFound('Sprint');
  });
  return { sprint, space };
}

/** The people who belong to a space: direct members and members of its groups. */
async function spacePeople(t: TenantDb, spaceId: string) {
  const entries = await t.spaceMembers.find({ spaceId });
  const groupIds = entries.filter((e) => e.principalType === 'group').map((e) => e.principalId);
  const links = groupIds.length ? await t.groupMembers.find({ groupId: { $in: groupIds } }) : [];
  return [...new Set([...entries.filter((e) => e.principalType === 'user').map((e) => e.principalId), ...links.map((l) => l.userId)])];
}

export async function sprintRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const sprintPermissions = (actor: Actor, space: SpaceRow) => {
    const ctx = spaceCtx(space);
    const writable = space.status === 'active';
    return {
      create: writable && can(actor, 'sprint.create', ctx),
      start: writable && can(actor, 'sprint.start', ctx),
      complete: writable && can(actor, 'sprint.complete', ctx),
      moveItems: writable && can(actor, 'item.edit', ctx),
    };
  };

  const presentSprint = (s: SprintDoc) => ({
    id: s.id,
    spaceId: s.spaceId,
    name: s.name,
    goal: s.goal,
    startDate: s.startDate,
    endDate: s.endDate,
    state: s.state,
    startedAt: s.startedAt,
    closedAt: s.closedAt,
  });

  async function itemsOf(t: TenantDb, space: SpaceRow, filter: Record<string, unknown>) {
    const docs = await t.workItems.find(
      { spaceId: space.id, deletedAt: null, type: { $in: [...SPRINT_ITEM_TYPES] }, ...filter },
      { sort: { rank: 1, number: 1 } },
    );
    // Hand-ordered items come first in their saved order; newly added ones follow by board rank.
    docs.sort((a, b) => {
      if (a.backlogRank && b.backlogRank) return a.backlogRank < b.backlogRank ? -1 : a.backlogRank > b.backlogRank ? 1 : 0;
      return a.backlogRank ? -1 : b.backlogRank ? 1 : 0;
    });
    return (await hydrateItems(t, docs)).map((row) => presentItem(row, space.key));
  }

  const summary = (items: ReturnType<typeof presentItem>[]) => ({
    count: items.length,
    done: items.filter((i) => i.status.category === 'done').length,
    points: points(items),
    donePoints: points(items.filter((i) => i.status.category === 'done')),
  });

  // ---- Backlog ---------------------------------------------------------------------------------------------

  r.get('/spaces/:id/backlog', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      await assertScrum(t, space);
      const sprints = await t.sprints.find({ spaceId: space.id, state: { $in: ['active', 'planned'] } }, { sort: { state: 1, createdAt: 1 } });
      const sections = [];
      // Active first, then planned in the order they were made.
      for (const s of [...sprints.filter((x) => x.state === 'active'), ...sprints.filter((x) => x.state === 'planned')]) {
        const items = await itemsOf(t, space, { sprintId: s.id });
        sections.push({ ...presentSprint(s), items, summary: summary(items) });
      }
      const backlog = await itemsOf(t, space, { sprintId: null, resolvedAt: null });
      const plan = await loadPlan(t, actor.orgId);
      return {
        sprints: sections,
        backlog: { items: backlog, summary: summary(backlog) },
        permissions: sprintPermissions(actor, space),
        features: { sprints: plan.features.includes('scrum_sprints'), burndown: plan.features.includes('burndown_reports') },
      };
    });
  });

  /** Saves the order of one section (a sprint, or the backlog with `sprintId: null`). */
  r.put(
    '/spaces/:id/backlog/order',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z.object({ sprintId: z.string().uuid().nullable(), ids: z.array(z.string().uuid()).min(1).max(500) }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { sprintId, ids } = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'item.edit', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        await assertScrum(t, space);
        const unique = [...new Set(ids)];
        const found = await t.workItems.count({ id: { $in: unique }, spaceId: space.id, sprintId, deletedAt: null });
        if (found !== unique.length) {
          throw new AppError(422, 'invalid_order', 'Those items are no longer in that list. Reload and try again.');
        }
        const ranks = generateNKeysBetween(null, null, unique.length);
        for (const [i, id] of unique.entries()) await t.workItems.updateOne({ id }, { backlogRank: ranks[i]! });
        return { ok: true };
      });
    },
  );

  // ---- Sprints ---------------------------------------------------------------------------------------------

  r.get('/spaces/:id/sprints', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const rows = await t.sprints.find({ spaceId: space.id }, { sort: { createdAt: -1 } });
      return { items: rows.map(presentSprint), permissions: sprintPermissions(actor, space) };
    });
  });

  r.post(
    '/spaces/:id/sprints',
    { preHandler: requireAuth, schema: { params: idParam, body: sprintBody.partial() } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'sprint.create', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        await assertScrum(t, space);
        const b = req.body;
        if (b.startDate && b.endDate && b.endDate < b.startDate) {
          throw new AppError(422, 'validation_error', 'The end date is before the start date', { endDate: 'End after the start' });
        }
        const n = (await t.sprints.count({ spaceId: space.id })) + 1;
        const s = await t.sprints.insert({
          spaceId: space.id,
          name: b.name ?? `${space.key} Sprint ${n}`,
          goal: b.goal ?? null,
          startDate: b.startDate ?? null,
          endDate: b.endDate ?? null,
          state: 'planned',
          startedAt: null,
          closedAt: null,
          startPoints: null,
          summary: null,
          createdBy: actor.userId,
          createdAt: new Date(),
        });
        return presentSprint(s);
      });
    },
  );

  r.patch(
    '/sprints/:id',
    {
      preHandler: requireAuth,
      schema: { params: uuidParam, body: sprintBody.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update') },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const { sprint, space } = await resolveSprint(t, actor, req.params.id);
        if (!can(actor, 'sprint.create', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        if (sprint.state === 'closed') throw conflict('A completed sprint cannot be changed');
        const next = { ...sprint, ...req.body };
        if (next.startDate && next.endDate && next.endDate < next.startDate) {
          throw new AppError(422, 'validation_error', 'The end date is before the start date', { endDate: 'End after the start' });
        }
        const updated = await t.sprints.findOneAndUpdate({ id: sprint.id }, req.body as Partial<SprintDoc>);
        return presentSprint(updated!);
      });
    },
  );

  r.delete('/sprints/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const { sprint, space } = await resolveSprint(t, actor, req.params.id);
      if (!can(actor, 'sprint.create', spaceCtx(space))) throw forbidden();
      assertWritable(space);
      if (sprint.state !== 'planned') throw conflict('Only a sprint that has not started can be deleted');
      const items = await t.workItems.find({ sprintId: sprint.id }, { projection: { id: 1, sprintId: 1, estimate: 1 } });
      await setItemsSprint(t, items, null);
      await t.sprints.deleteOne({ id: sprint.id });
      return { ok: true, movedToBacklog: items.length };
    });
  });

  r.post(
    '/sprints/:id/start',
    {
      preHandler: requireAuth,
      schema: { params: uuidParam, body: z.object({ startDate: date.optional(), endDate: date.optional(), goal: z.string().trim().max(500).nullable().optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      let notifyTo: { space: SpaceRow; sprint: SprintDoc } | null = null;
      const out = await withTenantTx(deps.db, actor.orgId, async (t) => {
        const { sprint, space } = await resolveSprint(t, actor, req.params.id);
        if (!can(actor, 'sprint.start', spaceCtx(space))) throw forbidden('Only space admins can start a sprint');
        assertWritable(space);
        await assertScrum(t, space);
        assertFeature(await loadPlan(t, actor.orgId), 'scrum_sprints', 'Sprints');
        if (sprint.state !== 'planned') throw conflict('This sprint has already started or finished');
        const startDate = req.body.startDate ?? sprint.startDate;
        const endDate = req.body.endDate ?? sprint.endDate;
        if (!startDate || !endDate) {
          throw new AppError(422, 'validation_error', 'Set the start and end dates first', { endDate: 'Choose the dates' });
        }
        if (endDate < startDate) {
          throw new AppError(422, 'validation_error', 'The end date is before the start date', { endDate: 'End after the start' });
        }
        const items = await t.workItems.find({ sprintId: sprint.id, deletedAt: null, type: { $in: [...SPRINT_ITEM_TYPES] } });
        if (items.length === 0) throw new AppError(422, 'empty_sprint', 'Add work to the sprint before starting it');
        if (await t.sprints.exists({ spaceId: space.id, state: 'active' })) {
          throw conflict('Another sprint is already running in this space. Complete it first.');
        }
        const now = new Date();
        let started: SprintDoc | null;
        try {
          started = await t.sprints.findOneAndUpdate(
            { id: sprint.id, state: 'planned' },
            {
              state: 'active',
              startedAt: now,
              startDate,
              endDate,
              ...(req.body.goal !== undefined ? { goal: req.body.goal } : {}),
              startPoints: points(items),
            },
          );
        } catch (e) {
          // The unique index allows one active sprint per space, even when two people press Start at once.
          if (isDuplicateKey(e)) throw conflict('Another sprint is already running in this space. Complete it first.');
          throw e;
        }
        if (!started) throw conflict('This sprint has already started or finished');
        const settings = await t.tenantSettings.findOne({});
        await snapshotSprint(t, started, localDate(now, settings?.timezone ?? 'UTC'));
        notifyTo = { space, sprint: started };
        liveTouch({ orgId: actor.orgId, spaceId: space.id, kind: 'sprint' });
        return { ...presentSprint(started), items: items.length, points: points(items) };
      });
      if (notifyTo) await notifySprint(actor, notifyTo, 'sprint_started').catch((e) => req.log.error(e));
      return out;
    },
  );

  r.post(
    '/sprints/:id/complete',
    {
      preHandler: requireAuth,
      schema: {
        params: uuidParam,
        body: z.object({ destination: z.union([z.literal('backlog'), z.literal('new'), z.string().uuid()]).default('backlog') }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      let notifyTo: { space: SpaceRow; sprint: SprintDoc } | null = null;
      const out = await withTenantTx(deps.db, actor.orgId, async (t) => {
        const { sprint, space } = await resolveSprint(t, actor, req.params.id);
        if (!can(actor, 'sprint.complete', spaceCtx(space))) throw forbidden('Only space admins can complete a sprint');
        assertWritable(space);
        if (sprint.state !== 'active') throw conflict('Only a running sprint can be completed');
        const now = new Date();

        // Where unfinished work goes: the backlog, a planned sprint, or a new sprint.
        let target: string | null = null;
        let created: SprintDoc | null = null;
        const dest = req.body.destination;
        if (dest === 'new') {
          const n = (await t.sprints.count({ spaceId: space.id })) + 1;
          created = await t.sprints.insert({
            spaceId: space.id,
            name: `${space.key} Sprint ${n}`,
            goal: null,
            startDate: null,
            endDate: null,
            state: 'planned',
            startedAt: null,
            closedAt: null,
            startPoints: null,
            summary: null,
            createdBy: actor.userId,
            createdAt: now,
          });
          target = created.id;
        } else if (dest !== 'backlog') {
          const other = await t.sprints.findOne({ id: dest, spaceId: space.id, state: 'planned' });
          if (!other) {
            throw new AppError(422, 'invalid_sprint', 'Choose a planned sprint in this space', { destination: 'Choose a planned sprint' });
          }
          target = other.id;
        }

        const items = await t.workItems.find({ sprintId: sprint.id, deletedAt: null });
        const done = items.filter((i) => i.resolvedAt);
        const open = items.filter((i) => !i.resolvedAt);
        const history = await t.sprintItemsHistory.find({ sprintId: sprint.id });
        const addedAfter = [...new Set(history.filter((h) => sprint.startedAt && h.addedAt > sprint.startedAt).map((h) => h.itemId))];

        // Done work stays in the closed sprint; the rest moves on and counts a carry-over.
        await setItemsSprint(t, open, target, now);
        if (open.length) {
          await t.workItems.updateMany({ id: { $in: open.map((i) => i.id) } }, { $inc: { carryOverCount: 1 } } as never);
        }
        const settings = await t.tenantSettings.findOne({});
        await snapshotSprint(t, sprint, localDate(now, settings?.timezone ?? 'UTC'));
        const closed = await t.sprints.findOneAndUpdate(
          { id: sprint.id, state: 'active' },
          {
            state: 'closed',
            closedAt: now,
            summary: {
              completed: done.map((i) => i.id),
              notCompleted: open.map((i) => i.id),
              addedAfterStart: addedAfter,
              completedPoints: points(done),
              notCompletedPoints: points(open),
            },
          },
        );
        if (!closed) throw conflict('Only a running sprint can be completed');
        for (const i of open) {
          await recordActivity(t, {
            item: i,
            actorId: actor.userId,
            kind: 'updated',
            field: 'sprint',
            oldValue: { id: sprint.id, name: sprint.name },
            newValue: target ? { id: target, name: created?.name ?? (await t.sprints.get(target))?.name } : null,
          });
        }
        notifyTo = { space, sprint: closed };
        liveTouch({ orgId: actor.orgId, spaceId: space.id, kind: 'sprint' });
        return {
          ...presentSprint(closed),
          completed: done.length,
          moved: open.length,
          movedTo: target ? { id: target, name: created?.name ?? (await t.sprints.get(target))?.name ?? '' } : null,
        };
      });
      if (notifyTo) await notifySprint(actor, notifyTo, 'sprint_completed').catch((e) => req.log.error(e));
      return out;
    },
  );

  async function notifySprint(actor: Actor, n: { space: SpaceRow; sprint: SprintDoc }, type: 'sprint_started' | 'sprint_completed') {
    const t = deps.db.tenant(actor.orgId);
    for (const userId of await spacePeople(t, n.space.id)) {
      if (userId === actor.userId) continue;
      await notifyOne(t, n.space, null, { userId, type, actorId: actor.userId, data: { sprint: n.sprint.name, sprintId: n.sprint.id } });
    }
  }

  // ---- Putting items into sprints -------------------------------------------------------------------------------

  const moveBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), sprintId: z.string().uuid().nullable() });

  /** Puts items (all from one space) into a sprint, or back in the backlog with null. */
  async function moveItems(t: TenantDb, actor: Actor, ids: string[], sprintId: string | null) {
    const items = await t.workItems.find({ id: { $in: ids }, deletedAt: null });
    if (items.length !== ids.length) throw notFound('Work item');
    if (new Set(items.map((i) => i.spaceId)).size > 1) throw new AppError(422, 'multiple_spaces', 'Move items from one space at a time');
    const space = await resolveSpace(t, actor, items[0]!.spaceId).catch(() => {
      throw notFound('Work item');
    });
    if (!can(actor, 'item.edit', spaceCtx(space))) throw forbidden();
    assertWritable(space);
    await assertScrum(t, space);
    if (items.some((i) => !(SPRINT_ITEM_TYPES as readonly string[]).includes(i.type))) {
      throw new AppError(422, 'invalid_type', 'Only stories, tasks and bugs go into sprints');
    }
    let sprint: SprintDoc | null = null;
    if (sprintId) {
      sprint = await t.sprints.findOne({ id: sprintId, spaceId: space.id });
      if (!sprint) throw new AppError(422, 'invalid_sprint', 'Choose a sprint in this space', { sprintId: 'Choose a sprint' });
      if (sprint.state === 'closed') throw conflict('A completed sprint cannot take new work');
    }
    const oldIds = [...new Set(items.map((i) => i.sprintId).filter((x): x is string => !!x))];
    const names = new Map((await t.sprints.find({ id: { $in: oldIds } })).map((x) => [x.id, x.name]));
    const changed = items.filter((i) => i.sprintId !== (sprint?.id ?? null));
    await setItemsSprint(t, items, sprint?.id ?? null);
    await recordActivity(
      t,
      changed.map((i) => ({
        item: i,
        actorId: actor.userId,
        kind: 'updated' as const,
        field: 'sprint',
        oldValue: i.sprintId ? { id: i.sprintId, name: names.get(i.sprintId) ?? '' } : null,
        newValue: sprint ? { id: sprint.id, name: sprint.name } : null,
      })),
    );
    return { updated: changed.length };
  }

  r.post('/items/sprint', { preHandler: requireAuth, schema: { body: moveBody } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, (t) => moveItems(t, actor, [...new Set(req.body.ids)], req.body.sprintId));
  });

  r.put(
    '/items/:id/sprint',
    { preHandler: requireAuth, schema: { params: idParam, body: z.object({ sprintId: z.string().uuid().nullable() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { row } = await resolveItem(t, actor, req.params.id);
        return moveItems(t, actor, [row.id], req.body.sprintId);
      });
    },
  );

  // ---- Reports ---------------------------------------------------------------------------------------------

  r.get('/sprints/:id/report', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { sprint, space } = await resolveSprint(t, actor, req.params.id);
      let completed: string[];
      let notCompleted: string[];
      let addedAfterStart: string[];
      if (sprint.summary) {
        ({ completed, notCompleted, addedAfterStart } = sprint.summary);
      } else {
        const items = await t.workItems.find({ sprintId: sprint.id, deletedAt: null }, { projection: { id: 1, resolvedAt: 1 } });
        completed = items.filter((i) => i.resolvedAt).map((i) => i.id);
        notCompleted = items.filter((i) => !i.resolvedAt).map((i) => i.id);
        const history = sprint.startedAt ? await t.sprintItemsHistory.find({ sprintId: sprint.id, addedAt: { $gt: sprint.startedAt } }) : [];
        addedAfterStart = [...new Set(history.map((h) => h.itemId))];
      }
      const all = await t.workItems.find({ id: { $in: [...new Set([...completed, ...notCompleted, ...addedAfterStart])] } });
      const rows = new Map((await hydrateItems(t, all)).map((r) => [r.id, presentItem(r, space.key)]));
      const pick = (ids: string[]) => ids.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []));
      return { sprint: presentSprint(sprint), completed: pick(completed), notCompleted: pick(notCompleted), addedAfterStart: pick(addedAfterStart) };
    });
  });

  r.get('/sprints/:id/burndown', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { sprint } = await resolveSprint(t, actor, req.params.id);
      assertFeature(await loadPlan(t, actor.orgId), 'burndown_reports', 'Burndown reports');
      if (!sprint.startedAt || !sprint.startDate || !sprint.endDate) {
        throw new AppError(422, 'not_started', 'The burndown starts when the sprint starts');
      }
      const settings = await t.tenantSettings.findOne({});
      const tz = settings?.timezone ?? 'UTC';
      const days = daysBetween(sprint.startDate, sprint.endDate);
      const start = sprint.startPoints ?? 0;
      const ideal = days.map((d, i) => ({ date: d, points: days.length > 1 ? Math.round((start - (start * i) / (days.length - 1)) * 10) / 10 : 0 }));
      const snaps = await t.sprintSnapshots.find({ sprintId: sprint.id }, { sort: { date: 1 } });
      const byDate = new Map(snaps.map((s) => [s.date, s]));
      const today = localDate(new Date(), tz);
      const last = sprint.closedAt ? localDate(sprint.closedAt, tz) : today;
      // Days without a snapshot (none recorded yet) carry the previous day's value.
      let carry = start;
      const actual = days
        .filter((d) => d <= last)
        .map((d) => {
          const s = byDate.get(d);
          if (s) carry = s.remainingPoints;
          return { date: d, points: carry, total: s?.totalPoints ?? null };
        });
      const history = await t.sprintItemsHistory.find({
        sprintId: sprint.id,
        $or: [{ addedAt: { $gt: sprint.startedAt } }, { removedAt: { $gt: sprint.startedAt } }],
      });
      const items = new Map((await t.workItems.find({ id: { $in: history.map((h) => h.itemId) } })).map((i) => [i.id, i]));
      const changes = history.flatMap((h) => {
        const item = items.get(h.itemId);
        const label = item ? `${item.title}` : 'An item';
        const out: { date: string; kind: 'added' | 'removed'; points: number; title: string }[] = [];
        if (sprint.startedAt && h.addedAt > sprint.startedAt) out.push({ date: localDate(h.addedAt, tz), kind: 'added', points: Number(h.estimateAtAdd ?? 0), title: label });
        if (h.removedAt && sprint.startedAt && h.removedAt > sprint.startedAt && (!sprint.closedAt || h.removedAt < sprint.closedAt)) {
          out.push({ date: localDate(h.removedAt, tz), kind: 'removed', points: Number(item?.estimate ?? h.estimateAtAdd ?? 0), title: label });
        }
        return out;
      });
      return { sprint: presentSprint(sprint), startPoints: start, ideal, actual, scopeChanges: changes };
    });
  });

  // ---- Board type ------------------------------------------------------------------------------------------

  r.put(
    '/spaces/:id/board-type',
    { preHandler: requireAuth, schema: { params: idParam, body: z.object({ type: z.enum(['kanban', 'scrum']) }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'board.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const board = await loadBoard(t, space.id);
        if (board.type === 'service') throw conflict('A service desk keeps its board type.');
        if (board.type === req.body.type) return { type: board.type, movedToBacklog: 0 };
        if (await t.sprints.exists({ spaceId: space.id, state: 'active' })) {
          throw conflict('A sprint is running. Complete it before changing the board type.');
        }
        let moved = 0;
        if (req.body.type === 'scrum') {
          assertFeature(await loadPlan(t, actor.orgId), 'scrum_sprints', 'Scrum boards');
        } else {
          // Work planned into sprints goes back to the backlog; the sprints themselves are kept.
          const planned = await t.sprints.find({ spaceId: space.id, state: 'planned' }, { projection: { id: 1 } });
          const items = await t.workItems.find({ sprintId: { $in: planned.map((p) => p.id) } }, { projection: { id: 1, sprintId: 1, estimate: 1 } });
          await setItemsSprint(t, items, null);
          moved = items.length;
        }
        await t.boards.updateOne({ id: board.id }, { type: req.body.type, updatedAt: new Date() });
        return { type: req.body.type, movedToBacklog: moved };
      });
    },
  );
}
