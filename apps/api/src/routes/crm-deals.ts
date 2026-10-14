import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  loadTags,
  ownerNames,
  setTags,
  uuid,
} from '../crm/helpers.js';
import { CI, withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertWithinLimit, countPipelines, loadPlan } from '../plans/index.js';
import { containsRegex, offsetOf, pageQuery } from '../lib/pagination.js';
import type { Actor } from '../permissions/can.js';

const title = z.string().trim().min(1, 'Enter a title').max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

type Filter = Record<string, unknown>;

export async function crmDealRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Pipelines and stages -------------------------------------------------------------------
  async function pipelineView(tx: TenantDb, _orgId?: string) {
    const pipelines = await tx.crmPipelines.find({});
    pipelines.sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    const stages = await tx.crmStages.find({}, { sort: { position: 1, id: 1 } });
    const counts = await tx.crmDeals.aggregate<{ _id: string; n: number }>([
      { $match: { deletedAt: null } },
      { $group: { _id: '$stageId', n: { $sum: 1 } } },
    ]);
    const countOf = new Map(counts.map((c) => [c._id, c.n]));
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
    return withTenantTx(deps.db, actor.orgId, async (tx) => {
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        await ensureDefaultPipeline(tx, actor.orgId);
        assertWithinLimit(
          await loadPlan(tx, actor.orgId),
          'pipelines',
          await countPipelines(tx, actor.orgId),
        );
        const p = await tx.crmPipelines.insert({ name: req.body.name });
        await tx.crmStages.insert(
          DEFAULT_STAGES.map((s, i) => ({ ...s, pipelineId: p.id, position: i + 1 })),
        );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.pipeline_created',
          targetType: 'crm_pipeline',
          targetId: p.id,
          after: { name: req.body.name },
        });
        return (await pipelineView(tx, actor.orgId)).find((x) => x.id === p.id)!;
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const done = await tx.crmPipelines.updateOne({ id: req.params.id }, { name: req.body.name });
        if (!done) throw notFound('Pipeline');
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
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const p = await tx.crmPipelines.get(req.params.id);
        if (!p) throw notFound('Pipeline');
        if (p.isDefault)
          throw new AppError(409, 'default_pipeline', 'The default pipeline cannot be deleted');
        if (await tx.crmDeals.exists({ pipelineId: p.id }))
          throw new AppError(409, 'pipeline_in_use', 'Move or delete this pipeline’s deals first');
        await tx.crmStages.deleteMany({ pipelineId: p.id });
        await tx.crmPipelines.deleteOne({ id: p.id });
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

  async function renumber(tx: TenantDb, ids: string[]) {
    for (const [i, id] of ids.entries()) {
      await tx.crmStages.updateOne({ id }, { position: i + 1 });
    }
  }

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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const p = await tx.crmPipelines.get(req.params.id);
        if (!p) throw notFound('Pipeline');
        // New stages go before the closing (won / lost) stages so the board keeps its shape.
        const stages = await tx.crmStages.find({ pipelineId: p.id }, { sort: { position: 1 } });
        const closing = req.body.isWon || req.body.isLost;
        const firstClosing = stages.findIndex((s) => s.isWon || s.isLost);
        const at = closing || firstClosing === -1 ? stages.length : firstClosing;
        const order = stages.map((s) => s.id);
        const created = await tx.crmStages.insert({
          pipelineId: p.id,
          ...req.body,
          position: stages.length + 1,
        });
        order.splice(at, 0, created.id);
        await renumber(tx, order);
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const s = await tx.crmStages.get(req.params.id);
        if (!s) throw notFound('Stage');
        const next = { ...req.body };
        // Setting one flag clears the other, so a stage is never both won and lost.
        if (next.isWon) next.isLost = false;
        if (next.isLost) next.isWon = false;
        await tx.crmStages.updateOne({ id: s.id }, next);
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const s = await tx.crmStages.get(req.params.id);
        if (!s) throw notFound('Stage');
        if (await tx.crmDeals.exists({ stageId: s.id }))
          throw new AppError(409, 'stage_in_use', 'Move this stage’s deals to another stage first');
        await tx.crmStages.deleteOne({ id: s.id });
        const rest = await tx.crmStages.find({ pipelineId: s.pipelineId }, { sort: { position: 1 } });
        await renumber(tx, rest.map((x) => x.id));
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const current = await tx.crmStages.find({ pipelineId: req.params.id });
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
        await renumber(tx, wanted);
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

  /** Deals matching a filter, with stage, company, contact and owner names joined in. */
  async function dealRows(
    tx: TenantDb,
    actor: Actor,
    filter: Filter,
    limit = 20,
    skip = 0,
    sort: Record<string, 1 | -1> = { createdAt: -1, id: 1 },
    collate = false,
  ) {
    const docs = await tx.crmDeals.find(
      { ...filter, deletedAt: null },
      { sort, skip, limit, ...(collate ? { collation: CI } : {}) },
    );
    const [stages, companies, contacts, owners, tags] = await Promise.all([
      tx.crmStages.find({ id: { $in: [...new Set(docs.map((d) => d.stageId))] } }),
      tx.crmCompanies.find({
        id: { $in: [...new Set(docs.map((d) => d.companyId).filter((x): x is string => !!x))] },
      }),
      tx.crmContacts.find({
        id: { $in: [...new Set(docs.map((d) => d.contactId).filter((x): x is string => !!x))] },
      }),
      ownerNames(tx, docs.map((d) => d.ownerId)),
      loadTags(tx, actor.orgId, 'deal', docs.map((d) => d.id)),
    ]);
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const contactName = new Map(contacts.map((c) => [c.id, c.name]));
    return docs.map((x) => {
      const stage = stageById.get(x.stageId);
      return {
        id: x.id,
        title: x.title,
        pipelineId: x.pipelineId,
        stageId: x.stageId,
        stageName: stage?.name ?? '',
        probability: stage?.probability ?? 0,
        status: x.status,
        value: Number(x.value),
        currency: x.currency,
        expectedClose: x.expectedClose,
        position: x.position,
        closedAt: x.closedAt,
        companyId: x.companyId,
        companyName: x.companyId ? (companyName.get(x.companyId) ?? null) : null,
        contactId: x.contactId,
        contactName: x.contactId ? (contactName.get(x.contactId) ?? null) : null,
        ownerId: x.ownerId,
        ownerName: x.ownerId ? (owners.get(x.ownerId) ?? null) : null,
        createdAt: x.createdAt,
        tags: tags.get(x.id) ?? [],
      };
    });
  }

  /** A deal search matches its title or its company's name. */
  async function searchFilter(tx: TenantDb, q: string | undefined): Promise<Filter> {
    if (!q) return {};
    const rx = containsRegex(q);
    const companies = await tx.crmCompanies.find({ name: rx, deletedAt: null }, { projection: { id: 1 } });
    return { $or: [{ title: rx }, { companyId: { $in: companies.map((c) => c.id) } }] };
  }

  async function assertLinks(
    tx: TenantDb,
    _orgId: string,
    b: { companyId?: string | null; contactId?: string | null },
  ) {
    if (b.companyId) {
      if (!(await tx.crmCompanies.exists({ id: b.companyId, deletedAt: null })))
        throw new AppError(400, 'validation_error', 'That company does not exist', {
          companyId: 'Choose an existing company',
        });
    }
    if (b.contactId) {
      if (!(await tx.crmContacts.exists({ id: b.contactId, deletedAt: null })))
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

  const nextPosition = async (tx: TenantDb, stageId: string) => {
    const top = await tx.crmDeals.findOne({ stageId }, { sort: { position: -1 } });
    return (top?.position ?? 0) + 1000;
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
        const filters: Filter = await searchFilter(tx, q.q);
        if (q.pipelineId) filters.pipelineId = q.pipelineId;
        if (q.stageId) filters.stageId = q.stageId;
        if (q.status) filters.status = q.status;
        if (q.ownerId) filters.ownerId = q.ownerId;
        if (q.companyId) filters.companyId = q.companyId;
        const col = { created: 'createdAt', value: 'value', close: 'expectedClose', title: 'title' }[
          q.sort
        ];
        const dir = q.dir === 'asc' ? 1 : -1;
        const items = await dealRows(
          tx,
          actor,
          filters,
          q.pageSize,
          offsetOf(q),
          { [col]: dir, id: 1 },
          q.sort === 'title',
        );
        const total = await tx.crmDeals.count({ ...filters, deletedAt: null });
        return { items, total, page: q.page, pageSize: q.pageSize };
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const def = await ensureDefaultPipeline(tx, actor.orgId);
        const pipelines = await pipelineView(tx, actor.orgId);
        const pipeline = pipelines.find((p) => p.id === (q.pipelineId ?? def.id));
        if (!pipeline) throw notFound('Pipeline');
        const filters: Filter = { ...(await searchFilter(tx, q.q)), pipelineId: pipeline.id };
        if (q.ownerId) filters.ownerId = q.ownerId;
        // A board column shows the 100 most recently placed cards; the total still counts them all.
        const deals = await dealRows(tx, actor, filters, 1000, 0, { position: 1, id: 1 });
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
      const [deal] = await dealRows(tx, actor, { id: req.params.id }, 1);
      if (!deal) throw notFound('Deal');
      const stages = (
        await tx.crmStages.find({ pipelineId: deal.pipelineId }, { sort: { position: 1 } })
      ).map((s) => ({ id: s.id, name: s.name, isWon: s.isWon, isLost: s.isLost }));
      return { ...deal, stages };
    });
  });

  r.post('/crm/deals', { preHandler: requireAuth, schema: { body: dealBody } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'edit');
      await crmCapacity(tx, actor.orgId);
      const b = req.body;
      await assertLinks(tx, actor.orgId, b);
      await assertActiveMember(tx, actor.orgId, b.ownerId);
      const pipeline = b.pipelineId
        ? await tx.crmPipelines.get(b.pipelineId)
        : await ensureDefaultPipeline(tx, actor.orgId);
      if (!pipeline)
        throw new AppError(400, 'validation_error', 'That pipeline does not exist', {
          pipelineId: 'Choose a pipeline',
        });
      const stages = await tx.crmStages.find({ pipelineId: pipeline.id }, { sort: { position: 1 } });
      const stage = b.stageId
        ? stages.find((s) => s.id === b.stageId)
        : stages.find((s) => !s.isWon && !s.isLost);
      if (!stage)
        throw new AppError(400, 'validation_error', 'That stage is not in the pipeline', {
          stageId: 'Choose a stage',
        });
      const row = await tx.crmDeals.insert({
        pipelineId: pipeline.id,
        stageId: stage.id,
        companyId: b.companyId ?? null,
        contactId: b.contactId ?? null,
        title: b.title,
        value: b.value ?? 0,
        currency: b.currency ?? 'USD',
        expectedClose: b.expectedClose ?? null,
        ownerId: b.ownerId ?? actor.userId,
        position: await nextPosition(tx, stage.id),
        createdBy: actor.userId,
        ...closing(stage),
      });
      if (b.tagIds) await setTags(tx, actor.orgId, 'deal', row.id, b.tagIds);
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'crm.deal_created',
        targetType: 'crm_deal',
        targetId: row.id,
        after: { title: b.title, value: b.value ?? 0 },
      });
      const [out] = await dealRows(tx, actor, { id: row.id }, 1);
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const { tagIds: tags, ...patch } = req.body;
        const before = await tx.crmDeals.findOne({ id: req.params.id, deletedAt: null });
        if (!before) throw notFound('Deal');
        await assertLinks(tx, actor.orgId, patch);
        await assertActiveMember(tx, actor.orgId, patch.ownerId);
        if (Object.keys(patch).length) {
          await tx.crmDeals.updateOne({ id: before.id }, { ...patch, updatedAt: new Date() });
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
        const [out] = await dealRows(tx, actor, { id: before.id }, 1);
        return out!;
      });
    },
  );

  r.delete(
    '/crm/deals/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx.crmDeals.findOneAndUpdate(
          { id: req.params.id, deletedAt: null },
          { deletedAt: new Date() },
        );
        if (!gone) throw notFound('Deal');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.deal_deleted',
          targetType: 'crm_deal',
          targetId: gone.id,
          before: { title: gone.title },
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
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const deal = await tx.crmDeals.findOne({ id: req.params.id, deletedAt: null });
        if (!deal) throw notFound('Deal');
        const stage = await tx.crmStages.findOne({
          id: req.body.stageId,
          pipelineId: deal.pipelineId,
        });
        if (!stage)
          throw new AppError(400, 'validation_error', 'That stage is not in this deal’s pipeline', {
            stageId: 'Choose a stage in the same pipeline',
          });

        const column = await tx.crmDeals.find(
          { stageId: stage.id, deletedAt: null },
          { sort: { position: 1, id: 1 }, projection: { id: 1, position: 1 } },
        );
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
        await tx.crmDeals.updateOne(
          { id: deal.id },
          { stageId: stage.id, position, ...state, updatedAt: new Date() },
        );
        if (changedStage) {
          const from = await tx.crmStages.get(deal.stageId);
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
        const [out] = await dealRows(tx, actor, { id: deal.id }, 1);
        return out!;
      });
    },
  );
}
