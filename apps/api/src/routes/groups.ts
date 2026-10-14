import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { GroupDoc } from '../db/types.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { containsRegex, offsetOf, pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';

const idParam = z.object({ id: z.string().uuid() });
const nameSchema = z.string().trim().min(1, 'Enter a name').max(60);
const descriptionSchema = z.string().trim().max(500);

const nameTaken = () =>
  new AppError(409, 'name_taken', 'A group with that name already exists', {
    name: 'A group with that name already exists',
  });

async function loadGroup(t: TenantDb, id: string) {
  const g = await t.groups.get(id);
  if (!g) throw notFound('Group');
  return g;
}

const personName = (u: { name: string | null; email: string }) => (u.name ?? u.email).toLowerCase();

async function loadMembers(t: TenantDb, groupId: string) {
  const links = await t.groupMembers.find({ groupId });
  const ids = links.map((l) => l.userId);
  const [people, ms] = [await t.users(ids), await t.memberships.find({ userId: { $in: ids } })];
  const roleOf = new Map(ms.map((m) => [m.userId, m]));
  return ids
    .flatMap((id) => {
      const u = people.get(id);
      const m = roleOf.get(id);
      if (!u || !m) return [];
      return [
        {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatarUrl,
          jobTitle: u.jobTitle,
          orgRole: m.orgRole,
          status: (m.status === 'deactivated' ? 'deactivated' : u.status) as
            'active' | 'invited' | 'deactivated',
        },
      ];
    })
    .sort((a, b) => personName(a).localeCompare(personName(b)) || a.id.localeCompare(b.id));
}

const present = (g: GroupDoc) => ({
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
      const filter = q.q
        ? { $or: [{ name: containsRegex(q.q) }, { description: containsRegex(q.q) }] }
        : {};
      return withTenant(deps.db, actor.orgId, async (t) => {
        const rows = await t.groups.find(filter, {
          sort: { nameLower: 1, id: 1 },
          skip: offsetOf(q),
          limit: q.pageSize,
        });
        const total = await t.groups.count(filter);

        // A few member avatars per group for the list view, and the full member count.
        const links = rows.length
          ? await t.groupMembers.find(
              { groupId: { $in: rows.map((g) => g.id) } },
              { sort: { createdAt: 1 } },
            )
          : [];
        const people = await t.users(links.map((l) => l.userId));
        const counts = new Map<string, number>();
        const preview = new Map<
          string,
          { id: string; name: string | null; email: string; avatarUrl: string | null }[]
        >();
        for (const l of links) {
          counts.set(l.groupId, (counts.get(l.groupId) ?? 0) + 1);
          const p = people.get(l.userId);
          if (!p) continue;
          const list = preview.get(l.groupId) ?? [];
          if (list.length < 4)
            list.push({ id: p.id, name: p.name, email: p.email, avatarUrl: p.avatarUrl });
          preview.set(l.groupId, list);
        }
        return {
          items: rows.map((g) => ({
            ...present(g),
            memberCount: counts.get(g.id) ?? 0,
            members: preview.get(g.id) ?? [],
          })),
          total,
          page: q.page,
          pageSize: q.pageSize,
        };
      });
    },
  );

  r.get('/groups/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    const isAdmin = can(actor, 'group.manage');
    return withTenant(deps.db, actor.orgId, async (t) => {
      const g = await loadGroup(t, req.params.id);
      const members = await loadMembers(t, g.id);
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
        return await withTenantTx(deps.db, actor.orgId, async (t) => {
          if (await t.groups.exists({ nameLower: req.body.name.toLowerCase() })) throw nameTaken();
          const g = await t.groups.insert({
            name: req.body.name,
            description: req.body.description || null,
          });
          await writeAudit(t, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'group.created',
            targetType: 'group',
            targetId: g.id,
            after: { name: g.name, description: g.description },
          });
          return { ...present(g), members: [] };
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
        return await withTenantTx(deps.db, actor.orgId, async (t) => {
          const before = await loadGroup(t, req.params.id);
          if (req.body.name && req.body.name.toLowerCase() !== before.name.toLowerCase()) {
            if (await t.groups.exists({ nameLower: req.body.name.toLowerCase() })) throw nameTaken();
          }
          const patch = {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.description !== undefined
              ? { description: req.body.description || null }
              : {}),
          };
          const g = await t.groups.findOneAndUpdate(
            { id: before.id },
            { ...patch, updatedAt: new Date() },
          );
          await writeAudit(t, {
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
          return { ...present(g!), members: await loadMembers(t, g!.id) };
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
    await withTenantTx(deps.db, actor.orgId, async (t) => {
      const g = await loadGroup(t, req.params.id);
      const members = await loadMembers(t, g.id);
      // Group memberships, and the group's access to spaces, go with the group (the old ON DELETE CASCADE).
      await t.groupMembers.deleteMany({ groupId: g.id });
      await t.spaceMembers.deleteMany({ principalType: 'group', principalId: g.id });
      await t.groups.deleteOne({ id: g.id });
      await writeAudit(t, {
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

      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const g = await loadGroup(t, req.params.id);
        const current = await t.groupMembers.find({ groupId: g.id });
        const currentIds = new Set(current.map((c) => c.userId));
        const added = wanted.filter((id) => !currentIds.has(id));
        const removed = [...currentIds].filter((id) => !wanted.includes(id));

        if (added.length) {
          const eligible = await t.memberships.count({
            status: 'active',
            userId: { $in: added },
          });
          if (eligible !== added.length) {
            throw new AppError(
              400,
              'invalid_members',
              'Every person must be an active member of this workspace',
            );
          }
          await t.groupMembers.insert(added.map((userId) => ({ groupId: g.id, userId })));
        }
        if (removed.length) {
          await t.groupMembers.deleteMany({ groupId: g.id, userId: { $in: removed } });
        }
        if (added.length || removed.length) {
          await writeAudit(t, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'group.members_changed',
            targetType: 'group',
            targetId: g.id,
            after: { added, removed },
          });
        }
        return { ...present(g), members: await loadMembers(t, g.id) };
      });
    },
  );
}
