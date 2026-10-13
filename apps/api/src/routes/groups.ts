import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { groupMembers, groups, memberships, users } from '../db/schema.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { likePattern, offsetOf, pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';

const idParam = z.object({ id: z.string().uuid() });
const nameSchema = z.string().trim().min(1, 'Enter a name').max(60);
const descriptionSchema = z.string().trim().max(500);

const effectiveStatus = sql<
  'active' | 'invited' | 'deactivated'
>`case when ${memberships.status} = 'deactivated' then 'deactivated' else ${users.status} end`;

const nameTaken = () =>
  new AppError(409, 'name_taken', 'A group with that name already exists', {
    name: 'A group with that name already exists',
  });

async function loadGroup(tx: Tx, orgId: string, id: string) {
  const [g] = await tx
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), eq(groups.orgId, orgId)));
  if (!g) throw notFound('Group');
  return g;
}

async function loadMembers(tx: Tx, orgId: string, groupId: string) {
  return tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      orgRole: memberships.orgRole,
      status: effectiveStatus,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.orgId, groupMembers.orgId)),
    )
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.orgId, orgId)))
    .orderBy(asc(sql`lower(coalesce(${users.name}, ${users.email}))`), asc(users.id));
}

const present = (g: typeof groups.$inferSelect) => ({
  id: g.id,
  name: g.name,
  description: g.description,
  createdAt: g.createdAt,
});

export async function groupRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Reading groups is open to every member (like the People directory); changing them is admin-only.
  r.get(
    '/groups',
    {
      preHandler: requireAuth,
      schema: { querystring: pageQuery.extend({ q: z.string().trim().max(100).optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      const where = and(
        eq(groups.orgId, actor.orgId),
        q.q
          ? or(ilike(groups.name, likePattern(q.q)), ilike(groups.description, likePattern(q.q)))
          : undefined,
      );
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const rows = await tx
          .select({
            id: groups.id,
            name: groups.name,
            description: groups.description,
            createdAt: groups.createdAt,
            memberCount: sql<number>`(select count(*)::int from group_members gm where gm.group_id = "groups"."id")`,
          })
          .from(groups)
          .where(where)
          .orderBy(asc(sql`lower(${groups.name})`), asc(groups.id))
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(groups)
          .where(where);

        // A few member avatars per group for the list view.
        const preview = new Map<
          string,
          { id: string; name: string | null; email: string; avatarUrl: string | null }[]
        >();
        if (rows.length) {
          const people = await tx
            .select({
              groupId: groupMembers.groupId,
              id: users.id,
              name: users.name,
              email: users.email,
              avatarUrl: users.avatarUrl,
            })
            .from(groupMembers)
            .innerJoin(users, eq(users.id, groupMembers.userId))
            .where(
              and(
                eq(groupMembers.orgId, actor.orgId),
                inArray(
                  groupMembers.groupId,
                  rows.map((g) => g.id),
                ),
              ),
            )
            .orderBy(asc(groupMembers.createdAt));
          for (const p of people) {
            const list = preview.get(p.groupId) ?? [];
            if (list.length < 4)
              list.push({ id: p.id, name: p.name, email: p.email, avatarUrl: p.avatarUrl });
            preview.set(p.groupId, list);
          }
        }
        return {
          items: rows.map((g) => ({ ...g, members: preview.get(g.id) ?? [] })),
          total: count?.n ?? 0,
          page: q.page,
          pageSize: q.pageSize,
        };
      });
    },
  );

  r.get('/groups/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    const isAdmin = can(actor, 'group.manage');
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const g = await loadGroup(tx, actor.orgId, req.params.id);
      const members = await loadMembers(tx, actor.orgId, g.id);
      // Non-admins do not see deactivated people.
      return {
        ...present(g),
        members: isAdmin ? members : members.filter((m) => m.status === 'active'),
      };
    });
  });

  r.post(
    '/groups',
    {
      preHandler: requireAuth,
      schema: { body: z.object({ name: nameSchema, description: descriptionSchema.optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'group.manage')) throw forbidden();
      try {
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const dup = await tx
            .select({ id: groups.id })
            .from(groups)
            .where(
              and(
                eq(groups.orgId, actor.orgId),
                sql`lower(${groups.name}) = lower(${req.body.name})`,
              ),
            );
          if (dup.length) throw nameTaken();
          const [g] = await tx
            .insert(groups)
            .values({
              orgId: actor.orgId,
              name: req.body.name,
              description: req.body.description || null,
            })
            .returning();
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'group.created',
            targetType: 'group',
            targetId: g!.id,
            after: { name: g!.name, description: g!.description },
          });
          return { ...present(g!), members: [] };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  r.patch(
    '/groups/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z
          .object({ name: nameSchema, description: descriptionSchema.nullable() })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'group.manage')) throw forbidden();
      try {
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const before = await loadGroup(tx, actor.orgId, req.params.id);
          if (req.body.name && req.body.name.toLowerCase() !== before.name.toLowerCase()) {
            const dup = await tx
              .select({ id: groups.id })
              .from(groups)
              .where(
                and(
                  eq(groups.orgId, actor.orgId),
                  sql`lower(${groups.name}) = lower(${req.body.name})`,
                ),
              );
            if (dup.length) throw nameTaken();
          }
          const patch = {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.description !== undefined
              ? { description: req.body.description || null }
              : {}),
          };
          const [g] = await tx
            .update(groups)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(groups.id, before.id), eq(groups.orgId, actor.orgId)))
            .returning();
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'group.updated',
            targetType: 'group',
            targetId: before.id,
            before: Object.fromEntries(
              Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
            ),
            after: patch,
          });
          return { ...present(g!), members: await loadMembers(tx, actor.orgId, g!.id) };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw nameTaken();
        throw e;
      }
    },
  );

  r.delete('/groups/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'group.manage')) throw forbidden();
    await withTenant(deps.db, actor.orgId, async (tx) => {
      const g = await loadGroup(tx, actor.orgId, req.params.id);
      const members = await loadMembers(tx, actor.orgId, g.id);
      // Group memberships go with the group (ON DELETE CASCADE).
      await tx.delete(groups).where(and(eq(groups.id, g.id), eq(groups.orgId, actor.orgId)));
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'group.deleted',
        targetType: 'group',
        targetId: g.id,
        before: { name: g.name, description: g.description, memberCount: members.length },
      });
    });
    return { ok: true };
  });

  // Replaces the whole member list in one call.
  r.put(
    '/groups/:id/members',
    {
      preHandler: requireAuth,
      schema: { params: idParam, body: z.object({ userIds: z.array(z.string().uuid()).max(500) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'group.manage')) throw forbidden();
      const wanted = [...new Set(req.body.userIds)];

      return withTenant(deps.db, actor.orgId, async (tx) => {
        const g = await loadGroup(tx, actor.orgId, req.params.id);
        const current = await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.orgId, actor.orgId)));
        const currentIds = new Set(current.map((c) => c.userId));
        const added = wanted.filter((id) => !currentIds.has(id));
        const removed = [...currentIds].filter((id) => !wanted.includes(id));

        if (added.length) {
          const eligible = await tx
            .select({ id: users.id })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(
              and(
                eq(memberships.orgId, actor.orgId),
                eq(memberships.status, 'active'),
                inArray(users.id, added),
              ),
            );
          if (eligible.length !== added.length) {
            throw new AppError(
              400,
              'invalid_members',
              'Every person must be an active member of this workspace',
            );
          }
          await tx
            .insert(groupMembers)
            .values(added.map((userId) => ({ groupId: g.id, orgId: actor.orgId, userId })));
        }
        if (removed.length) {
          await tx
            .delete(groupMembers)
            .where(
              and(
                eq(groupMembers.groupId, g.id),
                eq(groupMembers.orgId, actor.orgId),
                inArray(groupMembers.userId, removed),
              ),
            );
        }
        if (added.length || removed.length) {
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'group.members_changed',
            targetType: 'group',
            targetId: g.id,
            after: { added, removed },
          });
        }
        return { ...present(g), members: await loadMembers(tx, actor.orgId, g.id) };
      });
    },
  );
}
