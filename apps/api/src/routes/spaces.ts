import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { assertFeature, assertWithinLimit, countSpaces, loadPlan } from '../plans/index.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { containsRegex, offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor, type SpaceRole } from '../permissions/can.js';
import {
  isOrgAdmin,
  loadVisibleSpaces,
  type SpaceView,
} from '../spaces/access.js';
import { seedSpaceWork } from '../work/seed.js';

export { isOrgAdmin };

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

/** Loads a space by id or key, or 404s. Hidden spaces look exactly like missing ones. */
export async function resolveSpace(t: TenantDb, actor: Actor, param: string): Promise<SpaceView> {
  const byId = UUID.test(param);
  const [row] = await loadVisibleSpaces(t, actor, byId ? { id: param } : { key: param.toUpperCase() });
  if (!row) throw notFound('Space');
  return row;
}

export const spaceCtx = (row: { myRole: SpaceRole | null; visibility: 'open' | 'private' }) => ({
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
    viewAudit: can(actor, 'audit.viewSpace', ctx),
  };
}

async function memberSummary(t: TenantDb, spaceId: string) {
  const direct = await t.spaceMembers.find(
    { spaceId, principalType: 'user' },
    { sort: { createdAt: 1 }, limit: 8 },
  );
  const people = await t.users(direct.map((d) => d.principalId));
  const grouped = await t.spaceMembers.find(
    { spaceId, principalType: 'group' },
    { sort: { createdAt: 1 }, limit: 8 },
  );
  const gs = grouped.length ? await t.groups.find({ id: { $in: grouped.map((g) => g.principalId) } }) : [];
  const groupName = new Map(gs.map((g) => [g.id, g.name]));
  return [
    ...direct.flatMap((d) => {
      const u = people.get(d.principalId);
      return u
        ? [
            {
              type: 'user' as const,
              id: u.id,
              name: u.name,
              email: u.email,
              avatarUrl: u.avatarUrl,
              role: d.spaceRole,
            },
          ]
        : [];
    }),
    ...grouped.flatMap((g) =>
      groupName.has(g.principalId)
        ? [
            {
              type: 'group' as const,
              id: g.principalId,
              name: groupName.get(g.principalId)!,
              role: g.spaceRole,
            },
          ]
        : [],
    ),
  ];
}

const createBody = z.object({
  key: keySchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  icon: iconSchema.default('folder'),
  visibility: visibilitySchema.default('open'),
  boardType: z.enum(['kanban', 'scrum', 'service']).default('kanban'),
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

  const detail = async (tx: TenantDb, actor: Actor, row: SpaceView) => ({
    ...row,
    boardType: (await tx.boards.findOne({ spaceId: row.id }, { projection: { type: 1 } }))?.type ?? 'kanban',
    members: await memberSummary(tx, row.id),
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
      const filter: Record<string, unknown> = {};
      if (q.q) {
        const rx = containsRegex(q.q);
        filter.$or = [{ name: rx }, { key: rx }, { description: rx }];
      }
      if (q.visibility !== 'all') filter.visibility = q.visibility;
      if (q.status !== 'all') filter.status = q.status;
      if (q.key) filter.key = q.key.toUpperCase();

      return withTenant(deps.db, actor.orgId, async (tx) => {
        let rows = await loadVisibleSpaces(tx, actor, filter);
        if (q.mine === 'true') rows = rows.filter((r) => r.myRole !== null);
        if (q.starred === 'true') rows = rows.filter((r) => r.starred);
        rows.sort(
          (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id),
        );
        const items = rows.slice(offsetOf(q), offsetOf(q) + q.pageSize);
        return { items, total: rows.length, page: q.page, pageSize: q.pageSize };
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
      return await withTenantTx(deps.db, actor.orgId, async (tx) => {
        const plan = await loadPlan(tx, actor.orgId);
        assertWithinLimit(plan, 'spaces', await countSpaces(tx, actor.orgId));
        if (b.boardType === 'scrum') {
          assertFeature(plan, 'scrum_sprints', 'Scrum boards');
        }
        if (b.boardType === 'service') {
          assertFeature(plan, 'service_desk', 'Service desks');
        }
        // Keys are unique per workspace and never reused, deleted spaces included.
        if (await tx.spaces.exists({ key: b.key })) throw keyTaken();

        // Validate every requested principal belongs to this workspace.
        const userIds = [...new Set(b.members.filter((m) => m.type === 'user').map((m) => m.id))];
        const groupIds = [...new Set(b.members.filter((m) => m.type === 'group').map((m) => m.id))];
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

        const created = await tx.spaces.insert({
          key: b.key,
          name: b.name,
          description: b.description || null,
          icon: b.icon,
          visibility: b.visibility,
          ownerId: actor.userId,
        });
        const spaceId = created.id;
        // Board, counter and starting columns (the old database trigger), from the workspace template.
        await seedSpaceWork(tx, spaceId, { boardType: b.boardType });

        // The creator is always the first space admin, whatever else was chosen.
        const byPrincipal = new Map<
          string,
          { type: 'user' | 'group'; id: string; role: SpaceRole }
        >();
        for (const m of b.members) byPrincipal.set(`${m.type}:${m.id}`, m);
        byPrincipal.set(`user:${actor.userId}`, { type: 'user', id: actor.userId, role: 'admin' });
        await tx.spaceMembers.insert(
          [...byPrincipal.values()].map((m) => ({
            spaceId,
            principalType: m.type,
            principalId: m.id,
            spaceRole: m.role,
          })),
        );

        for (const m of byPrincipal.values()) {
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'space.member_added',
            targetType: 'space',
            targetId: spaceId,
            after: { principalType: m.type, principalId: m.id, role: m.role },
          });
        }
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
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
        await tx.spaces.updateOne({ id: before.id }, { ...patch, updatedAt: new Date() });
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
    return withTenantTx(deps.db, actor.orgId, async (tx) => {
      const row = await resolveSpace(tx, actor, id);
      if (!can(actor, 'space.edit', spaceCtx(row))) throw forbidden();
      if (row.status !== status) {
        await tx.spaces.updateOne({ id: row.id }, { status, updatedAt: new Date() });
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
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
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
        await tx.spaces.updateOne({ id: row.id }, { deletedAt: new Date(), updatedAt: new Date() });
        await tx.spaceStars.deleteMany({ spaceId: row.id });
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
          await tx.spaceStars.insertIgnore({ spaceId: row.id, userId: actor.userId });
        } else {
          await tx.spaceStars.deleteMany({ spaceId: row.id, userId: actor.userId });
        }
        return { starred: want };
      });
    },
  );
}
