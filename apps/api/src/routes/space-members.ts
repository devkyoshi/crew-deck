import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listAudit, writeAudit } from '../audit/service.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor, type SpaceRole } from '../permissions/can.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const roleSchema = z.enum(['admin', 'member', 'viewer']);
const RANK: Record<SpaceRole, number> = { admin: 3, member: 2, viewer: 1 };
const spaceParam = z.object({ id: z.string().min(1).max(64) });
const memberParam = z.object({ id: z.string().min(1).max(64), memberId: z.string().uuid() });

type Row = {
  id: string;
  type: 'user' | 'group';
  principal_id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: SpaceRole;
  group_role: SpaceRole | null;
  member_count: number | null;
  deactivated: boolean;
};

const lastAdmin = () =>
  new AppError(
    409,
    'last_admin',
    'A space needs at least one admin. Make someone else an admin first.',
  );

/**
 * How many admins would remain if `excludeRowId` stopped being one. A group row only counts if
 * the group has at least one active person, and a person row only counts while they are active.
 */
async function otherAdmins(t: TenantDb, spaceId: string, excludeRowId: string) {
  const rows = await t.spaceMembers.find({
    spaceId,
    spaceRole: 'admin',
    id: { $ne: excludeRowId },
  });
  if (rows.length === 0) return 0;
  const active = new Set(
    (await t.memberships.find({ status: 'active' }, { projection: { userId: 1 } })).map(
      (m) => m.userId,
    ),
  );
  const groupIds = rows.filter((r) => r.principalType === 'group').map((r) => r.principalId);
  const groupsWithPeople = new Set<string>();
  if (groupIds.length) {
    const links = await t.groupMembers.find({ groupId: { $in: groupIds } });
    for (const l of links) if (active.has(l.userId)) groupsWithPeople.add(l.groupId);
  }
  return rows.filter((r) =>
    r.principalType === 'user' ? active.has(r.principalId) : groupsWithPeople.has(r.principalId),
  ).length;
}

export async function spaceMemberRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const loadEditable = async (tx: TenantDb, actor: Actor, id: string) => {
    const space = await resolveSpace(tx, actor, id);
    if (!can(actor, 'space.manageMembers', spaceCtx(space))) throw forbidden();
    if (space.status === 'archived') {
      throw new AppError(409, 'archived', 'Restore this space before changing its members');
    }
    return space;
  };

  r.get(
    '/spaces/:id/members',
    {
      preHandler: requireAuth,
      schema: {
        params: spaceParam,
        querystring: pageQuery.extend({ q: z.string().trim().max(100).optional() }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        // Anyone who can see the space can see who is in it (404 otherwise).
        const space = await resolveSpace(tx, actor, req.params.id);
        const entries = await tx.spaceMembers.find({ spaceId: space.id });
        const userEntries = entries.filter((e) => e.principalType === 'user');
        const groupEntries = entries.filter((e) => e.principalType === 'group');

        const people = await tx.users(userEntries.map((e) => e.principalId));
        const ms = await tx.memberships.find({ userId: { $in: userEntries.map((e) => e.principalId) } });
        const deactivated = new Set(ms.filter((m) => m.status === 'deactivated').map((m) => m.userId));
        const gs = groupEntries.length
          ? await tx.groups.find({ id: { $in: groupEntries.map((e) => e.principalId) } })
          : [];
        const groupById = new Map(gs.map((g) => [g.id, g]));
        const links = groupEntries.length
          ? await tx.groupMembers.find({ groupId: { $in: groupEntries.map((e) => e.principalId) } })
          : [];
        const memberCount = new Map<string, number>();
        for (const l of links) memberCount.set(l.groupId, (memberCount.get(l.groupId) ?? 0) + 1);
        // Highest role a person inherits through any group that has access to this space.
        const groupRoleOf = new Map<string, SpaceRole>();
        for (const l of links) {
          const gRole = groupEntries.find((e) => e.principalId === l.groupId)!.spaceRole;
          const cur = groupRoleOf.get(l.userId);
          if (!cur || RANK[gRole] > RANK[cur]) groupRoleOf.set(l.userId, gRole);
        }

        const rows: Row[] = [];
        for (const e of userEntries) {
          const u = people.get(e.principalId);
          if (!u) continue;
          rows.push({
            id: e.id,
            type: 'user',
            principal_id: u.id,
            name: u.name,
            email: u.email,
            avatar_url: u.avatarUrl,
            job_title: u.jobTitle,
            role: e.spaceRole,
            group_role: groupRoleOf.get(u.id) ?? null,
            member_count: null,
            deactivated: deactivated.has(u.id),
          });
        }
        for (const e of groupEntries) {
          const g = groupById.get(e.principalId);
          if (!g) continue;
          rows.push({
            id: e.id,
            type: 'group',
            principal_id: g.id,
            name: g.name,
            email: null,
            avatar_url: null,
            job_title: null,
            role: e.spaceRole,
            group_role: null,
            member_count: memberCount.get(g.id) ?? 0,
            deactivated: false,
          });
        }

        const needle = q.q?.toLowerCase();
        const filtered = needle
          ? rows.filter((m) => [m.name, m.email].some((v) => v?.toLowerCase().includes(needle)))
          : rows;
        filtered.sort(
          (a, b) =>
            Number(a.type === 'group') - Number(b.type === 'group') ||
            (a.name ?? a.email ?? '').toLowerCase().localeCompare((b.name ?? b.email ?? '').toLowerCase()) ||
            a.id.localeCompare(b.id),
        );
        const page = filtered.slice(offsetOf(q), offsetOf(q) + q.pageSize);

        return {
          items: page.map((m) => ({
            id: m.id,
            type: m.type,
            principalId: m.principal_id,
            name: m.name,
            email: m.email,
            avatarUrl: m.avatar_url,
            jobTitle: m.job_title,
            role: m.role,
            // Highest of the direct role and any role inherited through a group.
            effectiveRole:
              m.type === 'user' && m.group_role && RANK[m.group_role] > RANK[m.role]
                ? m.group_role
                : m.role,
            inheritedRole: m.type === 'user' ? m.group_role : null,
            memberCount: m.member_count,
            deactivated: m.deactivated,
          })),
          total: filtered.length,
          page: q.page,
          pageSize: q.pageSize,
        };
      });
    },
  );

  r.post(
    '/spaces/:id/members',
    {
      preHandler: requireAuth,
      schema: {
        params: spaceParam,
        body: z.object({
          members: z
            .array(
              z.object({
                type: z.enum(['user', 'group']),
                id: z.string().uuid(),
                role: roleSchema,
              }),
            )
            .min(1)
            .max(100),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const space = await loadEditable(tx, actor, req.params.id);
        const wanted = new Map<string, { type: 'user' | 'group'; id: string; role: SpaceRole }>();
        for (const m of req.body.members) wanted.set(`${m.type}:${m.id}`, m);
        const list = [...wanted.values()];

        const userIds = list.filter((m) => m.type === 'user').map((m) => m.id);
        const groupIds = list.filter((m) => m.type === 'group').map((m) => m.id);
        if (userIds.length) {
          const ok = await tx.memberships.count({ status: 'active', userId: { $in: userIds } });
          if (ok !== userIds.length) {
            throw new AppError(
              400,
              'invalid_members',
              'Every person must be an active member of this workspace',
            );
          }
        }
        if (groupIds.length) {
          const ok = await tx.groups.count({ id: { $in: groupIds } });
          if (ok !== groupIds.length) {
            throw new AppError(400, 'invalid_members', 'One of the selected groups does not exist');
          }
        }

        const existing = await tx.spaceMembers.find({ spaceId: space.id });
        const have = new Set(existing.map((e) => `${e.principalType}:${e.principalId}`));

        const results: { type: string; id: string; status: 'added' | 'already_member' }[] = [];
        for (const m of list) {
          if (have.has(`${m.type}:${m.id}`)) {
            results.push({ type: m.type, id: m.id, status: 'already_member' });
            continue;
          }
          const row = await tx.spaceMembers.insert({
            spaceId: space.id,
            principalType: m.type,
            principalId: m.id,
            spaceRole: m.role,
          });
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'space.member_added',
            targetType: 'space',
            targetId: space.id,
            after: { principalType: m.type, principalId: m.id, role: m.role, memberRowId: row.id },
          });
          results.push({ type: m.type, id: m.id, status: 'added' });
        }
        return { results };
      });
    },
  );

  r.patch(
    '/spaces/:id/members/:memberId',
    {
      preHandler: requireAuth,
      schema: { params: memberParam, body: z.object({ role: roleSchema }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const space = await loadEditable(tx, actor, req.params.id);
        const row = await tx.spaceMembers.findOne({ id: req.params.memberId, spaceId: space.id });
        if (!row) throw notFound('Member');
        if (row.spaceRole === req.body.role) return { id: row.id, role: row.spaceRole };

        if (row.spaceRole === 'admin' && (await otherAdmins(tx, space.id, row.id)) === 0) {
          throw lastAdmin();
        }
        await tx.spaceMembers.updateOne({ id: row.id }, { spaceRole: req.body.role });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.member_role_changed',
          targetType: 'space',
          targetId: space.id,
          before: {
            principalType: row.principalType,
            principalId: row.principalId,
            role: row.spaceRole,
          },
          after: {
            principalType: row.principalType,
            principalId: row.principalId,
            role: req.body.role,
          },
        });
        return { id: row.id, role: req.body.role };
      });
    },
  );

  r.delete(
    '/spaces/:id/members/:memberId',
    { preHandler: requireAuth, schema: { params: memberParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        const space = await loadEditable(tx, actor, req.params.id);
        const row = await tx.spaceMembers.findOne({ id: req.params.memberId, spaceId: space.id });
        if (!row) throw notFound('Member');
        if (row.spaceRole === 'admin' && (await otherAdmins(tx, space.id, row.id)) === 0) {
          throw lastAdmin();
        }
        await tx.spaceMembers.deleteOne({ id: row.id });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.member_removed',
          targetType: 'space',
          targetId: space.id,
          before: {
            principalType: row.principalType,
            principalId: row.principalId,
            role: row.spaceRole,
          },
        });
      });
      return { ok: true };
    },
  );

  // Space admins see their own space's history; org admins can too. Nobody else can.
  r.get(
    '/spaces/:id/audit-logs',
    {
      preHandler: requireAuth,
      schema: {
        params: spaceParam,
        querystring: pageQuery.extend({
          action: z.string().max(100).optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        if (!can(actor, 'audit.viewSpace', spaceCtx(space))) throw forbidden();
        const plan = await loadPlan(tx, actor.orgId);
        assertFeature(plan, 'space_audit', 'The per-space audit log');
        return listAudit(tx, {
          ...req.query,
          orgId: actor.orgId,
          targetType: 'space',
          target: space.id,
        });
      });
    },
  );
}
