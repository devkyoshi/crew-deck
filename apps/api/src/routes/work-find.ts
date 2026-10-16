import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ITEM_TYPES, PRIORITIES } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { BOM, csvCell } from '../crm/helpers.js';
import { withTenant, type TenantDb } from '../db/client.js';
import type { SavedFilterDoc, WorkItemDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { escapeRegex } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { loadVisibleSpaces, type SpaceView } from '../spaces/access.js';
import { filterConditions, filterQuery, lookupConditions } from '../work/filters.js';
import { hydrateItems, listStatuses, presentItem } from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

/**
 * Finding work: search across every space the caller can open, "My work", saved filters, the epics
 * page and the list view (with CSV export). Access is part of every query: results are only ever read
 * from the spaces the caller can open, never filtered afterwards.
 */

const KEY_RE = /^([a-z][a-z0-9]{1,9})[-\s]?(\d{1,9})$/i;
const idParam = z.object({ id: z.string().min(1).max(64) });

const SORTS = ['key', 'title', 'status', 'priority', 'due', 'updated', 'created', 'estimate'] as const;
const listQuery = filterQuery.extend({
  sort: z.enum(SORTS).default('key'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  types: z.enum(['cards', 'all']).default('all'),
});
const CSV_MAX_ROWS = 5000;

/** Spaces the caller can open, keyed by id. Archived spaces are left out unless asked for. */
async function openSpaces(t: TenantDb, actor: Actor, opts: { archived?: boolean } = {}) {
  const spaces = await loadVisibleSpaces(t, actor, opts.archived ? {} : { status: 'active' });
  return new Map(spaces.map((s) => [s.id, s]));
}

const present = (rows: Awaited<ReturnType<typeof hydrateItems>>, spaces: Map<string, SpaceView>) =>
  rows.flatMap((r) => {
    const s = spaces.get(r.spaceId);
    return s ? [{ ...presentItem(r, s.key), spaceName: s.name }] : [];
  });

/** Sort stage for the list: priority and status sort by their own order, not alphabetically. */
function sortStages(sort: (typeof SORTS)[number], dir: 1 | -1, statusOrder: string[]) {
  const field: Record<(typeof SORTS)[number], string> = {
    key: 'number',
    title: 'title',
    status: '_status',
    priority: '_priority',
    due: 'dueDate',
    updated: 'updatedAt',
    created: 'createdAt',
    estimate: 'estimate',
  };
  return [
    {
      $addFields: {
        _priority: { $indexOfArray: [[...PRIORITIES], '$priority'] },
        _status: { $indexOfArray: [statusOrder, '$statusId'] },
      },
    },
    { $sort: { [field[sort]]: dir, number: dir } },
  ];
}

export async function workFindRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Search ---------------------------------------------------------------------------------------------

  r.get(
    '/search',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          q: z.string().trim().min(1).max(100),
          space: z.string().max(64).optional(),
          type: z.enum(ITEM_TYPES).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
          offset: z.coerce.number().int().min(0).max(1000).default(0),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { q, limit, offset } = req.query;
      return withTenant(deps.db, actor.orgId, async (t) => {
        let spaces = await openSpaces(t, actor);
        if (req.query.space) {
          const only = [...spaces.values()].find(
            (s) => s.id === req.query.space || s.key === req.query.space!.toUpperCase(),
          );
          spaces = new Map(only ? [[only.id, only]] : []);
        }
        const spaceIds = [...spaces.keys()];
        if (spaceIds.length === 0) return { items: [], nextOffset: null };
        const base: Record<string, unknown> = { spaceId: { $in: spaceIds }, deletedAt: null };
        if (req.query.type) base.type = req.query.type;

        const found: WorkItemDoc[] = [];
        const seen = new Set<string>();
        const add = (docs: WorkItemDoc[]) => {
          for (const d of docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            found.push(d);
          }
        };
        // 1. An exact key ("ENG-142", "eng 142") comes first.
        const match = KEY_RE.exec(q);
        const keySpace = match ? [...spaces.values()].find((x) => x.key === match[1]!.toUpperCase()) : undefined;
        if (match && keySpace) add(await t.workItems.find({ ...base, spaceId: keySpace.id, number: Number(match[2]) }));
        // "ENG-142" or "eng 142" is always a key; "eng142" only when such a space exists (it could be a word).
        const key = match && (/[-\s]/.test(q) || keySpace);
        const want = offset + limit + 1;
        // 2. Whole words in the title or description, best match first. A key-shaped query skips this:
        //    the text index would split "ENG-142" into "eng" and "142" and match unrelated items.
        if (!key) add(
          await t.workItems.find(
            { ...base, $text: { $search: q } },
            { projection: { score: { $meta: 'textScore' } }, sort: { score: { $meta: 'textScore' } }, limit: want },
          ),
        );
        // 3. Titles containing what was typed so far (partial words, as people type in the palette).
        if (found.length < want) {
          add(
            await t.workItems.find(
              { ...base, title: { $regex: escapeRegex(q), $options: 'i' } },
              { sort: { updatedAt: -1 }, limit: want },
            ),
          );
        }
        const page = found.slice(offset, offset + limit);
        return {
          items: present(await hydrateItems(t, page), spaces),
          nextOffset: found.length > offset + limit ? offset + limit : null,
        };
      });
    },
  );

  // ---- My work --------------------------------------------------------------------------------------------

  r.get(
    '/me/items',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          role: z.enum(['assigned', 'reported', 'watching']).default('assigned'),
          state: z.enum(['open', 'done', 'all']).default('open'),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { role, state, limit } = req.query;
      return withTenant(deps.db, actor.orgId, async (t) => {
        const spaces = await openSpaces(t, actor);
        const filter: Record<string, unknown> = { spaceId: { $in: [...spaces.keys()] }, deletedAt: null };
        if (role === 'assigned') filter.assigneeId = actor.userId;
        else if (role === 'reported') filter.reporterId = actor.userId;
        else {
          const watched = await t.watchers.find({ userId: actor.userId }, { projection: { itemId: 1 } });
          filter.id = { $in: watched.map((w) => w.itemId) };
        }
        if (state === 'open') filter.resolvedAt = null;
        else if (state === 'done') filter.resolvedAt = { $ne: null };
        const docs = await t.workItems.find(filter, { sort: { dueDate: 1, updatedAt: -1 }, limit });
        // Items with a due date first (soonest first), then the rest by last change.
        docs.sort((a, b) =>
          a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : +b.updatedAt - +a.updatedAt,
        );
        return { items: present(await hydrateItems(t, docs), spaces) };
      });
    },
  );

  // ---- Saved filters --------------------------------------------------------------------------------------

  const filterBody = z.object({
    name: z.string().trim().min(1, 'Name the filter').max(80),
    /** The filter part of the board or list URL (`assignee=...&type=bug`). */
    query: z.string().max(2000),
    spaceId: z.string().uuid().nullable().default(null),
    shared: z.boolean().default(false),
  });

  const presentFilter = (f: SavedFilterDoc, actor: Actor) => ({
    id: f.id,
    name: f.name,
    query: f.query,
    spaceId: f.spaceId,
    shared: f.isShared,
    mine: f.ownerId === actor.userId,
    canEdit: f.ownerId === actor.userId || actor.orgRole !== 'member',
    createdAt: f.createdAt,
  });

  /** Sharing needs a role that can change work in the space (or the workspace) and the plan feature. */
  async function assertCanShare(t: TenantDb, actor: Actor, spaceId: string | null) {
    const ctx = spaceId ? spaceCtx(await resolveSpace(t, actor, spaceId)) : {};
    if (!can(actor, 'filter.share', ctx)) throw forbidden('You cannot share filters here');
    assertFeature(await loadPlan(t, actor.orgId), 'shared_filters', 'Shared filters');
  }

  /** Only the parts the board and list understand are kept, so a saved filter cannot carry anything else. */
  function cleanQuery(raw: string) {
    const parsed = filterQuery.safeParse(Object.fromEntries(new URLSearchParams(raw)));
    if (!parsed.success) {
      throw new AppError(422, 'validation_error', 'That filter is not valid', { query: 'That filter is not valid' });
    }
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v === undefined) continue;
      out.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return out.toString();
  }

  r.get(
    '/filters',
    { preHandler: requireAuth, schema: { querystring: z.object({ space: z.string().max(64).optional() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const spaces = await openSpaces(t, actor, { archived: true });
        let spaceId: string | null = null;
        if (req.query.space) {
          const s = [...spaces.values()].find((x) => x.id === req.query.space || x.key === req.query.space!.toUpperCase());
          if (!s) throw notFound('Space');
          spaceId = s.id;
        }
        const rows = await t.savedFilters.find(
          {
            $or: [{ ownerId: actor.userId }, { isShared: true }],
            ...(spaceId ? { spaceId: { $in: [spaceId, null] } } : {}),
          },
          { sort: { name: 1 } },
        );
        // Shared filters of spaces the caller cannot open stay hidden.
        const visible = rows.filter((f) => f.spaceId === null || spaces.has(f.spaceId));
        const plan = await loadPlan(t, actor.orgId);
        return {
          items: visible.map((f) => presentFilter(f, actor)),
          canShare: plan.features.includes('shared_filters'),
        };
      });
    },
  );

  r.post('/filters', { preHandler: requireAuth, schema: { body: filterBody } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body;
    return withTenant(deps.db, actor.orgId, async (t) => {
      if (b.spaceId) await resolveSpace(t, actor, b.spaceId);
      if (b.shared) await assertCanShare(t, actor, b.spaceId);
      if ((await t.savedFilters.count({ ownerId: actor.userId })) >= 100) {
        throw new AppError(422, 'too_many', 'You can keep up to 100 saved filters');
      }
      const f = await t.savedFilters.insert({
        ownerId: actor.userId,
        spaceId: b.spaceId,
        name: b.name,
        query: cleanQuery(b.query),
        isShared: b.shared,
        createdAt: new Date(),
      });
      return presentFilter(f, actor);
    });
  });

  r.patch(
    '/filters/:id',
    {
      preHandler: requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: filterBody.partial().omit({ spaceId: true }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const f = await t.savedFilters.get(req.params.id);
        if (!f || (f.ownerId !== actor.userId && !f.isShared)) throw notFound('Filter');
        if (f.ownerId !== actor.userId && actor.orgRole === 'member') throw forbidden();
        if (req.body.shared) await assertCanShare(t, actor, f.spaceId);
        const set: Partial<SavedFilterDoc> = {};
        if (req.body.name !== undefined) set.name = req.body.name;
        if (req.body.query !== undefined) set.query = cleanQuery(req.body.query);
        if (req.body.shared !== undefined) set.isShared = req.body.shared;
        const updated = await t.savedFilters.findOneAndUpdate({ id: f.id }, set);
        return presentFilter(updated!, actor);
      });
    },
  );

  r.delete(
    '/filters/:id',
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const f = await t.savedFilters.get(req.params.id);
        if (!f || (f.ownerId !== actor.userId && !f.isShared)) throw notFound('Filter');
        if (f.ownerId !== actor.userId && actor.orgRole === 'member') throw forbidden();
        await t.savedFilters.deleteOne({ id: f.id });
        return { ok: true };
      });
    },
  );

  // ---- Epics ----------------------------------------------------------------------------------------------

  r.get('/spaces/:id/epics', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const epics = await t.workItems.find({ spaceId: space.id, type: 'epic', deletedAt: null }, { sort: { number: -1 } });
      const kids = epics.length
        ? await t.workItems.find(
            { parentId: { $in: epics.map((e) => e.id) }, deletedAt: null },
            { projection: { parentId: 1, resolvedAt: 1, estimate: 1 } },
          )
        : [];
      const stats = new Map<string, { total: number; done: number; points: number; donePoints: number }>();
      for (const k of kids) {
        const s = stats.get(k.parentId!) ?? { total: 0, done: 0, points: 0, donePoints: 0 };
        s.total++;
        s.points += Number(k.estimate ?? 0);
        if (k.resolvedAt) {
          s.done++;
          s.donePoints += Number(k.estimate ?? 0);
        }
        stats.set(k.parentId!, s);
      }
      const rows = await hydrateItems(t, epics);
      return {
        items: rows.map((r) => ({
          ...presentItem(r, space.key),
          progress: stats.get(r.id) ?? { total: 0, done: 0, points: 0, donePoints: 0 },
        })),
        permissions: { create: space.status === 'active' && can(actor, 'item.create', spaceCtx(space)) },
      };
    });
  });

  // ---- List view and CSV ----------------------------------------------------------------------------------

  async function listRows(t: TenantDb, actor: Actor, spaceRef: string, q: z.infer<typeof listQuery>, cap: number, offset: number) {
    const space = await resolveSpace(t, actor, spaceRef);
    const statuses = await listStatuses(t, space.id);
    const match: Record<string, unknown> = { spaceId: space.id, deletedAt: null };
    if (q.types === 'cards') match.type = { $in: ['story', 'task', 'bug'] };
    const conds = [...filterConditions(q, actor.userId), ...(await lookupConditions(t, space.id, q))];
    if (conds.length) match.$and = conds;
    const dir = q.dir === 'asc' ? 1 : -1;
    const [counted] = await t.workItems.aggregate<{ n: number }>([{ $match: match }, { $count: 'n' }]);
    const docs = await t.workItems.aggregate<WorkItemDoc>([
      { $match: match },
      ...sortStages(q.sort, dir, statuses.map((s) => s.id)),
      { $skip: offset },
      { $limit: cap },
      { $project: { _id: 0, _priority: 0, _status: 0 } },
    ]);
    return { space, total: counted?.n ?? 0, rows: await hydrateItems(t, docs) };
  }

  r.get('/spaces/:id/list', { preHandler: requireAuth, schema: { params: idParam, querystring: listQuery } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { space, total, rows } = await listRows(t, actor, req.params.id, req.query, req.query.limit, req.query.offset);
      const writable = space.status === 'active';
      return {
        items: rows.map((r) => presentItem(r, space.key)),
        total,
        nextOffset: req.query.offset + rows.length < total ? req.query.offset + rows.length : null,
        permissions: {
          editItem: writable && can(actor, 'item.edit', spaceCtx(space)),
          createItem: writable && can(actor, 'item.create', spaceCtx(space)),
        },
      };
    });
  });

  r.get(
    '/spaces/:id/items.csv',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { params: idParam, querystring: listQuery },
    },
    async (req, reply) => {
      const actor = actorOf(req);
      const { space, rows } = await withTenant(deps.db, actor.orgId, (t) =>
        listRows(t, actor, req.params.id, req.query, CSV_MAX_ROWS, 0),
      );
      const header = ['Key', 'Type', 'Title', 'Status', 'Priority', 'Assignee', 'Reporter', 'Estimate', 'Due date', 'Labels', 'Parent', 'Created', 'Updated', 'Resolved'];
      const lines = rows.map((r) => {
        const p = presentItem(r, space.key);
        return [
          p.key,
          p.type,
          p.title,
          p.status.name,
          p.priority,
          p.assignee?.name ?? p.assignee?.email ?? '',
          p.reporter.name ?? p.reporter.email,
          p.estimate ?? '',
          p.dueDate ?? '',
          p.labels.map((l) => l.name).join('; '),
          p.parent?.key ?? '',
          p.createdAt.toISOString(),
          p.updatedAt.toISOString(),
          p.resolvedAt ? p.resolvedAt.toISOString() : '',
        ]
          .map(csvCell)
          .join(',');
      });
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${space.key}-items.csv"`);
      return BOM + [header.join(','), ...lines].join('\r\n') + '\r\n';
    },
  );
}
