import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { effectiveRole, effectiveRoles } from '../spaces/access.js';
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
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        const param = req.params.id;
        const space = await tx.spaces.findOne({
          deletedAt: null,
          visibility: 'private',
          status: 'active',
          ...(UUID.test(param) ? { id: param } : { key: param.toUpperCase() }),
        });
        // Missing, open, archived, already a member, or an org admin: all look the same to the caller.
        if (!space || isOrgAdmin(actor)) return;
        if (await effectiveRole(tx, actor.userId, space.id)) return;
        if (
          await tx.spaceAccessRequests.exists({
            spaceId: space.id,
            userId: actor.userId,
            status: 'pending',
          })
        ) {
          return;
        }
        const created = await tx.spaceAccessRequests.insert({
          spaceId: space.id,
          userId: actor.userId,
          message: req.body.message || null,
        });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.access_requested',
          targetType: 'space',
          targetId: space.id,
          after: { requestId: created.id },
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
      const filter: Record<string, unknown> = {};
      if (q.status !== 'all') filter.status = q.status;
      if (mine) filter.userId = actor.userId;

      return withTenant(deps.db, actor.orgId, async (tx) => {
        let requests = await tx.spaceAccessRequests.find(filter, {
          sort: { createdAt: -1, id: -1 },
        });
        const spaceDocs = await tx.spaces.find({
          id: { $in: [...new Set(requests.map((x) => x.spaceId))] },
        });
        const spaceById = new Map(spaceDocs.map((s) => [s.id, s]));
        // A request whose space is gone is not shown.
        requests = requests.filter((x) => spaceById.has(x.spaceId));
        if (!mine && !isOrgAdmin(actor)) {
          // The inbox only holds requests for spaces the caller administers.
          const roles = await effectiveRoles(tx, actor.userId, [...spaceById.keys()]);
          requests = requests.filter(
            (x) => roles.get(x.spaceId) === 'admin' && spaceById.get(x.spaceId)!.deletedAt === null,
          );
        }
        const total = requests.length;
        const page = requests.slice(offsetOf(q), offsetOf(q) + q.pageSize);
        const people = await tx.users([
          ...page.map((x) => x.userId),
          ...page.map((x) => x.decidedBy).filter((x): x is string => !!x),
        ]);
        return {
          // People only learn the key they asked for, never the name of a space they cannot see.
          items: page.map((x) => {
            const space = spaceById.get(x.spaceId)!;
            const who = people.get(x.userId);
            return {
              id: x.id,
              status: x.status,
              message: x.message,
              grantedRole: x.grantedRole,
              createdAt: x.createdAt,
              decidedAt: x.decidedAt,
              requesterId: x.userId,
              requesterName: who?.name ?? null,
              requesterEmail: who?.email ?? '',
              requesterAvatar: who?.avatarUrl ?? null,
              spaceKey: space.key,
              spaceId: mine ? null : space.id,
              spaceName: mine ? null : space.name,
              spaceIcon: mine ? null : space.icon,
              decidedByName: x.decidedBy ? (people.get(x.decidedBy)?.name ?? null) : null,
            };
          }),
          total,
          page: q.page,
          pageSize: q.pageSize,
        };
      });
    },
  );

  async function loadForDecision(tx: TenantDb, actor: Actor, id: string) {
    const request = await tx.spaceAccessRequests.get(id);
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { request, space } = await loadForDecision(tx, actor, req.params.id);
        if (space.status === 'archived') {
          throw new AppError(409, 'archived', 'Restore this space before adding people to it');
        }
        const person = await tx.memberships.findOne({ userId: request.userId });
        if (!person || person.status !== 'active') {
          throw new AppError(
            409,
            'requester_inactive',
            'This person is no longer an active member',
          );
        }
        const role = req.body.role;
        const inserted = await tx.spaceMembers.insertIgnore({
          spaceId: space.id,
          principalType: 'user',
          principalId: request.userId,
          spaceRole: role,
        });
        await tx.spaceAccessRequests.updateOne(
          { id: request.id },
          { status: 'approved', decidedBy: actor.userId, decidedAt: new Date(), grantedRole: role },
        );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.access_approved',
          targetType: 'space',
          targetId: space.id,
          after: { requestId: request.id, userId: request.userId, role },
        });
        if (inserted) {
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const { request, space } = await loadForDecision(tx, actor, req.params.id);
        await tx.spaceAccessRequests.updateOne(
          { id: request.id },
          { status: 'declined', decidedBy: actor.userId, decidedAt: new Date() },
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const request = await tx.spaceAccessRequests.findOne({
          id: req.params.id,
          userId: actor.userId,
        });
        if (!request) throw notFound('Request');
        if (request.status !== 'pending') {
          throw new AppError(409, 'not_pending', 'This request has already been handled');
        }
        await tx.spaceAccessRequests.updateOne(
          { id: request.id },
          { status: 'cancelled', decidedAt: new Date() },
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
