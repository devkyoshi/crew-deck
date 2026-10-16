import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ITEM_TYPES } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { isDuplicateKey, withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { ComponentDoc, VersionDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { liveTouch } from '../lib/live.js';
import { DATE_RE, isRealDate, localDate } from '../lib/time.js';
import { can, type Actor } from '../permissions/can.js';
import { assertFeature, hasFeature, loadPlan } from '../plans/index.js';
import { assertAssignable, assertWritable, listStatuses, type SpaceRow } from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const date = z.string().regex(DATE_RE, 'Use the format YYYY-MM-DD').refine(isRealDate, 'That date does not exist');
const name = z.string().trim().min(1, 'Enter a name').max(60, 'Use 60 characters or fewer');

const versionBody = z.object({
  name,
  description: z.string().trim().max(1000).default(''),
  startDate: date.nullable().default(null),
  releaseDate: date.nullable().default(null),
});
const versionPatch = versionBody
  .partial()
  .extend({ state: z.enum(['unreleased', 'archived']).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const componentBody = z.object({
  name,
  description: z.string().trim().max(1000).default(''),
  leadId: z.string().uuid().nullable().default(null),
  defaultAssigneeId: z.string().uuid().nullable().default(null),
});
const componentPatch = componentBody.partial().strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const MAX_VERSIONS = 200;
const MAX_COMPONENTS = 100;

const nameTaken = (what: string) =>
  new AppError(409, 'name_taken', `A ${what} with that name already exists in this space`, {
    name: `A ${what} with that name already exists`,
  });

/** Releases (versions) and components of a space. Reading is open to anyone who can open the space. */
export async function versionRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function loadVersion(t: TenantDb, actor: Actor, id: string) {
    const version = await t.versions.get(id);
    if (!version) throw notFound('Version');
    const space = await resolveSpace(t, actor, version.spaceId).catch(() => {
      throw notFound('Version');
    });
    return { version, space };
  }
  async function loadComponent(t: TenantDb, actor: Actor, id: string) {
    const component = await t.components.get(id);
    if (!component) throw notFound('Component');
    const space = await resolveSpace(t, actor, component.spaceId).catch(() => {
      throw notFound('Component');
    });
    return { component, space };
  }

  const present = (v: VersionDoc, counts: { total: number; done: number }) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    startDate: v.startDate,
    releaseDate: v.releaseDate,
    state: v.state,
    releasedAt: v.releasedAt,
    total: counts.total,
    done: counts.done,
    open: counts.total - counts.done,
    overdue: v.state === 'unreleased' && !!v.releaseDate && v.releaseDate < localDate(new Date(), 'UTC') && counts.total - counts.done > 0,
  });

  /** Items per version (live ones only), and how many of them are in a Done status. */
  async function countsFor(t: TenantDb, space: { id: string }, ids: string[]) {
    const out = new Map<string, { total: number; done: number }>();
    if (!ids.length) return out;
    const doneIds = (await listStatuses(t, space.id)).filter((s) => s.category === 'done').map((s) => s.id);
    const rows = await t.workItems.find(
      { spaceId: space.id, deletedAt: null, fixVersionIds: { $in: ids } },
      { projection: { fixVersionIds: 1, statusId: 1 } },
    );
    for (const row of rows) {
      for (const id of row.fixVersionIds ?? []) {
        if (!ids.includes(id)) continue;
        const c = out.get(id) ?? { total: 0, done: 0 };
        c.total++;
        if (doneIds.includes(row.statusId)) c.done++;
        out.set(id, c);
      }
    }
    return out;
  }

  const permissions = (actor: Actor, space: SpaceRow) => {
    const ctx = spaceCtx(space);
    const writable = space.status === 'active';
    return {
      manage: writable && can(actor, 'version.manage', ctx),
      release: writable && can(actor, 'version.release', ctx),
      manageComponents: writable && can(actor, 'component.manage', ctx),
    };
  };

  // ---- Versions ------------------------------------------------------------------------------------------

  r.get('/spaces/:id/versions', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const rows = await t.versions.find({ spaceId: space.id }, { sort: { createdAt: 1 } });
      const counts = await countsFor(t, space, rows.map((v) => v.id));
      const plan = await loadPlan(t, actor.orgId);
      return {
        items: rows.map((v) => present(v, counts.get(v.id) ?? { total: 0, done: 0 })),
        permissions: permissions(actor, space),
        feature: hasFeature(plan, 'releases'),
      };
    });
  });

  r.post(
    '/spaces/:id/versions',
    { preHandler: requireAuth, schema: { params: idParam, body: versionBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'version.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        assertFeature(await loadPlan(t, actor.orgId), 'releases', 'Releases');
        if (b.startDate && b.releaseDate && b.releaseDate < b.startDate) {
          throw new AppError(422, 'invalid_dates', 'The release date cannot be before the start date', {
            releaseDate: 'Choose a date on or after the start',
          });
        }
        if ((await t.versions.count({ spaceId: space.id })) >= MAX_VERSIONS) {
          throw new AppError(409, 'too_many', `A space can have up to ${MAX_VERSIONS} versions`);
        }
        try {
          const v = await t.versions.insert({
            spaceId: space.id,
            name: b.name,
            nameLower: b.name.toLowerCase(),
            description: b.description,
            startDate: b.startDate,
            releaseDate: b.releaseDate,
            state: 'unreleased',
            releasedAt: null,
            createdAt: new Date(),
          });
          liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'version', itemId: null });
          return present(v, { total: 0, done: 0 });
        } catch (e) {
          if (isDuplicateKey(e)) throw nameTaken('version');
          throw e;
        }
      });
    },
  );

  r.patch(
    '/versions/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: versionPatch } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { version, space } = await loadVersion(t, actor, req.params.id);
        if (!can(actor, 'version.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        assertFeature(await loadPlan(t, actor.orgId), 'releases', 'Releases');
        if (version.state === 'released' && b.state === 'unreleased') {
          throw new AppError(409, 'already_released', 'A released version cannot be reopened');
        }
        const set: Partial<VersionDoc> = {};
        if (b.name !== undefined) {
          set.name = b.name;
          set.nameLower = b.name.toLowerCase();
        }
        if (b.description !== undefined) set.description = b.description;
        if (b.startDate !== undefined) set.startDate = b.startDate;
        if (b.releaseDate !== undefined) set.releaseDate = b.releaseDate;
        if (b.state !== undefined && version.state !== 'released') set.state = b.state;
        // Archiving a released version keeps it released: archived is "hide it", not "undo it".
        if (b.state === 'archived' && version.state === 'released') set.state = 'archived';
        const start = set.startDate !== undefined ? set.startDate : version.startDate;
        const end = set.releaseDate !== undefined ? set.releaseDate : version.releaseDate;
        if (start && end && end < start) {
          throw new AppError(422, 'invalid_dates', 'The release date cannot be before the start date', {
            releaseDate: 'Choose a date on or after the start',
          });
        }
        try {
          await t.versions.updateOne({ id: version.id }, set);
        } catch (e) {
          if (isDuplicateKey(e)) throw nameTaken('version');
          throw e;
        }
        const fresh = (await t.versions.get(version.id))!;
        liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'version', itemId: null });
        return present(fresh, (await countsFor(t, space, [version.id])).get(version.id) ?? { total: 0, done: 0 });
      });
    },
  );

  r.delete('/versions/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const { version, space } = await loadVersion(t, actor, req.params.id);
      if (!can(actor, 'version.manage', spaceCtx(space))) throw forbidden();
      assertWritable(space);
      assertFeature(await loadPlan(t, actor.orgId), 'releases', 'Releases');
      // The version leaves every item that carried it; the items themselves are untouched.
      await t.workItems.updateMany(
        { spaceId: space.id, $or: [{ fixVersionIds: version.id }, { affectsVersionIds: version.id }] },
        { $pull: { fixVersionIds: version.id, affectsVersionIds: version.id } } as never,
      );
      await t.versions.deleteOne({ id: version.id });
      liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'version', itemId: null });
      return { ok: true };
    });
  });

  /**
   * Releases a version. Items that are not finished either move to another unreleased version of the
   * space (`moveOpenTo`) or simply leave this one (`null`).
   */
  r.post(
    '/versions/:id/release',
    {
      preHandler: requireAuth,
      schema: { params: idParam, body: z.object({ moveOpenTo: z.string().uuid().nullable().default(null) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { version, space } = await loadVersion(t, actor, req.params.id);
        if (!can(actor, 'version.release', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        assertFeature(await loadPlan(t, actor.orgId), 'releases', 'Releases');
        if (version.state !== 'unreleased') throw new AppError(409, 'already_released', 'This version is already released');
        let target: VersionDoc | null = null;
        if (req.body.moveOpenTo) {
          target = await t.versions.findOne({ id: req.body.moveOpenTo, spaceId: space.id });
          if (!target || target.id === version.id || target.state !== 'unreleased') {
            throw new AppError(422, 'invalid_version', 'Choose another version that is not released yet', {
              moveOpenTo: 'Choose an unreleased version',
            });
          }
        }
        const doneIds = (await listStatuses(t, space.id)).filter((s) => s.category === 'done').map((s) => s.id);
        const open = await t.workItems.find(
          { spaceId: space.id, deletedAt: null, fixVersionIds: version.id, statusId: { $nin: doneIds } },
          { projection: { id: 1, fixVersionIds: 1 } },
        );
        const now = new Date();
        for (const item of open) {
          const rest = (item.fixVersionIds ?? []).filter((x) => x !== version.id);
          const next = target && !rest.includes(target.id) ? [...rest, target.id] : rest;
          await t.workItems.updateOne({ id: item.id }, { fixVersionIds: next, updatedAt: now });
        }
        await t.versions.updateOne(
          { id: version.id },
          { state: 'released', releasedAt: now, releaseDate: version.releaseDate ?? localDate(now, 'UTC') },
        );
        liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'version', itemId: null });
        return { ok: true, moved: target ? open.length : 0, removed: target ? 0 : open.length };
      });
    },
  );

  /** What shipped (finished work, grouped by type) and what did not, ready to read or copy. */
  r.get('/versions/:id/notes', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { version, space } = await loadVersion(t, actor, req.params.id);
      const statuses = await listStatuses(t, space.id);
      const doneIds = new Set(statuses.filter((s) => s.category === 'done').map((s) => s.id));
      const docs = await t.workItems.find(
        { spaceId: space.id, deletedAt: null, fixVersionIds: version.id },
        { sort: { number: 1 }, projection: { id: 1, number: 1, type: 1, title: 1, statusId: 1, resolution: 1 } },
      );
      const row = (d: (typeof docs)[number]) => ({
        id: d.id,
        key: `${space.key}-${d.number}`,
        type: d.type,
        title: d.title,
        resolution: doneIds.has(d.statusId) ? (d.resolution ?? 'done') : null,
      });
      // Work finished as "won't do" or "duplicate" did not ship, so it is not in the notes.
      const shipped = docs.filter((d) => doneIds.has(d.statusId) && (d.resolution ?? 'done') === 'done').map(row);
      const notShipped = docs.filter((d) => !shipped.some((s) => s.id === d.id)).map(row);
      return {
        version: { id: version.id, name: version.name, state: version.state, releaseDate: version.releaseDate, description: version.description },
        groups: ITEM_TYPES.map((type) => ({ type, items: shipped.filter((i) => i.type === type) })).filter((g) => g.items.length),
        notShipped,
      };
    });
  });

  // ---- Components ----------------------------------------------------------------------------------------

  const presentComponent = async (t: TenantDb, rows: ComponentDoc[]) => {
    const people = await t.users(rows.flatMap((c) => [c.leadId, c.defaultAssigneeId].filter((x): x is string => !!x)));
    const person = (id: string | null) => {
      const u = id ? people.get(id) : undefined;
      return u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null;
    };
    const counts = rows.length
      ? await t.workItems.aggregate<{ _id: string; n: number }>([
          { $match: { deletedAt: null, componentIds: { $in: rows.map((c) => c.id) } } },
          { $unwind: '$componentIds' },
          { $match: { componentIds: { $in: rows.map((c) => c.id) } } },
          { $group: { _id: '$componentIds', n: { $sum: 1 } } },
        ])
      : [];
    const byId = new Map(counts.map((c) => [c._id, c.n]));
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      lead: person(c.leadId),
      defaultAssignee: person(c.defaultAssigneeId),
      itemCount: byId.get(c.id) ?? 0,
    }));
  };

  r.get('/spaces/:id/components', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const rows = await t.components.find({ spaceId: space.id }, { sort: { nameLower: 1 } });
      return { items: await presentComponent(t, rows), permissions: permissions(actor, space) };
    });
  });

  async function checkPeople(t: TenantDb, actor: Actor, space: SpaceRow, ids: (string | null | undefined)[]) {
    for (const id of ids) if (id) await assertAssignable(t, actor.orgId, space, id);
  }

  r.post(
    '/spaces/:id/components',
    { preHandler: requireAuth, schema: { params: idParam, body: componentBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'component.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        await checkPeople(t, actor, space, [b.leadId, b.defaultAssigneeId]);
        if ((await t.components.count({ spaceId: space.id })) >= MAX_COMPONENTS) {
          throw new AppError(409, 'too_many', `A space can have up to ${MAX_COMPONENTS} components`);
        }
        try {
          const c = await t.components.insert({
            spaceId: space.id,
            name: b.name,
            nameLower: b.name.toLowerCase(),
            description: b.description,
            leadId: b.leadId,
            defaultAssigneeId: b.defaultAssigneeId,
            createdAt: new Date(),
          });
          return (await presentComponent(t, [c]))[0]!;
        } catch (e) {
          if (isDuplicateKey(e)) throw nameTaken('component');
          throw e;
        }
      });
    },
  );

  r.patch(
    '/components/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: componentPatch } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { component, space } = await loadComponent(t, actor, req.params.id);
        if (!can(actor, 'component.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        await checkPeople(t, actor, space, [b.leadId, b.defaultAssigneeId]);
        const set: Partial<ComponentDoc> = {};
        if (b.name !== undefined) {
          set.name = b.name;
          set.nameLower = b.name.toLowerCase();
        }
        if (b.description !== undefined) set.description = b.description;
        if (b.leadId !== undefined) set.leadId = b.leadId;
        if (b.defaultAssigneeId !== undefined) set.defaultAssigneeId = b.defaultAssigneeId;
        try {
          await t.components.updateOne({ id: component.id }, set);
        } catch (e) {
          if (isDuplicateKey(e)) throw nameTaken('component');
          throw e;
        }
        return (await presentComponent(t, [(await t.components.get(component.id))!]))[0]!;
      });
    },
  );

  r.delete('/components/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const { component, space } = await loadComponent(t, actor, req.params.id);
      if (!can(actor, 'component.manage', spaceCtx(space))) throw forbidden();
      assertWritable(space);
      await t.workItems.updateMany({ spaceId: space.id, componentIds: component.id }, { $pull: { componentIds: component.id } } as never);
      await t.components.deleteOne({ id: component.id });
      return { ok: true };
    });
  });
}
