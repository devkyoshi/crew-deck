import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';
import { PRIORITIES } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { labels, spaceStatuses, workItemLabels, workItems } from '../db/schema.js';
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

const C = sql.raw(' COLLATE "C"');

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

      const result = await withTenant(deps.db, actor.orgId, async (tx) => {
        const { row, space } = await resolveItem(tx, actor, req.params.id);
        if (!can(actor, 'item.edit', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
          throw forbidden();
        }
        assertWritable(space);
        // Everything below runs behind the space lock, so a competing move has already committed.
        await lockSpace(tx, space.id);
        const target = await statusIn(tx, space, b.statusId);

        const column = and(
          eq(workItems.spaceId, space.id),
          eq(workItems.statusId, target.id),
          isNull(workItems.deletedAt),
          ne(workItems.id, row.id),
        );
        const neighbour = async (id: string) => {
          const [n] = await tx
            .select({ rank: workItems.rank })
            .from(workItems)
            .where(and(column, eq(workItems.id, id)));
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
            const [next] = await tx
              .select({ rank: workItems.rank })
              .from(workItems)
              .where(and(column, sql`${workItems.rank}${C} > ${lo}::text${C}`))
              .orderBy(sql`${workItems.rank}${C} asc`)
              .limit(1);
            hi = next?.rank ?? null;
          } else if (b.beforeItemId) {
            hi = await neighbour(b.beforeItemId);
            const [prev] = await tx
              .select({ rank: workItems.rank })
              .from(workItems)
              .where(and(column, sql`${workItems.rank}${C} < ${hi}::text${C}`))
              .orderBy(sql`${workItems.rank}${C} desc`)
              .limit(1);
            lo = prev?.rank ?? null;
          } else {
            const [last] = await tx
              .select({ rank: workItems.rank })
              .from(workItems)
              .where(column)
              .orderBy(sql`${workItems.rank}${C} desc`)
              .limit(1);
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
        const set: Partial<typeof workItems.$inferInsert> = {
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
        const updated = await tx
          .update(workItems)
          .set(set)
          .where(and(eq(workItems.id, row.id), matchesVersion(expected)))
          .returning({ id: workItems.id });
        if (!updated.length) throw stale();

        if (needsRebalance(rank)) rebalance = { spaceId: space.id, statusId: target.id };

        const [fresh] = await loadItemRows(tx, eq(workItems.id, row.id));
        const [wip] = await tx
          .select({ n: count() })
          .from(workItems)
          .where(
            and(
              eq(workItems.spaceId, space.id),
              eq(workItems.statusId, target.id),
              isNull(workItems.deletedAt),
            ),
          );
        const [limit] = await tx
          .select({ wipLimit: spaceStatuses.wipLimit })
          .from(spaceStatuses)
          .where(eq(spaceStatuses.id, target.id));
        return {
          ...presentItem(fresh!, space.key),
          permissions: itemPermissions(actor, space, fresh!.reporterId, can),
          wip: { limit: limit?.wipLimit ?? null, count: wip?.n ?? 0 },
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
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const rows = await tx
        .select({
          id: workItems.id,
          number: workItems.number,
          spaceId: workItems.spaceId,
          type: workItems.type,
          reporterId: workItems.reporterId,
          resolvedAt: workItems.resolvedAt,
          statusId: workItems.statusId,
        })
        .from(workItems)
        .where(
          and(
            inArray(workItems.id, ids),
            eq(workItems.orgId, actor.orgId),
            isNull(workItems.deletedAt),
          ),
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
            reason: b.action === 'delete' ? 'You can only delete items you reported' : 'You cannot change this item',
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
            await tx
              .update(workItems)
              .set({
                statusId: target.id,
                rank: ranks[i]!,
                resolvedAt: resolvedAtFor(target.category, item.resolvedAt, now),
                updatedAt: now,
              })
              .where(eq(workItems.id, item.id));
          }
        } else if (b.action === 'assign') {
          if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);
          await tx
            .update(workItems)
            .set({ assigneeId: b.assigneeId, updatedAt: now })
            .where(inArray(workItems.id, idsOk));
        } else if (b.action === 'label') {
          const [label] = await tx
            .select({ id: labels.id })
            .from(labels)
            .where(and(eq(labels.id, b.labelId), eq(labels.spaceId, space.id)));
          if (!label) {
            throw new AppError(422, 'invalid_label', 'That label does not exist in this space', {
              labelId: 'Choose a label from this space',
            });
          }
          if (b.mode === 'add') {
            await tx
              .insert(workItemLabels)
              .values(idsOk.map((workItemId) => ({ workItemId, labelId: label.id, orgId: actor.orgId, spaceId: space.id })))
              .onConflictDoNothing();
          } else {
            await tx
              .delete(workItemLabels)
              .where(and(inArray(workItemLabels.workItemId, idsOk), eq(workItemLabels.labelId, label.id)));
          }
          await tx.update(workItems).set({ updatedAt: now }).where(inArray(workItems.id, idsOk));
        } else {
          // Subtasks go with their parent; stories under a deleted epic stay.
          const subtaskRows = await tx
            .select({ id: workItems.id })
            .from(workItems)
            .where(
              and(
                inArray(
                  workItems.parentId,
                  ok.filter((x) => x.type !== 'epic').map((x) => x.id),
                ),
                isNull(workItems.deletedAt),
              ),
            );
          await tx
            .update(workItems)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                inArray(workItems.id, [...idsOk, ...subtaskRows.map((x) => x.id)]),
                isNull(workItems.deletedAt),
              ),
            );
        }
      }
      return { updated: ok.length, failed };
    });
  });
}

export type { Tx };
