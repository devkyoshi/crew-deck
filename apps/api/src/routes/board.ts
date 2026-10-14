import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant } from '../db/client.js';
import type { BoardDoc } from '../db/types.js';
import { filterConditions, filterQuery, hasFilters, type FilterQuery } from '../work/filters.js';
import { forbidden, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import {
  afterCursor,
  assertWritable,
  byRank,
  encodeCursor,
  listStatuses,
  loadBoard,
  loadItemRows,
  presentItem,
  type SpaceRow,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

export const CARD_FIELDS = [
  'assignee',
  'priority',
  'estimate',
  'dueDate',
  'epic',
  'labels',
  'subtasks',
] as const;
export const SWIMLANES = ['none', 'assignee', 'epic', 'priority'] as const;

const settingsSchema = z.object({
  swimlane: z.enum(SWIMLANES),
  cardFields: z.array(z.enum(CARD_FIELDS)).max(CARD_FIELDS.length),
  doneRetentionDays: z.number().int().min(1).max(365),
});
export type BoardSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: BoardSettings = {
  swimlane: 'none',
  cardFields: [...CARD_FIELDS],
  doneRetentionDays: 14,
};

/** Stored settings may be partial or from an older version; always return a complete, valid set. */
export function readSettings(stored: unknown): BoardSettings {
  const parsed = settingsSchema.partial().safeParse(stored ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

/** Cards on the board: stories, tasks and bugs. Epics have their own page; subtasks show as progress. */
export const BOARD_TYPES_SHOWN = ['story', 'task', 'bug'] as const;
const PAGE = 50;

export async function boardRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const presentBoard = (b: BoardDoc) => ({
    id: b.id,
    type: b.type,
    name: b.name,
    settings: readSettings(b.settings),
  });

  /** Filter for the cards of one column, hiding old Done items in Kanban spaces (they stay searchable). */
  const columnWhere = (
    spaceId: string,
    status: { id: string; category: string },
    board: { type: string; settings: BoardSettings },
    extra: Record<string, unknown>[] = [],
  ): Record<string, unknown> => {
    const all: Record<string, unknown>[] = [
      ...extra,
      { spaceId, statusId: status.id, deletedAt: null, type: { $in: [...BOARD_TYPES_SHOWN] } },
    ];
    if (board.type === 'kanban' && status.category === 'done') {
      const cutoff = new Date(Date.now() - board.settings.doneRetentionDays * 86_400_000);
      all.push({ $or: [{ resolvedAt: null }, { resolvedAt: { $gt: cutoff } }] });
    }
    return { $and: all };
  };

  const permissions = (actor: Actor, space: SpaceRow) => {
    const ctx = spaceCtx(space);
    const writable = space.status === 'active';
    return {
      createItem: writable && can(actor, 'item.create', ctx),
      editItem: writable && can(actor, 'item.edit', ctx),
      manageBoard: writable && can(actor, 'board.manage', ctx),
      manageStatuses: writable && can(actor, 'status.manage', ctx),
    };
  };

  r.get(
    '/spaces/:id/board',
    {
      preHandler: requireAuth,
      schema: { params: z.object({ id: z.string().min(1).max(64) }), querystring: filterQuery },
    },
    async (req) => {
      const actor = actorOf(req);
      const filters: FilterQuery = req.query;
      const extra = filterConditions(filters, actor.userId);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        const boardRow = await loadBoard(tx, space.id);
        const board = presentBoard(boardRow);
        const statuses = await listStatuses(tx, space.id);

        const columns = [];
        for (const status of statuses) {
          const where = columnWhere(space.id, status, board, extra);
          const total = await tx.workItems.count(where);
          // The work-in-progress count ignores filters: the limit is about the whole column.
          const wip = extra.length
            ? await tx.workItems.count(columnWhere(space.id, status, board))
            : total;
          const rows = await loadItemRows(tx, where, { sort: byRank, limit: PAGE + 1 });
          const page = rows.slice(0, PAGE);
          const last = page.at(-1);
          columns.push({
            statusId: status.id,
            items: page.map((row) => presentItem(row, space.key)),
            total,
            wipCount: wip,
            nextCursor: rows.length > PAGE && last ? encodeCursor(last.rank, last.id) : null,
          });
        }
        return {
          filtered: hasFilters(filters),
          space: { id: space.id, key: space.key, name: space.name, status: space.status },
          board,
          statuses,
          columns,
          permissions: permissions(actor, space),
        };
      });
    },
  );

  /** More cards for one column ("load more"). */
  r.get(
    '/spaces/:id/board/columns/:statusId',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().min(1).max(64), statusId: z.string().uuid() }),
        querystring: filterQuery.extend({ cursor: z.string().max(400).optional() }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const extra = filterConditions(req.query, actor.userId);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        const board = presentBoard(await loadBoard(tx, space.id));
        const status = await tx.spaceStatuses.findOne({ id: req.params.statusId, spaceId: space.id });
        if (!status) throw notFound('Status');
        const cursor = afterCursor(req.query.cursor);
        const where = columnWhere(space.id, status, board, [...extra, ...(cursor ? [cursor] : [])]);
        const rows = await loadItemRows(tx, where, { sort: byRank, limit: PAGE + 1 });
        const page = rows.slice(0, PAGE);
        const last = page.at(-1);
        return {
          statusId: status.id,
          items: page.map((row) => presentItem(row, space.key)),
          nextCursor: rows.length > PAGE && last ? encodeCursor(last.rank, last.id) : null,
        };
      });
    },
  );

  r.patch(
    '/boards/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            name: z.string().trim().min(1).max(60),
            settings: settingsSchema.partial().strict(),
          })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const row = await tx.boards.get(req.params.id);
        if (!row) throw notFound('Board');
        const space = await resolveSpace(tx, actor, row.spaceId).catch(() => null);
        if (!space) throw notFound('Board');
        if (!can(actor, 'board.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const settings = { ...readSettings(row.settings), ...req.body.settings };
        const updated = await tx.boards.findOneAndUpdate(
          { id: row.id },
          {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            settings,
            updatedAt: new Date(),
          },
        );
        return presentBoard(updated!);
      });
    },
  );
}
