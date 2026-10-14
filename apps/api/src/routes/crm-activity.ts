import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { assertActiveMember, crmGuard, idParam, ownerNames, uuid } from '../crm/helpers.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { CrmActivityDoc, CrmNoteDoc, CrmRecordType } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';

const linkedType = z.enum(['company', 'contact', 'lead', 'deal']);
const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task'] as const;

/** The record an activity or note is attached to must exist in this workspace and not be deleted. */
async function assertLinked(tx: TenantDb, _orgId: string, type: CrmRecordType, id: string) {
  const repo = {
    company: tx.crmCompanies,
    contact: tx.crmContacts,
    lead: tx.crmLeads,
    deal: tx.crmDeals,
  }[type] as typeof tx.crmCompanies;
  if (!(await repo.exists({ id, deletedAt: null }))) {
    throw new AppError(400, 'validation_error', 'That record does not exist', {
      linkedId: 'Choose an existing record',
    });
  }
}

export async function crmActivityRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Activities -----------------------------------------------------------------------------
  async function presentActivities(tx: TenantDb, rows: CrmActivityDoc[]) {
    const names = await ownerNames(tx, rows.map((a) => a.assigneeId));
    return rows.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      dueAt: a.dueAt,
      completedAt: a.completedAt,
      assigneeId: a.assigneeId,
      assigneeName: a.assigneeId ? (names.get(a.assigneeId) ?? null) : null,
      linkedType: a.linkedType,
      linkedId: a.linkedId,
      createdAt: a.createdAt,
    }));
  }

  async function activityById(tx: TenantDb, id: string) {
    const row = await tx.crmActivities.get(id);
    return row ? (await presentActivities(tx, [row]))[0] : undefined;
  }

  r.get(
    '/crm/activities',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          linkedType: linkedType.optional(),
          linkedId: uuid.optional(),
          assigneeId: uuid.optional(),
          type: z.enum(ACTIVITY_TYPES).optional(),
          // open = not done, overdue = not done and past due, done = completed
          status: z.enum(['open', 'overdue', 'done']).optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const filter: Record<string, unknown> = {};
        if (q.linkedType) filter.linkedType = q.linkedType;
        if (q.linkedId) filter.linkedId = q.linkedId;
        if (q.assigneeId) filter.assigneeId = q.assigneeId;
        if (q.type) filter.type = q.type;
        if (q.status === 'done') filter.completedAt = { $ne: null };
        if (q.status === 'open') filter.completedAt = null;
        if (q.status === 'overdue') {
          filter.completedAt = null;
          filter.dueAt = { $lt: new Date() };
        }
        const rows = await tx.crmActivities.aggregate<CrmActivityDoc>([
          { $match: filter },
          {
            // Open items first, soonest due first; finished items after, newest first.
            $addFields: {
              _done: { $cond: [{ $ne: [{ $ifNull: ['$completedAt', null] }, null] }, 1, 0] },
              _noDue: { $cond: [{ $eq: [{ $ifNull: ['$dueAt', null] }, null] }, 1, 0] },
            },
          },
          { $sort: { _done: 1, _noDue: 1, dueAt: 1, createdAt: -1, id: 1 } },
          { $skip: offsetOf(q) },
          { $limit: q.pageSize },
          { $project: { _id: 0, _done: 0, _noDue: 0 } },
        ]);
        const total = await tx.crmActivities.count(filter);
        return { items: await presentActivities(tx, rows), total, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  const activityBody = z.object({
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().min(1, 'Enter a subject').max(200),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    assigneeId: uuid.nullable().optional(),
    linkedType: linkedType.nullable().optional(),
    linkedId: uuid.nullable().optional(),
  });
  const linkedPair = (v: { linkedType?: string | null; linkedId?: string | null }) =>
    Boolean(v.linkedType) === Boolean(v.linkedId);

  r.post(
    '/crm/activities',
    {
      preHandler: requireAuth,
      schema: {
        body: activityBody.refine(linkedPair, {
          message: 'Give both the record type and the record',
          path: ['linkedId'],
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const b = req.body;
        await assertActiveMember(tx, actor.orgId, b.assigneeId, 'assigneeId');
        if (b.linkedType && b.linkedId)
          await assertLinked(tx, actor.orgId, b.linkedType, b.linkedId);
        const row = await tx.crmActivities.insert({
          type: b.type,
          subject: b.subject,
          dueAt: b.dueAt ? new Date(b.dueAt) : null,
          assigneeId: b.assigneeId ?? actor.userId,
          linkedType: b.linkedType ?? null,
          linkedId: b.linkedId ?? null,
          createdBy: actor.userId,
        });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.activity_created',
          targetType: b.linkedType ? (`crm_${b.linkedType}` as 'crm_deal') : 'crm_lead',
          targetId: b.linkedId ?? row.id,
          after: { type: b.type, subject: b.subject },
        });
        return (await activityById(tx, row.id))!;
      });
    },
  );

  r.patch(
    '/crm/activities/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: activityBody
          .pick({ type: true, subject: true, dueAt: true, assigneeId: true })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const b = req.body;
        await assertActiveMember(tx, actor.orgId, b.assigneeId, 'assigneeId');
        const { dueAt, ...rest } = b;
        const done = await tx.crmActivities.updateOne(
          { id: req.params.id },
          {
            ...rest,
            ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
          },
        );
        if (!done) throw notFound('Activity');
        return (await activityById(tx, req.params.id))!;
      });
    },
  );

  r.post(
    '/crm/activities/:id/complete',
    { preHandler: requireAuth, schema: { params: idParam, body: z.object({ done: z.boolean() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const done = await tx.crmActivities.updateOne(
          { id: req.params.id },
          { completedAt: req.body.done ? new Date() : null },
        );
        if (!done) throw notFound('Activity');
        return (await activityById(tx, req.params.id))!;
      });
    },
  );

  r.delete(
    '/crm/activities/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const a = await tx.crmActivities.get(req.params.id);
        if (!a) throw notFound('Activity');
        // Members remove their own entries; CRM admins remove anyone's.
        if (
          a.createdBy !== actor.userId &&
          a.assigneeId !== actor.userId &&
          !can(actor, 'crm.admin')
        ) {
          throw forbidden();
        }
        await tx.crmActivities.deleteOne({ id: a.id });
      });
      return { ok: true };
    },
  );

  // ---- Notes ----------------------------------------------------------------------------------
  async function presentNotes(tx: TenantDb, rows: CrmNoteDoc[]) {
    const names = await ownerNames(tx, rows.map((n) => n.authorId));
    return rows.map((n) => ({
      id: n.id,
      body: n.body,
      authorId: n.authorId,
      authorName: names.get(n.authorId) ?? null,
      mentions: n.mentions,
      linkedType: n.linkedType,
      linkedId: n.linkedId,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
  }

  async function activeMemberIds(tx: TenantDb, _orgId: string, ids: string[]) {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return [];
    const found = await tx.memberships.count({ status: 'active', userId: { $in: wanted } });
    if (found !== wanted.length) {
      throw new AppError(400, 'validation_error', 'You can only mention active members', {
        mentions: 'Mention active members only',
      });
    }
    return wanted;
  }

  r.get(
    '/crm/notes',
    {
      preHandler: requireAuth,
      schema: { querystring: z.object({ linkedType, linkedId: uuid }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const rows = await tx.crmNotes.find(
          { linkedType: req.query.linkedType, linkedId: req.query.linkedId },
          { sort: { createdAt: -1, id: 1 }, limit: 200 },
        );
        return { items: await presentNotes(tx, rows) };
      });
    },
  );

  const noteBody = z.object({
    body: z.string().trim().min(1, 'Write something').max(5000),
    mentions: z.array(uuid).max(20).default([]),
  });

  r.post(
    '/crm/notes',
    {
      preHandler: requireAuth,
      schema: { body: noteBody.extend({ linkedType, linkedId: uuid }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const b = req.body;
        await assertLinked(tx, actor.orgId, b.linkedType, b.linkedId);
        const mentions = await activeMemberIds(tx, actor.orgId, b.mentions);
        const row = await tx.crmNotes.insert({
          body: b.body,
          authorId: actor.userId,
          linkedType: b.linkedType,
          linkedId: b.linkedId,
          mentions,
        });
        return (await presentNotes(tx, [row]))[0]!;
      });
    },
  );

  async function ownNote(tx: TenantDb, actor: Actor, id: string) {
    const n = await tx.crmNotes.get(id);
    if (!n) throw notFound('Note');
    if (n.authorId !== actor.userId && !can(actor, 'crm.admin')) throw forbidden();
    return n;
  }

  r.patch(
    '/crm/notes/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: noteBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const n = await ownNote(tx, actor, req.params.id);
        const mentions = await activeMemberIds(tx, actor.orgId, req.body.mentions);
        const out = await tx.crmNotes.findOneAndUpdate(
          { id: n.id },
          { body: req.body.body, mentions, updatedAt: new Date() },
        );
        return (await presentNotes(tx, [out!]))[0]!;
      });
    },
  );

  r.delete(
    '/crm/notes/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const n = await ownNote(tx, actor, req.params.id);
        await tx.crmNotes.deleteOne({ id: n.id });
      });
      return { ok: true };
    },
  );

  // ---- Dashboard ------------------------------------------------------------------------------
  r.get('/crm/dashboard', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');

      const grouped = await tx.crmDeals.aggregate<{
        _id: { stageId: string; pipelineId: string; currency: string };
        count: number;
        total: number;
      }>([
        { $match: { status: 'open', deletedAt: null } },
        {
          $group: {
            _id: { stageId: '$stageId', pipelineId: '$pipelineId', currency: '$currency' },
            count: { $sum: 1 },
            total: { $sum: '$value' },
          },
        },
      ]);
      const stages = await tx.crmStages.find({});
      const pipelines = await tx.crmPipelines.find({});
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const pipelineName = new Map(pipelines.map((p) => [p.id, p.name]));
      const byStage = grouped
        .flatMap((g) => {
          const s = stageById.get(g._id.stageId);
          return s
            ? [
                {
                  stageId: s.id,
                  stage: s.name,
                  position: s.position,
                  pipeline: pipelineName.get(g._id.pipelineId) ?? '',
                  currency: g._id.currency,
                  count: g.count,
                  total: Number(g.total),
                },
              ]
            : [];
        })
        .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.position - b.position);

      // "This month" is the calendar month in UTC; the figures are for orientation, not accounting.
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const wonRows = await tx.crmDeals.aggregate<{ _id: string; count: number; total: number }>([
        { $match: { status: 'won', deletedAt: null, closedAt: { $gte: monthStart } } },
        { $group: { _id: '$currency', count: { $sum: 1 }, total: { $sum: '$value' } } },
      ]);
      const won = wonRows.map((w) => ({ currency: w._id, count: w.count, total: Number(w.total) }));

      const sources = await tx.crmLeads.aggregate<{ _id: string; count: number }>([
        { $match: { deletedAt: null } },
        { $group: { _id: { $ifNull: ['$source', 'Unknown'] }, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 10 },
      ]);
      const leadsBySource = sources.map((s) => ({ source: s._id, count: s.count }));

      const overdue = await tx.crmActivities.find(
        { assigneeId: actor.userId, completedAt: null, dueAt: { $lt: new Date() } },
        { sort: { dueAt: 1 }, limit: 10 },
      );
      const myOverdue = await presentActivities(tx, overdue);

      const [open, converted] = await Promise.all([
        tx.crmLeads.count({ deletedAt: null, convertedAt: null }),
        tx.crmLeads.count({ deletedAt: null, convertedAt: { $ne: null } }),
      ]);

      return {
        openDealsByStage: byStage,
        wonThisMonth: won,
        leadsBySource,
        leads: { open, converted },
        myOverdue,
      };
    });
  });
}
