import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
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
  likeEscape,
  loadTags,
  optionalText,
  setTags,
  TAG_COLORS,
  uuid,
} from '../crm/helpers.js';
import { withTenant, type Tx } from '../db/client.js';
import {
  crmCompanies,
  crmContacts,
  crmDeals,
  crmLeads,
  crmPipelines,
  crmStages,
  crmTags,
  tenantSettings,
  users,
} from '../db/schema.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { offsetOf, pageQuery } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';

const name = (max = 120) => z.string().trim().min(1, 'Enter a name').max(max);
const tagIds = z.array(uuid).max(20);
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified'] as const;

// Qualified column references for use inside raw subqueries (an unqualified "id" would bind to the wrong table).
const COMPANY_ID = sql.raw('"crm_companies"."id"');
const CONTACT_ID = sql.raw('"crm_contacts"."id"');
const LEAD_ID = sql.raw('"crm_leads"."id"');

const tagFilter = (type: string, recordId: SQL, tag: string) =>
  sql`exists (select 1 from crm_record_tags rt where rt.record_type = ${type} and rt.record_id = ${recordId} and rt.tag_id = ${tag})`;

const dupName = () =>
  new AppError(409, 'name_taken', 'A company with that name already exists', {
    name: 'A company with that name already exists',
  });

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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(tenantSettings)
          .where(eq(tenantSettings.orgId, actor.orgId));
        const base = row?.enabledModules ?? ['members', 'spaces', 'checkin', 'crm'];
        const modules = req.body.enabled
          ? [...new Set([...base, 'crm'])]
          : base.filter((m) => m !== 'crm');
        await tx
          .insert(tenantSettings)
          .values({ orgId: actor.orgId, enabledModules: modules })
          .onConflictDoUpdate({
            target: tenantSettings.orgId,
            set: { enabledModules: modules, updatedAt: new Date() },
          });
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
      return {
        items: await tx
          .select({ id: crmTags.id, name: crmTags.name, color: crmTags.color })
          .from(crmTags)
          .where(eq(crmTags.orgId, actor.orgId))
          .orderBy(asc(sql`lower(${crmTags.name})`)),
      };
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
          const [row] = await tx
            .insert(crmTags)
            .values({ orgId: actor.orgId, name: req.body.name, color: req.body.color })
            .returning({ id: crmTags.id, name: crmTags.name, color: crmTags.color });
          return row!;
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
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx
          .delete(crmTags)
          .where(and(eq(crmTags.id, req.params.id), eq(crmTags.orgId, actor.orgId)))
          .returning({ id: crmTags.id });
        if (!gone.length) throw notFound('Tag');
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

  async function companyRows(tx: Tx, actor: Actor, where: SQL | undefined, limit = 20, offset = 0) {
    const rows = await tx
      .select({
        id: crmCompanies.id,
        name: crmCompanies.name,
        website: crmCompanies.website,
        industry: crmCompanies.industry,
        size: crmCompanies.size,
        ownerId: crmCompanies.ownerId,
        ownerName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
        createdAt: crmCompanies.createdAt,
        contactCount: sql<number>`(select count(*)::int from crm_contacts c where c.company_id = "crm_companies"."id" and c.deleted_at is null)`,
        dealCount: sql<number>`(select count(*)::int from crm_deals d where d.company_id = "crm_companies"."id" and d.deleted_at is null)`,
      })
      .from(crmCompanies)
      .leftJoin(users, eq(users.id, crmCompanies.ownerId))
      .where(and(eq(crmCompanies.orgId, actor.orgId), isNull(crmCompanies.deletedAt), where))
      .orderBy(asc(sql`lower(${crmCompanies.name})`), asc(crmCompanies.id))
      .limit(limit)
      .offset(offset);
    const tags = await loadTags(
      tx,
      actor.orgId,
      'company',
      rows.map((x) => x.id),
    );
    return rows.map((x) => ({ ...x, tags: tags.get(x.id) ?? [] }));
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
        const filters = and(
          q.q
            ? or(
                ilike(crmCompanies.name, likeEscape(q.q)),
                ilike(crmCompanies.website, likeEscape(q.q)),
                ilike(crmCompanies.industry, likeEscape(q.q)),
              )
            : undefined,
          q.ownerId ? eq(crmCompanies.ownerId, q.ownerId) : undefined,
          q.tagId ? tagFilter('company', COMPANY_ID, q.tagId) : undefined,
        );
        const items = await companyRows(tx, actor, filters, q.pageSize, offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(crmCompanies)
          .where(and(eq(crmCompanies.orgId, actor.orgId), isNull(crmCompanies.deletedAt), filters));
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
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
        const [company] = await companyRows(tx, actor, eq(crmCompanies.id, req.params.id), 1);
        if (!company) throw notFound('Company');
        const contacts = await tx
          .select({
            id: crmContacts.id,
            name: crmContacts.name,
            email: crmContacts.email,
            jobTitle: crmContacts.jobTitle,
          })
          .from(crmContacts)
          .where(
            and(
              eq(crmContacts.orgId, actor.orgId),
              eq(crmContacts.companyId, company.id),
              isNull(crmContacts.deletedAt),
            ),
          )
          .orderBy(asc(sql`lower(${crmContacts.name})`))
          .limit(100);
        const deals = await tx
          .select({
            id: crmDeals.id,
            title: crmDeals.title,
            value: sql<number>`${crmDeals.value}::float8`,
            currency: crmDeals.currency,
            status: crmDeals.status,
            stageName: crmStages.name,
          })
          .from(crmDeals)
          .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
          .where(
            and(
              eq(crmDeals.orgId, actor.orgId),
              eq(crmDeals.companyId, company.id),
              isNull(crmDeals.deletedAt),
            ),
          )
          .orderBy(desc(crmDeals.createdAt))
          .limit(100);
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          await crmCapacity(tx, actor.orgId);
          const b = req.body;
          await assertActiveMember(tx, actor.orgId, b.ownerId);
          const [row] = await tx
            .insert(crmCompanies)
            .values({
              orgId: actor.orgId,
              name: b.name,
              website: b.website ?? null,
              industry: b.industry ?? null,
              size: b.size ?? null,
              ownerId: b.ownerId ?? actor.userId,
              createdBy: actor.userId,
            })
            .returning({ id: crmCompanies.id });
          if (b.tagIds) await setTags(tx, actor.orgId, 'company', row!.id, b.tagIds);
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'crm.company_created',
            targetType: 'crm_company',
            targetId: row!.id,
            after: { name: b.name },
          });
          const [out] = await companyRows(tx, actor, eq(crmCompanies.id, row!.id), 1);
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          const { tagIds: tags, ...patch } = req.body;
          const [before] = await tx
            .select()
            .from(crmCompanies)
            .where(
              and(
                eq(crmCompanies.id, req.params.id),
                eq(crmCompanies.orgId, actor.orgId),
                isNull(crmCompanies.deletedAt),
              ),
            );
          if (!before) throw notFound('Company');
          await assertActiveMember(tx, actor.orgId, patch.ownerId);
          if (Object.keys(patch).length) {
            await tx
              .update(crmCompanies)
              .set({ ...patch, updatedAt: new Date() })
              .where(and(eq(crmCompanies.id, before.id), eq(crmCompanies.orgId, actor.orgId)));
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
          const [out] = await companyRows(tx, actor, eq(crmCompanies.id, before.id), 1);
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
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const [c] = await tx
          .select()
          .from(crmCompanies)
          .where(
            and(
              eq(crmCompanies.id, req.params.id),
              eq(crmCompanies.orgId, actor.orgId),
              isNull(crmCompanies.deletedAt),
            ),
          );
        if (!c) throw notFound('Company');
        const open = await tx
          .select({ id: crmDeals.id })
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.orgId, actor.orgId),
              eq(crmDeals.companyId, c.id),
              eq(crmDeals.status, 'open'),
              isNull(crmDeals.deletedAt),
            ),
          )
          .limit(1);
        if (open.length)
          throw new AppError(
            409,
            'has_open_deals',
            'Close or delete this company’s open deals first',
          );
        await tx
          .update(crmCompanies)
          .set({ deletedAt: new Date() })
          .where(and(eq(crmCompanies.id, c.id), eq(crmCompanies.orgId, actor.orgId)));
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

  async function assertCompany(tx: Tx, orgId: string, id: string | null | undefined) {
    if (!id) return;
    const [c] = await tx
      .select({ id: crmCompanies.id })
      .from(crmCompanies)
      .where(
        and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId), isNull(crmCompanies.deletedAt)),
      );
    if (!c)
      throw new AppError(400, 'validation_error', 'That company does not exist', {
        companyId: 'Choose an existing company',
      });
  }

  async function contactRows(tx: Tx, actor: Actor, where: SQL | undefined, limit = 20, offset = 0) {
    const rows = await tx
      .select({
        id: crmContacts.id,
        name: crmContacts.name,
        email: crmContacts.email,
        phone: crmContacts.phone,
        jobTitle: crmContacts.jobTitle,
        companyId: crmContacts.companyId,
        companyName: crmCompanies.name,
        ownerId: crmContacts.ownerId,
        ownerName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
        createdAt: crmContacts.createdAt,
      })
      .from(crmContacts)
      .leftJoin(
        crmCompanies,
        and(eq(crmCompanies.id, crmContacts.companyId), eq(crmCompanies.orgId, crmContacts.orgId)),
      )
      .leftJoin(users, eq(users.id, crmContacts.ownerId))
      .where(and(eq(crmContacts.orgId, actor.orgId), isNull(crmContacts.deletedAt), where))
      .orderBy(asc(sql`lower(${crmContacts.name})`), asc(crmContacts.id))
      .limit(limit)
      .offset(offset);
    const tags = await loadTags(
      tx,
      actor.orgId,
      'contact',
      rows.map((x) => x.id),
    );
    return rows.map((x) => ({ ...x, tags: tags.get(x.id) ?? [] }));
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
        const filters = and(
          q.q
            ? or(
                ilike(crmContacts.name, likeEscape(q.q)),
                ilike(crmContacts.email, likeEscape(q.q)),
                ilike(crmContacts.jobTitle, likeEscape(q.q)),
              )
            : undefined,
          q.companyId ? eq(crmContacts.companyId, q.companyId) : undefined,
          q.ownerId ? eq(crmContacts.ownerId, q.ownerId) : undefined,
          q.tagId ? tagFilter('contact', CONTACT_ID, q.tagId) : undefined,
        );
        const items = await contactRows(tx, actor, filters, q.pageSize, offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(crmContacts)
          .where(and(eq(crmContacts.orgId, actor.orgId), isNull(crmContacts.deletedAt), filters));
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
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
        const [contact] = await contactRows(tx, actor, eq(crmContacts.id, req.params.id), 1);
        if (!contact) throw notFound('Contact');
        const deals = await tx
          .select({
            id: crmDeals.id,
            title: crmDeals.title,
            value: sql<number>`${crmDeals.value}::float8`,
            currency: crmDeals.currency,
            status: crmDeals.status,
            stageName: crmStages.name,
          })
          .from(crmDeals)
          .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
          .where(
            and(
              eq(crmDeals.orgId, actor.orgId),
              eq(crmDeals.contactId, contact.id),
              isNull(crmDeals.deletedAt),
            ),
          )
          .orderBy(desc(crmDeals.createdAt))
          .limit(100);
        return { ...contact, deals };
      });
    },
  );

  r.post(
    '/crm/contacts',
    { preHandler: requireAuth, schema: { body: contactBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        await crmCapacity(tx, actor.orgId);
        const b = req.body;
        await assertCompany(tx, actor.orgId, b.companyId);
        await assertActiveMember(tx, actor.orgId, b.ownerId);
        const [row] = await tx
          .insert(crmContacts)
          .values({
            orgId: actor.orgId,
            name: b.name,
            companyId: b.companyId ?? null,
            email: b.email ?? null,
            phone: b.phone ?? null,
            jobTitle: b.jobTitle ?? null,
            ownerId: b.ownerId ?? actor.userId,
            createdBy: actor.userId,
          })
          .returning({ id: crmContacts.id });
        if (b.tagIds) await setTags(tx, actor.orgId, 'contact', row!.id, b.tagIds);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.contact_created',
          targetType: 'crm_contact',
          targetId: row!.id,
          after: { name: b.name },
        });
        const [out] = await contactRows(tx, actor, eq(crmContacts.id, row!.id), 1);
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const { tagIds: tags, ...patch } = req.body;
        const [before] = await tx
          .select()
          .from(crmContacts)
          .where(
            and(
              eq(crmContacts.id, req.params.id),
              eq(crmContacts.orgId, actor.orgId),
              isNull(crmContacts.deletedAt),
            ),
          );
        if (!before) throw notFound('Contact');
        await assertCompany(tx, actor.orgId, patch.companyId);
        await assertActiveMember(tx, actor.orgId, patch.ownerId);
        if (Object.keys(patch).length) {
          await tx
            .update(crmContacts)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(crmContacts.id, before.id), eq(crmContacts.orgId, actor.orgId)));
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
        const [out] = await contactRows(tx, actor, eq(crmContacts.id, before.id), 1);
        return out!;
      });
    },
  );

  r.delete(
    '/crm/contacts/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx
          .update(crmContacts)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(crmContacts.id, req.params.id),
              eq(crmContacts.orgId, actor.orgId),
              isNull(crmContacts.deletedAt),
            ),
          )
          .returning({ id: crmContacts.id, name: crmContacts.name });
        if (!gone.length) throw notFound('Contact');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.contact_deleted',
          targetType: 'crm_contact',
          targetId: gone[0]!.id,
          before: { name: gone[0]!.name },
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

  async function leadRows(tx: Tx, actor: Actor, where: SQL | undefined, limit = 20, offset = 0) {
    const rows = await tx
      .select({
        id: crmLeads.id,
        name: crmLeads.name,
        email: crmLeads.email,
        companyName: crmLeads.companyName,
        source: crmLeads.source,
        status: crmLeads.status,
        ownerId: crmLeads.ownerId,
        ownerName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
        convertedAt: crmLeads.convertedAt,
        convertedCompanyId: crmLeads.convertedCompanyId,
        convertedContactId: crmLeads.convertedContactId,
        convertedDealId: crmLeads.convertedDealId,
        createdAt: crmLeads.createdAt,
      })
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerId))
      .where(and(eq(crmLeads.orgId, actor.orgId), isNull(crmLeads.deletedAt), where))
      .orderBy(desc(crmLeads.createdAt), asc(crmLeads.id))
      .limit(limit)
      .offset(offset);
    const tags = await loadTags(
      tx,
      actor.orgId,
      'lead',
      rows.map((x) => x.id),
    );
    return rows.map((x) => ({ ...x, tags: tags.get(x.id) ?? [] }));
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
        const filters = and(
          q.q
            ? or(
                ilike(crmLeads.name, likeEscape(q.q)),
                ilike(crmLeads.email, likeEscape(q.q)),
                ilike(crmLeads.companyName, likeEscape(q.q)),
              )
            : undefined,
          q.status ? eq(crmLeads.status, q.status) : undefined,
          q.source ? eq(crmLeads.source, q.source) : undefined,
          q.ownerId ? eq(crmLeads.ownerId, q.ownerId) : undefined,
          q.tagId ? tagFilter('lead', LEAD_ID, q.tagId) : undefined,
          q.converted === 'true'
            ? sql`${crmLeads.convertedAt} is not null`
            : q.converted === 'false'
              ? isNull(crmLeads.convertedAt)
              : undefined,
        );
        const items = await leadRows(tx, actor, filters, q.pageSize, offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(crmLeads)
          .where(and(eq(crmLeads.orgId, actor.orgId), isNull(crmLeads.deletedAt), filters));
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.get('/crm/leads/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'view');
      const [lead] = await leadRows(tx, actor, eq(crmLeads.id, req.params.id), 1);
      if (!lead) throw notFound('Lead');
      return lead;
    });
  });

  r.post('/crm/leads', { preHandler: requireAuth, schema: { body: leadBody } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      await crmGuard(tx, actor, 'edit');
      await crmCapacity(tx, actor.orgId);
      const b = req.body;
      await assertActiveMember(tx, actor.orgId, b.ownerId);
      const [row] = await tx
        .insert(crmLeads)
        .values({
          orgId: actor.orgId,
          name: b.name,
          email: b.email ?? null,
          companyName: b.companyName ?? null,
          source: b.source ?? null,
          status: b.status ?? 'new',
          ownerId: b.ownerId ?? actor.userId,
          createdBy: actor.userId,
        })
        .returning({ id: crmLeads.id });
      if (b.tagIds) await setTags(tx, actor.orgId, 'lead', row!.id, b.tagIds);
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'crm.lead_created',
        targetType: 'crm_lead',
        targetId: row!.id,
        after: { name: b.name, source: b.source ?? null },
      });
      const [out] = await leadRows(tx, actor, eq(crmLeads.id, row!.id), 1);
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
      return withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'edit');
        const { tagIds: tags, ...patch } = req.body;
        const [before] = await tx
          .select()
          .from(crmLeads)
          .where(
            and(
              eq(crmLeads.id, req.params.id),
              eq(crmLeads.orgId, actor.orgId),
              isNull(crmLeads.deletedAt),
            ),
          );
        if (!before) throw notFound('Lead');
        await assertActiveMember(tx, actor.orgId, patch.ownerId);
        if (Object.keys(patch).length) {
          await tx
            .update(crmLeads)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(crmLeads.id, before.id), eq(crmLeads.orgId, actor.orgId)));
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
        const [out] = await leadRows(tx, actor, eq(crmLeads.id, before.id), 1);
        return out!;
      });
    },
  );

  r.delete(
    '/crm/leads/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const gone = await tx
          .update(crmLeads)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(crmLeads.id, req.params.id),
              eq(crmLeads.orgId, actor.orgId),
              isNull(crmLeads.deletedAt),
            ),
          )
          .returning({ id: crmLeads.id, name: crmLeads.name });
        if (!gone.length) throw notFound('Lead');
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.lead_deleted',
          targetType: 'crm_lead',
          targetId: gone[0]!.id,
          before: { name: gone[0]!.name },
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          await crmGuard(tx, actor, 'edit');
          const b = req.body;
          await crmCapacity(
            tx,
            actor.orgId,
            (b.company.mode === 'new' ? 1 : 0) +
              (b.contact.mode === 'new' ? 1 : 0) +
              (b.deal ? 1 : 0),
          );
          const [lead] = await tx
            .select()
            .from(crmLeads)
            .where(
              and(
                eq(crmLeads.id, req.params.id),
                eq(crmLeads.orgId, actor.orgId),
                isNull(crmLeads.deletedAt),
              ),
            );
          if (!lead) throw notFound('Lead');
          if (lead.convertedAt)
            throw new AppError(409, 'already_converted', 'This lead was already converted');

          let companyId: string | null = null;
          if (b.company.mode === 'existing') {
            await assertCompany(tx, actor.orgId, b.company.id);
            companyId = b.company.id;
          } else if (b.company.mode === 'new') {
            const [created] = await tx
              .insert(crmCompanies)
              .values({
                orgId: actor.orgId,
                name: b.company.name,
                website: b.company.website ?? null,
                ownerId: lead.ownerId ?? actor.userId,
                createdBy: actor.userId,
              })
              .returning({ id: crmCompanies.id });
            companyId = created!.id;
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
            const [c] = await tx
              .select({ id: crmContacts.id })
              .from(crmContacts)
              .where(
                and(
                  eq(crmContacts.id, b.contact.id),
                  eq(crmContacts.orgId, actor.orgId),
                  isNull(crmContacts.deletedAt),
                ),
              );
            if (!c)
              throw new AppError(400, 'validation_error', 'That contact does not exist', {
                contact: 'Choose an existing contact',
              });
            contactId = c.id;
          } else if (b.contact.mode === 'new') {
            const [created] = await tx
              .insert(crmContacts)
              .values({
                orgId: actor.orgId,
                name: b.contact.name,
                email: b.contact.email ?? null,
                phone: b.contact.phone ?? null,
                jobTitle: b.contact.jobTitle ?? null,
                companyId,
                ownerId: lead.ownerId ?? actor.userId,
                createdBy: actor.userId,
              })
              .returning({ id: crmContacts.id });
            contactId = created!.id;
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
              ? (
                  await tx
                    .select()
                    .from(crmPipelines)
                    .where(
                      and(
                        eq(crmPipelines.id, b.deal.pipelineId),
                        eq(crmPipelines.orgId, actor.orgId),
                      ),
                    )
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
              .orderBy(asc(crmStages.position), asc(crmStages.id));
            const stage = b.deal.stageId
              ? stages.find((s) => s.id === b.deal!.stageId)
              : stages.find((s) => !s.isWon && !s.isLost);
            if (!stage)
              throw new AppError(400, 'validation_error', 'That stage is not in the pipeline', {
                stageId: 'Choose a stage',
              });
            const [top] = await tx
              .select({ p: sql<number>`coalesce(max(${crmDeals.position}), 0)::float8` })
              .from(crmDeals)
              .where(and(eq(crmDeals.orgId, actor.orgId), eq(crmDeals.stageId, stage.id)));
            const [created] = await tx
              .insert(crmDeals)
              .values({
                orgId: actor.orgId,
                pipelineId: pipeline.id,
                stageId: stage.id,
                companyId,
                contactId,
                title: b.deal.title,
                value: String(b.deal.value),
                currency: b.deal.currency,
                expectedClose: b.deal.expectedClose ?? null,
                ownerId: lead.ownerId ?? actor.userId,
                status: stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open',
                closedAt: stage.isWon || stage.isLost ? new Date() : null,
                position: (top?.p ?? 0) + 1000,
                createdBy: actor.userId,
              })
              .returning({ id: crmDeals.id });
            dealId = created!.id;
            await writeAudit(tx, {
              orgId: actor.orgId,
              actorId: actor.userId,
              action: 'crm.deal_created',
              targetType: 'crm_deal',
              targetId: dealId,
              after: { title: b.deal.title, fromLead: lead.id },
            });
          }

          await tx
            .update(crmLeads)
            .set({
              convertedAt: new Date(),
              status: 'qualified',
              convertedCompanyId: companyId,
              convertedContactId: contactId,
              convertedDealId: dealId,
              updatedAt: new Date(),
            })
            .where(and(eq(crmLeads.id, lead.id), eq(crmLeads.orgId, actor.orgId)));
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
