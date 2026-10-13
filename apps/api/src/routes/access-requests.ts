import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { memberships, spaceAccessRequests, spaceMembers, spaces, users } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { effectiveRoleSql } from '../spaces/access.js';
import { isOrgAdmin, resolveSpace, spaceCtx } from './spaces.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = z.object({ id: z.string().uuid() });
const spaceParam = z.object({ id: z.string().min(1).max(64) });

/** Identical for every outcome, so the form cannot be used to find out which private spaces exist. */
const SENT = {
  ok: true,
  message:
    'If that space exists and is private, its admins have been asked to review your request.',
} as const;

export async function accessRequestRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/spaces/:id/access-requests',
    {
      preHandler: requireAuth,
      schema: {
        params: spaceParam,
        body: z.object({ message: z.string().trim().max(500).optional() }).default({}),
      },
      // Keyed by session so one person cannot probe keys quickly.
      config: {
        rateLimit: {
          max: Math.max(20, deps.config.AUTH_RATE_LIMIT_MAX * 2),
          timeWindow: '1 hour',
          keyGenerator: (req: { cookies?: Record<string, string | undefined>; ip: string }) =>
            `access-request:${req.cookies?.cd_session ?? req.ip}`,
        },
      },
    },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        const myRole = effectiveRoleSql(actor.userId, actor.orgId);
        const param = req.params.id;
        const [space] = await tx
          .select({ id: spaces.id, role: myRole })
          .from(spaces)
          .where(
            and(
              eq(spaces.orgId, actor.orgId),
              sql`${spaces.deletedAt} is null`,
              eq(spaces.visibility, 'private'),
              eq(spaces.status, 'active'),
              UUID.test(param) ? eq(spaces.id, param) : eq(spaces.key, param.toUpperCase()),
            ),
          );
        // Missing, open, archived, already a member, or an org admin: all look the same to the caller.
        if (!space || space.role || isOrgAdmin(actor)) return;
        const pending = await tx
          .select({ id: spaceAccessRequests.id })
          .from(spaceAccessRequests)
          .where(
            and(
              eq(spaceAccessRequests.spaceId, space.id),
              eq(spaceAccessRequests.userId, actor.userId),
              eq(spaceAccessRequests.status, 'pending'),
            ),
          );
        if (pending.length) return;
        const [created] = await tx
          .insert(spaceAccessRequests)
          .values({
            orgId: actor.orgId,
            spaceId: space.id,
            userId: actor.userId,
            message: req.body.message || null,
          })
          .returning({ id: spaceAccessRequests.id });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.access_requested',
          targetType: 'space',
          targetId: space.id,
          after: { requestId: created!.id },
        });
      });
      return SENT;
    },
  );

  r.get(
    '/access-requests',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          status: z
            .enum(['pending', 'approved', 'declined', 'cancelled', 'all'])
            .default('pending'),
          mine: z.enum(['true', 'false']).default('false'),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      const mine = q.mine === 'true';
      const role = effectiveRoleSql(actor.userId, actor.orgId);
      const conds: (SQL | undefined)[] = [eq(spaceAccessRequests.orgId, actor.orgId)];
      if (q.status !== 'all') conds.push(eq(spaceAccessRequests.status, q.status));
      if (mine) {
        conds.push(eq(spaceAccessRequests.userId, actor.userId));
      } else if (!isOrgAdmin(actor)) {
        // The inbox only holds requests for spaces the caller administers.
        conds.push(sql`${role} = 'admin'`, sql`${spaces.deletedAt} is null`);
      }
      const where = and(...conds);

      return withTenant(deps.db, actor.orgId, async (tx) => {
        const rows = await tx
          .select({
            id: spaceAccessRequests.id,
            status: spaceAccessRequests.status,
            message: spaceAccessRequests.message,
            grantedRole: spaceAccessRequests.grantedRole,
            createdAt: spaceAccessRequests.createdAt,
            decidedAt: spaceAccessRequests.decidedAt,
            requesterId: users.id,
            requesterName: users.name,
            requesterEmail: users.email,
            requesterAvatar: users.avatarUrl,
            spaceId: spaces.id,
            spaceKey: spaces.key,
            spaceName: spaces.name,
            spaceIcon: spaces.icon,
            decidedByName: sql<string | null>`(select d.name from users d where d.id = decided_by)`,
          })
          .from(spaceAccessRequests)
          .innerJoin(spaces, eq(spaces.id, spaceAccessRequests.spaceId))
          .innerJoin(users, eq(users.id, spaceAccessRequests.userId))
          .where(where)
          .orderBy(desc(spaceAccessRequests.createdAt), desc(spaceAccessRequests.id))
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(spaceAccessRequests)
          .innerJoin(spaces, eq(spaces.id, spaceAccessRequests.spaceId))
          .where(where);
        return {
          // People only learn the key they asked for, never the name of a space they cannot see.
          items: rows.map((x) => ({
            id: x.id,
            status: x.status,
            message: x.message,
            grantedRole: x.grantedRole,
            createdAt: x.createdAt,
            decidedAt: x.decidedAt,
            requesterId: x.requesterId,
            requesterName: x.requesterName,
            requesterEmail: x.requesterEmail,
            requesterAvatar: x.requesterAvatar,
            spaceKey: x.spaceKey,
            spaceId: mine ? null : x.spaceId,
            spaceName: mine ? null : x.spaceName,
            spaceIcon: mine ? null : x.spaceIcon,
            decidedByName: x.decidedByName,
          })),
          total: count?.n ?? 0,
          page: q.page,
          pageSize: q.pageSize,
        };
      });
    },
  );

  async function loadForDecision(tx: Tx, actor: Actor, id: string) {
    const [request] = await tx
      .select()
      .from(spaceAccessRequests)
      .where(and(eq(spaceAccessRequests.id, id), eq(spaceAccessRequests.orgId, actor.orgId)));
    if (!request) throw notFound('Request');
    // resolveSpace 404s for anyone who cannot see the space, so outsiders learn nothing.
    const space = await resolveSpace(tx, actor, request.spaceId);
    if (!can(actor, 'accessRequest.approve', spaceCtx(space))) throw forbidden();
    if (request.status !== 'pending') {
      throw new AppError(409, 'not_pending', 'This request has already been handled');
    }
    return { request, space };
  }

  r.post(
    '/access-requests/:id/approve',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z
          .object({ role: z.enum(['admin', 'member', 'viewer']).default('member') })
          .default({ role: 'member' }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { request, space } = await loadForDecision(tx, actor, req.params.id);
        if (space.status === 'archived') {
          throw new AppError(409, 'archived', 'Restore this space before adding people to it');
        }
        const [person] = await tx
          .select({ status: memberships.status })
          .from(memberships)
          .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, request.userId)));
        if (!person || person.status !== 'active') {
          throw new AppError(
            409,
            'requester_inactive',
            'This person is no longer an active member',
          );
        }
        const role = req.body.role;
        const inserted = await tx
          .insert(spaceMembers)
          .values({
            spaceId: space.id,
            orgId: actor.orgId,
            principalType: 'user',
            principalId: request.userId,
            spaceRole: role,
          })
          .onConflictDoNothing()
          .returning({ id: spaceMembers.id });
        await tx
          .update(spaceAccessRequests)
          .set({
            status: 'approved',
            decidedBy: actor.userId,
            decidedAt: new Date(),
            grantedRole: role,
          })
          .where(
            and(eq(spaceAccessRequests.id, request.id), eq(spaceAccessRequests.orgId, actor.orgId)),
          );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.access_approved',
          targetType: 'space',
          targetId: space.id,
          after: { requestId: request.id, userId: request.userId, role },
        });
        if (inserted.length) {
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'space.member_added',
            targetType: 'space',
            targetId: space.id,
            after: {
              principalType: 'user',
              principalId: request.userId,
              role,
              viaRequest: request.id,
            },
          });
        }
        return { ok: true, role };
      });
    },
  );

  r.post(
    '/access-requests/:id/decline',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z.object({ reason: z.string().trim().max(300).optional() }).default({}),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { request, space } = await loadForDecision(tx, actor, req.params.id);
        await tx
          .update(spaceAccessRequests)
          .set({ status: 'declined', decidedBy: actor.userId, decidedAt: new Date() })
          .where(
            and(eq(spaceAccessRequests.id, request.id), eq(spaceAccessRequests.orgId, actor.orgId)),
          );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.access_declined',
          targetType: 'space',
          targetId: space.id,
          after: {
            requestId: request.id,
            userId: request.userId,
            ...(req.body.reason ? { reason: req.body.reason } : {}),
          },
        });
        return { ok: true };
      });
    },
  );

  // Requesters can withdraw their own pending request.
  r.post(
    '/access-requests/:id/cancel',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const [request] = await tx
          .select()
          .from(spaceAccessRequests)
          .where(
            and(
              eq(spaceAccessRequests.id, req.params.id),
              eq(spaceAccessRequests.orgId, actor.orgId),
              eq(spaceAccessRequests.userId, actor.userId),
            ),
          );
        if (!request) throw notFound('Request');
        if (request.status !== 'pending') {
          throw new AppError(409, 'not_pending', 'This request has already been handled');
        }
        await tx
          .update(spaceAccessRequests)
          .set({ status: 'cancelled', decidedAt: new Date() })
          .where(
            and(eq(spaceAccessRequests.id, request.id), eq(spaceAccessRequests.orgId, actor.orgId)),
          );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.access_cancelled',
          targetType: 'space',
          targetId: request.spaceId,
          after: { requestId: request.id },
        });
        return { ok: true };
      });
    },
  );
}
