import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { orgRoleSchema, type OrgRole } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { timezoneSchema } from '../auth/routes.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { MembershipDoc, UserDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';

type Status = 'active' | 'invited' | 'deactivated';

/** A member as the API shows them: the person plus their role in this workspace. */
export interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string;
  orgRole: OrgRole;
  crmRole: MembershipDoc['crmRole'];
  status: Status;
  lastLoginAt: Date | null;
  joinedAt: Date;
  reportsTo: string | null;
  reportsToName: string | null;
}

/** A deactivated membership wins over the global user status. */
const effectiveStatus = (m: MembershipDoc, u: UserDoc): Status =>
  m.status === 'deactivated' ? 'deactivated' : u.status;

function toRow(m: MembershipDoc, u: UserDoc, names: Map<string, UserDoc>): MemberRow {
  const boss = m.reportsTo ? names.get(m.reportsTo) : undefined;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    timezone: u.timezone,
    orgRole: m.orgRole,
    crmRole: m.crmRole,
    status: effectiveStatus(m, u),
    lastLoginAt: u.lastLoginAt,
    joinedAt: m.createdAt,
    reportsTo: m.reportsTo,
    reportsToName: boss ? (boss.name ?? boss.email) : null,
  };
}

/** Every member of the workspace joined with their user record. Workspaces are small enough for this. */
export async function loadMembers(t: TenantDb): Promise<MemberRow[]> {
  const ms = await t.memberships.find({});
  const users = await t.users(ms.map((m) => m.userId));
  const rows: MemberRow[] = [];
  for (const m of ms) {
    const u = users.get(m.userId);
    if (u) rows.push(toRow(m, u, users));
  }
  return rows;
}

const SORTS = {
  name: (r: MemberRow) => (r.name ?? r.email).toLowerCase(),
  email: (r: MemberRow) => r.email.toLowerCase(),
  role: (r: MemberRow) => r.orgRole,
  status: (r: MemberRow) => r.status,
  lastLoginAt: (r: MemberRow) => r.lastLoginAt?.getTime() ?? 0,
  joinedAt: (r: MemberRow) => r.joinedAt.getTime(),
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
const activeOwnerCount = (t: TenantDb) =>
  t.memberships.count({ orgRole: 'owner', status: 'active' });

async function loadTarget(t: TenantDb, userId: string) {
  const m = await t.memberships.findOne({ userId });
  if (!m) throw notFound('Member');
  const users = await t.users([userId, ...(m.reportsTo ? [m.reportsTo] : [])]);
  const u = users.get(userId);
  if (!u) throw notFound('Member');
  return { ...toRow(m, u, users), membershipStatus: m.status };
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
      let rows = await withTenant(deps.db, actor.orgId, (t) => loadMembers(t));
      if (q.q) {
        const needle = q.q.toLowerCase();
        rows = rows.filter((r) =>
          [r.name, r.email, r.jobTitle].some((v) => v?.toLowerCase().includes(needle)),
        );
      }
      if (q.role) rows = rows.filter((r) => r.orgRole === q.role);
      // Non-admins only ever see active people.
      const status = isAdmin ? q.status : 'active';
      if (status) rows = rows.filter((r) => r.status === status);

      const key = SORTS[q.sort];
      const dir = q.dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return (x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1) * dir;
      });
      const items = rows.slice(offsetOf(q), offsetOf(q) + q.pageSize);
      return {
        items: items.map((i) => present(isAdmin, i)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );

  r.get('/members/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    const isAdmin = can(actor, 'member.deactivate');
    const { row, memberGroups } = await withTenant(deps.db, actor.orgId, async (t) => {
      const row = await loadTarget(t, req.params.id);
      const links = await t.groupMembers.find({ userId: row.id });
      const gs = links.length ? await t.groups.find({ id: { $in: links.map((l) => l.groupId) } }) : [];
      const memberGroups = gs
        .map((g) => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return { row, memberGroups };
    });
    if (!isAdmin && row.status !== 'active') throw notFound('Member');
    const { membershipStatus: _s, ...member } = row;
    return { ...present(isAdmin, member), groups: memberGroups };
  });

  r.patch(
    '/members/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: patchBody } },
    async (req) => {
      const actor = actorOf(req);
      const { orgRole, reportsTo, crmRole, ...profile } = req.body;
      const isSelf = req.params.id === actor.userId;

      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const target = await loadTarget(t, req.params.id);

        if (orgRole !== undefined && orgRole !== target.orgRole) {
          if (!can(actor, 'member.changeRole', { targetOrgRole: target.orgRole }))
            throw forbidden();
          if (orgRole === 'owner' && actor.orgRole !== 'owner') throw forbidden();
          if (target.orgRole === 'owner' && (await activeOwnerCount(t)) <= 1) {
            throw new AppError(409, 'last_owner', 'A workspace needs at least one owner');
          }
          await t.memberships.updateOne({ userId: target.id }, { orgRole: orgRole as OrgRole });
          await writeAudit(t, {
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
          await t.memberships.updateOne({ userId: target.id }, { crmRole });
          await writeAudit(t, {
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
            const boss = await t.memberships.findOne({ userId: reportsTo });
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
              const up: MembershipDoc | null = await t.memberships.findOne({ userId: cursor });
              cursor = up?.reportsTo ?? null;
            }
          }
          await t.memberships.updateOne({ userId: target.id }, { reportsTo });
          await writeAudit(t, {
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
          await t.updateUser(target.id, profile);
          await writeAudit(t, {
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

        const { membershipStatus: _s, ...member } = await loadTarget(t, target.id);
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
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const target = await loadTarget(t, userId);
      if (target.orgRole === 'owner' && actor.orgRole !== 'owner') throw forbidden();
      const already = (target.membershipStatus === 'deactivated') === deactivate;
      if (!already) {
        if (deactivate && target.orgRole === 'owner' && (await activeOwnerCount(t)) <= 1) {
          throw new AppError(409, 'last_owner', 'A workspace needs at least one owner');
        }
        await t.memberships.updateOne(
          { userId },
          {
            status: deactivate ? 'deactivated' : 'active',
            deactivatedAt: deactivate ? new Date() : null,
          },
        );
        await writeAudit(t, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: deactivate ? 'member.deactivated' : 'member.reactivated',
          targetType: 'member',
          targetId: target.id,
          before: { status: target.membershipStatus },
          after: { status: deactivate ? 'deactivated' : 'active' },
        });
      }
      const { membershipStatus: _s, ...member } = await loadTarget(t, userId);
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
