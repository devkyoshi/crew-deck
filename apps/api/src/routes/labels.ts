import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { STATUS_COLORS } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
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
      const rows = await tx.labels.find({ spaceId: space.id }, { sort: { nameLower: 1 } });
      // How many live items carry each label.
      const counts = await tx.workItems.aggregate<{ _id: string; n: number }>([
        { $match: { spaceId: space.id, deletedAt: null, labelIds: { $ne: [] } } },
        { $unwind: '$labelIds' },
        { $group: { _id: '$labelIds', n: { $sum: 1 } } },
      ]);
      const byLabel = new Map(counts.map((c) => [c._id, c.n]));
      return {
        items: rows.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
          itemCount: byLabel.get(l.id) ?? 0,
        })),
      };
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
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          const space = await resolveSpace(tx, actor, req.params.id);
          if (!can(actor, 'label.create', spaceCtx(space))) throw forbidden();
          assertWritable(space);
          if ((await tx.labels.count({ spaceId: space.id })) >= MAX_LABELS) {
            throw new AppError(409, 'label_limit', `A space can have at most ${MAX_LABELS} labels`);
          }
          const created = await tx.labels.insert({
            spaceId: space.id,
            name: req.body.name,
            color: req.body.color,
          });
          return { id: created.id, name: created.name, color: created.color, itemCount: 0 };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  async function loadLabel(tx: TenantDb, actor: Actor, id: string) {
    const label = await tx.labels.get(id);
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
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          const label = await loadLabel(tx, actor, req.params.id);
          const updated = await tx.labels.findOneAndUpdate(
            { id: label.id },
            {
              ...(req.body.name !== undefined ? { name: req.body.name } : {}),
              ...(req.body.color !== undefined ? { color: req.body.color } : {}),
            },
          );
          return { id: updated!.id, name: updated!.name, color: updated!.color };
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const label = await loadLabel(tx, actor, req.params.id);
        // The label is embedded in items, so deleting it also removes it from every item (the old cascade).
        const removedFrom = await tx.workItems.updateMany(
          { labelIds: label.id },
          { $pull: { labelIds: label.id } } as never,
        );
        await tx.labels.deleteOne({ id: label.id });
        return { deleted: true, removedFrom };
      });
    },
  );
}
