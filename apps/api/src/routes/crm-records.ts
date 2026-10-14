import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { loadSettings } from '../checkin/service.js';
import {
  assertActiveMember,
  crmCapacity,
  crmGuard,
  currencyCode,
  email,
  ensureDefaultPipeline,
  idParam,
  loadTags,
  optionalText,
  ownerNames,
  recordIdsWithTag,
  setTags,
  TAG_COLORS,
  uuid,
} from '../crm/helpers.js';
import { CI, withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { containsRegex, offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';

const name = (max = 120) => z.string().trim().min(1, 'Enter a name').max(max);
const tagIds = z.array(uuid).max(20);
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified'] as const;

const dupName = () =>
  new AppError(409, 'name_taken', 'A company with that name already exists', {
    name: 'A company with that name already exists',
  });

type Filter = Record<string, unknown>;

/** Narrows a filter to records carrying a tag (an `id $in` over the tagged record ids). */
async function withTagFilter(
  tx: TenantDb,
  type: 'company' | 'contact' | 'lead' | 'deal',
  filter: Filter,
  tagId: string | undefined,
): Promise<Filter> {
  if (!tagId) return filter;
  return { ...filter, id: { $in: await recordIdsWithTag(tx, type, tagId) } };
}

export async function crmRecordRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Access and module switch -------------------------------------------------------------
  r.get('/crm/access', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const settings = await loadSettings(tx, actor.orgId);
      return {
        enabled: settings.crmEnabled,
        role: actor.crmRole ?? 'member',
        canView: settings.crmEnabled && can(actor, 'crm.view'),
        canEdit: settings.crmEnabled && can(actor, 'crm.edit'),
        canAdmin: can(actor, 'crm.admin'),
      };
    });
  });

  r.put(
    '/crm/settings',
    { preHandler: requireAuth, schema: { body: z.object({ enabled: z.boolean() }) } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const row = await tx.tenantSettings.findOne({});
        const base = row?.enabledModules ?? ['members', 'spaces', 'checkin', 'crm'];
        const modules = req.body.enabled
          ? [...new Set([...base, 'crm'])]
          : base.filter((m) => m !== 'crm');
        await tx.tenantSettings.upsert({}, { enabledModules: modules, updatedAt: new Date() });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.module_toggled',
          targetType: 'settings',
          targetId: actor.orgId,
          after: { crmEnabled: req.body.enabled },
        });
        return { enabled: req.body.enabled };
      });
    },
  );

  // ---- Tags -----------------------------------------------------------------------------------
  r.get('/crm/tags', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');
      const rows = await tx.crmTags.find({}, { sort: { nameLower: 1 } });
      return { items: rows.map((t) => ({ id: t.id, name: t.name, color: t.color })) };
    });
  });

  r.post(
    '/crm/tags',
    {
      preHandler: requireAuth,
      schema: { body: z.object({ name: name(40), color: z.enum(TAG_COLORS).default('blue') }) },
    },
    async (req) => {
      const actor = actorOf(req);
      try {
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          // Tag names are unique per workspace, ignoring case.
          const dup = await tx.crmTags.exists({ nameLower: req.body.name.toLowerCase() });
          if (dup) throw new AppError(409, 'name_taken', 'That tag already exists', { name: 'That tag already exists' });
          const row = await tx.crmTags.insert({ name: req.body.name, color: req.body.color });
          return { id: row.id, name: row.name, color: row.color };
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw new AppError(409, 'name_taken', 'That tag already exists', {
            name: 'That tag already exists',
          });
        throw e;
      }
    },
  );

  r.delete(
    '/crm/tags/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx.crmTags.deleteOne({ id: req.params.id });
        if (!gone) throw notFound('Tag');
        await tx.crmRecordTags.deleteMany({ tagId: req.params.id });
      });
      return { ok: true };
    },
  );

  // ---- Companies ------------------------------------------------------------------------------
  const companyBody = z.object({
    name: name(),
    website: optionalText(200),
    industry: optionalText(80),
    size: optionalText(40),
    ownerId: uuid.nullable().optional(),
    tagIds: tagIds.optional(),
  });

  async function companyRows(tx: TenantDb, actor: Actor, filter: Filter, limit = 20, skip = 0) {
    const docs = await tx.crmCompanies.find(
      { ...filter, deletedAt: null },
      { sort: { nameLower: 1, id: 1 }, skip, limit },
    );
    const ids = docs.map((d) => d.id);
    const owners = await ownerNames(tx, docs.map((d) => d.ownerId));
    const [contactCounts, dealCounts] = await Promise.all([
      tx.crmContacts.aggregate<{ _id: string; n: number }>([
        { $match: { companyId: { $in: ids }, deletedAt: null } },
        { $group: { _id: '$companyId', n: { $sum: 1 } } },
      ]),
      tx.crmDeals.aggregate<{ _id: string; n: number }>([
        { $match: { companyId: { $in: ids }, deletedAt: null } },
        { $group: { _id: '$companyId', n: { $sum: 1 } } },
      ]),
    ]);
    const contacts = new Map(contactCounts.map((c) => [c._id, c.n]));
    const deals = new Map(dealCounts.map((c) => [c._id, c.n]));
    const tags = await loadTags(tx, actor.orgId, 'company', ids);
    return docs.map((x) => ({
      id: x.id,
      name: x.name,
      website: x.website,
      industry: x.industry,
      size: x.size,
      ownerId: x.ownerId,
      ownerName: x.ownerId ? (owners.get(x.ownerId) ?? null) : null,
      createdAt: x.createdAt,
      contactCount: contacts.get(x.id) ?? 0,
      dealCount: deals.get(x.id) ?? 0,
      tags: tags.get(x.id) ?? [],
    }));
  }

  /** Open deals attached to a record, newest first, with their stage name. */
  async function dealSummaries(tx: TenantDb, filter: Filter) {
    const deals = await tx.crmDeals.find(
      { ...filter, deletedAt: null },
      { sort: { createdAt: -1 }, limit: 100 },
    );
    const stages = await tx.crmStages.find({ id: { $in: [...new Set(deals.map((d) => d.stageId))] } });
    const stageName = new Map(stages.map((s) => [s.id, s.name]));
    return deals.map((d) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value),
      currency: d.currency,
      status: d.status,
      stageName: stageName.get(d.stageId) ?? '',
    }));
  }

  r.get(
    '/crm/companies',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          ownerId: uuid.optional(),
          tagId: uuid.optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        let filters: Filter = {};
        if (q.q) {
          const rx = containsRegex(q.q);
          filters.$or = [{ name: rx }, { website: rx }, { industry: rx }];
        }
        if (q.ownerId) filters.ownerId = q.ownerId;
        filters = await withTagFilter(tx, 'company', filters, q.tagId);
        const items = await companyRows(tx, actor, filters, q.pageSize, offsetOf(q));
        const total = await tx.crmCompanies.count({ ...filters, deletedAt: null });
        return { items, total, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.get(
    '/crm/companies/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const [company] = await companyRows(tx, actor, { id: req.params.id }, 1);
        if (!company) throw notFound('Company');
        const contacts = (
          await tx.crmContacts.find(
            { companyId: company.id, deletedAt: null },
            { sort: { name: 1 }, collation: CI, limit: 100 },
          )
        ).map((c) => ({ id: c.id, name: c.name, email: c.email, jobTitle: c.jobTitle }));
        const deals = await dealSummaries(tx, { companyId: company.id });
        return { ...company, contacts, deals };
      });
    },
  );

  r.post(
    '/crm/companies',
    { preHandler: requireAuth, schema: { body: companyBody } },
    async (req) => {
      const actor = actorOf(req);
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          await crmCapacity(tx, actor.orgId);
          const b = req.body;
          await assertActiveMember(tx, actor.orgId, b.ownerId);
          const row = await tx.crmCompanies.insert({
            name: b.name,
            website: b.website ?? null,
            industry: b.industry ?? null,
            size: b.size ?? null,
            ownerId: b.ownerId ?? actor.userId,
            createdBy: actor.userId,
          });
          if (b.tagIds) await setTags(tx, actor.orgId, 'company', row.id, b.tagIds);
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'crm.company_created',
            targetType: 'crm_company',
            targetId: row.id,
            after: { name: b.name },
          });
          const [out] = await companyRows(tx, actor, { id: row.id }, 1);
          return out!;
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw dupName();
        throw e;
      }
    },
  );

  r.patch(
    '/crm/companies/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: companyBody
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          const { tagIds: tags, ...patch } = req.body;
          const before = await tx.crmCompanies.findOne({ id: req.params.id, deletedAt: null });
          if (!before) throw notFound('Company');
          await assertActiveMember(tx, actor.orgId, patch.ownerId);
          if (Object.keys(patch).length) {
            await tx.crmCompanies.updateOne({ id: before.id }, { ...patch, updatedAt: new Date() });
          }
          if (tags) await setTags(tx, actor.orgId, 'company', before.id, tags);
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'crm.company_updated',
            targetType: 'crm_company',
            targetId: before.id,
            before: Object.fromEntries(
              Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
            ),
            after: patch,
          });
          const [out] = await companyRows(tx, actor, { id: before.id }, 1);
          return out!;
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw dupName();
        throw e;
      }
    },
  );

  r.delete(
    '/crm/companies/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const c = await tx.crmCompanies.findOne({ id: req.params.id, deletedAt: null });
        if (!c) throw notFound('Company');
        if (await tx.crmDeals.exists({ companyId: c.id, status: 'open', deletedAt: null }))
          throw new AppError(
            409,
            'has_open_deals',
            'Close or delete this company’s open deals first',
          );
        await tx.crmCompanies.updateOne({ id: c.id }, { deletedAt: new Date() });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.company_deleted',
          targetType: 'crm_company',
          targetId: c.id,
          before: { name: c.name },
        });
      });
      return { ok: true };
    },
  );

  // ---- Contacts -------------------------------------------------------------------------------
  const contactBody = z.object({
    name: name(),
    companyId: uuid.nullable().optional(),
    email,
    phone: optionalText(40),
    jobTitle: optionalText(80),
    ownerId: uuid.nullable().optional(),
    tagIds: tagIds.optional(),
  });

  async function assertCompany(tx: TenantDb, _orgId: string, id: string | null | undefined) {
    if (!id) return;
    if (!(await tx.crmCompanies.exists({ id, deletedAt: null })))
      throw new AppError(400, 'validation_error', 'That company does not exist', {
        companyId: 'Choose an existing company',
      });
  }

  async function contactRows(tx: TenantDb, actor: Actor, filter: Filter, limit = 20, skip = 0) {
    const docs = await tx.crmContacts.find(
      { ...filter, deletedAt: null },
      { sort: { name: 1, id: 1 }, collation: CI, skip, limit },
    );
    const companies = await tx.crmCompanies.find({
      id: { $in: [...new Set(docs.map((d) => d.companyId).filter((x): x is string => !!x))] },
    });
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const owners = await ownerNames(tx, docs.map((d) => d.ownerId));
    const tags = await loadTags(tx, actor.orgId, 'contact', docs.map((d) => d.id));
    return docs.map((x) => ({
      id: x.id,
      name: x.name,
      email: x.email,
      phone: x.phone,
      jobTitle: x.jobTitle,
      companyId: x.companyId,
      companyName: x.companyId ? (companyName.get(x.companyId) ?? null) : null,
      ownerId: x.ownerId,
      ownerName: x.ownerId ? (owners.get(x.ownerId) ?? null) : null,
      createdAt: x.createdAt,
      tags: tags.get(x.id) ?? [],
    }));
  }

  r.get(
    '/crm/contacts',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          companyId: uuid.optional(),
          ownerId: uuid.optional(),
          tagId: uuid.optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        let filters: Filter = {};
        if (q.q) {
          const rx = containsRegex(q.q);
          filters.$or = [{ name: rx }, { email: rx }, { jobTitle: rx }];
        }
        if (q.companyId) filters.companyId = q.companyId;
        if (q.ownerId) filters.ownerId = q.ownerId;
        filters = await withTagFilter(tx, 'contact', filters, q.tagId);
        const items = await contactRows(tx, actor, filters, q.pageSize, offsetOf(q));
        const total = await tx.crmContacts.count({ ...filters, deletedAt: null });
        return { items, total, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.get(
    '/crm/contacts/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        const [contact] = await contactRows(tx, actor, { id: req.params.id }, 1);
        if (!contact) throw notFound('Contact');
        const deals = await dealSummaries(tx, { contactId: contact.id });
        return { ...contact, deals };
      });
    },
  );

  r.post(
    '/crm/contacts',
    { preHandler: requireAuth, schema: { body: contactBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        await crmCapacity(tx, actor.orgId);
        const b = req.body;
        await assertCompany(tx, actor.orgId, b.companyId);
        await assertActiveMember(tx, actor.orgId, b.ownerId);
        const row = await tx.crmContacts.insert({
          name: b.name,
          companyId: b.companyId ?? null,
          email: b.email ?? null,
          phone: b.phone ?? null,
          jobTitle: b.jobTitle ?? null,
          ownerId: b.ownerId ?? actor.userId,
          createdBy: actor.userId,
        });
        if (b.tagIds) await setTags(tx, actor.orgId, 'contact', row.id, b.tagIds);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.contact_created',
          targetType: 'crm_contact',
          targetId: row.id,
          after: { name: b.name },
        });
        const [out] = await contactRows(tx, actor, { id: row.id }, 1);
        return out!;
      });
    },
  );

  r.patch(
    '/crm/contacts/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: contactBody
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
        const before = await tx.crmContacts.findOne({ id: req.params.id, deletedAt: null });
        if (!before) throw notFound('Contact');
        await assertCompany(tx, actor.orgId, patch.companyId);
        await assertActiveMember(tx, actor.orgId, patch.ownerId);
        if (Object.keys(patch).length) {
          await tx.crmContacts.updateOne({ id: before.id }, { ...patch, updatedAt: new Date() });
        }
        if (tags) await setTags(tx, actor.orgId, 'contact', before.id, tags);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.contact_updated',
          targetType: 'crm_contact',
          targetId: before.id,
          before: Object.fromEntries(
            Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
          ),
          after: patch,
        });
        const [out] = await contactRows(tx, actor, { id: before.id }, 1);
        return out!;
      });
    },
  );

  r.delete(
    '/crm/contacts/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx.crmContacts.findOneAndUpdate(
          { id: req.params.id, deletedAt: null },
          { deletedAt: new Date() },
        );
        if (!gone) throw notFound('Contact');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.contact_deleted',
          targetType: 'crm_contact',
          targetId: gone.id,
          before: { name: gone.name },
        });
      });
      return { ok: true };
    },
  );

  // ---- Leads ----------------------------------------------------------------------------------
  const leadBody = z.object({
    name: name(),
    email,
    companyName: optionalText(120),
    source: optionalText(60),
    status: z.enum(LEAD_STATUSES).optional(),
    ownerId: uuid.nullable().optional(),
    tagIds: tagIds.optional(),
  });

  async function leadRows(tx: TenantDb, actor: Actor, filter: Filter, limit = 20, skip = 0) {
    const docs = await tx.crmLeads.find(
      { ...filter, deletedAt: null },
      { sort: { createdAt: -1, id: 1 }, skip, limit },
    );
    const owners = await ownerNames(tx, docs.map((d) => d.ownerId));
    const tags = await loadTags(tx, actor.orgId, 'lead', docs.map((d) => d.id));
    return docs.map((x) => ({
      id: x.id,
      name: x.name,
      email: x.email,
      companyName: x.companyName,
      source: x.source,
      status: x.status,
      ownerId: x.ownerId,
      ownerName: x.ownerId ? (owners.get(x.ownerId) ?? null) : null,
      convertedAt: x.convertedAt,
      convertedCompanyId: x.convertedCompanyId,
      convertedContactId: x.convertedContactId,
      convertedDealId: x.convertedDealId,
      createdAt: x.createdAt,
      tags: tags.get(x.id) ?? [],
    }));
  }

  r.get(
    '/crm/leads',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          status: z.enum(LEAD_STATUSES).optional(),
          source: z.string().trim().max(60).optional(),
          ownerId: uuid.optional(),
          tagId: uuid.optional(),
          converted: z.enum(['true', 'false']).optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const q = req.query;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'view');
        let filters: Filter = {};
        if (q.q) {
          const rx = containsRegex(q.q);
          filters.$or = [{ name: rx }, { email: rx }, { companyName: rx }];
        }
        if (q.status) filters.status = q.status;
        if (q.source) filters.source = q.source;
        if (q.ownerId) filters.ownerId = q.ownerId;
        if (q.converted === 'true') filters.convertedAt = { $ne: null };
        else if (q.converted === 'false') filters.convertedAt = null;
        filters = await withTagFilter(tx, 'lead', filters, q.tagId);
        const items = await leadRows(tx, actor, filters, q.pageSize, offsetOf(q));
        const total = await tx.crmLeads.count({ ...filters, deletedAt: null });
        return { items, total, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.get('/crm/leads/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');
      const [lead] = await leadRows(tx, actor, { id: req.params.id }, 1);
      if (!lead) throw notFound('Lead');
      return lead;
    });
  });

  r.post('/crm/leads', { preHandler: requireAuth, schema: { body: leadBody } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'edit');
      await crmCapacity(tx, actor.orgId);
      const b = req.body;
      await assertActiveMember(tx, actor.orgId, b.ownerId);
      const row = await tx.crmLeads.insert({
        name: b.name,
        email: b.email ?? null,
        companyName: b.companyName ?? null,
        source: b.source ?? null,
        status: b.status ?? 'new',
        ownerId: b.ownerId ?? actor.userId,
        createdBy: actor.userId,
      });
      if (b.tagIds) await setTags(tx, actor.orgId, 'lead', row.id, b.tagIds);
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'crm.lead_created',
        targetType: 'crm_lead',
        targetId: row.id,
        after: { name: b.name, source: b.source ?? null },
      });
      const [out] = await leadRows(tx, actor, { id: row.id }, 1);
      return out!;
    });
  });

  r.patch(
    '/crm/leads/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: leadBody
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
        const before = await tx.crmLeads.findOne({ id: req.params.id, deletedAt: null });
        if (!before) throw notFound('Lead');
        await assertActiveMember(tx, actor.orgId, patch.ownerId);
        if (Object.keys(patch).length) {
          await tx.crmLeads.updateOne({ id: before.id }, { ...patch, updatedAt: new Date() });
        }
        if (tags) await setTags(tx, actor.orgId, 'lead', before.id, tags);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.lead_updated',
          targetType: 'crm_lead',
          targetId: before.id,
          before: Object.fromEntries(
            Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]),
          ),
          after: patch,
        });
        const [out] = await leadRows(tx, actor, { id: before.id }, 1);
        return out!;
      });
    },
  );

  r.delete(
    '/crm/leads/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx.crmLeads.findOneAndUpdate(
          { id: req.params.id, deletedAt: null },
          { deletedAt: new Date() },
        );
        if (!gone) throw notFound('Lead');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.lead_deleted',
          targetType: 'crm_lead',
          targetId: gone.id,
          before: { name: gone.name },
        });
      });
      return { ok: true };
    },
  );

  // Convert a lead into a company, a contact and a deal in one step. All or nothing.
  const convertBody = z.object({
    company: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('existing'), id: uuid }),
      z.object({ mode: z.literal('new'), name: name(), website: optionalText(200) }),
      z.object({ mode: z.literal('none') }),
    ]),
    contact: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('existing'), id: uuid }),
      z.object({
        mode: z.literal('new'),
        name: name(),
        email,
        phone: optionalText(40),
        jobTitle: optionalText(80),
      }),
      z.object({ mode: z.literal('none') }),
    ]),
    deal: z
      .object({
        title: name(160),
        value: z.number().min(0).max(1e12).default(0),
        currency: currencyCode.default('USD'),
        pipelineId: uuid.optional(),
        stageId: uuid.optional(),
        expectedClose: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .nullable(),
  });

  r.post(
    '/crm/leads/:id/convert',
    { preHandler: requireAuth, schema: { params: idParam, body: convertBody } },
    async (req) => {
      const actor = actorOf(req);
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          const b = req.body;
          await crmCapacity(
            tx,
            actor.orgId,
            (b.company.mode === 'new' ? 1 : 0) +
              (b.contact.mode === 'new' ? 1 : 0) +
              (b.deal ? 1 : 0),
          );
          const lead = await tx.crmLeads.findOne({ id: req.params.id, deletedAt: null });
          if (!lead) throw notFound('Lead');
          if (lead.convertedAt)
            throw new AppError(409, 'already_converted', 'This lead was already converted');

          let companyId: string | null = null;
          if (b.company.mode === 'existing') {
            await assertCompany(tx, actor.orgId, b.company.id);
            companyId = b.company.id;
          } else if (b.company.mode === 'new') {
            const created = await tx.crmCompanies.insert({
              name: b.company.name,
              website: b.company.website ?? null,
              ownerId: lead.ownerId ?? actor.userId,
              createdBy: actor.userId,
            });
            companyId = created.id;
            await writeAudit(tx, {
              orgId: actor.orgId,
              actorId: actor.userId,
              action: 'crm.company_created',
              targetType: 'crm_company',
              targetId: companyId,
              after: { name: b.company.name, fromLead: lead.id },
            });
          }

          let contactId: string | null = null;
          if (b.contact.mode === 'existing') {
            const c = await tx.crmContacts.findOne({ id: b.contact.id, deletedAt: null });
            if (!c)
              throw new AppError(400, 'validation_error', 'That contact does not exist', {
                contact: 'Choose an existing contact',
              });
            contactId = c.id;
          } else if (b.contact.mode === 'new') {
            const created = await tx.crmContacts.insert({
              name: b.contact.name,
              email: b.contact.email ?? null,
              phone: b.contact.phone ?? null,
              jobTitle: b.contact.jobTitle ?? null,
              companyId,
              ownerId: lead.ownerId ?? actor.userId,
              createdBy: actor.userId,
            });
            contactId = created.id;
            await writeAudit(tx, {
              orgId: actor.orgId,
              actorId: actor.userId,
              action: 'crm.contact_created',
              targetType: 'crm_contact',
              targetId: contactId,
              after: { name: b.contact.name, fromLead: lead.id },
            });
          }

          let dealId: string | null = null;
          if (b.deal) {
            const pipeline = b.deal.pipelineId
              ? await tx.crmPipelines.get(b.deal.pipelineId)
              : await ensureDefaultPipeline(tx, actor.orgId);
            if (!pipeline)
              throw new AppError(400, 'validation_error', 'That pipeline does not exist', {
                pipelineId: 'Choose a pipeline',
              });
            const stages = await tx.crmStages.find(
              { pipelineId: pipeline.id },
              { sort: { position: 1, id: 1 } },
            );
            const stage = b.deal.stageId
              ? stages.find((s) => s.id === b.deal!.stageId)
              : stages.find((s) => !s.isWon && !s.isLost);
            if (!stage)
              throw new AppError(400, 'validation_error', 'That stage is not in the pipeline', {
                stageId: 'Choose a stage',
              });
            const top = await tx.crmDeals.findOne({ stageId: stage.id }, { sort: { position: -1 } });
            const created = await tx.crmDeals.insert({
              pipelineId: pipeline.id,
              stageId: stage.id,
              companyId,
              contactId,
              title: b.deal.title,
              value: b.deal.value,
              currency: b.deal.currency,
              expectedClose: b.deal.expectedClose ?? null,
              ownerId: lead.ownerId ?? actor.userId,
              status: stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open',
              closedAt: stage.isWon || stage.isLost ? new Date() : null,
              position: (top?.position ?? 0) + 1000,
              createdBy: actor.userId,
            });
            dealId = created.id;
            await writeAudit(tx, {
              orgId: actor.orgId,
              actorId: actor.userId,
              action: 'crm.deal_created',
              targetType: 'crm_deal',
              targetId: dealId,
              after: { title: b.deal.title, fromLead: lead.id },
            });
          }

          await tx.crmLeads.updateOne(
            { id: lead.id },
            {
              convertedAt: new Date(),
              status: 'qualified',
              convertedCompanyId: companyId,
              convertedContactId: contactId,
              convertedDealId: dealId,
              updatedAt: new Date(),
            },
          );
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'crm.lead_converted',
            targetType: 'crm_lead',
            targetId: lead.id,
            after: { companyId, contactId, dealId },
          });
          return { leadId: lead.id, companyId, contactId, dealId };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw dupName();
        throw e;
      }
    },
  );
}
