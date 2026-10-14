import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ITEM_TYPES, PRIORITIES, type ItemType } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { WorkItemDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { containsRegex } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWithinLimit, countWorkItems, loadPlan } from '../plans/index.js';
import { textToDoc } from '../work/doc.js';
import {
  assertAssignable,
  assertWritable,
  ifMatch,
  listStatuses,
  liveParent,
  loadItemRows,
  lockSpace,
  matchesVersion,
  nextNumber,
  presentItem,
  rankAtEnd,
  resolveItem,
  resolvedAtFor,
  setItemLabels,
  stale,
  statusIn,
  validateHierarchy,
  type SpaceRow,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const titleSchema = z.string().trim().min(1, 'Enter a title').max(255, 'Use 255 characters or fewer');
const descriptionSchema = z.string().max(20000, 'That description is too long');
const estimateSchema = z.number().min(0).max(999.9).multipleOf(0.5);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

const createBody = z.object({
  type: z.enum(ITEM_TYPES),
  title: titleSchema,
  description: descriptionSchema.nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  statusId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeId: z.string().uuid().nullable().optional(),
  estimate: estimateSchema.nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
});

const patchBody = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: titleSchema,
    description: descriptionSchema.nullable(),
    parentId: z.string().uuid().nullable(),
    statusId: z.string().uuid(),
    priority: z.enum(PRIORITIES),
    assigneeId: z.string().uuid().nullable(),
    estimate: estimateSchema.nullable(),
    dueDate: dateSchema.nullable(),
    labelIds: z.array(z.string().uuid()).max(20),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const listQuery = z.object({
  status: z.string().uuid().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.union([z.string().uuid(), z.literal('none')]).optional(),
  parent: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParam = z.object({ id: z.string().min(1).max(64) });

export async function workItemRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const itemPermissions = (actor: Actor, space: SpaceRow, reporterId: string) => {
    const ctx = { ...spaceCtx(space), isReporter: reporterId === actor.userId };
    const writable = space.status === 'active';
    return {
      edit: writable && can(actor, 'item.edit', ctx),
      delete: writable && can(actor, 'item.delete', ctx),
    };
  };

  async function fresh(tx: TenantDb, actor: Actor, space: SpaceRow, id: string) {
    const [row] = await loadItemRows(tx, { id });
    if (!row) throw notFound('Work item');
    return {
      ...presentItem(row, space.key),
      permissions: itemPermissions(actor, space, row.reporterId),
    };
  }

  // ---- List -------------------------------------------------------------------------------------------

  r.get(
    '/spaces/:id/items',
    { preHandler: requireAuth, schema: { params: idParam, querystring: listQuery } },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        const filter: Record<string, unknown> = { spaceId: space.id, deletedAt: null };
        if (q.status) filter.statusId = q.status;
        if (q.type) filter.type = q.type;
        if (q.priority) filter.priority = q.priority;
        if (q.assignee === 'none') filter.assigneeId = null;
        else if (q.assignee) filter.assigneeId = q.assignee;
        if (q.parent) filter.parentId = q.parent;
        if (q.q) filter.title = containsRegex(q.q);
        if (q.cursor) {
          const before = Number(q.cursor);
          if (!Number.isInteger(before) || before < 1) {
            throw new AppError(400, 'bad_cursor', 'That page marker is not valid');
          }
          filter.number = { $lt: before };
        }
        const rows = await loadItemRows(tx, filter, { sort: { number: -1 }, limit: q.limit + 1 });
        const page = rows.slice(0, q.limit);
        return {
          items: page.map((row) => presentItem(row, space.key)),
          nextCursor: rows.length > q.limit ? String(page.at(-1)!.number) : null,
        };
      });
    },
  );

  // ---- People who can be assigned -------------------------------------------------------------------------

  r.get(
    '/spaces/:id/assignees',
    {
      preHandler: requireAuth,
      schema: { params: idParam, querystring: z.object({ q: z.string().trim().max(100).optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        // Active members who can open the space: everyone for an open space, otherwise org admins
        // and anyone with a direct or group role.
        const members = await tx.memberships.find({ status: 'active' });
        const people = await tx.users(members.map((m) => m.userId));
        let allowed: Set<string> | null = null;
        if (space.visibility !== 'open') {
          const entries = await tx.spaceMembers.find({ spaceId: space.id });
          const groupIds = entries.filter((e) => e.principalType === 'group').map((e) => e.principalId);
          const links = groupIds.length ? await tx.groupMembers.find({ groupId: { $in: groupIds } }) : [];
          allowed = new Set([
            ...entries.filter((e) => e.principalType === 'user').map((e) => e.principalId),
            ...links.map((l) => l.userId),
          ]);
        }
        const needle = req.query.q?.toLowerCase();
        const items = members
          .filter(
            (m) => !allowed || allowed.has(m.userId) || m.orgRole === 'owner' || m.orgRole === 'admin',
          )
          .flatMap((m) => {
            const u = people.get(m.userId);
            return u ? [u] : [];
          })
          .filter((u) => !needle || [u.name, u.email].some((v) => v?.toLowerCase().includes(needle)))
          .sort(
            (a, b) =>
              (a.name ?? a.email).toLowerCase().localeCompare((b.name ?? b.email).toLowerCase()) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 25);
        return {
          items: items.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl })),
        };
      });
    },
  );

  // ---- Create -----------------------------------------------------------------------------------------

  r.post(
    '/spaces/:id/items',
    { preHandler: requireAuth, schema: { params: idParam, body: createBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        if (!can(actor, 'item.create', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        assertWithinLimit(
          await loadPlan(tx, actor.orgId),
          'work_items',
          await countWorkItems(tx, actor.orgId),
        );

        const parent = b.parentId ? await liveParent(tx, space, b.parentId) : null;
        validateHierarchy(b.type, parent);

        let statusId = b.statusId;
        if (!statusId) {
          const first = (await listStatuses(tx, space.id)).find((s) => s.category === 'todo');
          statusId = first!.id;
        }
        const status = await statusIn(tx, space, statusId);
        if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);

        // The space lock serialises creates, moves and bulk changes, so ranks cannot collide.
        await lockSpace(tx, space.id);
        const number = await nextNumber(tx, space.id);
        const rank = await rankAtEnd(tx, space.id, statusId);
        const now = new Date();
        const created = await tx.workItems.insert({
          spaceId: space.id,
          number,
          type: b.type,
          parentId: b.parentId ?? null,
          title: b.title,
          description: textToDoc(b.description),
          statusId,
          priority: b.priority,
          assigneeId: b.assigneeId ?? null,
          reporterId: actor.userId,
          estimate: b.estimate ?? null,
          dueDate: b.dueDate ?? null,
          rank,
          resolvedAt: resolvedAtFor(status.category, null, now),
          createdAt: now,
          updatedAt: now,
        });
        if (b.labelIds?.length) await setItemLabels(tx, actor.orgId, space, created.id, b.labelIds);
        return fresh(tx, actor, space, created.id);
      });
    },
  );

  // ---- Read -------------------------------------------------------------------------------------------

  r.get('/items/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const { row, space } = await resolveItem(tx, actor, req.params.id);
      return {
        ...presentItem(row, space.key),
        permissions: itemPermissions(actor, space, row.reporterId),
      };
    });
  });

  r.get(
    '/items/:id/subtasks',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { row, space } = await resolveItem(tx, actor, req.params.id);
        const rows = await loadItemRows(
          tx,
          { parentId: row.id, deletedAt: null },
          { sort: { number: 1 } },
        );
        return { items: rows.map((child) => presentItem(child, space.key)) };
      });
    },
  );

  // ---- Update -----------------------------------------------------------------------------------------

  r.patch(
    '/items/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: patchBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      const expected = ifMatch(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { row, space } = await resolveItem(tx, actor, req.params.id);
        if (!can(actor, 'item.edit', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
          throw forbidden();
        }
        assertWritable(space);

        const type: ItemType = b.type ?? row.type;
        const parentId = b.parentId === undefined ? row.parentId : b.parentId;
        if (b.type !== undefined || b.parentId !== undefined) {
          const parent = parentId ? await liveParent(tx, space, parentId) : null;
          if (parentId === row.id) {
            throw new AppError(422, 'invalid_parent', 'An item cannot be its own parent', {
              parentId: 'An item cannot be its own parent',
            });
          }
          const kids = await tx.workItems.find(
            { parentId: row.id, deletedAt: null },
            { projection: { type: 1 } },
          );
          validateHierarchy(type, parent, kids.map((k) => k.type));
        }
        if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);

        await lockSpace(tx, space.id);
        const now = new Date();
        const set: Partial<WorkItemDoc> = { updatedAt: now };
        if (b.title !== undefined) set.title = b.title;
        if (b.description !== undefined) set.description = textToDoc(b.description);
        if (b.type !== undefined) set.type = b.type;
        if (b.parentId !== undefined) set.parentId = b.parentId;
        if (b.priority !== undefined) set.priority = b.priority;
        if (b.assigneeId !== undefined) set.assigneeId = b.assigneeId;
        if (b.estimate !== undefined) set.estimate = b.estimate;
        if (b.dueDate !== undefined) set.dueDate = b.dueDate;
        if (b.statusId !== undefined && b.statusId !== row.statusId) {
          const target = await statusIn(tx, space, b.statusId);
          set.statusId = target.id;
          set.rank = await rankAtEnd(tx, space.id, target.id);
          set.resolvedAt = resolvedAtFor(target.category, null, now);
        }

        // The version check lives in the update's filter, so two simultaneous edits cannot both win.
        const updated = await tx.workItems.updateOne({ id: row.id, ...matchesVersion(expected) }, set);
        if (updated === 0) throw stale();
        if (b.labelIds !== undefined) await setItemLabels(tx, actor.orgId, space, row.id, b.labelIds);
        return fresh(tx, actor, space, row.id);
      });
    },
  );

  // ---- Delete -----------------------------------------------------------------------------------------

  r.delete('/items/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (tx) => {
      const { row, space } = await resolveItem(tx, actor, req.params.id);
      if (!can(actor, 'item.delete', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
        throw forbidden();
      }
      assertWritable(space);
      const now = new Date();
      // Subtasks go with their parent. Stories under a deleted epic stay; they just lose the epic.
      const children =
        row.type === 'epic'
          ? []
          : await tx.workItems.find(
              { parentId: row.id, deletedAt: null },
              { projection: { id: 1 } },
            );
      const ids = [row.id, ...children.map((c) => c.id)];
      await tx.workItems.updateMany(
        { id: { $in: ids }, deletedAt: null },
        { deletedAt: now, updatedAt: now },
      );
      return { deleted: ids.length, subtasks: children.length };
    });
  });
}
