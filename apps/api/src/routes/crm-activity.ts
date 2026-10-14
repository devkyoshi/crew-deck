import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { assertActiveMember, crmGuard, idParam, uuid } from '../crm/helpers.js';
import { withTenant, type Tx } from '../db/client.js';
import {
  crmActivities,
  crmCompanies,
  crmContacts,
  crmDeals,
  crmLeads,
  crmNotes,
  crmPipelines,
  crmStages,
  memberships,
  users,
  type CrmRecordType,
} from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';

const linkedType = z.enum(['company', 'contact', 'lead', 'deal']);
const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task'] as const;

const TABLES = {
  company: crmCompanies,
  contact: crmContacts,
  lead: crmLeads,
  deal: crmDeals,
} as const;

/** The record an activity or note is attached to must exist in this workspace and not be deleted. */
async function assertLinked(tx: Tx, orgId: string, type: CrmRecordType, id: string) {
  const t = TABLES[type];
  const [row] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.id, id), eq(t.orgId, orgId), isNull(t.deletedAt)));
  if (!row) {
    throw new AppError(400, 'validation_error', 'That record does not exist', {
      linkedId: 'Choose an existing record',
    });
  }
}

export async function crmActivityRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Activities -----------------------------------------------------------------------------
  const activitySelect = {
    id: crmActivities.id,
    type: crmActivities.type,
    subject: crmActivities.subject,
    dueAt: crmActivities.dueAt,
    completedAt: crmActivities.completedAt,
    assigneeId: crmActivities.assigneeId,
    assigneeName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
    linkedType: crmActivities.linkedType,
    linkedId: crmActivities.linkedId,
    createdAt: crmActivities.createdAt,
  };

  async function activityById(tx: Tx, orgId: string, id: string) {
    const [row] = await tx
      .select(activitySelect)
      .from(crmActivities)
      .leftJoin(users, eq(users.id, crmActivities.assigneeId))
      .where(and(eq(crmActivities.id, id), eq(crmActivities.orgId, orgId)));
    return row;
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
        const filters: (SQL | undefined)[] = [
          q.linkedType ? eq(crmActivities.linkedType, q.linkedType) : undefined,
          q.linkedId ? eq(crmActivities.linkedId, q.linkedId) : undefined,
          q.assigneeId ? eq(crmActivities.assigneeId, q.assigneeId) : undefined,
          q.type ? eq(crmActivities.type, q.type) : undefined,
          q.status === 'done' ? sql`${crmActivities.completedAt} is not null` : undefined,
          q.status === 'open' ? isNull(crmActivities.completedAt) : undefined,
          q.status === 'overdue'
            ? and(isNull(crmActivities.completedAt), lt(crmActivities.dueAt, new Date()))
            : undefined,
        ];
        const where = and(eq(crmActivities.orgId, actor.orgId), ...filters);
        const items = await tx
          .select(activitySelect)
          .from(crmActivities)
          .leftJoin(users, eq(users.id, crmActivities.assigneeId))
          .where(where)
          .orderBy(
            // Open items first, soonest due first; finished items after, newest first.
            sql`(${crmActivities.completedAt} is not null)`,
            sql`${crmActivities.dueAt} asc nulls last`,
            desc(crmActivities.createdAt),
            asc(crmActivities.id),
          )
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(crmActivities)
          .where(where);
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const b = req.body;
        await assertActiveMember(tx, actor.orgId, b.assigneeId, 'assigneeId');
        if (b.linkedType && b.linkedId)
          await assertLinked(tx, actor.orgId, b.linkedType, b.linkedId);
        const [row] = await tx
          .insert(crmActivities)
          .values({
            orgId: actor.orgId,
            type: b.type,
            subject: b.subject,
            dueAt: b.dueAt ? new Date(b.dueAt) : null,
            assigneeId: b.assigneeId ?? actor.userId,
            linkedType: b.linkedType ?? null,
            linkedId: b.linkedId ?? null,
            createdBy: actor.userId,
          })
          .returning({ id: crmActivities.id });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.activity_created',
          targetType: b.linkedType ? (`crm_${b.linkedType}` as 'crm_deal') : 'crm_lead',
          targetId: b.linkedId ?? row!.id,
          after: { type: b.type, subject: b.subject },
        });
        return (await activityById(tx, actor.orgId, row!.id))!;
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const b = req.body;
        await assertActiveMember(tx, actor.orgId, b.assigneeId, 'assigneeId');
        const { dueAt, ...rest } = b;
        const done = await tx
          .update(crmActivities)
          .set({
            ...rest,
            ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
          })
          .where(and(eq(crmActivities.id, req.params.id), eq(crmActivities.orgId, actor.orgId)))
          .returning({ id: crmActivities.id });
        if (!done.length) throw notFound('Activity');
        return (await activityById(tx, actor.orgId, req.params.id))!;
      });
    },
  );

  r.post(
    '/crm/activities/:id/complete',
    { preHandler: requireAuth, schema: { params: idParam, body: z.object({ done: z.boolean() }) } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const done = await tx
          .update(crmActivities)
          .set({ completedAt: req.body.done ? new Date() : null })
          .where(and(eq(crmActivities.id, req.params.id), eq(crmActivities.orgId, actor.orgId)))
          .returning({ id: crmActivities.id });
        if (!done.length) throw notFound('Activity');
        return (await activityById(tx, actor.orgId, req.params.id))!;
      });
    },
  );

  r.delete(
    '/crm/activities/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const [a] = await tx
          .select()
          .from(crmActivities)
          .where(and(eq(crmActivities.id, req.params.id), eq(crmActivities.orgId, actor.orgId)));
        if (!a) throw notFound('Activity');
        // Members remove their own entries; CRM admins remove anyone's.
        if (
          a.createdBy !== actor.userId &&
          a.assigneeId !== actor.userId &&
          !can(actor, 'crm.admin')
        ) {
          throw forbidden();
        }
        await tx
          .delete(crmActivities)
          .where(and(eq(crmActivities.id, a.id), eq(crmActivities.orgId, actor.orgId)));
      });
      return { ok: true };
    },
  );

  // ---- Notes ----------------------------------------------------------------------------------
  const noteSelect = {
    id: crmNotes.id,
    body: crmNotes.body,
    authorId: crmNotes.authorId,
    authorName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
    mentions: crmNotes.mentions,
    linkedType: crmNotes.linkedType,
    linkedId: crmNotes.linkedId,
    createdAt: crmNotes.createdAt,
    updatedAt: crmNotes.updatedAt,
  };

  async function activeMemberIds(tx: Tx, orgId: string, ids: string[]) {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return [];
    const found = await tx
      .select({ id: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, orgId),
          eq(memberships.status, 'active'),
          inArray(memberships.userId, wanted),
        ),
      );
    if (found.length !== wanted.length) {
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
        const items = await tx
          .select(noteSelect)
          .from(crmNotes)
          .leftJoin(users, eq(users.id, crmNotes.authorId))
          .where(
            and(
              eq(crmNotes.orgId, actor.orgId),
              eq(crmNotes.linkedType, req.query.linkedType),
              eq(crmNotes.linkedId, req.query.linkedId),
            ),
          )
          .orderBy(desc(crmNotes.createdAt), asc(crmNotes.id))
          .limit(200);
        return { items };
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const b = req.body;
        await assertLinked(tx, actor.orgId, b.linkedType, b.linkedId);
        const mentions = await activeMemberIds(tx, actor.orgId, b.mentions);
        const [row] = await tx
          .insert(crmNotes)
          .values({
            orgId: actor.orgId,
            body: b.body,
            authorId: actor.userId,
            linkedType: b.linkedType,
            linkedId: b.linkedId,
            mentions,
          })
          .returning({ id: crmNotes.id });
        const [out] = await tx
          .select(noteSelect)
          .from(crmNotes)
          .leftJoin(users, eq(users.id, crmNotes.authorId))
          .where(and(eq(crmNotes.id, row!.id), eq(crmNotes.orgId, actor.orgId)));
        return out!;
      });
    },
  );

  async function ownNote(tx: Tx, actor: Actor, id: string) {
    const [n] = await tx
      .select()
      .from(crmNotes)
      .where(and(eq(crmNotes.id, id), eq(crmNotes.orgId, actor.orgId)));
    if (!n) throw notFound('Note');
    if (n.authorId !== actor.userId && !can(actor, 'crm.admin')) throw forbidden();
    return n;
  }

  r.patch(
    '/crm/notes/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: noteBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const n = await ownNote(tx, actor, req.params.id);
        const mentions = await activeMemberIds(tx, actor.orgId, req.body.mentions);
        await tx
          .update(crmNotes)
          .set({ body: req.body.body, mentions, updatedAt: new Date() })
          .where(and(eq(crmNotes.id, n.id), eq(crmNotes.orgId, actor.orgId)));
        const [out] = await tx
          .select(noteSelect)
          .from(crmNotes)
          .leftJoin(users, eq(users.id, crmNotes.authorId))
          .where(and(eq(crmNotes.id, n.id), eq(crmNotes.orgId, actor.orgId)));
        return out!;
      });
    },
  );

  r.delete(
    '/crm/notes/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const n = await ownNote(tx, actor, req.params.id);
        await tx
          .delete(crmNotes)
          .where(and(eq(crmNotes.id, n.id), eq(crmNotes.orgId, actor.orgId)));
      });
      return { ok: true };
    },
  );

  // ---- Dashboard ------------------------------------------------------------------------------
  r.get('/crm/dashboard', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');

      const byStage = await tx
        .select({
          stageId: crmStages.id,
          stage: crmStages.name,
          position: crmStages.position,
          pipeline: crmPipelines.name,
          currency: crmDeals.currency,
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${crmDeals.value}), 0)::float8`,
        })
        .from(crmDeals)
        .innerJoin(
          crmStages,
          and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.orgId, crmDeals.orgId)),
        )
        .innerJoin(
          crmPipelines,
          and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.orgId, crmDeals.orgId)),
        )
        .where(
          and(
            eq(crmDeals.orgId, actor.orgId),
            eq(crmDeals.status, 'open'),
            isNull(crmDeals.deletedAt),
          ),
        )
        .groupBy(
          crmStages.id,
          crmStages.name,
          crmStages.position,
          crmPipelines.name,
          crmDeals.currency,
        )
        .orderBy(asc(crmPipelines.name), asc(crmStages.position));

      // "This month" is the calendar month in UTC; the figures are for orientation, not accounting.
      const won = await tx
        .select({
          currency: crmDeals.currency,
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${crmDeals.value}), 0)::float8`,
        })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.orgId, actor.orgId),
            eq(crmDeals.status, 'won'),
            isNull(crmDeals.deletedAt),
            sql`${crmDeals.closedAt} >= date_trunc('month', now())`,
          ),
        )
        .groupBy(crmDeals.currency);

      const leadsBySource = await tx
        .select({
          source: sql<string>`coalesce(${crmLeads.source}, 'Unknown')`,
          count: sql<number>`count(*)::int`,
        })
        .from(crmLeads)
        .where(and(eq(crmLeads.orgId, actor.orgId), isNull(crmLeads.deletedAt)))
        .groupBy(sql`coalesce(${crmLeads.source}, 'Unknown')`)
        .orderBy(desc(sql`count(*)`), asc(sql`coalesce(${crmLeads.source}, 'Unknown')`))
        .limit(10);

      const myOverdue = await tx
        .select(activitySelect)
        .from(crmActivities)
        .leftJoin(users, eq(users.id, crmActivities.assigneeId))
        .where(
          and(
            eq(crmActivities.orgId, actor.orgId),
            eq(crmActivities.assigneeId, actor.userId),
            isNull(crmActivities.completedAt),
            lt(crmActivities.dueAt, new Date()),
          ),
        )
        .orderBy(asc(crmActivities.dueAt))
        .limit(10);

      const [leadCounts] = await tx
        .select({
          open: sql<number>`count(*) filter (where ${crmLeads.convertedAt} is null)::int`,
          converted: sql<number>`count(*) filter (where ${crmLeads.convertedAt} is not null)::int`,
        })
        .from(crmLeads)
        .where(and(eq(crmLeads.orgId, actor.orgId), isNull(crmLeads.deletedAt)));

      return {
        openDealsByStage: byStage,
        wonThisMonth: won,
        leadsBySource,
        leads: leadCounts ?? { open: 0, converted: 0 },
        myOverdue,
      };
    });
  });
}
