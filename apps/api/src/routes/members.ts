import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { orgRoleSchema, type OrgRole } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { timezoneSchema } from '../auth/routes.js';
import { withTenant, type Tx } from '../db/client.js';
import { groupMembers, groups, memberships, users } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { likePattern, offsetOf, pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';

const effectiveStatus = sql<
  'active' | 'invited' | 'deactivated'
>`case when ${memberships.status} = 'deactivated' then 'deactivated' else ${users.status} end`;

const columns = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
  jobTitle: users.jobTitle,
  timezone: users.timezone,
  orgRole: memberships.orgRole,
  crmRole: memberships.crmRole,
  status: effectiveStatus,
  lastLoginAt: users.lastLoginAt,
  joinedAt: memberships.createdAt,
  reportsTo: memberships.reportsTo,
  reportsToName: sql<
    string | null
  >`(select coalesce(mu.name, mu.email) from users mu where mu.id = ${memberships.reportsTo})`,
};

const SORTS = {
  name: sql`lower(coalesce(${users.name}, ${users.email}))`,
  email: sql`lower(${users.email})`,
  role: memberships.orgRole,
  status: effectiveStatus,
  lastLoginAt: users.lastLoginAt,
  joinedAt: memberships.createdAt,
} as const;

const listQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  role: orgRoleSchema.optional(),
  status: z.enum(['active', 'invited', 'deactivated']).optional(),
  sort: z.enum(['name', 'email', 'role', 'status', 'lastLoginAt', 'joinedAt']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

const idParam = z.object({ id: z.string().uuid() });

const patchBody = z
  .object({
    orgRole: orgRoleSchema,
    reportsTo: z.string().uuid().nullable(),
    crmRole: z.enum(['none', 'viewer', 'member', 'admin']),
    name: z.string().trim().min(1).max(100),
    jobTitle: z.string().trim().max(100).nullable(),
    timezone: timezoneSchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Active owners in the tenant, used to protect the last one. */
async function activeOwnerCount(tx: Tx, orgId: string) {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.orgRole, 'owner'),
        eq(memberships.status, 'active'),
      ),
    );
  return rows[0]?.n ?? 0;
}

async function loadTarget(tx: Tx, orgId: string, userId: string) {
  const rows = await tx
    .select({ ...columns, membershipId: memberships.id, membershipStatus: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(users.id, userId)));
  const row = rows[0];
  if (!row) throw notFound('Member');
  return row;
}

export async function memberRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // The directory is visible to every member; admin-only fields are stripped for others.
  const present = <T extends { lastLoginAt: Date | null; status: string }>(
    isAdmin: boolean,
    row: T,
  ) => (isAdmin ? row : { ...row, lastLoginAt: null });

  r.get(
    '/members',
    { preHandler: requireAuth, schema: { querystring: listQuery } },
    async (req) => {
      const actor = actorOf(req);
      const isAdmin = can(actor, 'member.deactivate');
      const q = req.query;
      const conds: (SQL | undefined)[] = [eq(memberships.orgId, actor.orgId)];
      if (q.q) {
        const p = likePattern(q.q);
        conds.push(or(ilike(users.name, p), ilike(users.email, p), ilike(users.jobTitle, p)));
      }
      if (q.role) conds.push(eq(memberships.orgRole, q.role));
      // Non-admins only ever see active people.
      const status = isAdmin ? q.status : 'active';
      if (status) conds.push(sql`${effectiveStatus} = ${status}`);
      const where = and(...conds);
      const order = (q.dir === 'desc' ? desc : asc)(SORTS[q.sort]);

      const { items, total } = await withTenant(deps.db, actor.orgId, async (tx) => {
        const items = await tx
          .select(columns)
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(where)
          .orderBy(order, asc(users.id))
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(where);
        return { items, total: count?.n ?? 0 };
      });
      return {
        items: items.map((i) => present(isAdmin, i)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  r.get('/members/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    const isAdmin = can(actor, 'member.deactivate');
    const { row, memberGroups } = await withTenant(deps.db, actor.orgId, async (tx) => {
      const row = await loadTarget(tx, actor.orgId, req.params.id);
      const memberGroups = await tx
        .select({ id: groups.id, name: groups.name })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(and(eq(groupMembers.orgId, actor.orgId), eq(groupMembers.userId, row.id)))
        .orderBy(asc(sql`lower(${groups.name})`));
      return { row, memberGroups };
    });
    if (!isAdmin && row.status !== 'active') throw notFound('Member');
    const { membershipId: _m, membershipStatus: _s, ...member } = row;
    return { ...present(isAdmin, member), groups: memberGroups };
  });

  r.patch(
    '/members/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: patchBody } },
    async (req) => {
      const actor = actorOf(req);
      const { orgRole, reportsTo, crmRole, ...profile } = req.body;
      const isSelf = req.params.id === actor.userId;

      return withTenant(deps.db, actor.orgId, async (tx) => {
        const target = await loadTarget(tx, actor.orgId, req.params.id);

        if (orgRole !== undefined && orgRole !== target.orgRole) {
          if (!can(actor, 'member.changeRole', { targetOrgRole: target.orgRole }))
            throw forbidden();
          if (orgRole === 'owner' && actor.orgRole !== 'owner') throw forbidden();
          if (target.orgRole === 'owner' && (await activeOwnerCount(tx, actor.orgId)) <= 1) {
            throw new AppError(409, 'last_owner', 'A workspace needs at least one owner');
          }
          await tx
            .update(memberships)
            .set({ orgRole: orgRole as OrgRole })
            .where(
              and(eq(memberships.id, target.membershipId), eq(memberships.orgId, actor.orgId)),
            );
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'member.role_changed',
            targetType: 'member',
            targetId: target.id,
            before: { orgRole: target.orgRole },
            after: { orgRole },
          });
        }

        if (crmRole !== undefined && crmRole !== target.crmRole) {
          // CRM access is granted by admins; owners and admins always have full CRM access regardless.
          if (!can(actor, 'member.editProfile')) throw forbidden();
          await tx
            .update(memberships)
            .set({ crmRole })
            .where(
              and(eq(memberships.id, target.membershipId), eq(memberships.orgId, actor.orgId)),
            );
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'member.crm_role_changed',
            targetType: 'member',
            targetId: target.id,
            before: { crmRole: target.crmRole },
            after: { crmRole },
          });
        }

        if (reportsTo !== undefined && reportsTo !== target.reportsTo) {
          // Who someone reports to decides who can see their exact times, so only admins set it.
          if (!can(actor, 'member.editProfile')) throw forbidden();
          if (reportsTo !== null) {
            if (reportsTo === target.id) {
              throw new AppError(400, 'validation_error', 'Nobody can report to themselves', {
                reportsTo: 'Choose someone else',
              });
            }
            const [boss] = await tx
              .select({ id: memberships.userId, status: memberships.status })
              .from(memberships)
              .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, reportsTo)));
            if (!boss || boss.status !== 'active') {
              throw new AppError(400, 'validation_error', 'That person is not an active member', {
                reportsTo: 'Choose an active member',
              });
            }
            // No loops: walk up from the new manager; reaching this person would close a circle.
            let cursor: string | null = reportsTo;
            for (let depth = 0; cursor && depth < 50; depth++) {
              if (cursor === target.id) {
                throw new AppError(400, 'validation_error', 'That would create a reporting loop', {
                  reportsTo: 'This person already reports to them',
                });
              }
              const [up] = await tx
                .select({ next: memberships.reportsTo })
                .from(memberships)
                .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, cursor)));
              cursor = up?.next ?? null;
            }
          }
          await tx
            .update(memberships)
            .set({ reportsTo })
            .where(
              and(eq(memberships.id, target.membershipId), eq(memberships.orgId, actor.orgId)),
            );
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'member.manager_changed',
            targetType: 'member',
            targetId: target.id,
            before: { reportsTo: target.reportsTo },
            after: { reportsTo },
          });
        }

        if (Object.keys(profile).length > 0) {
          const allowed =
            isSelf ||
            (can(actor, 'member.editProfile') &&
              (target.orgRole !== 'owner' || actor.orgRole === 'owner'));
          if (!allowed) throw forbidden();
          await tx.update(users).set(profile).where(eq(users.id, target.id));
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'member.profile_updated',
            targetType: 'member',
            targetId: target.id,
            before: Object.fromEntries(
              Object.keys(profile).map((k) => [k, target[k as keyof typeof target]]),
            ),
            after: profile,
          });
        }

        const {
          membershipId: _m,
          membershipStatus: _s,
          ...member
        } = await loadTarget(tx, actor.orgId, target.id);
        return member;
      });
    },
  );

  async function setActive(
    userId: string,
    req: Parameters<typeof actorOf>[0],
    deactivate: boolean,
  ) {
    const actor = actorOf(req);
    if (!can(actor, 'member.deactivate')) throw forbidden();
    if (deactivate && userId === actor.userId) {
      throw new AppError(400, 'cannot_deactivate_self', 'You cannot deactivate yourself');
    }
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const target = await loadTarget(tx, actor.orgId, userId);
      if (target.orgRole === 'owner' && actor.orgRole !== 'owner') throw forbidden();
      const already = (target.membershipStatus === 'deactivated') === deactivate;
      if (!already) {
        if (
          deactivate &&
          target.orgRole === 'owner' &&
          (await activeOwnerCount(tx, actor.orgId)) <= 1
        ) {
          throw new AppError(409, 'last_owner', 'A workspace needs at least one owner');
        }
        await tx
          .update(memberships)
          .set({
            status: deactivate ? 'deactivated' : 'active',
            deactivatedAt: deactivate ? new Date() : null,
          })
          .where(and(eq(memberships.id, target.membershipId), eq(memberships.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: deactivate ? 'member.deactivated' : 'member.reactivated',
          targetType: 'member',
          targetId: target.id,
          before: { status: target.membershipStatus },
          after: { status: deactivate ? 'deactivated' : 'active' },
        });
      }
      const {
        membershipId: _m,
        membershipStatus: _s,
        ...member
      } = await loadTarget(tx, actor.orgId, userId);
      return member;
    });
  }

  r.post(
    '/members/:id/deactivate',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => setActive(req.params.id, req, true),
  );
  r.post(
    '/members/:id/reactivate',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => setActive(req.params.id, req, false),
  );
}
