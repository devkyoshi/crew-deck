import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx } from '../db/client.js';
import type { GadgetDoc } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { resolveSpace } from './spaces.js';

const MAX_GADGETS = 12;
const gadget = z.object({
  id: z.string().min(1).max(64).default(() => randomUUID()),
  type: z.enum(['assigned', 'filter', 'sprint', 'versions', 'flow']),
  spaceId: z.string().uuid().nullable().default(null),
  filterId: z.string().uuid().nullable().default(null),
});

const DEFAULT: GadgetDoc[] = [{ id: 'assigned', type: 'assigned', spaceId: null, filterId: null }];

/**
 * A person's own dashboard layout. Only the choice of tiles is stored; what a tile shows is read from
 * the usual endpoints when the page opens, so it always follows the person's current access.
 */
export async function dashboardRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/me/dashboard', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const row = await t.dashboards.findOne({ userId: actor.userId });
      return { gadgets: row?.gadgets ?? DEFAULT, custom: !!row };
    });
  });

  r.put(
    '/me/dashboard',
    { preHandler: requireAuth, schema: { body: z.object({ gadgets: z.array(gadget).max(MAX_GADGETS) }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const gadgets = req.body.gadgets;
        if (new Set(gadgets.map((g) => g.id)).size !== gadgets.length) {
          throw new AppError(422, 'invalid_gadgets', 'Each tile needs its own id');
        }
        for (const g of gadgets) {
          if (g.type !== 'assigned' && g.type !== 'filter' && !g.spaceId) {
            throw new AppError(422, 'invalid_gadgets', 'Choose a space for that tile', { gadgets: 'Choose a space' });
          }
          if (g.type === 'filter' && !g.filterId) {
            throw new AppError(422, 'invalid_gadgets', 'Choose a saved filter for that tile', { gadgets: 'Choose a filter' });
          }
          // Only spaces the person can open can be pinned.
          if (g.spaceId) {
            await resolveSpace(t, actor, g.spaceId).catch(() => {
              throw new AppError(422, 'invalid_gadgets', 'You cannot open that space', { gadgets: 'Choose a space you can open' });
            });
          }
        }
        await t.dashboards.upsert({ userId: actor.userId }, { gadgets, updatedAt: new Date() } as never);
        return { gadgets, custom: true };
      });
    },
  );

  r.delete('/me/dashboard', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      await t.dashboards.deleteMany({ userId: actor.userId });
      return { gadgets: DEFAULT, custom: false };
    });
  });
}
