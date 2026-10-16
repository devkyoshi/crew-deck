import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ITEM_TYPES, MAX_CHECKLIST, PRIORITIES, type ItemType } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { WorkItemDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { containsRegex } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWithinLimit, countWorkItems, loadPlan } from '../plans/index.js';
import { addWatchers, itemChanges, recordActivity, recordChanges } from '../work/activity.js';
import { textToDoc } from '../work/doc.js';
import { mentionsIn, sanitizeDoc } from '../work/rich-text.js';
import type { StorageDriver } from '../storage/index.js';
import { deleteStoredFiles, dropAttachments } from '../work/purge.js';
import { assertTransition, loadWorkflow, resolutionFor, resolutionSchema } from '../work/workflow.js';
import { refreshSearchText, SEARCH_TEXT_VERSION, searchTextOf } from '../work/search-text.js';
import { deliverSafely, eventsFromChanges, type NotifyEvent } from '../work/notify.js';
import { loadFeatures } from '../work/space-features.js';
import { loadSlaPolicy, markFirstResponse, slaDueDates, workCalendar } from '../work/sla.js';
import {
  assertAssignable,
  assertMentionable,
  assertWritable,
  ifMatch,
  listStatuses,
  liveParent,
  loadItemRows,
  lockSpace,
  matchesVersion,
  nextNumber,
  presentItem,
  rankAtEnd,
  resolveItem,
  resolvedAtFor,
  setItemLabels,
  spaceRefs,
  stale,
  statusIn,
  statusLabel,
  validateHierarchy,
  type SpaceRow,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const titleSchema = z.string().trim().min(1, 'Enter a title').max(255, 'Use 255 characters or fewer');
const descriptionSchema = z.string().max(20000, 'That description is too long');
const estimateSchema = z.number().min(0).max(999.9).multipleOf(0.5);
/** Planned or remaining time, in whole minutes (up to 1,000 hours). */
const minutesSchema = z.number().int().min(0).max(60_000);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

const createBody = z.object({
  type: z.enum(ITEM_TYPES),
  title: titleSchema,
  description: descriptionSchema.nullable().optional(),
  /** Rich text from the editor; takes the place of `description`. */
  descriptionDoc: z.unknown().optional(),
  parentId: z.string().uuid().nullable().optional(),
  statusId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeId: z.string().uuid().nullable().optional(),
  estimate: estimateSchema.nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  startDate: dateSchema.nullable().optional(),
  originalMinutes: minutesSchema.nullable().optional(),
  remainingMinutes: minutesSchema.nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
  fixVersionIds: z.array(z.string().uuid()).max(20).optional(),
  affectsVersionIds: z.array(z.string().uuid()).max(20).optional(),
  componentIds: z.array(z.string().uuid()).max(20).optional(),
});

const patchBody = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: titleSchema,
    description: descriptionSchema.nullable(),
    descriptionDoc: z.unknown(),
    parentId: z.string().uuid().nullable(),
    statusId: z.string().uuid(),
    priority: z.enum(PRIORITIES),
    assigneeId: z.string().uuid().nullable(),
    estimate: estimateSchema.nullable(),
    dueDate: dateSchema.nullable(),
    startDate: dateSchema.nullable(),
    originalMinutes: minutesSchema.nullable(),
    remainingMinutes: minutesSchema.nullable(),
    labelIds: z.array(z.string().uuid()).max(20),
    fixVersionIds: z.array(z.string().uuid()).max(20),
    affectsVersionIds: z.array(z.string().uuid()).max(20),
    componentIds: z.array(z.string().uuid()).max(20),
    resolution: resolutionSchema,
    checklist: z
      .array(z.object({ id: z.string().min(1).max(64), text: z.string().trim().min(1).max(200), done: z.boolean() }))
      .max(MAX_CHECKLIST),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => v.description === undefined || v.descriptionDoc === undefined, 'Send description or descriptionDoc, not both');

const listQuery = z.object({
  status: z.string().uuid().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.union([z.string().uuid(), z.literal('none')]).optional(),
  parent: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParam = z.object({ id: z.string().min(1).max(64) });

export async function workItemRoutes(app: FastifyInstance, deps: AuthDeps & { storage?: StorageDriver }) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const itemPermissions = (actor: Actor, space: SpaceRow, reporterId: string) => {
    const ctx = { ...spaceCtx(space), isReporter: reporterId === actor.userId };
    const writable = space.status === 'active';
    return {
      edit: writable && can(actor, 'item.edit', ctx),
      delete: writable && can(actor, 'item.delete', ctx),
    };
  };

  async function fresh(tx: TenantDb, actor: Actor, space: SpaceRow, id: string) {
    const [row] = await loadItemRows(tx, { id });
    if (!row) throw notFound('Work item');
    return {
      ...presentItem(row, space.key),
      permissions: itemPermissions(actor, space, row.reporterId),
    };
  }

  // ---- List -------------------------------------------------------------------------------------------

  r.get(
    '/spaces/:id/items',
    { preHandler: requireAuth, schema: { params: idParam, querystring: listQuery } },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        const filter: Record<string, unknown> = { spaceId: space.id, deletedAt: null };
        if (q.status) filter.statusId = q.status;
        if (q.type) filter.type = q.type;
        if (q.priority) filter.priority = q.priority;
        if (q.assignee === 'none') filter.assigneeId = null;
        else if (q.assignee) filter.assigneeId = q.assignee;
        if (q.parent) filter.parentId = q.parent;
        if (q.q) filter.title = containsRegex(q.q);
        if (q.cursor) {
          const before = Number(q.cursor);
          if (!Number.isInteger(before) || before < 1) {
            throw new AppError(400, 'bad_cursor', 'That page marker is not valid');
          }
          filter.number = { $lt: before };
        }
        const rows = await loadItemRows(tx, filter, { sort: { number: -1 }, limit: q.limit + 1 });
        const page = rows.slice(0, q.limit);
        return {
          items: page.map((row) => presentItem(row, space.key)),
          nextCursor: rows.length > q.limit ? String(page.at(-1)!.number) : null,
        };
      });
    },
  );

  // ---- People who can be assigned -------------------------------------------------------------------------

  r.get(
    '/spaces/:id/assignees',
    {
      preHandler: requireAuth,
      schema: { params: idParam, querystring: z.object({ q: z.string().trim().max(100).optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const space = await resolveSpace(tx, actor, req.params.id);
        // Active members who can open the space: everyone for an open space, otherwise org admins
        // and anyone with a direct or group role.
        const members = await tx.memberships.find({ status: 'active' });
        const people = await tx.users(members.map((m) => m.userId));
        let allowed: Set<string> | null = null;
        if (space.visibility !== 'open') {
          const entries = await tx.spaceMembers.find({ spaceId: space.id });
          const groupIds = entries.filter((e) => e.principalType === 'group').map((e) => e.principalId);
          const links = groupIds.length ? await tx.groupMembers.find({ groupId: { $in: groupIds } }) : [];
          allowed = new Set([
            ...entries.filter((e) => e.principalType === 'user').map((e) => e.principalId),
            ...links.map((l) => l.userId),
          ]);
        }
        const needle = req.query.q?.toLowerCase();
        const items = members
          .filter(
            (m) => !allowed || allowed.has(m.userId) || m.orgRole === 'owner' || m.orgRole === 'admin',
          )
          .flatMap((m) => {
            const u = people.get(m.userId);
            return u ? [u] : [];
          })
          .filter((u) => !needle || [u.name, u.email].some((v) => v?.toLowerCase().includes(needle)))
          .sort(
            (a, b) =>
              (a.name ?? a.email).toLowerCase().localeCompare((b.name ?? b.email).toLowerCase()) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 25);
        return {
          items: items.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl })),
        };
      });
    },
  );

  // ---- Create -----------------------------------------------------------------------------------------

  r.post(
    '/spaces/:id/items',
    { preHandler: requireAuth, schema: { params: idParam, body: createBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      const events: NotifyEvent[] = [];
      const out = await withTenantTx(deps.db, actor.orgId, async (tx) => {
        events.length = 0;
        const space = await resolveSpace(tx, actor, req.params.id);
        // Anyone who can see a service desk may raise a ticket in it; everything else needs member rights.
        const features = await loadFeatures(tx, space.id);
        if (b.type === 'ticket' && !features.includes('tickets')) {
          throw new AppError(422, 'validation_error', 'This space does not take tickets', {
            type: 'Turn on tickets in Board settings to raise one here',
          });
        }
        if (b.type === 'epic' && !features.includes('epics')) {
          throw new AppError(422, 'validation_error', 'This space does not use epics', {
            type: 'Turn on epics in Board settings first',
          });
        }
        const allowed =
          b.type === 'ticket'
            ? can(actor, 'ticket.submit', spaceCtx(space))
            : can(actor, 'item.create', spaceCtx(space));
        if (!allowed) throw forbidden();
        assertWritable(space);
        assertWithinLimit(
          await loadPlan(tx, actor.orgId),
          'work_items',
          await countWorkItems(tx, actor.orgId),
        );

        const parent = b.parentId ? await liveParent(tx, space, b.parentId) : null;
        validateHierarchy(b.type, parent);

        let statusId = b.statusId;
        if (!statusId) {
          const first = (await listStatuses(tx, space.id)).find((s) => s.category === 'todo');
          statusId = first!.id;
        }
        const status = await statusIn(tx, space, statusId);
        const fixVersionIds = await spaceRefs(tx, space, 'versions', b.fixVersionIds ?? [], 'fixVersionIds');
        const affectsVersionIds = await spaceRefs(tx, space, 'versions', b.affectsVersionIds ?? [], 'affectsVersionIds');
        const componentIds = await spaceRefs(tx, space, 'components', b.componentIds ?? [], 'componentIds');
        // Work with no assignee goes to the default assignee of its first component that has one.
        let assigneeId = b.assigneeId ?? null;
        if (!assigneeId && componentIds.length) {
          const comps = await tx.components.find({ id: { $in: componentIds } });
          const first = componentIds.map((id) => comps.find((c) => c.id === id)).find((c) => c?.defaultAssigneeId);
          if (first?.defaultAssigneeId) {
            assigneeId = await assertAssignable(tx, actor.orgId, space, first.defaultAssigneeId).then(
              () => first.defaultAssigneeId,
              () => null,
            );
          }
        }
        if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);
        const rich = b.descriptionDoc !== undefined ? sanitizeDoc(b.descriptionDoc, 'descriptionDoc') : null;
        if (rich) await assertMentionable(tx, space, rich.mentions, 'descriptionDoc');

        // The space lock serialises creates, moves and bulk changes, so ranks cannot collide.
        await lockSpace(tx, space.id);
        const number = await nextNumber(tx, space.id);
        const rank = await rankAtEnd(tx, space.id, statusId);
        const now = new Date();
        const sla =
          b.type === 'ticket'
            ? slaDueDates(await loadSlaPolicy(tx, space.id), b.priority, now, await workCalendar(tx))
            : null;
        const created = await tx.workItems.insert({
          spaceId: space.id,
          number,
          type: b.type,
          parentId: b.parentId ?? null,
          title: b.title,
          description: rich ? rich.doc : textToDoc(b.description),
          searchText: searchTextOf(rich ? rich.doc : textToDoc(b.description)),
          searchVersion: SEARCH_TEXT_VERSION,
          statusId,
          priority: b.priority,
          assigneeId,
          reporterId: actor.userId,
          fixVersionIds,
          affectsVersionIds,
          componentIds,
          estimate: b.estimate ?? null,
          dueDate: b.dueDate ?? null,
          startDate: b.startDate ?? null,
          originalMinutes: b.originalMinutes ?? null,
          remainingMinutes: b.remainingMinutes ?? b.originalMinutes ?? null,
          rank,
          ...(sla
            ? { slaResponseDueAt: sla.response, slaResolveDueAt: sla.resolve, firstResponseAt: null }
            : {}),
          resolvedAt: resolvedAtFor(status.category, null, now),
          createdAt: now,
          updatedAt: now,
        });
        if (b.labelIds?.length) await setItemLabels(tx, actor.orgId, space, created.id, b.labelIds);
        await recordActivity(tx, { item: created, actorId: actor.userId, kind: 'created' });
        await addWatchers(tx, created.id, [actor.userId, assigneeId, ...(rich?.mentions ?? [])]);
        const base = { orgId: actor.orgId, actorId: actor.userId, itemId: created.id };
        if (assigneeId) events.push({ type: 'assigned', ...base, userId: assigneeId });
        if (rich?.mentions.length) events.push({ type: 'mentioned', ...base, userIds: rich.mentions, excerpt: rich.text.slice(0, 200) });
        if (b.type === 'ticket') events.push({ type: 'ticket_received', ...base });
        return fresh(tx, actor, space, created.id);
      });
      await deliverSafely(deps.db, events, req.log);
      return out;
    },
  );

  // ---- Read -------------------------------------------------------------------------------------------

  r.get('/items/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const { row, space } = await resolveItem(tx, actor, req.params.id);
      return {
        ...presentItem(row, space.key),
        permissions: itemPermissions(actor, space, row.reporterId),
      };
    });
  });

  r.get(
    '/items/:id/subtasks',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const { row, space } = await resolveItem(tx, actor, req.params.id);
        const rows = await loadItemRows(
          tx,
          { parentId: row.id, deletedAt: null },
          { sort: { number: 1 } },
        );
        return { items: rows.map((child) => presentItem(child, space.key)) };
      });
    },
  );

  // ---- Update -----------------------------------------------------------------------------------------

  r.patch(
    '/items/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: patchBody } },
    async (req) => {
      const actor = actorOf(req);
      const b = req.body;
      const expected = ifMatch(req);
      const events: NotifyEvent[] = [];
      const out = await withTenantTx(deps.db, actor.orgId, async (tx) => {
        events.length = 0;
        const { row, space } = await resolveItem(tx, actor, req.params.id);
        if (!can(actor, 'item.edit', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
          throw forbidden();
        }
        assertWritable(space);

        const type: ItemType = b.type ?? row.type;
        if (b.type !== undefined && (b.type === 'ticket') !== (row.type === 'ticket')) {
          throw new AppError(422, 'validation_error', 'A ticket cannot become another type', {
            type: 'Tickets keep their type',
          });
        }
        const parentId = b.parentId === undefined ? row.parentId : b.parentId;
        if (b.type !== undefined || b.parentId !== undefined) {
          const parent = parentId ? await liveParent(tx, space, parentId) : null;
          if (parentId === row.id) {
            throw new AppError(422, 'invalid_parent', 'An item cannot be its own parent', {
              parentId: 'An item cannot be its own parent',
            });
          }
          const kids = await tx.workItems.find(
            { parentId: row.id, deletedAt: null },
            { projection: { type: 1 } },
          );
          validateHierarchy(type, parent, kids.map((k) => k.type));
        }
        if (b.assigneeId) await assertAssignable(tx, actor.orgId, space, b.assigneeId);
        const rich = b.descriptionDoc !== undefined ? sanitizeDoc(b.descriptionDoc, 'descriptionDoc') : null;
        const before = mentionsIn(row.description);
        const newMentions = (rich?.mentions ?? []).filter((m) => !before.includes(m));
        await assertMentionable(tx, space, newMentions, 'descriptionDoc');

        await lockSpace(tx, space.id);
        const now = new Date();
        const set: Partial<WorkItemDoc> = { updatedAt: now };
        if (b.title !== undefined) set.title = b.title;
        if (b.description !== undefined) set.description = textToDoc(b.description);
        if (rich) set.description = rich.doc;
        if (b.type !== undefined) set.type = b.type;
        if (b.parentId !== undefined) set.parentId = b.parentId;
        if (b.priority !== undefined) {
          set.priority = b.priority;
          // A new priority restarts the targets from when the ticket was raised.
          if (row.type === 'ticket' && b.priority !== row.priority) {
            const due = slaDueDates(await loadSlaPolicy(tx, space.id), b.priority, row.createdAt, await workCalendar(tx));
            set.slaResponseDueAt = due.response;
            set.slaResolveDueAt = due.resolve;
          }
        }
        if (b.assigneeId !== undefined) set.assigneeId = b.assigneeId;
        if (b.estimate !== undefined) set.estimate = b.estimate;
        if (b.dueDate !== undefined) set.dueDate = b.dueDate;
        if (b.startDate !== undefined) set.startDate = b.startDate;
        if (b.originalMinutes !== undefined) set.originalMinutes = b.originalMinutes;
        if (b.remainingMinutes !== undefined) set.remainingMinutes = b.remainingMinutes;
        {
          const start = set.startDate !== undefined ? set.startDate : (row.startDate ?? null);
          const due = set.dueDate !== undefined ? set.dueDate : row.dueDate;
          if (start && due && due < start) {
            throw new AppError(422, 'invalid_dates', 'The due date cannot be before the start date', {
              dueDate: 'Choose a date on or after the start',
            });
          }
        }
        if (b.fixVersionIds !== undefined) set.fixVersionIds = await spaceRefs(tx, space, 'versions', b.fixVersionIds, 'fixVersionIds');
        if (b.affectsVersionIds !== undefined) set.affectsVersionIds = await spaceRefs(tx, space, 'versions', b.affectsVersionIds, 'affectsVersionIds');
        if (b.componentIds !== undefined) set.componentIds = await spaceRefs(tx, space, 'components', b.componentIds, 'componentIds');
        if (b.statusId !== undefined && b.statusId !== row.statusId) {
          const target = await statusIn(tx, space, b.statusId);
          assertTransition(await loadWorkflow(tx, space.id), await statusLabel(tx, row.statusId), await statusLabel(tx, target.id));
          set.statusId = target.id;
          set.rank = await rankAtEnd(tx, space.id, target.id);
          set.resolvedAt = resolvedAtFor(target.category, null, now);
          set.resolution = resolutionFor(target.category, row.resolution, b.resolution);
        } else if (b.resolution !== undefined) {
          const cat = (await tx.spaceStatuses.get(row.statusId))?.category;
          if (cat !== 'done') {
            throw new AppError(422, 'not_resolved', 'Only finished items have a resolution', { resolution: 'Move the item to a Done status first' });
          }
          set.resolution = b.resolution;
        }
        if (b.checklist !== undefined) {
          const ids = new Set(b.checklist.map((c) => c.id));
          if (ids.size !== b.checklist.length) {
            throw new AppError(422, 'invalid_checklist', 'Checklist entries need distinct ids', { checklist: 'Reload and try again' });
          }
          set.checklist = b.checklist;
        }

        // The version check lives in the update's filter, so two simultaneous edits cannot both win.
        const updated = await tx.workItems.updateOne({ id: row.id, ...matchesVersion(expected) }, set);
        if (updated === 0) throw stale();
        if (set.description !== undefined) await refreshSearchText(tx, row.id);
        if (b.labelIds !== undefined) await setItemLabels(tx, actor.orgId, space, row.id, b.labelIds);
        const after = await fresh(tx, actor, space, row.id);
        const changes = itemChanges(presentItem(row, space.key), after);
        await recordChanges(tx, row, actor.userId, changes);
        await addWatchers(tx, row.id, [b.assigneeId, ...newMentions]);
        if (b.statusId !== undefined || b.assigneeId !== undefined) await markFirstResponse(tx, row, actor.userId, now);
        events.push(...eventsFromChanges(actor.orgId, actor.userId, row.id, changes));
        if (newMentions.length) {
          events.push({ type: 'mentioned', orgId: actor.orgId, actorId: actor.userId, itemId: row.id, userIds: newMentions, excerpt: rich?.text.slice(0, 200) });
        }
        return after;
      });
      await deliverSafely(deps.db, events, req.log);
      return out;
    },
  );

  // ---- Delete -----------------------------------------------------------------------------------------

  r.delete('/items/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    let files: string[] = [];
    const result = await withTenantTx(deps.db, actor.orgId, async (tx) => {
      const { row, space } = await resolveItem(tx, actor, req.params.id);
      if (!can(actor, 'item.delete', { ...spaceCtx(space), isReporter: row.reporterId === actor.userId })) {
        throw forbidden();
      }
      assertWritable(space);
      const now = new Date();
      // Subtasks go with their parent. Stories under a deleted epic stay; they just lose the epic.
      const children =
        row.type === 'epic'
          ? []
          : await tx.workItems.find(
              { parentId: row.id, deletedAt: null },
              { projection: { id: 1 } },
            );
      const ids = [row.id, ...children.map((c) => c.id)];
      await tx.workItems.updateMany(
        { id: { $in: ids }, deletedAt: null },
        { deletedAt: now, updatedAt: now },
      );
      await recordActivity(tx, { item: row, actorId: actor.userId, kind: 'deleted' });
      files = await dropAttachments(tx, ids);
      return { deleted: ids.length, subtasks: children.length };
    });
    await deleteStoredFiles(deps.storage, files, req.log);
    return result;
  });
}
