import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { listAudit, writeAudit } from '../audit/service.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { groups, memberships, spaceMembers } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { likePattern, offsetOf, pageQuery } from '../lib/pagination.js';
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
async function otherAdmins(tx: Tx, orgId: string, spaceId: string, excludeRowId: string) {
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from space_members sm
    where sm.space_id = ${spaceId} and sm.org_id = ${orgId}
      and sm.space_role = 'admin' and sm.id <> ${excludeRowId}
      and (
        (sm.principal_type = 'user' and exists (
          select 1 from memberships m
          where m.org_id = ${orgId} and m.user_id = sm.principal_id and m.status = 'active'))
        or (sm.principal_type = 'group' and exists (
          select 1 from group_members gm
          join memberships m on m.org_id = gm.org_id and m.user_id = gm.user_id and m.status = 'active'
          where gm.group_id = sm.principal_id and gm.org_id = ${orgId}))
      )`);
  return rows[0]?.n ?? 0;
}

export async function spaceMemberRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const loadEditable = async (tx: Tx, actor: Actor, id: string) => {
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
        const search: SQL = q.q
          ? sql`and (lower(coalesce(t.name, '')) like lower(${likePattern(q.q)}) or lower(coalesce(t.email, '')) like lower(${likePattern(q.q)}))`
          : sql``;
        const rows = await tx.execute<Row>(sql`
          select * from (
            select sm.id, 'user'::text as type, u.id as principal_id, u.name, u.email,
                   u.avatar_url, u.job_title, sm.space_role as role,
                   (select sm2.space_role from space_members sm2
                      join group_members gm on gm.group_id = sm2.principal_id and gm.org_id = sm2.org_id
                     where sm2.space_id = sm.space_id and sm2.org_id = sm.org_id
                       and sm2.principal_type = 'group' and gm.user_id = u.id
                     order by case sm2.space_role when 'admin' then 3 when 'member' then 2 else 1 end desc
                     limit 1) as group_role,
                   null::int as member_count,
                   (m.status = 'deactivated') as deactivated, sm.created_at
            from space_members sm
            join users u on u.id = sm.principal_id
            join memberships m on m.user_id = u.id and m.org_id = sm.org_id
            where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId} and sm.principal_type = 'user'
            union all
            select sm.id, 'group'::text, g.id, g.name, null, null, null, sm.space_role,
                   null::text,
                   (select count(*)::int from group_members gm where gm.group_id = g.id),
                   false, sm.created_at
            from space_members sm
            join groups g on g.id = sm.principal_id
            where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId} and sm.principal_type = 'group'
          ) t
          where true ${search}
          order by (t.type = 'group'), lower(coalesce(t.name, t.email)), t.id
          limit ${q.pageSize} offset ${offsetOf(q)}`);
        const totals = await tx.execute<{ n: number }>(sql`
          select (
            (select count(*) from space_members sm join users u on u.id = sm.principal_id
              where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId} and sm.principal_type = 'user'
                ${q.q ? sql`and (lower(coalesce(u.name,'')) like lower(${likePattern(q.q)}) or lower(u.email) like lower(${likePattern(q.q)}))` : sql``})
            +
            (select count(*) from space_members sm join groups g on g.id = sm.principal_id
              where sm.space_id = ${space.id} and sm.org_id = ${actor.orgId} and sm.principal_type = 'group'
                ${q.q ? sql`and lower(g.name) like lower(${likePattern(q.q)})` : sql``})
          )::int as n`);

        return {
          items: rows.map((m) => ({
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
          total: totals[0]?.n ?? 0,
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await loadEditable(tx, actor, req.params.id);
        const wanted = new Map<string, { type: 'user' | 'group'; id: string; role: SpaceRole }>();
        for (const m of req.body.members) wanted.set(`${m.type}:${m.id}`, m);
        const list = [...wanted.values()];

        const userIds = list.filter((m) => m.type === 'user').map((m) => m.id);
        const groupIds = list.filter((m) => m.type === 'group').map((m) => m.id);
        if (userIds.length) {
          const ok = await tx
            .select({ id: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.orgId, actor.orgId),
                eq(memberships.status, 'active'),
                inArray(memberships.userId, userIds),
              ),
            );
          if (ok.length !== userIds.length) {
            throw new AppError(
              400,
              'invalid_members',
              'Every person must be an active member of this workspace',
            );
          }
        }
        if (groupIds.length) {
          const ok = await tx
            .select({ id: groups.id })
            .from(groups)
            .where(and(eq(groups.orgId, actor.orgId), inArray(groups.id, groupIds)));
          if (ok.length !== groupIds.length) {
            throw new AppError(400, 'invalid_members', 'One of the selected groups does not exist');
          }
        }

        const existing = await tx
          .select({ type: spaceMembers.principalType, id: spaceMembers.principalId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.orgId, actor.orgId)));
        const have = new Set(existing.map((e) => `${e.type}:${e.id}`));

        const results: { type: string; id: string; status: 'added' | 'already_member' }[] = [];
        for (const m of list) {
          if (have.has(`${m.type}:${m.id}`)) {
            results.push({ type: m.type, id: m.id, status: 'already_member' });
            continue;
          }
          const [row] = await tx
            .insert(spaceMembers)
            .values({
              spaceId: space.id,
              orgId: actor.orgId,
              principalType: m.type,
              principalId: m.id,
              spaceRole: m.role,
            })
            .returning({ id: spaceMembers.id });
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'space.member_added',
            targetType: 'space',
            targetId: space.id,
            after: { principalType: m.type, principalId: m.id, role: m.role, memberRowId: row!.id },
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await loadEditable(tx, actor, req.params.id);
        const [row] = await tx
          .select()
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.id, req.params.memberId),
              eq(spaceMembers.spaceId, space.id),
              eq(spaceMembers.orgId, actor.orgId),
            ),
          );
        if (!row) throw notFound('Member');
        if (row.spaceRole === req.body.role) return { id: row.id, role: row.spaceRole };

        if (
          row.spaceRole === 'admin' &&
          (await otherAdmins(tx, actor.orgId, space.id, row.id)) === 0
        ) {
          throw lastAdmin();
        }
        await tx
          .update(spaceMembers)
          .set({ spaceRole: req.body.role })
          .where(and(eq(spaceMembers.id, row.id), eq(spaceMembers.orgId, actor.orgId)));
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
      await withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await loadEditable(tx, actor, req.params.id);
        const [row] = await tx
          .select()
          .from(spaceMembers)
          .where(
            and(
              eq(spaceMembers.id, req.params.memberId),
              eq(spaceMembers.spaceId, space.id),
              eq(spaceMembers.orgId, actor.orgId),
            ),
          );
        if (!row) throw notFound('Member');
        if (
          row.spaceRole === 'admin' &&
          (await otherAdmins(tx, actor.orgId, space.id, row.id)) === 0
        ) {
          throw lastAdmin();
        }
        await tx
          .delete(spaceMembers)
          .where(and(eq(spaceMembers.id, row.id), eq(spaceMembers.orgId, actor.orgId)));
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
