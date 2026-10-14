import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { STATUS_COLORS } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { labels, workItemLabels } from '../db/schema.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWritable } from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const MAX_LABELS = 100;
const nameSchema = z.string().trim().min(1, 'Enter a name').max(40, 'Use 40 characters or fewer');
const colorSchema = z.enum(STATUS_COLORS);
const nameTaken = () =>
  new AppError(409, 'name_taken', 'A label with that name already exists in this space', {
    name: 'A label with that name already exists',
  });

export async function labelRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const spaceParam = z.object({ id: z.string().min(1).max(64) });

  r.get('/spaces/:id/labels', { preHandler: requireAuth, schema: { params: spaceParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const space = await resolveSpace(tx, actor, req.params.id);
      const rows = await tx
        .select({
          id: labels.id,
          name: labels.name,
          color: labels.color,
          itemCount: sql<number>`(select count(*)::int from work_item_labels wl
            join work_items w on w.id = wl.work_item_id
            where wl.label_id = ${labels.id} and w.deleted_at is null)`,
        })
        .from(labels)
        .where(eq(labels.spaceId, space.id))
        .orderBy(asc(sql`lower(${labels.name})`));
      return { items: rows };
    });
  });

  r.post(
    '/spaces/:id/labels',
    {
      preHandler: requireAuth,
      schema: {
        params: spaceParam,
        body: z.object({ name: nameSchema, color: colorSchema.default('slate') }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      try {
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const space = await resolveSpace(tx, actor, req.params.id);
          if (!can(actor, 'label.create', spaceCtx(space))) throw forbidden();
          assertWritable(space);
          const [n] = await tx.select({ n: count() }).from(labels).where(eq(labels.spaceId, space.id));
          if ((n?.n ?? 0) >= MAX_LABELS) {
            throw new AppError(409, 'label_limit', `A space can have at most ${MAX_LABELS} labels`);
          }
          const [created] = await tx
            .insert(labels)
            .values({ orgId: actor.orgId, spaceId: space.id, name: req.body.name, color: req.body.color })
            .returning({ id: labels.id, name: labels.name, color: labels.color });
          return { ...created!, itemCount: 0 };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  async function loadLabel(tx: Tx, actor: Actor, id: string) {
    const [label] = await tx
      .select()
      .from(labels)
      .where(and(eq(labels.id, id), eq(labels.orgId, actor.orgId)));
    if (!label) throw notFound('Label');
    const space = await resolveSpace(tx, actor, label.spaceId).catch(() => null);
    if (!space) throw notFound('Label');
    if (!can(actor, 'label.manage', spaceCtx(space))) throw forbidden();
    assertWritable(space);
    return label;
  }

  r.patch(
    '/labels/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({ name: nameSchema, color: colorSchema })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      try {
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const label = await loadLabel(tx, actor, req.params.id);
          const [updated] = await tx
            .update(labels)
            .set({
              ...(req.body.name !== undefined ? { name: req.body.name } : {}),
              ...(req.body.color !== undefined ? { color: req.body.color } : {}),
            })
            .where(eq(labels.id, label.id))
            .returning({ id: labels.id, name: labels.name, color: labels.color });
          return updated!;
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  r.delete(
    '/labels/:id',
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const label = await loadLabel(tx, actor, req.params.id);
        const [used] = await tx
          .select({ n: count() })
          .from(workItemLabels)
          .where(eq(workItemLabels.labelId, label.id));
        await tx.delete(labels).where(eq(labels.id, label.id));
        return { deleted: true, removedFrom: used?.n ?? 0 };
      });
    },
  );
}
