import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type Tx } from '../db/client.js';
import { groups, memberships, spaceMembers, spaceStars, spaces, users } from '../db/schema.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { likePattern, offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor, type SpaceRole } from '../permissions/can.js';
import { effectiveRoleSql, memberCountSql, starredSql, visibleTo } from '../spaces/access.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Icons the UI can render; stored by name so the API stays presentation-free. */
export const SPACE_ICONS = [
  'folder',
  'rocket',
  'code',
  'briefcase',
  'palette',
  'bug',
  'chart',
  'globe',
  'shield',
  'lightbulb',
  'users',
  'megaphone',
] as const;

// "NEW" is the create page's URL segment, so it can never be a space key.
const RESERVED_KEYS = new Set(['NEW']);
const keySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2 to 10 letters or digits, starting with a letter')
      .refine((k) => !RESERVED_KEYS.has(k), 'That key is reserved'),
  );
const nameSchema = z.string().trim().min(1, 'Enter a name').max(80);
const descriptionSchema = z.string().trim().max(1000);
const iconSchema = z.enum(SPACE_ICONS);
const visibilitySchema = z.enum(['open', 'private']);
const roleSchema = z.enum(['admin', 'member', 'viewer']);

const keyTaken = () =>
  new AppError(409, 'key_taken', 'That key is already used by a space in this workspace', {
    key: 'That key is already used (keys are never reused)',
  });

function columnsFor(userId: string, orgId: string) {
  return {
    id: spaces.id,
    key: spaces.key,
    name: spaces.name,
    description: spaces.description,
    icon: spaces.icon,
    visibility: spaces.visibility,
    status: spaces.status,
    ownerId: spaces.ownerId,
    createdAt: spaces.createdAt,
    updatedAt: spaces.updatedAt,
    myRole: effectiveRoleSql(userId, orgId),
    starred: starredSql(userId),
    memberCount: memberCountSql,
  };
}
const isOrgAdmin = (a: Actor) => a.orgRole === 'owner' || a.orgRole === 'admin';

/** Loads a space by id or key, or 404s. Hidden spaces look exactly like missing ones. */
async function resolveSpace(tx: Tx, actor: Actor, param: string) {
  const cols = columnsFor(actor.userId, actor.orgId);
  const byId = UUID.test(param);
  const rows = await tx
    .select(cols)
    .from(spaces)
    .where(
      and(
        visibleTo({ orgId: actor.orgId, isOrgAdmin: isOrgAdmin(actor), role: cols.myRole }),
        byId ? eq(spaces.id, param) : eq(spaces.key, param.toUpperCase()),
      ),
    );
  const row = rows[0];
  if (!row) throw notFound('Space');
  return row;
}

const spaceCtx = (row: { myRole: SpaceRole | null; visibility: 'open' | 'private' }) => ({
  spaceRole: row.myRole,
  spaceVisibility: row.visibility,
});

function presentPermissions(
  actor: Actor,
  row: { myRole: SpaceRole | null; visibility: 'open' | 'private' },
) {
  const ctx = spaceCtx(row);
  return {
    edit: can(actor, 'space.edit', ctx),
    manageMembers: can(actor, 'space.manageMembers', ctx),
    delete: can(actor, 'space.delete', ctx),
  };
}

async function memberSummary(tx: Tx, orgId: string, spaceId: string) {
  const direct = await tx
    .select({
      type: sql<'user'>`'user'`,
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: spaceMembers.spaceRole,
    })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.principalId))
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.orgId, orgId),
        eq(spaceMembers.principalType, 'user'),
      ),
    )
    .orderBy(asc(spaceMembers.createdAt))
    .limit(8);
  const grouped = await tx
    .select({
      type: sql<'group'>`'group'`,
      id: groups.id,
      name: groups.name,
      role: spaceMembers.spaceRole,
    })
    .from(spaceMembers)
    .innerJoin(groups, eq(groups.id, spaceMembers.principalId))
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.orgId, orgId),
        eq(spaceMembers.principalType, 'group'),
      ),
    )
    .orderBy(asc(spaceMembers.createdAt))
    .limit(8);
  return [...direct, ...grouped];
}

const createBody = z.object({
  key: keySchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  icon: iconSchema.default('folder'),
  visibility: visibilitySchema.default('open'),
  members: z
    .array(z.object({ type: z.enum(['user', 'group']), id: z.string().uuid(), role: roleSchema }))
    .max(200)
    .default([]),
});

const patchBody = z
  .object({
    name: nameSchema,
    description: descriptionSchema.nullable(),
    icon: iconSchema,
    visibility: visibilitySchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const param = z.object({ id: z.string().min(1).max(64) });

export async function spaceRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const detail = async (tx: Tx, actor: Actor, row: Awaited<ReturnType<typeof resolveSpace>>) => ({
    ...row,
    members: await memberSummary(tx, actor.orgId, row.id),
    permissions: presentPermissions(actor, row),
  });

  r.get(
    '/spaces',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          visibility: z.enum(['open', 'private', 'all']).default('all'),
          status: z.enum(['active', 'archived', 'all']).default('active'),
          mine: z.enum(['true', 'false']).default('false'),
          starred: z.enum(['true', 'false']).default('false'),
          key: z.string().trim().max(10).optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      const cols = columnsFor(actor.userId, actor.orgId);
      const conds: (SQL | undefined)[] = [
        visibleTo({ orgId: actor.orgId, isOrgAdmin: isOrgAdmin(actor), role: cols.myRole }),
      ];
      if (q.q) {
        const p = likePattern(q.q);
        conds.push(or(ilike(spaces.name, p), ilike(spaces.key, p), ilike(spaces.description, p)));
      }
      if (q.visibility !== 'all') conds.push(eq(spaces.visibility, q.visibility));
      if (q.status !== 'all') conds.push(eq(spaces.status, q.status));
      if (q.mine === 'true') conds.push(sql`${cols.myRole} is not null`);
      if (q.starred === 'true') conds.push(starredSql(actor.userId));
      if (q.key) conds.push(eq(spaces.key, q.key.toUpperCase()));
      const where = and(...conds);

      return withTenant(deps.db, actor.orgId, async (tx) => {
        const items = await tx
          .select(cols)
          .from(spaces)
          .where(where)
          .orderBy(asc(sql`lower(${spaces.name})`), asc(spaces.id))
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(spaces)
          .where(where);
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.get('/spaces/:id', { preHandler: requireAuth, schema: { params: param } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) =>
      detail(tx, actor, await resolveSpace(tx, actor, req.params.id)),
    );
  });

  r.post('/spaces', { preHandler: requireAuth, schema: { body: createBody } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'space.create')) throw forbidden();
    const b = req.body;

    try {
      return await withTenant(deps.db, actor.orgId, async (tx) => {
        // Keys are unique per workspace and never reused, deleted spaces included.
        const taken = await tx
          .select({ id: spaces.id })
          .from(spaces)
          .where(and(eq(spaces.orgId, actor.orgId), eq(spaces.key, b.key)));
        if (taken.length) throw keyTaken();

        // Validate every requested principal belongs to this workspace.
        const userIds = [...new Set(b.members.filter((m) => m.type === 'user').map((m) => m.id))];
        const groupIds = [...new Set(b.members.filter((m) => m.type === 'group').map((m) => m.id))];
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

        const [created] = await tx
          .insert(spaces)
          .values({
            orgId: actor.orgId,
            key: b.key,
            name: b.name,
            description: b.description || null,
            icon: b.icon,
            visibility: b.visibility,
            ownerId: actor.userId,
          })
          .returning({ id: spaces.id });
        const spaceId = created!.id;

        // The creator is always the first space admin, whatever else was chosen.
        const byPrincipal = new Map<
          string,
          { type: 'user' | 'group'; id: string; role: SpaceRole }
        >();
        for (const m of b.members) byPrincipal.set(`${m.type}:${m.id}`, m);
        byPrincipal.set(`user:${actor.userId}`, { type: 'user', id: actor.userId, role: 'admin' });
        await tx.insert(spaceMembers).values(
          [...byPrincipal.values()].map((m) => ({
            spaceId,
            orgId: actor.orgId,
            principalType: m.type,
            principalId: m.id,
            spaceRole: m.role,
          })),
        );

        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.created',
          targetType: 'space',
          targetId: spaceId,
          after: {
            key: b.key,
            name: b.name,
            visibility: b.visibility,
            memberCount: byPrincipal.size,
          },
        });
        return detail(tx, actor, await resolveSpace(tx, actor, spaceId));
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw keyTaken();
      throw e;
    }
  });

  r.patch(
    '/spaces/:id',
    { preHandler: requireAuth, schema: { params: param, body: patchBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const before = await resolveSpace(tx, actor, req.params.id);
        if (!can(actor, 'space.edit', spaceCtx(before))) throw forbidden();
        if (before.status === 'archived') {
          throw new AppError(409, 'archived', 'Restore this space before editing it');
        }
        const patch = {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined
            ? { description: req.body.description || null }
            : {}),
          ...(req.body.icon !== undefined ? { icon: req.body.icon } : {}),
          ...(req.body.visibility !== undefined ? { visibility: req.body.visibility } : {}),
        };
        await tx
          .update(spaces)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(spaces.id, before.id), eq(spaces.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.updated',
          targetType: 'space',
          targetId: before.id,
          before: Object.fromEntries(
            Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
          ),
          after: patch,
        });
        // A private space the editor can no longer see (they only had access through the old
        // visibility) is impossible: they have a role or are an org admin, so this resolves.
        return detail(tx, actor, await resolveSpace(tx, actor, before.id));
      });
    },
  );

  async function setStatus(actor: Actor, id: string, status: 'active' | 'archived') {
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const row = await resolveSpace(tx, actor, id);
      if (!can(actor, 'space.edit', spaceCtx(row))) throw forbidden();
      if (row.status !== status) {
        await tx
          .update(spaces)
          .set({ status, updatedAt: new Date() })
          .where(and(eq(spaces.id, row.id), eq(spaces.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: status === 'archived' ? 'space.archived' : 'space.restored',
          targetType: 'space',
          targetId: row.id,
          before: { status: row.status },
          after: { status },
        });
      }
      return detail(tx, actor, await resolveSpace(tx, actor, row.id));
    });
  }

  r.post('/spaces/:id/archive', { preHandler: requireAuth, schema: { params: param } }, (req) =>
    setStatus(actorOf(req), req.params.id, 'archived'),
  );
  r.post('/spaces/:id/restore', { preHandler: requireAuth, schema: { params: param } }, (req) =>
    setStatus(actorOf(req), req.params.id, 'active'),
  );

  r.delete(
    '/spaces/:id',
    {
      preHandler: requireAuth,
      // The caller must type the space key, so a stray request cannot delete anything.
      schema: { params: param, querystring: z.object({ confirm: z.string().max(10).optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        const row = await resolveSpace(tx, actor, req.params.id);
        if (!can(actor, 'space.delete', spaceCtx(row))) throw forbidden();
        if ((req.query.confirm ?? '').toUpperCase() !== row.key) {
          throw new AppError(
            400,
            'confirmation_required',
            'Type the space key to confirm deletion',
            {
              confirm: 'Type the space key to confirm',
            },
          );
        }
        // Soft delete: the row stays so the key can never be reused.
        await tx
          .update(spaces)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(spaces.id, row.id), eq(spaces.orgId, actor.orgId)));
        await tx
          .delete(spaceStars)
          .where(and(eq(spaceStars.spaceId, row.id), eq(spaceStars.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'space.deleted',
          targetType: 'space',
          targetId: row.id,
          before: { key: row.key, name: row.name, visibility: row.visibility },
        });
      });
      return { ok: true };
    },
  );

  r.post(
    '/spaces/:id/star',
    {
      preHandler: requireAuth,
      schema: { params: param, body: z.object({ starred: z.boolean().optional() }).default({}) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const row = await resolveSpace(tx, actor, req.params.id);
        if (!can(actor, 'space.view', spaceCtx(row))) throw forbidden();
        const want = req.body.starred ?? !row.starred;
        if (want) {
          await tx
            .insert(spaceStars)
            .values({ spaceId: row.id, orgId: actor.orgId, userId: actor.userId })
            .onConflictDoNothing();
        } else {
          await tx
            .delete(spaceStars)
            .where(
              and(
                eq(spaceStars.spaceId, row.id),
                eq(spaceStars.userId, actor.userId),
                eq(spaceStars.orgId, actor.orgId),
              ),
            );
        }
        return { starred: want };
      });
    },
  );
}
