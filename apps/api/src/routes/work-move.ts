import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import { PRIORITIES } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenantTx } from '../db/client.js';
import type { WorkItemDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can } from '../permissions/can.js';
import type { EnqueueRebalance } from '../work/jobs.js';
import {
  assertAssignable,
  assertWritable,
  ifMatch,
  itemPermissions,
  liveParent,
  loadItemRows,
  lockSpace,
  matchesVersion,
  needsRebalance,
  presentItem,
  rebalanceColumn,
  ranksAtEnd,
  resolveItem,
  resolvedAtFor,
  stale,
  statusIn,
  validateHierarchy,
  type SpaceRow,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

export interface MoveDeps extends AuthDeps {
  enqueueRebalance?: EnqueueRebalance;
}

const moveBody = z
  .object({
    statusId: z.string().uuid(),
    /** Place the card directly below this card. */
    afterItemId: z.string().uuid().optional(),
    /** Place the card directly above this card. */
    beforeItemId: z.string().uuid().optional(),
    /** Dropping into a swimlane can also change the lane's field. */
    assigneeId: z.string().uuid().nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    epicId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => !(b.afterItemId && b.beforeItemId), 'Use afterItemId or beforeItemId, not both');

const bulkBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move'),
    ids: z.array(z.string().uuid()).min(1).max(100),
    statusId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('assign'),
    ids: z.array(z.string().uuid()).min(1).max(100),
    assigneeId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal('label'),
    ids: z.array(z.string().uuid()).min(1).max(100),
    labelId: z.string().uuid(),
    mode: z.enum(['add', 'remove']).default('add'),
  }),
  z.object({
    action: z.literal('delete'),
    ids: z.array(z.string().uuid()).min(1).max(100),
  }),
]);

export async function workMoveRoutes(app: FastifyInstance, deps: MoveDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Move -------------------------------------------------------------------------------------------

  r.post(
    '/items/:id/move',
    {
      preHandler: requireAuth,
      schema: { params: z.object({ id: z.string().min(1).max(64) }), body: moveBody },
    },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      const expected = ifMatch(req);
      let rebalance: { spaceId: string; statusId: string } | null = null;

      const result = await withTenantTx(deps.db, actor.orgId, async (tx) => {
        rebalance = null;
        const { row, space } = await resolveItem(tx, actor, req.params.id);
        if (!can(actor, 'item.edit', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
          throw forbidden();
        }
        assertWritable(space);
        // Everything below runs behind the space lock, so a competing move has already committed.
        await lockSpace(tx, space.id);
        const target = await statusIn(tx, space, b.statusId);

        const columnBase = { spaceId: space.id, statusId: target.id, deletedAt: null };
        const column = { ...columnBase, id: { $ne: row.id } };
        const neighbour = async (id: string) => {
          const n = await tx.workItems.findOne(
            { ...columnBase, $and: [{ id }, { id: { $ne: row.id } }] },
            { projection: { rank: 1 } },
          );
          if (!n) {
            throw new AppError(
              422,
              'invalid_neighbor',
              'The card you dropped next to is no longer in that column',
              { afterItemId: 'Reload the board and try again' },
            );
          }
          return n.rank;
        };
        const rankBetween = async () => {
          let lo: string | null = null;
          let hi: string | null = null;
          if (b.afterItemId) {
            lo = await neighbour(b.afterItemId);
            const next = await tx.workItems.findOne(
              { ...column, rank: { $gt: lo } },
              { sort: { rank: 1 }, projection: { rank: 1 } },
            );
            hi = next?.rank ?? null;
          } else if (b.beforeItemId) {
            hi = await neighbour(b.beforeItemId);
            const prev = await tx.workItems.findOne(
              { ...column, rank: { $lt: hi } },
              { sort: { rank: -1 }, projection: { rank: 1 } },
            );
            lo = prev?.rank ?? null;
          } else {
            const last = await tx.workItems.findOne(column, {
              sort: { rank: -1 },
              projection: { rank: 1 },
            });
            lo = last?.rank ?? null;
          }
          return generateKeyBetween(lo, hi);
        };
        let rank: string;
        try {
          rank = await rankBetween();
        } catch (e) {
          if (e instanceof AppError) throw e;
          // Two neighbours with the same rank (it can only come from old data): space them out, retry.
          await rebalanceColumn(tx, space.id, target.id);
          rank = await rankBetween();
        }

        const now = new Date();
        const set: Partial<WorkItemDoc> = {
          statusId: target.id,
          rank,
          resolvedAt: resolvedAtFor(target.category, row.resolvedAt, now),
          updatedAt: now,
        };
        if (b.assigneeId !== undefined) {
          if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);
          set.assigneeId = b.assigneeId;
        }
        if (b.priority !== undefined) set.priority = b.priority;
        if (b.epicId !== undefined) {
          const parent = b.epicId ? await liveParent(tx, space, b.epicId) : null;
          validateHierarchy(row.type, parent);
          set.parentId = b.epicId;
        }
        const updated = await tx.workItems.updateOne({ id: row.id, ...matchesVersion(expected) }, set);
        if (updated === 0) throw stale();

        if (needsRebalance(rank)) rebalance = { spaceId: space.id, statusId: target.id };

        const [fresh] = await loadItemRows(tx, { id: row.id });
        const wip = await tx.workItems.count({
          spaceId: space.id,
          statusId: target.id,
          deletedAt: null,
        });
        const status = await tx.spaceStatuses.get(target.id);
        return {
          ...presentItem(fresh!, space.key),
          permissions: itemPermissions(actor, space, fresh!.reporterId, can),
          wip: { limit: status?.wipLimit ?? null, count: wip },
        };
      });

      if (rebalance) {
        const job = rebalance as { spaceId: string; statusId: string };
        await deps.enqueueRebalance?.({ orgId: actor.orgId, ...job });
      }
      return result;
    },
  );

  // ---- Bulk -------------------------------------------------------------------------------------------

  r.post('/items/bulk', { preHandler: requireAuth, schema: { body: bulkBody } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body;
    const ids = [...new Set(b.ids)];
    return withTenantTx(deps.db, actor.orgId, async (tx) => {
      const rows = await tx.workItems.find(
        { id: { $in: ids }, deletedAt: null },
        {
          projection: {
            id: 1,
            number: 1,
            spaceId: 1,
            type: 1,
            reporterId: 1,
            resolvedAt: 1,
            statusId: 1,
          },
        },
      );
      if (rows.length !== ids.length) throw notFound('Work item');
      const spaceIds = new Set(rows.map((x) => x.spaceId));
      if (spaceIds.size > 1) {
        throw new AppError(422, 'multiple_spaces', 'Change items from one space at a time');
      }
      const space: SpaceRow = await resolveSpace(tx, actor, rows[0]!.spaceId).catch(() => {
        throw notFound('Work item');
      });
      assertWritable(space);
      await lockSpace(tx, space.id);

      const failed: { id: string; key: string; reason: string }[] = [];
      const ok: typeof rows = [];
      const action = b.action === 'delete' ? 'item.delete' : 'item.edit';
      // Keep the order the person selected them in.
      const byId = new Map(rows.map((x) => [x.id, x]));
      for (const id of ids) {
        const item = byId.get(id)!;
        const allowed = can(actor, action, {
          ...spaceCtx(space),
          isReporter: item.reporterId === actor.userId,
        });
        if (allowed) ok.push(item);
        else {
          failed.push({
            id: item.id,
            key: `${space.key}-${item.number}`,
            reason:
              b.action === 'delete'
                ? 'You can only delete items you reported'
                : 'You cannot change this item',
          });
        }
      }
      const now = new Date();
      const idsOk = ok.map((x) => x.id);

      if (ok.length) {
        if (b.action === 'move') {
          const target = await statusIn(tx, space, b.statusId);
          const toMove = ok.filter((x) => x.statusId !== target.id);
          const ranks = await ranksAtEnd(tx, space.id, target.id, toMove.length);
          for (const [i, item] of toMove.entries()) {
            await tx.workItems.updateOne(
              { id: item.id },
              {
                statusId: target.id,
                rank: ranks[i]!,
                resolvedAt: resolvedAtFor(target.category, item.resolvedAt, now),
                updatedAt: now,
              },
            );
          }
        } else if (b.action === 'assign') {
          if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);
          await tx.workItems.updateMany(
            { id: { $in: idsOk } },
            { assigneeId: b.assigneeId, updatedAt: now },
          );
        } else if (b.action === 'label') {
          const label = await tx.labels.findOne({ id: b.labelId, spaceId: space.id });
          if (!label) {
            throw new AppError(422, 'invalid_label', 'That label does not exist in this space', {
              labelId: 'Choose a label from this space',
            });
          }
          await tx.workItems.updateMany(
            { id: { $in: idsOk } },
            b.mode === 'add'
              ? { $addToSet: { labelIds: label.id }, $set: { updatedAt: now } }
              : ({ $pull: { labelIds: label.id }, $set: { updatedAt: now } } as never),
          );
        } else {
          // Subtasks go with their parent; stories under a deleted epic stay.
          const parents = ok.filter((x) => x.type !== 'epic').map((x) => x.id);
          const subtaskRows = parents.length
            ? await tx.workItems.find(
                { parentId: { $in: parents }, deletedAt: null },
                { projection: { id: 1 } },
              )
            : [];
          await tx.workItems.updateMany(
            { id: { $in: [...idsOk, ...subtaskRows.map((x) => x.id)] }, deletedAt: null },
            { deletedAt: now, updatedAt: now },
          );
        }
      }
      return { updated: ok.length, failed };
    });
  });
}
