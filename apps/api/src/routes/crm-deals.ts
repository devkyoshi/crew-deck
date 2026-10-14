import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import {
  assertActiveMember,
  crmCapacity,
  crmGuard,
  currencyCode,
  DEFAULT_STAGES,
  ensureDefaultPipeline,
  idParam,
  likeEscape,
  loadTags,
  setTags,
  uuid,
} from '../crm/helpers.js';
import { withTenant, type Tx } from '../db/client.js';
import {
  crmCompanies,
  crmContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  users,
} from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertWithinLimit, countPipelines, loadPlan } from '../plans/index.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import type { Actor } from '../permissions/can.js';

const title = z.string().trim().min(1, 'Enter a title').max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export async function crmDealRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Pipelines and stages -------------------------------------------------------------------
  async function pipelineView(tx: Tx, orgId: string) {
    const pipelines = await tx
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.orgId, orgId))
      .orderBy(desc(crmPipelines.isDefault), asc(sql`lower(${crmPipelines.name})`));
    const stages = await tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.orgId, orgId))
      .orderBy(asc(crmStages.position), asc(crmStages.id));
    const counts = await tx
      .select({ stageId: crmDeals.stageId, n: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(and(eq(crmDeals.orgId, orgId), isNull(crmDeals.deletedAt)))
      .groupBy(crmDeals.stageId);
    const countOf = new Map(counts.map((c) => [c.stageId, c.n]));
    return pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: stages
        .filter((s) => s.pipelineId === p.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          position: s.position,
          probability: s.probability,
          isWon: s.isWon,
          isLost: s.isLost,
          dealCount: countOf.get(s.id) ?? 0,
        })),
    }));
  }

  r.get('/crm/pipelines', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');
      await ensureDefaultPipeline(tx, actor.orgId);
      return { items: await pipelineView(tx, actor.orgId) };
    });
  });

  r.post(
    '/crm/pipelines',
    {
      preHandler: requireAuth,
      schema: { body: z.object({ name: z.string().trim().min(1).max(80) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        await ensureDefaultPipeline(tx, actor.orgId);
        assertWithinLimit(
          await loadPlan(tx, actor.orgId),
          'pipelines',
          await countPipelines(tx, actor.orgId),
        );
        const [p] = await tx
          .insert(crmPipelines)
          .values({ orgId: actor.orgId, name: req.body.name })
          .returning({ id: crmPipelines.id });
        await tx.insert(crmStages).values(
          DEFAULT_STAGES.map((s, i) => ({
            ...s,
            orgId: actor.orgId,
            pipelineId: p!.id,
            position: i + 1,
          })),
        );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.pipeline_created',
          targetType: 'crm_pipeline',
          targetId: p!.id,
          after: { name: req.body.name },
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === p!.id)!;
      });
    },
  );

  r.patch(
    '/crm/pipelines/:id',
    {
      preHandler: requireAuth,
      schema: { params: idParam, body: z.object({ name: z.string().trim().min(1).max(80) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const done = await tx
          .update(crmPipelines)
          .set({ name: req.body.name })
          .where(and(eq(crmPipelines.id, req.params.id), eq(crmPipelines.orgId, actor.orgId)))
          .returning({ id: crmPipelines.id });
        if (!done.length) throw notFound('Pipeline');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.pipeline_updated',
          targetType: 'crm_pipeline',
          targetId: req.params.id,
          after: { name: req.body.name },
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === req.params.id)!;
      });
    },
  );

  r.delete(
    '/crm/pipelines/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const [p] = await tx
          .select()
          .from(crmPipelines)
          .where(and(eq(crmPipelines.id, req.params.id), eq(crmPipelines.orgId, actor.orgId)));
        if (!p) throw notFound('Pipeline');
        if (p.isDefault)
          throw new AppError(409, 'default_pipeline', 'The default pipeline cannot be deleted');
        const used = await tx
          .select({ id: crmDeals.id })
          .from(crmDeals)
          .where(and(eq(crmDeals.orgId, actor.orgId), eq(crmDeals.pipelineId, p.id)))
          .limit(1);
        if (used.length)
          throw new AppError(409, 'pipeline_in_use', 'Move or delete this pipeline’s deals first');
        await tx
          .delete(crmStages)
          .where(and(eq(crmStages.orgId, actor.orgId), eq(crmStages.pipelineId, p.id)));
        await tx
          .delete(crmPipelines)
          .where(and(eq(crmPipelines.id, p.id), eq(crmPipelines.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.pipeline_deleted',
          targetType: 'crm_pipeline',
          targetId: p.id,
          before: { name: p.name },
        });
      });
      return { ok: true };
    },
  );

  const stageBody = z.object({
    name: z.string().trim().min(1, 'Enter a name').max(60),
    probability: z.number().int().min(0).max(100),
    isWon: z.boolean().default(false),
    isLost: z.boolean().default(false),
  });
  const notBoth = (v: { isWon?: boolean; isLost?: boolean }) => !(v.isWon && v.isLost);

  r.post(
    '/crm/pipelines/:id/stages',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: stageBody.refine(notBoth, 'A stage cannot be both won and lost'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const [p] = await tx
          .select()
          .from(crmPipelines)
          .where(and(eq(crmPipelines.id, req.params.id), eq(crmPipelines.orgId, actor.orgId)));
        if (!p) throw notFound('Pipeline');
        // New stages go before the closing (won / lost) stages so the board keeps its shape.
        const stages = await tx
          .select()
          .from(crmStages)
          .where(and(eq(crmStages.orgId, actor.orgId), eq(crmStages.pipelineId, p.id)))
          .orderBy(asc(crmStages.position));
        const closing = req.body.isWon || req.body.isLost;
        const firstClosing = stages.findIndex((s) => s.isWon || s.isLost);
        const at = closing || firstClosing === -1 ? stages.length : firstClosing;
        const order = stages.map((s) => s.id);
        const [created] = await tx
          .insert(crmStages)
          .values({
            orgId: actor.orgId,
            pipelineId: p.id,
            ...req.body,
            position: stages.length + 1,
          })
          .returning({ id: crmStages.id });
        order.splice(at, 0, created!.id);
        await renumber(tx, actor.orgId, order);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.stage_created',
          targetType: 'crm_pipeline',
          targetId: p.id,
          after: { name: req.body.name },
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === p.id)!;
      });
    },
  );

  async function renumber(tx: Tx, orgId: string, ids: string[]) {
    for (const [i, id] of ids.entries()) {
      await tx
        .update(crmStages)
        .set({ position: i + 1 })
        .where(and(eq(crmStages.id, id), eq(crmStages.orgId, orgId)));
    }
  }

  r.patch(
    '/crm/stages/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: stageBody.partial().refine(notBoth, 'A stage cannot be both won and lost'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const [s] = await tx
          .select()
          .from(crmStages)
          .where(and(eq(crmStages.id, req.params.id), eq(crmStages.orgId, actor.orgId)));
        if (!s) throw notFound('Stage');
        const next = { ...req.body };
        // Setting one flag clears the other, so the check constraint never trips.
        if (next.isWon) next.isLost = false;
        if (next.isLost) next.isWon = false;
        await tx
          .update(crmStages)
          .set(next)
          .where(and(eq(crmStages.id, s.id), eq(crmStages.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.stage_updated',
          targetType: 'crm_pipeline',
          targetId: s.pipelineId,
          before: { name: s.name, probability: s.probability },
          after: next,
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === s.pipelineId)!;
      });
    },
  );

  r.delete(
    '/crm/stages/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const [s] = await tx
          .select()
          .from(crmStages)
          .where(and(eq(crmStages.id, req.params.id), eq(crmStages.orgId, actor.orgId)));
        if (!s) throw notFound('Stage');
        const used = await tx
          .select({ id: crmDeals.id })
          .from(crmDeals)
          .where(and(eq(crmDeals.orgId, actor.orgId), eq(crmDeals.stageId, s.id)))
          .limit(1);
        if (used.length)
          throw new AppError(409, 'stage_in_use', 'Move this stage’s deals to another stage first');
        await tx
          .delete(crmStages)
          .where(and(eq(crmStages.id, s.id), eq(crmStages.orgId, actor.orgId)));
        const rest = await tx
          .select({ id: crmStages.id })
          .from(crmStages)
          .where(and(eq(crmStages.orgId, actor.orgId), eq(crmStages.pipelineId, s.pipelineId)))
          .orderBy(asc(crmStages.position));
        await renumber(
          tx,
          actor.orgId,
          rest.map((x) => x.id),
        );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.stage_deleted',
          targetType: 'crm_pipeline',
          targetId: s.pipelineId,
          before: { name: s.name },
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === s.pipelineId)!;
      });
    },
  );

  r.put(
    '/crm/pipelines/:id/stage-order',
    {
      preHandler: requireAuth,
      schema: { params: idParam, body: z.object({ stageIds: z.array(uuid).min(1).max(50) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const current = await tx
          .select({ id: crmStages.id })
          .from(crmStages)
          .where(and(eq(crmStages.orgId, actor.orgId), eq(crmStages.pipelineId, req.params.id)));
        if (!current.length) throw notFound('Pipeline');
        const wanted = req.body.stageIds;
        const same =
          wanted.length === current.length &&
          new Set(wanted).size === wanted.length &&
          current.every((c) => wanted.includes(c.id));
        if (!same)
          throw new AppError(
            400,
            'validation_error',
            'The order must list every stage exactly once',
            { stageIds: 'List every stage once' },
          );
        await renumber(tx, actor.orgId, wanted);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.stages_reordered',
          targetType: 'crm_pipeline',
          targetId: req.params.id,
          after: { stageIds: wanted },
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === req.params.id)!;
      });
    },
  );

  // ---- Deals ----------------------------------------------------------------------------------
  const dealBody = z.object({
    title,
    pipelineId: uuid.optional(),
    stageId: uuid.optional(),
    companyId: uuid.nullable().optional(),
    contactId: uuid.nullable().optional(),
    value: z.number().min(0).max(1e12).optional(),
    currency: currencyCode.optional(),
    expectedClose: date.nullable().optional(),
    ownerId: uuid.nullable().optional(),
    tagIds: z.array(uuid).max(20).optional(),
  });

  async function dealRows(
    tx: Tx,
    actor: Actor,
    where: SQL | undefined,
    limit = 20,
    offset = 0,
    order: SQL[] = [desc(crmDeals.createdAt), asc(crmDeals.id)],
  ) {
    const rows = await tx
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        pipelineId: crmDeals.pipelineId,
        stageId: crmDeals.stageId,
        stageName: crmStages.name,
        probability: crmStages.probability,
        status: crmDeals.status,
        value: sql<number>`${crmDeals.value}::float8`,
        currency: crmDeals.currency,
        expectedClose: crmDeals.expectedClose,
        position: crmDeals.position,
        closedAt: crmDeals.closedAt,
        companyId: crmDeals.companyId,
        companyName: crmCompanies.name,
        contactId: crmDeals.contactId,
        contactName: crmContacts.name,
        ownerId: crmDeals.ownerId,
        ownerName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
        createdAt: crmDeals.createdAt,
      })
      .from(crmDeals)
      .innerJoin(
        crmStages,
        and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.orgId, crmDeals.orgId)),
      )
      .leftJoin(
        crmCompanies,
        and(eq(crmCompanies.id, crmDeals.companyId), eq(crmCompanies.orgId, crmDeals.orgId)),
      )
      .leftJoin(
        crmContacts,
        and(eq(crmContacts.id, crmDeals.contactId), eq(crmContacts.orgId, crmDeals.orgId)),
      )
      .leftJoin(users, eq(users.id, crmDeals.ownerId))
      .where(and(eq(crmDeals.orgId, actor.orgId), isNull(crmDeals.deletedAt), where))
      .orderBy(...order)
      .limit(limit)
      .offset(offset);
    const tags = await loadTags(
      tx,
      actor.orgId,
      'deal',
      rows.map((x) => x.id),
    );
    return rows.map((x) => ({ ...x, tags: tags.get(x.id) ?? [] }));
  }

  async function assertLinks(
    tx: Tx,
    orgId: string,
    b: { companyId?: string | null; contactId?: string | null },
  ) {
    if (b.companyId) {
      const [c] = await tx
        .select({ id: crmCompanies.id })
        .from(crmCompanies)
        .where(
          and(
            eq(crmCompanies.id, b.companyId),
            eq(crmCompanies.orgId, orgId),
            isNull(crmCompanies.deletedAt),
          ),
        );
      if (!c)
        throw new AppError(400, 'validation_error', 'That company does not exist', {
          companyId: 'Choose an existing company',
        });
    }
    if (b.contactId) {
      const [c] = await tx
        .select({ id: crmContacts.id })
        .from(crmContacts)
        .where(
          and(
            eq(crmContacts.id, b.contactId),
            eq(crmContacts.orgId, orgId),
            isNull(crmContacts.deletedAt),
          ),
        );
      if (!c)
        throw new AppError(400, 'validation_error', 'That contact does not exist', {
          contactId: 'Choose an existing contact',
        });
    }
  }

  /** Status and close time that go with a stage. */
  const closing = (s: { isWon: boolean; isLost: boolean }) => ({
    status: (s.isWon ? 'won' : s.isLost ? 'lost' : 'open') as 'won' | 'lost' | 'open',
    closedAt: s.isWon || s.isLost ? new Date() : null,
  });

  const nextPosition = async (tx: Tx, orgId: string, stageId: string) => {
    const [top] = await tx
      .select({ p: sql<number>`coalesce(max(${crmDeals.position}), 0)::float8` })
      .from(crmDeals)
      .where(and(eq(crmDeals.orgId, orgId), eq(crmDeals.stageId, stageId)));
    return (top?.p ?? 0) + 1000;
  };

  r.get(
    '/crm/deals',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          pipelineId: uuid.optional(),
          stageId: uuid.optional(),
          status: z.enum(['open', 'won', 'lost']).optional(),
          ownerId: uuid.optional(),
          companyId: uuid.optional(),
          sort: z.enum(['created', 'value', 'close', 'title']).default('created'),
          dir: z.enum(['asc', 'desc']).default('desc'),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const filters = and(
          q.q
            ? or(ilike(crmDeals.title, likeEscape(q.q)), ilike(crmCompanies.name, likeEscape(q.q)))
            : undefined,
          q.pipelineId ? eq(crmDeals.pipelineId, q.pipelineId) : undefined,
          q.stageId ? eq(crmDeals.stageId, q.stageId) : undefined,
          q.status ? eq(crmDeals.status, q.status) : undefined,
          q.ownerId ? eq(crmDeals.ownerId, q.ownerId) : undefined,
          q.companyId ? eq(crmDeals.companyId, q.companyId) : undefined,
        );
        const col = {
          created: crmDeals.createdAt,
          value: crmDeals.value,
          close: crmDeals.expectedClose,
          title: crmDeals.title,
        }[q.sort];
        const dir = q.dir === 'asc' ? asc : desc;
        const items = await dealRows(tx, actor, filters, q.pageSize, offsetOf(q), [
          dir(col),
          asc(crmDeals.id),
        ]);
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(crmDeals)
          .leftJoin(
            crmCompanies,
            and(eq(crmCompanies.id, crmDeals.companyId), eq(crmCompanies.orgId, crmDeals.orgId)),
          )
          .where(and(eq(crmDeals.orgId, actor.orgId), isNull(crmDeals.deletedAt), filters));
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.get(
    '/crm/deals/board',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          pipelineId: uuid.optional(),
          q: z.string().trim().max(100).optional(),
          ownerId: uuid.optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const def = await ensureDefaultPipeline(tx, actor.orgId);
        const pipelines = await pipelineView(tx, actor.orgId);
        const pipeline = pipelines.find((p) => p.id === (q.pipelineId ?? def.id));
        if (!pipeline) throw notFound('Pipeline');
        const filters = and(
          eq(crmDeals.pipelineId, pipeline.id),
          q.q
            ? or(ilike(crmDeals.title, likeEscape(q.q)), ilike(crmCompanies.name, likeEscape(q.q)))
            : undefined,
          q.ownerId ? eq(crmDeals.ownerId, q.ownerId) : undefined,
        );
        // A board column shows the 100 most recently placed cards; the total still counts them all.
        const deals = await dealRows(tx, actor, filters, 1000, 0, [
          asc(crmDeals.position),
          asc(crmDeals.id),
        ]);
        const columns = pipeline.stages.map((s) => {
          const mine = deals.filter((d) => d.stageId === s.id);
          const totals: Record<string, number> = {};
          for (const d of mine) totals[d.currency] = (totals[d.currency] ?? 0) + d.value;
          return { ...s, count: mine.length, totals, deals: mine.slice(0, 100) };
        });
        return {
          pipeline: { id: pipeline.id, name: pipeline.name },
          pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })),
          columns,
        };
      });
    },
  );

  r.get('/crm/deals/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');
      const [deal] = await dealRows(tx, actor, eq(crmDeals.id, req.params.id), 1);
      if (!deal) throw notFound('Deal');
      const stages = await tx
        .select({
          id: crmStages.id,
          name: crmStages.name,
          isWon: crmStages.isWon,
          isLost: crmStages.isLost,
        })
        .from(crmStages)
        .where(and(eq(crmStages.orgId, actor.orgId), eq(crmStages.pipelineId, deal.pipelineId)))
        .orderBy(asc(crmStages.position));
      return { ...deal, stages };
    });
  });

  r.post('/crm/deals', { preHandler: requireAuth, schema: { body: dealBody } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'edit');
      await crmCapacity(tx, actor.orgId);
      const b = req.body;
      await assertLinks(tx, actor.orgId, b);
      await assertActiveMember(tx, actor.orgId, b.ownerId);
      const pipeline = b.pipelineId
        ? (
            await tx
              .select()
              .from(crmPipelines)
              .where(and(eq(crmPipelines.id, b.pipelineId), eq(crmPipelines.orgId, actor.orgId)))
          )[0]
        : await ensureDefaultPipeline(tx, actor.orgId);
      if (!pipeline)
        throw new AppError(400, 'validation_error', 'That pipeline does not exist', {
          pipelineId: 'Choose a pipeline',
        });
      const stages = await tx
        .select()
        .from(crmStages)
        .where(and(eq(crmStages.orgId, actor.orgId), eq(crmStages.pipelineId, pipeline.id)))
        .orderBy(asc(crmStages.position));
      const stage = b.stageId
        ? stages.find((s) => s.id === b.stageId)
        : stages.find((s) => !s.isWon && !s.isLost);
      if (!stage)
        throw new AppError(400, 'validation_error', 'That stage is not in the pipeline', {
          stageId: 'Choose a stage',
        });
      const [row] = await tx
        .insert(crmDeals)
        .values({
          orgId: actor.orgId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          companyId: b.companyId ?? null,
          contactId: b.contactId ?? null,
          title: b.title,
          value: String(b.value ?? 0),
          currency: b.currency ?? 'USD',
          expectedClose: b.expectedClose ?? null,
          ownerId: b.ownerId ?? actor.userId,
          position: await nextPosition(tx, actor.orgId, stage.id),
          createdBy: actor.userId,
          ...closing(stage),
        })
        .returning({ id: crmDeals.id });
      if (b.tagIds) await setTags(tx, actor.orgId, 'deal', row!.id, b.tagIds);
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'crm.deal_created',
        targetType: 'crm_deal',
        targetId: row!.id,
        after: { title: b.title, value: b.value ?? 0 },
      });
      const [out] = await dealRows(tx, actor, eq(crmDeals.id, row!.id), 1);
      return out!;
    });
  });

  r.patch(
    '/crm/deals/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: dealBody
          .omit({ pipelineId: true, stageId: true })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const { tagIds: tags, value, ...rest } = req.body;
        const [before] = await tx
          .select()
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.id, req.params.id),
              eq(crmDeals.orgId, actor.orgId),
              isNull(crmDeals.deletedAt),
            ),
          );
        if (!before) throw notFound('Deal');
        await assertLinks(tx, actor.orgId, rest);
        await assertActiveMember(tx, actor.orgId, rest.ownerId);
        const patch = { ...rest, ...(value !== undefined ? { value: String(value) } : {}) };
        if (Object.keys(patch).length) {
          await tx
            .update(crmDeals)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(crmDeals.id, before.id), eq(crmDeals.orgId, actor.orgId)));
        }
        if (tags) await setTags(tx, actor.orgId, 'deal', before.id, tags);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.deal_updated',
          targetType: 'crm_deal',
          targetId: before.id,
          before: Object.fromEntries(
            Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
          ),
          after: patch,
        });
        const [out] = await dealRows(tx, actor, eq(crmDeals.id, before.id), 1);
        return out!;
      });
    },
  );

  r.delete(
    '/crm/deals/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx
          .update(crmDeals)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(crmDeals.id, req.params.id),
              eq(crmDeals.orgId, actor.orgId),
              isNull(crmDeals.deletedAt),
            ),
          )
          .returning({ id: crmDeals.id, title: crmDeals.title });
        if (!gone.length) throw notFound('Deal');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.deal_deleted',
          targetType: 'crm_deal',
          targetId: gone[0]!.id,
          before: { title: gone[0]!.title },
        });
      });
      return { ok: true };
    },
  );

  // Move a deal to a stage. `beforeDealId` places it above that card; leave it out to put it at the bottom.
  r.post(
    '/crm/deals/:id/move',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z.object({ stageId: uuid, beforeDealId: uuid.nullable().optional() }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const [deal] = await tx
          .select()
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.id, req.params.id),
              eq(crmDeals.orgId, actor.orgId),
              isNull(crmDeals.deletedAt),
            ),
          );
        if (!deal) throw notFound('Deal');
        const [stage] = await tx
          .select()
          .from(crmStages)
          .where(
            and(
              eq(crmStages.id, req.body.stageId),
              eq(crmStages.orgId, actor.orgId),
              eq(crmStages.pipelineId, deal.pipelineId),
            ),
          );
        if (!stage)
          throw new AppError(400, 'validation_error', 'That stage is not in this deal’s pipeline', {
            stageId: 'Choose a stage in the same pipeline',
          });

        const column = await tx
          .select({ id: crmDeals.id, position: crmDeals.position })
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.orgId, actor.orgId),
              eq(crmDeals.stageId, stage.id),
              isNull(crmDeals.deletedAt),
            ),
          )
          .orderBy(asc(crmDeals.position), asc(crmDeals.id));
        const others = column.filter((c) => c.id !== deal.id);
        let position: number;
        const beforeIdx = req.body.beforeDealId
          ? others.findIndex((c) => c.id === req.body.beforeDealId)
          : -1;
        if (req.body.beforeDealId && beforeIdx === -1) {
          throw new AppError(400, 'validation_error', 'That card is not in the target stage', {
            beforeDealId: 'Unknown card',
          });
        }
        if (beforeIdx === -1) {
          position = (others.at(-1)?.position ?? 0) + 1000;
        } else {
          const next = others[beforeIdx]!.position;
          const prev = beforeIdx > 0 ? others[beforeIdx - 1]!.position : next - 2000;
          position = (prev + next) / 2;
        }

        const changedStage = stage.id !== deal.stageId;
        const wasClosed = deal.status !== 'open';
        const state = changedStage
          ? closing(stage)
          : { status: deal.status, closedAt: deal.closedAt };
        await tx
          .update(crmDeals)
          .set({ stageId: stage.id, position, ...state, updatedAt: new Date() })
          .where(and(eq(crmDeals.id, deal.id), eq(crmDeals.orgId, actor.orgId)));
        if (changedStage) {
          const [from] = await tx
            .select({ name: crmStages.name })
            .from(crmStages)
            .where(and(eq(crmStages.id, deal.stageId), eq(crmStages.orgId, actor.orgId)));
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'crm.deal_moved',
            targetType: 'crm_deal',
            targetId: deal.id,
            before: { stage: from?.name ?? null, status: deal.status },
            after: {
              stage: stage.name,
              status: state.status,
              reopened: wasClosed && state.status === 'open',
            },
          });
        }
        const [out] = await dealRows(tx, actor, eq(crmDeals.id, deal.id), 1);
        return out!;
      });
    },
  );
}
