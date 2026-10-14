import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant } from '../db/client.js';
import { AUDIT_TARGET_TYPES, listAudit } from '../audit/service.js';
import { auditFloor, loadPlan } from '../plans/index.js';
import { forbidden } from '../lib/errors.js';
import { pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';

export async function auditRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);

  app.withTypeProvider<ZodTypeProvider>().get(
    '/audit-logs',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          actor: z.string().uuid().optional(),
          action: z.string().max(100).optional(),
          targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
          target: z.string().max(100).optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'audit.viewOrg')) throw forbidden();
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        // The plan decides how far back the log can be read; older entries are kept, not shown.
        const floor = auditFloor(await loadPlan(tx, actor.orgId));
        const from = floor && (!q.from || q.from < floor) ? floor : q.from;
        return listAudit(tx, { ...q, from, orgId: actor.orgId });
      });
    },
  );
}
