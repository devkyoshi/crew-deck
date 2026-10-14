import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenantTx, type TenantDb } from '../db/client.js';
import type { WorkItemDoc } from '../db/types.js';
import { AppError, forbidden } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWithinLimit, countWorkItems, loadPlan } from '../plans/index.js';
import { addWatchers, recordActivity } from '../work/activity.js';
import {
  assertWritable,
  canOpenSpace,
  itemPermissions,
  listStatuses,
  loadItemRows,
  lockSpace,
  nextNumber,
  presentItem,
  rankAtEnd,
  resolveItem,
  resolvedAtFor,
  type SpaceRow,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const idParam = z.object({ id: z.string().min(1).max(64) });

const duplicateBody = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  includeSubtasks: z.boolean().default(true),
});

const transferBody = z.object({ spaceId: z.string().min(1).max(64) });

async function present(t: TenantDb, actor: Actor, space: SpaceRow, id: string) {
  const [row] = await loadItemRows(t, { id });
  return { ...presentItem(row!, space.key), permissions: itemPermissions(actor, space, row!.reporterId, can) };
}

const liveChildren = (t: TenantDb, parentId: string) =>
  t.workItems.find({ parentId, deletedAt: null }, { sort: { number: 1 } });

export async function workCopyRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Duplicate ----------------------------------------------------------------------------------------

  r.post(
    '/items/:id/duplicate',
    { preHandler: requireAuth, schema: { params: idParam, body: duplicateBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { row, space } = await resolveItem(t, actor, req.params.id);
        if (!can(actor, 'item.duplicate', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        // An epic's children are whole items of their own, so only subtasks come along.
        const kids = b.includeSubtasks && row.type !== 'epic' ? await liveChildren(t, row.id) : [];
        assertWithinLimit(await loadPlan(t, actor.orgId), 'work_items', await countWorkItems(t, actor.orgId), 1 + kids.length);

        await lockSpace(t, space.id);
        const now = new Date();
        const copyOf = async (src: WorkItemDoc, overrides: Partial<WorkItemDoc>) =>
          t.workItems.insert({
            spaceId: space.id,
            number: await nextNumber(t, space.id),
            type: src.type,
            parentId: src.parentId,
            title: src.title,
            description: src.description,
            statusId: src.statusId,
            priority: src.priority,
            assigneeId: src.assigneeId,
            reporterId: actor.userId,
            estimate: src.estimate,
            dueDate: src.dueDate,
            rank: await rankAtEnd(t, space.id, src.statusId),
            labelIds: src.labelIds ?? [],
            resolvedAt: src.resolvedAt ? now : null,
            createdAt: now,
            updatedAt: now,
            ...overrides,
          });
        const copy = await copyOf(row, { title: b.title ?? `${row.title} (copy)`.slice(0, 255) });
        for (const kid of kids) await copyOf(kid, { parentId: copy.id });

        const fromKey = `${space.key}-${row.number}`;
        const toKey = `${space.key}-${copy.number}`;
        await recordActivity(t, [
          { item: copy, actorId: actor.userId, kind: 'duplicated', newValue: { from: { id: row.id, key: fromKey } } },
          { item: row, actorId: actor.userId, kind: 'duplicated', newValue: { to: { id: copy.id, key: toKey } } },
        ]);
        await addWatchers(t, copy.id, [actor.userId, copy.assigneeId]);
        return { ...(await present(t, actor, space, copy.id)), subtasksCopied: kids.length };
      });
    },
  );

  // ---- Transfer ------------------------------------------------------------------------------------------

  r.post(
    '/items/:id/transfer',
    { preHandler: requireAuth, schema: { params: idParam, body: transferBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { row, space } = await resolveItem(t, actor, req.params.id);
        if (!can(actor, 'item.transfer', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
          throw forbidden();
        }
        assertWritable(space);
        const target = await resolveSpace(t, actor, req.body.spaceId).catch(() => {
          throw new AppError(422, 'invalid_space', 'That space does not exist or you cannot open it', {
            spaceId: 'Choose a space you can add work to',
          });
        });
        if (target.id === space.id) {
          throw new AppError(422, 'invalid_space', 'The item is already in that space', { spaceId: 'Choose another space' });
        }
        if (!can(actor, 'item.create', spaceCtx(target))) {
          throw new AppError(403, 'forbidden', 'You cannot add work to that space', {
            spaceId: 'Choose a space you can add work to',
          });
        }
        assertWritable(target);
        if (row.type === 'subtask') {
          throw new AppError(422, 'invalid_hierarchy', 'Move the subtask’s parent instead; subtasks go with it');
        }

        // Subtasks travel with their parent; an epic's children stay and simply lose the epic.
        const kids = row.type === 'epic' ? [] : await liveChildren(t, row.id);
        const moving = [row as WorkItemDoc, ...kids];
        const [statuses, labels, oldLabels] = await Promise.all([
          listStatuses(t, target.id),
          t.labels.find({ spaceId: target.id }),
          t.labels.find({ id: { $in: [...new Set(moving.flatMap((m) => m.labelIds ?? []))] } }),
        ]);
        const oldStatuses = await t.spaceStatuses.find({ id: { $in: [...new Set(moving.map((m) => m.statusId))] } });
        // Same status name if the target has it, otherwise the first status of the same kind.
        const mapStatus = (statusId: string) => {
          const old = oldStatuses.find((s) => s.id === statusId);
          const byName = old && statuses.find((s) => s.name.toLowerCase() === old.name.toLowerCase());
          return byName ?? statuses.find((s) => s.category === (old?.category ?? 'todo')) ?? statuses[0]!;
        };
        const labelByName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
        const mapLabels = (ids: string[]) =>
          [...new Set(ids.flatMap((id) => {
            const name = oldLabels.find((l) => l.id === id)?.name.toLowerCase();
            const hit = name ? labelByName.get(name) : undefined;
            return hit ? [hit] : [];
          }))];

        await lockSpace(t, space.id);
        await lockSpace(t, target.id);
        const now = new Date();
        const fromKey = `${space.key}-${row.number}`;
        let toKey = '';
        for (const item of moving) {
          const status = mapStatus(item.statusId);
          const assigneeId = item.assigneeId && (await canOpenSpace(t, target, item.assigneeId)) ? item.assigneeId : null;
          const number = await nextNumber(t, target.id);
          if (item.id === row.id) toKey = `${target.key}-${number}`;
          await t.workItems.updateOne(
            { id: item.id },
            {
              spaceId: target.id,
              number,
              statusId: status.id,
              rank: await rankAtEnd(t, target.id, status.id),
              resolvedAt: resolvedAtFor(status.category, item.resolvedAt, now),
              labelIds: mapLabels(item.labelIds ?? []),
              assigneeId,
              // The parent (an epic) lives in the old space, so a moved story loses it.
              parentId: item.id === row.id ? null : item.parentId,
              sprintId: null,
              updatedAt: now,
            },
          );
        }
        const ids = moving.map((m) => m.id);
        await t.comments.updateMany({ itemId: { $in: ids } }, { spaceId: target.id });
        await t.attachments.updateMany({ itemId: { $in: ids } }, { spaceId: target.id });
        // Children of a moved epic stay where they are and no longer belong to it.
        if (row.type === 'epic') {
          await t.workItems.updateMany({ parentId: row.id, deletedAt: null }, { parentId: null, updatedAt: now });
        }
        await recordActivity(
          t,
          moving.map((m) => ({
            item: { id: m.id, spaceId: target.id },
            actorId: actor.userId,
            kind: 'transferred' as const,
            oldValue: { spaceId: space.id, spaceKey: space.key, ...(m.id === row.id ? { key: fromKey } : {}) },
            newValue: { spaceId: target.id, spaceKey: target.key, ...(m.id === row.id ? { key: toKey } : {}) },
          })),
        );
        return { ...(await present(t, actor, target, row.id)), subtasksMoved: kids.length, previousKey: fromKey };
      });
    },
  );
}
