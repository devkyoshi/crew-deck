import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_STATUSES, STATUS_CATEGORIES, STATUS_COLORS } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { spaceStatuses, workItems } from '../db/schema.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWritable, listStatuses, ranksAtEnd, resolvedAtFor } from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

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
  async function loadStatus(tx: Tx, actor: Actor, id: string) {
    const [status] = await tx
      .select()
      .from(spaceStatuses)
      .where(and(eq(spaceStatuses.id, id), eq(spaceStatuses.orgId, actor.orgId)));
    if (!status) throw notFound('Status');
    const space = await resolveSpace(tx, actor, status.spaceId).catch(() => null);
    if (!space) throw notFound('Status');
    return { status, space };
  }

  const guardManage = (actor: Actor, space: Awaited<ReturnType<typeof resolveSpace>>) => {
    if (!can(actor, 'status.manage', spaceCtx(space))) throw forbidden();
    assertWritable(space);
  };

  /** Statuses must keep at least one entry in each category. */
  async function categoryCount(tx: Tx, spaceId: string, category: string) {
    const [row] = await tx
      .select({ n: count() })
      .from(spaceStatuses)
      .where(and(eq(spaceStatuses.spaceId, spaceId), eq(spaceStatuses.category, category as 'todo')));
    return row?.n ?? 0;
  }

  r.get(
    '/spaces/:id/statuses',
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        const items = await listStatuses(tx, space.id);
        const counts = await tx
          .select({ statusId: workItems.statusId, n: count() })
          .from(workItems)
          .where(and(eq(workItems.spaceId, space.id), isNull(workItems.deletedAt)))
          .groupBy(workItems.statusId);
        const byStatus = new Map(counts.map((c) => [c.statusId, c.n]));
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const space = await resolveSpace(tx, actor, req.params.id);
          guardManage(actor, space);
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
          await tx
            .update(spaceStatuses)
            .set({ position: sql`${spaceStatuses.position} + 1` })
            .where(
              and(eq(spaceStatuses.spaceId, space.id), sql`${spaceStatuses.position} >= ${position}`),
            );
          const [created] = await tx
            .insert(spaceStatuses)
            .values({
              orgId: actor.orgId,
              spaceId: space.id,
              name: b.name,
              category: b.category,
              position,
              color: b.color,
              wipLimit: b.wipLimit ?? null,
            })
            .returning();
          return { ...created!, itemCount: 0 };
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
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
          const [updated] = await tx
            .update(spaceStatuses)
            .set({
              ...(b.name !== undefined ? { name: b.name } : {}),
              ...(b.color !== undefined ? { color: b.color } : {}),
              ...(b.category !== undefined ? { category: b.category } : {}),
              ...(b.wipLimit !== undefined ? { wipLimit: b.wipLimit } : {}),
            })
            .where(eq(spaceStatuses.id, status.id))
            .returning();
          // Moving a status between categories changes what its items mean: keep resolved_at honest.
          if (b.category && b.category !== status.category) {
            const now = new Date();
            await tx
              .update(workItems)
              .set({ resolvedAt: b.category === 'done' ? now : null })
              .where(
                and(
                  eq(workItems.statusId, status.id),
                  b.category === 'done' ? isNull(workItems.resolvedAt) : undefined,
                ),
              );
          }
          const [n] = await tx
            .select({ n: count() })
            .from(workItems)
            .where(and(eq(workItems.statusId, status.id), isNull(workItems.deletedAt)));
          return { ...updated!, itemCount: n?.n ?? 0 };
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { status, space } = await loadStatus(tx, actor, req.params.id);
        guardManage(actor, space);
        if ((await categoryCount(tx, space.id, status.category)) <= 1) {
          throw new AppError(
            422,
            'last_in_category',
            'Every space needs at least one status in each category',
          );
        }
        const [live] = await tx
          .select({ n: count() })
          .from(workItems)
          .where(and(eq(workItems.statusId, status.id), isNull(workItems.deletedAt)));
        const [all] = await tx
          .select({ n: count() })
          .from(workItems)
          .where(eq(workItems.statusId, status.id));
        let moved = 0;
        if ((all?.n ?? 0) > 0) {
          const others = (await listStatuses(tx, space.id)).filter((s) => s.id !== status.id);
          let target = others.find((s) => s.id === req.query.replace_with);
          if (req.query.replace_with && !target) {
            throw new AppError(422, 'invalid_replacement', 'Choose another status in this space');
          }
          if (!target) {
            if ((live?.n ?? 0) > 0) {
              throw new AppError(
                422,
                'replacement_required',
                'Choose a status to move this status’s items to',
              );
            }
            // Only deleted items remain; they still need a home to keep their history.
            target = others.find((s) => s.category === status.category) ?? others[0]!;
          }
          const rows = await tx
            .select({ id: workItems.id, resolvedAt: workItems.resolvedAt })
            .from(workItems)
            .where(eq(workItems.statusId, status.id))
            .orderBy(sql`${workItems.rank} COLLATE "C" asc`, asc(workItems.id));
          const ranks = await ranksAtEnd(tx, space.id, target.id, rows.length);
          const now = new Date();
          for (const [i, row] of rows.entries()) {
            await tx
              .update(workItems)
              .set({
                statusId: target.id,
                rank: ranks[i]!,
                resolvedAt: resolvedAtFor(target.category, row.resolvedAt, now),
                updatedAt: now,
              })
              .where(eq(workItems.id, row.id));
          }
          moved = rows.length;
        }
        await tx.delete(spaceStatuses).where(eq(spaceStatuses.id, status.id));
        const remaining = await listStatuses(tx, space.id);
        for (const [i, s] of remaining.entries()) {
          if (s.position !== i) {
            await tx.update(spaceStatuses).set({ position: i }).where(eq(spaceStatuses.id, s.id));
          }
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
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
          await tx
            .update(spaceStatuses)
            .set({ position: i })
            .where(and(eq(spaceStatuses.id, id), eq(spaceStatuses.spaceId, space.id)));
        }
        return { items: await listStatuses(tx, space.id) };
      });
    },
  );
}
