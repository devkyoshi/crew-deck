import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ITEM_TYPES, PRIORITIES, type ItemType } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { workItems } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { likePattern } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWithinLimit, countWorkItems, loadPlan } from '../plans/index.js';
import { textToDoc } from '../work/doc.js';
import {
  assertAssignable,
  assertWritable,
  itemQuery,
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

  async function fresh(tx: Tx, actor: Actor, space: SpaceRow, id: string) {
    const [row] = await loadItemRows(tx, eq(workItems.id, id));
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
        const conds: (SQL | undefined)[] = [
          eq(workItems.spaceId, space.id),
          isNull(workItems.deletedAt),
        ];
        if (q.status) conds.push(eq(workItems.statusId, q.status));
        if (q.type) conds.push(eq(workItems.type, q.type));
        if (q.priority) conds.push(eq(workItems.priority, q.priority));
        if (q.assignee === 'none') conds.push(isNull(workItems.assigneeId));
        else if (q.assignee) conds.push(eq(workItems.assigneeId, q.assignee));
        if (q.parent) conds.push(eq(workItems.parentId, q.parent));
        if (q.q) conds.push(ilike(workItems.title, likePattern(q.q)));
        const before = Number(q.cursor);
        if (q.cursor) {
          if (!Number.isInteger(before) || before < 1) {
            throw new AppError(400, 'bad_cursor', 'That page marker is not valid');
          }
          conds.push(lt(workItems.number, before));
        }
        const rows = await loadItemRows(tx, and(...conds))
          .orderBy(desc(workItems.number))
          .limit(q.limit + 1);
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
        const like = req.query.q ? likePattern(req.query.q) : null;
        // Active members who can open the space: everyone for an open space, otherwise org admins
        // and anyone with a direct or group role.
        const rows = await tx.execute<{
          id: string;
          name: string | null;
          email: string;
          avatar_url: string | null;
        }>(sql`
          select u.id, u.name, u.email, u.avatar_url
          from memberships m join users u on u.id = m.user_id
          where m.org_id = ${actor.orgId} and m.status = 'active'
            and (${like}::text is null or u.name ilike ${like} or u.email ilike ${like})
            and (
              ${space.visibility === 'open'} or m.org_role in ('owner', 'admin') or exists (
                select 1 from space_members sm
                where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId}
                  and ((sm.principal_type = 'user' and sm.principal_id = u.id)
                    or (sm.principal_type = 'group' and sm.principal_id in (
                      select gm.group_id from group_members gm
                      where gm.user_id = u.id and gm.org_id = ${actor.orgId})))
              )
            )
          order by lower(coalesce(u.name, u.email)), u.id
          limit 25`);
        return {
          items: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url })),
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
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
        if (statusId) await statusIn(tx, space, statusId);
        else {
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
        const [created] = await tx
          .insert(workItems)
          .values({
            orgId: actor.orgId,
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
            estimate: b.estimate === null || b.estimate === undefined ? null : String(b.estimate),
            dueDate: b.dueDate ?? null,
            rank,
            resolvedAt: resolvedAtFor(status.category, null, now),
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: workItems.id });
        if (b.labelIds?.length) await setItemLabels(tx, actor.orgId, space, created!.id, b.labelIds);
        return fresh(tx, actor, space, created!.id);
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
        const rows = await itemQuery(tx)
          .where(and(eq(workItems.parentId, row.id), isNull(workItems.deletedAt)))
          .orderBy(asc(workItems.number));
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
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
          const kids = await tx
            .select({ type: workItems.type })
            .from(workItems)
            .where(and(eq(workItems.parentId, row.id), isNull(workItems.deletedAt)));
          validateHierarchy(type, parent, kids.map((k) => k.type));
        }
        if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);

        await lockSpace(tx, space.id);
        const now = new Date();
        const set: Partial<typeof workItems.$inferInsert> = { updatedAt: now };
        if (b.title !== undefined) set.title = b.title;
        if (b.description !== undefined) set.description = textToDoc(b.description);
        if (b.type !== undefined) set.type = b.type;
        if (b.parentId !== undefined) set.parentId = b.parentId;
        if (b.priority !== undefined) set.priority = b.priority;
        if (b.assigneeId !== undefined) set.assigneeId = b.assigneeId;
        if (b.estimate !== undefined) set.estimate = b.estimate === null ? null : String(b.estimate);
        if (b.dueDate !== undefined) set.dueDate = b.dueDate;
        if (b.statusId !== undefined && b.statusId !== row.statusId) {
          const target = await statusIn(tx, space, b.statusId);
          set.statusId = target.id;
          set.rank = await rankAtEnd(tx, space.id, target.id);
          set.resolvedAt = resolvedAtFor(target.category, null, now);
        }

        // The version check lives in the UPDATE itself, so two simultaneous edits cannot both win.
        const updated = await tx
          .update(workItems)
          .set(set)
          .where(
            and(eq(workItems.id, row.id), matchesVersion(expected)),
          )
          .returning({ id: workItems.id });
        if (!updated.length) throw stale();
        if (b.labelIds !== undefined) await setItemLabels(tx, actor.orgId, space, row.id, b.labelIds);
        return fresh(tx, actor, space, row.id);
      });
    },
  );

  // ---- Delete -----------------------------------------------------------------------------------------

  r.delete('/items/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
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
          : await tx
              .select({ id: workItems.id })
              .from(workItems)
              .where(and(eq(workItems.parentId, row.id), isNull(workItems.deletedAt)));
      const ids = [row.id, ...children.map((c) => c.id)];
      await tx
        .update(workItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(workItems.id, ids), isNull(workItems.deletedAt)));
      return { deleted: ids.length, subtasks: children.length };
    });
  });
}
