import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant } from '../db/client.js';
import { auditLogs, users } from '../db/schema.js';
import { forbidden } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
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
          targetType: z.enum(['member', 'invitation']).optional(),
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
      const conds: (SQL | undefined)[] = [eq(auditLogs.orgId, actor.orgId)];
      if (q.actor) conds.push(eq(auditLogs.actorId, q.actor));
      if (q.action) conds.push(eq(auditLogs.action, q.action));
      if (q.targetType) conds.push(eq(auditLogs.targetType, q.targetType));
      if (q.target) conds.push(eq(auditLogs.targetId, q.target));
      if (q.from) conds.push(gte(auditLogs.createdAt, q.from));
      // "to" is a date: include the whole day.
      if (q.to) conds.push(lt(auditLogs.createdAt, new Date(q.to.getTime() + 24 * 3600 * 1000)));
      const where = and(...conds);

      return withTenant(deps.db, actor.orgId, async (tx) => {
        const items = await tx
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            targetType: auditLogs.targetType,
            targetId: auditLogs.targetId,
            before: auditLogs.before,
            after: auditLogs.after,
            createdAt: auditLogs.createdAt,
            actorId: auditLogs.actorId,
            actorName: users.name,
            actorEmail: users.email,
          })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorId))
          .where(where)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(where);
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
      });
    },
  );
}
