import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MAX_STATUSES, STATUS_CATEGORIES, STATUS_COLORS } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import type { SpaceRow } from '../work/service.js';
import {
  assertWritable,
  byRank,
  listStatuses,
  lockSpace,
  ranksAtEnd,
  resolvedAtFor,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';
import { liveTouch } from '../lib/live.js';

const nameSchema = z.string().trim().min(1, 'Enter a name').max(40, 'Use 40 characters or fewer');
const colorSchema = z.enum(STATUS_COLORS);
const categorySchema = z.enum(STATUS_CATEGORIES);
const wipSchema = z.number().int().min(1).max(999).nullable();

const nameTaken = () =>
  new AppError(409, 'name_taken', 'A status with that name already exists in this space', {
    name: 'A status with that name already exists',
  });

export async function statusRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Loads a status and its space, 404ing for anything the caller cannot see. */
  async function loadStatus(tx: TenantDb, actor: Actor, id: string) {
    const status = await tx.spaceStatuses.get(id);
    if (!status) throw notFound('Status');
    const space = await resolveSpace(tx, actor, status.spaceId).catch(() => null);
    if (!space) throw notFound('Status');
    return { status, space };
  }

  const guardManage = (actor: Actor, space: SpaceRow) => {
    if (!can(actor, 'status.manage', spaceCtx(space))) throw forbidden();
    assertWritable(space);
  };

  /** Statuses must keep at least one entry in each category. */
  const categoryCount = (tx: TenantDb, spaceId: string, category: string) =>
    tx.spaceStatuses.count({ spaceId, category: category as 'todo' });

  const liveCount = (tx: TenantDb, statusId: string) =>
    tx.workItems.count({ statusId, deletedAt: null });

  /** The API shape of a status document. */
  const present = (s: {
    id: string;
    spaceId: string;
    name: string;
    category: string;
    position: number;
    color: string;
    wipLimit: number | null;
    createdAt: Date;
    orgId: string;
  }) => ({
    id: s.id,
    orgId: s.orgId,
    spaceId: s.spaceId,
    name: s.name,
    category: s.category,
    position: s.position,
    color: s.color,
    wipLimit: s.wipLimit,
    createdAt: s.createdAt,
  });

  r.get(
    '/spaces/:id/statuses',
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        const items = await listStatuses(tx, space.id);
        const counts = await tx.workItems.aggregate<{ _id: string; n: number }>([
          { $match: { spaceId: space.id, deletedAt: null } },
          { $group: { _id: '$statusId', n: { $sum: 1 } } },
        ]);
        const byStatus = new Map(counts.map((c) => [c._id, c.n]));
        return {
          items: items.map((s) => ({ ...s, itemCount: byStatus.get(s.id) ?? 0 })),
          max: MAX_STATUSES,
        };
      });
    },
  );

  r.post(
    '/spaces/:id/statuses',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().min(1).max(64) }),
        body: z.object({
          name: nameSchema,
          category: categorySchema,
          color: colorSchema.default('slate'),
          wipLimit: wipSchema.optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          const space = await resolveSpace(tx, actor, req.params.id);
          guardManage(actor, space);
          await lockSpace(tx, space.id);
          const existing = await listStatuses(tx, space.id);
          if (existing.length >= MAX_STATUSES) {
            throw new AppError(
              409,
              'status_limit',
              `A space can have at most ${MAX_STATUSES} statuses`,
            );
          }
          // New statuses go at the end of their category so the board reads To do, In progress, Done.
          const order = ['todo', 'in_progress', 'done'] as const;
          const lastOfCategory = [...existing]
            .filter((s) => order.indexOf(s.category) <= order.indexOf(b.category))
            .at(-1);
          const position = lastOfCategory ? lastOfCategory.position + 1 : 0;
          await tx.spaceStatuses.updateMany(
            { spaceId: space.id, position: { $gte: position } },
            { $inc: { position: 1 } },
          );
          const created = await tx.spaceStatuses.insert({
            spaceId: space.id,
            name: b.name,
            category: b.category,
            position,
            color: b.color,
            wipLimit: b.wipLimit ?? null,
          });
          return { ...present(created), itemCount: 0 };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  r.patch(
    '/statuses/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            name: nameSchema,
            color: colorSchema,
            category: categorySchema,
            wipLimit: wipSchema,
          })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          const { status, space } = await loadStatus(tx, actor, req.params.id);
          guardManage(actor, space);
          if (b.category && b.category !== status.category) {
            if ((await categoryCount(tx, space.id, status.category)) <= 1) {
              throw new AppError(
                422,
                'last_in_category',
                'Every space needs at least one status in each category',
                { category: 'This is the only status in its category' },
              );
            }
          }
          const updated = await tx.spaceStatuses.findOneAndUpdate(
            { id: status.id },
            {
              ...(b.name !== undefined ? { name: b.name } : {}),
              ...(b.color !== undefined ? { color: b.color } : {}),
              ...(b.category !== undefined ? { category: b.category } : {}),
              ...(b.wipLimit !== undefined ? { wipLimit: b.wipLimit } : {}),
            },
          );
          // Moving a status between categories changes what its items mean: keep resolvedAt honest.
          if (b.category && b.category !== status.category) {
            const now = new Date();
            await tx.workItems.updateMany(
              {
                statusId: status.id,
                ...(b.category === 'done' ? { resolvedAt: null } : {}),
              },
              { resolvedAt: b.category === 'done' ? now : null },
            );
          }
          return { ...present(updated!), itemCount: await liveCount(tx, status.id) };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  r.delete(
    '/statuses/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ replace_with: z.string().uuid().optional() }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { status, space } = await loadStatus(tx, actor, req.params.id);
        guardManage(actor, space);
        await lockSpace(tx, space.id);
        if ((await categoryCount(tx, space.id, status.category)) <= 1) {
          throw new AppError(
            422,
            'last_in_category',
            'Every space needs at least one status in each category',
          );
        }
        const live = await liveCount(tx, status.id);
        const all = await tx.workItems.count({ statusId: status.id });
        let moved = 0;
        if (all > 0) {
          const others = (await listStatuses(tx, space.id)).filter((s) => s.id !== status.id);
          let target = others.find((s) => s.id === req.query.replace_with);
          if (req.query.replace_with && !target) {
            throw new AppError(422, 'invalid_replacement', 'Choose another status in this space');
          }
          if (!target) {
            if (live > 0) {
              throw new AppError(
                422,
                'replacement_required',
                'Choose a status to move this status’s items to',
              );
            }
            // Only deleted items remain; they still need a home to keep their history.
            target = others.find((s) => s.category === status.category) ?? others[0]!;
          }
          const rows = await tx.workItems.find(
            { statusId: status.id },
            { sort: byRank, projection: { id: 1, resolvedAt: 1 } },
          );
          const ranks = await ranksAtEnd(tx, space.id, target.id, rows.length);
          const now = new Date();
          for (const [i, row] of rows.entries()) {
            await tx.workItems.updateOne(
              { id: row.id },
              {
                statusId: target.id,
                rank: ranks[i]!,
                resolvedAt: resolvedAtFor(target.category, row.resolvedAt, now),
                updatedAt: now,
              },
            );
          }
          moved = rows.length;
        }
        await tx.spaceStatuses.deleteOne({ id: status.id });
        const remaining = await listStatuses(tx, space.id);
        for (const [i, s] of remaining.entries()) {
          if (s.position !== i) await tx.spaceStatuses.updateOne({ id: s.id }, { position: i });
        }
        return { deleted: true, moved };
      });
    },
  );

  r.put(
    '/spaces/:id/statuses/order',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().min(1).max(64) }),
        body: z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_STATUSES) }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        guardManage(actor, space);
        const current = await listStatuses(tx, space.id);
        const ids = req.body.ids;
        const sameSet =
          ids.length === current.length &&
          new Set(ids).size === ids.length &&
          current.every((s) => ids.includes(s.id));
        if (!sameSet) {
          throw new AppError(422, 'invalid_order', 'List every status in the space exactly once');
        }
        for (const [i, id] of ids.entries()) {
          await tx.spaceStatuses.updateOne({ id, spaceId: space.id }, { position: i });
        }
        liveTouch({ orgId: actor.orgId, spaceId: space.id, kind: 'statuses' });
        return { items: await listStatuses(tx, space.id) };
      });
    },
  );
}
