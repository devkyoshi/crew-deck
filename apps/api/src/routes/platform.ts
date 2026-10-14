import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { verifyPassword } from '../auth/password.js';
import type { AuthDeps } from '../auth/plugin.js';
import { findOrgBySlug } from '../auth/service.js';
import { emailEnabled, isProd } from '../config.js';
import { inviteEmail } from '../email/templates.js';
import { AppError, notFound } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { withTenant } from '../db/client.js';
import type { OrganizationDoc } from '../db/types.js';
import { getPlatformSettings } from '../onboarding/settings.js';
import { provisionWorkspace } from '../onboarding/provision.js';
import { emailDomainOf, slugMessage, slugProblem } from '../onboarding/rules.js';
import { LIMIT_KEYS, loadPlan, loadUsage } from '../plans/index.js';
import { containsRegex, offsetOf, pageQuery } from '../lib/pagination.js';
import type { SendMail } from './signup.js';

const COOKIE = 'cd_platform';
const SESSION_SECONDS = 8 * 60 * 60;
const IMPERSONATION_SECONDS = 30 * 60;

type PlatformAdmin = {
  id: string;
  email: string;
  name: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    platformAdmin?: PlatformAdmin;
  }
}

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: 'active' | 'suspended';
  suspended_reason: string | null;
  suspended_at: Date | null;
  plan_key: string | null;
  on_trial: boolean;
  trial_ends_at: Date | null;
  limit_overrides: Record<string, number | null>;
  created_at: Date;
  created_via: string;
  domain_restricted: boolean;
};

const toTenantRow = (o: OrganizationDoc): TenantRow => ({
  id: o.id,
  name: o.name,
  slug: o.slug,
  domain: o.domain,
  status: o.status,
  suspended_reason: o.suspendedReason,
  suspended_at: o.suspendedAt,
  plan_key: o.planKey,
  on_trial: o.onTrial,
  trial_ends_at: o.trialEndsAt,
  limit_overrides: o.limitOverrides,
  created_at: o.createdAt,
  created_via: o.createdVia,
  domain_restricted: o.domainRestricted,
});

const email = z.string().trim().toLowerCase().email().max(254);
const idParam = z.object({ id: z.string().uuid() });

export async function platformRoutes(
  app: FastifyInstance,
  deps: AuthDeps & { redis: Redis; sendMail: SendMail },
) {
  const { db, config, redis, sendMail } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  const key = (sid: string) => `platform:sess:${sha256(sid)}`;
  const setCookie = (reply: FastifyReply, sid: string) =>
    reply.setCookie(COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd(config),
      path: '/',
      maxAge: SESSION_SECONDS,
    });

  /** The console lives on the apex host only, never on a tenant's address. */
  async function requirePlatformAdmin(req: FastifyRequest) {
    if (req.tenantSlug) throw new AppError(404, 'not_found', 'Not found');
    const sid = req.cookies[COOKIE];
    const adminId = sid ? await redis.get(key(sid)) : null;
    if (!sid || !adminId) throw new AppError(401, 'unauthenticated', 'Sign in required');
    const admin = await db.global.platformAdmins.findOne({ id: adminId });
    if (!admin) throw new AppError(401, 'unauthenticated', 'Sign in required');
    await redis.expire(key(sid), SESSION_SECONDS);
    req.platformAdmin = { id: admin.id, email: admin.email, name: admin.name };
  }

  const audit = (admin: PlatformAdmin, action: string, orgId: string | null, detail: object = {}) =>
    db.global.platformAudit.insert({ adminId: admin.id, action, orgId, detail });

  const tenantOrigin = (slug: string) => config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', slug);

  // ---- Sign in ------------------------------------------------------------------------------------
  r.post(
    '/platform/auth/login',
    {
      schema: { body: z.object({ email, password: z.string().min(1).max(200) }) },
      config: {
        rateLimit: {
          max: Math.max(5, config.AUTH_RATE_LIMIT_MAX),
          timeWindow: '1 minute',
          keyGenerator: (req: { ip: string; body?: unknown }) =>
            `platform:${req.ip}:${String((req.body as { email?: string } | undefined)?.email ?? '')}`,
        },
      },
    },
    async (req, reply) => {
      if (req.tenantSlug) throw new AppError(404, 'not_found', 'Not found');
      const found = await db.global.platformAdmins.findOne({ email: req.body.email });
      const ok = await verifyPassword(found?.passwordHash, req.body.password);
      if (!found || !ok)
        throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
      const admin = { id: found.id, email: found.email, name: found.name };
      const sid = randomToken();
      await redis.set(key(sid), admin.id, 'EX', SESSION_SECONDS);
      setCookie(reply, sid);
      await audit(admin, 'platform.sign_in', null);
      return { ok: true };
    },
  );

  r.post('/platform/auth/logout', async (req, reply) => {
    const sid = req.cookies[COOKIE];
    if (sid) await redis.del(key(sid));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  r.get('/platform/me', { preHandler: requirePlatformAdmin }, async (req) => ({
    admin: { email: req.platformAdmin!.email, name: req.platformAdmin!.name },
  }));

  // ---- Plans and settings ---------------------------------------------------------------------------
  r.get('/platform/plans', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await db.global.plans.find({}, { sort: { sort: 1 } });
    return { items: rows.map((p) => ({ key: p.key, name: p.name, public: p.public })) };
  });

  r.get('/platform/settings', { preHandler: requirePlatformAdmin }, async () => {
    const s = await getPlatformSettings(db);
    return {
      blockFreeEmailDomains: s.blockFreeEmailDomains,
      signupsEnabled: s.signupsEnabled,
      trialDays: s.trialDays,
    };
  });

  r.put(
    '/platform/settings',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: z.object({
          blockFreeEmailDomains: z.boolean(),
          signupsEnabled: z.boolean(),
          trialDays: z.number().int().min(0).max(90),
        }),
      },
    },
    async (req) => {
      const b = req.body;
      await getPlatformSettings(db);
      await db.global.platformSettings.updateOne(
        { id: 'singleton' },
        { ...b, updatedAt: new Date() },
      );
      await audit(req.platformAdmin!, 'platform.settings_changed', null, b);
      return b;
    },
  );

  // ---- Tenants ------------------------------------------------------------------------------------------
  r.get(
    '/platform/tenants',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        querystring: pageQuery.extend({
          q: z.string().trim().max(100).optional(),
          status: z.enum(['active', 'suspended']).optional(),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const filter: Record<string, unknown> = {};
      if (q.status) filter.status = q.status;
      if (q.q) {
        const rx = containsRegex(q.q);
        filter.$or = [{ name: rx }, { slug: rx }, { domain: rx }];
      }
      const total = await db.global.organizations.count(filter);
      const orgs = await db.global.organizations.find(filter, {
        sort: { createdAt: -1, id: 1 },
        skip: offsetOf(q),
        limit: q.pageSize,
      });
      const items = await Promise.all(
        orgs.map(async (t) => {
          const members = await db.global.all.memberships.find({ orgId: t.id });
          const people = await db.global.users.find({ id: { $in: members.map((m) => m.userId) } });
          const logins = people.map((u) => u.lastLoginAt).filter((d): d is Date => d !== null);
          return {
            id: t.id,
            name: t.name,
            slug: t.slug,
            domain: t.domain,
            status: t.status,
            suspendedReason: t.suspendedReason,
            planKey: t.planKey,
            onTrial: t.onTrial,
            trialEndsAt: t.trialEndsAt,
            createdAt: t.createdAt,
            createdVia: t.createdVia,
            workType: t.workType,
            memberCount: members.filter((m) => m.status === 'active').length,
            lastLoginAt: logins.length
              ? new Date(Math.max(...logins.map((d) => d.getTime())))
              : null,
          };
        }),
      );
      return { items, total, page: q.page, pageSize: q.pageSize };
    },
  );

  /** Newest platform audit entries, with the acting admin's email. */
  async function auditList(orgId: string | null, limit: number) {
    const rows = await db.global.platformAudit.find(orgId ? { orgId } : {}, {
      sort: { createdAt: -1 },
      limit,
    });
    const admins = await db.global.platformAdmins.find({
      id: { $in: rows.map((x) => x.adminId).filter((x): x is string => !!x) },
    });
    const emailOf = new Map(admins.map((a) => [a.id, a.email]));
    return rows.map((x) => ({
      id: x.id,
      admin_email: x.adminId ? (emailOf.get(x.adminId) ?? null) : null,
      action: x.action,
      org_id: x.orgId,
      detail: x.detail as object | null,
      created_at: x.createdAt,
    }));
  }

  async function tenantById(id: string) {
    const org = await db.global.organizations.findOne({ id });
    if (!org) throw notFound('Workspace');
    return toTenantRow(org);
  }

  r.get(
    '/platform/tenants/:id',
    { preHandler: requirePlatformAdmin, schema: { params: idParam } },
    async (req) => {
      const t = await tenantById(req.params.id);
      const { plan, usage } = await withTenant(db, t.id, async (tx) => ({
        plan: await loadPlan(tx, t.id),
        usage: await loadUsage(tx, t.id),
      }));
      const history = await auditList(t.id, 30);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        domain: t.domain,
        status: t.status,
        suspendedReason: t.suspended_reason,
        suspendedAt: t.suspended_at,
        createdAt: t.created_at,
        createdVia: t.created_via,
        domainRestricted: t.domain_restricted,
        planKey: t.plan_key,
        onTrial: t.on_trial,
        trialEndsAt: t.trial_ends_at,
        limitOverrides: t.limit_overrides,
        effective: { name: plan.name, limits: plan.limits, features: plan.features },
        usage,
        workType: (await db.global.organizations.findOne({ id: t.id }))?.workType ?? null,
        history: history.map((h) => ({
          id: h.id,
          admin: h.admin_email,
          action: h.action,
          detail: h.detail,
          at: h.created_at,
        })),
      };
    },
  );

  // An admin-created workspace: the owner gets an invitation by email and sets their own password.
  r.post(
    '/platform/tenants',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        body: z.object({
          name: z.string().trim().min(2).max(80),
          slug: z.string().trim().toLowerCase().max(40),
          ownerEmail: email,
          plan: z.string().min(1).max(30).default('team'),
          trialDays: z.number().int().min(0).max(90).default(0),
        }),
      },
    },
    async (req) => {
      const b = req.body;
      const problem = slugProblem(b.slug);
      if (problem)
        throw new AppError(400, 'validation_error', slugMessage[problem], {
          slug: slugMessage[problem],
        });
      if (await findOrgBySlug(db, b.slug)) {
        throw new AppError(409, 'slug_taken', slugMessage.taken, { slug: slugMessage.taken });
      }
      const plan = await db.global.plans.findOne({ key: b.plan });
      if (!plan)
        throw new AppError(400, 'validation_error', 'Unknown plan', { plan: 'Unknown plan' });
      const out = await provisionWorkspace(db, {
        name: b.name,
        slug: b.slug,
        domain: emailDomainOf(b.ownerEmail),
        ownerEmail: b.ownerEmail,
        plan: b.plan,
        trialDays: b.trialDays,
        domainRestricted: true,
        via: 'platform',
        ownerMode: 'invite',
        createdBy: req.platformAdmin!.email,
      });
      const link = `${tenantOrigin(out.slug)}/accept-invite?token=${encodeURIComponent(out.inviteToken!)}`;
      let emailed = true;
      try {
        await sendMail({
          to: b.ownerEmail,
          ...inviteEmail({
            orgName: b.name,
            inviterName: 'The Crew Deck team',
            link,
            expiresInDays: 7,
          }),
        });
      } catch (err) {
        // The workspace exists; show the link so the owner can still be invited by hand.
        req.log.error({ err }, 'owner invitation email failed');
        emailed = false;
      }
      await audit(req.platformAdmin!, 'platform.workspace_created', out.orgId, {
        slug: out.slug,
        plan: b.plan,
      });
      const showLink = !emailed || (!emailEnabled(config) && !isProd(config));
      return { id: out.orgId, slug: out.slug, ...(showLink ? { inviteLink: link } : {}) };
    },
  );

  async function setStatus(
    req: {
      params: { id: string };
      body?: { reason?: string } | null;
      platformAdmin?: PlatformAdmin;
    },
    status: 'active' | 'suspended',
  ) {
    const t = await tenantById(req.params.id);
    const reason =
      status === 'suspended' ? req.body?.reason?.trim() || 'Suspended by the platform' : null;
    await db.global.organizations.updateOne(
      { id: t.id },
      {
        status,
        suspendedAt: status === 'suspended' ? new Date() : null,
        suspendedReason: status === 'suspended' ? reason : null,
      },
    );
    await audit(
      req.platformAdmin!,
      status === 'suspended' ? 'platform.workspace_suspended' : 'platform.workspace_unsuspended',
      t.id,
      { reason },
    );
    // The workspace's own log shows it too, so its admins know what happened and when.
    await withTenant(db, t.id, (tx) =>
      writeAudit(tx, {
        orgId: t.id,
        actorId: null,
        action:
          status === 'suspended'
            ? 'platform.workspace_suspended'
            : 'platform.workspace_unsuspended',
        targetType: 'settings',
        targetId: t.id,
        after: { by: 'platform', reason },
      }),
    );
    return { ok: true, status };
  }

  r.post(
    '/platform/tenants/:id/suspend',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: idParam,
        body: z.object({ reason: z.string().trim().max(300).optional() }),
      },
    },
    (req) => setStatus(req, 'suspended'),
  );
  r.post(
    '/platform/tenants/:id/unsuspend',
    { preHandler: requirePlatformAdmin, schema: { params: idParam } },
    (req) => setStatus({ params: req.params, platformAdmin: req.platformAdmin }, 'active'),
  );

  // Change plan, start or extend a trial, or set custom limits (Enterprise).
  r.patch(
    '/platform/tenants/:id',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: idParam,
        body: z
          .object({
            planKey: z.string().min(1).max(30).nullable(),
            trialDays: z.number().int().min(0).max(365),
            limitOverrides: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(0).nullable()),
          })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const t = await tenantById(req.params.id);
      const b = req.body;
      if (b.planKey) {
        const found = await db.global.plans.findOne({ key: b.planKey });
        if (!found)
          throw new AppError(400, 'validation_error', 'Unknown plan', { planKey: 'Unknown plan' });
      }
      const planKey = b.planKey !== undefined ? b.planKey : t.plan_key;
      let onTrial = t.on_trial;
      let trialEnds = t.trial_ends_at;
      if (b.trialDays !== undefined) {
        onTrial = b.trialDays > 0;
        trialEnds = b.trialDays > 0 ? new Date(Date.now() + b.trialDays * 86_400_000) : null;
      } else if (b.planKey !== undefined) {
        // Choosing a plan directly ends any trial.
        onTrial = false;
        trialEnds = null;
      }
      const overrides = b.limitOverrides ?? t.limit_overrides;
      await db.global.organizations.updateOne(
        { id: t.id },
        {
          planKey,
          onTrial,
          trialEndsAt: trialEnds ? new Date(trialEnds) : null,
          limitOverrides: overrides as Record<string, number>,
        },
      );
      await audit(req.platformAdmin!, 'platform.plan_changed', t.id, {
        before: { plan: t.plan_key, onTrial: t.on_trial },
        after: { plan: planKey, onTrial, trialEnds, overrides },
      });
      await withTenant(db, t.id, (tx) =>
        writeAudit(tx, {
          orgId: t.id,
          actorId: null,
          action: 'platform.plan_changed',
          targetType: 'settings',
          targetId: t.id,
          before: { plan: t.plan_key },
          after: { plan: planKey, by: 'platform' },
        }),
      );
      return tenantById(t.id).then((x) => ({
        planKey: x.plan_key,
        onTrial: x.on_trial,
        trialEndsAt: x.trial_ends_at,
        limitOverrides: x.limit_overrides,
      }));
    },
  );

  // Open a workspace as its owner, read-only, for 30 minutes. The workspace's own log records it.
  r.post(
    '/platform/tenants/:id/impersonate',
    { preHandler: requirePlatformAdmin, schema: { params: idParam } },
    async (req) => {
      const t = await tenantById(req.params.id);
      if (t.status === 'suspended') {
        throw new AppError(
          409,
          'workspace_suspended',
          'Unsuspend this workspace before opening it',
        );
      }
      // The earliest active owner whose account is still active.
      const ownerMemberships = await db.global.all.memberships.find(
        { orgId: t.id, orgRole: 'owner', status: 'active' },
        { sort: { createdAt: 1 } },
      );
      const ownerUsers = await db.global.users.find({
        id: { $in: ownerMemberships.map((m) => m.userId) },
        status: 'active',
      });
      const first = ownerMemberships.find((m) => ownerUsers.some((u) => u.id === m.userId));
      const ownerUser = first && ownerUsers.find((u) => u.id === first.userId);
      const owner = ownerUser ? { user_id: ownerUser.id, email: ownerUser.email } : null;
      if (!owner)
        throw new AppError(409, 'no_owner', 'This workspace has no active owner to open it as');
      const admin = req.platformAdmin!;
      await withTenant(db, t.id, (tx) =>
        writeAudit(tx, {
          orgId: t.id,
          actorId: null,
          action: 'platform.impersonation_started',
          targetType: 'settings',
          targetId: t.id,
          after: {
            platformAdmin: admin.email,
            viewingAs: owner.email,
            minutes: IMPERSONATION_SECONDS / 60,
            readOnly: true,
          },
        }),
      );
      await audit(admin, 'platform.impersonation_started', t.id, { viewingAs: owner.email });
      const sid = await deps.sessions.create(t.id, owner.user_id, {
        impersonatedBy: admin.email,
        ttl: IMPERSONATION_SECONDS,
      });
      const ticket = await deps.sessions.createTicket(t.id, sid);
      return {
        url: `${tenantOrigin(t.slug)}/api/v1/auth/sso/complete?ticket=${encodeURIComponent(ticket)}`,
      };
    },
  );

  r.get('/platform/audit', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await auditList(null, 100);
    return {
      items: rows.map((h) => ({
        id: h.id,
        admin: h.admin_email,
        action: h.action,
        orgId: h.org_id,
        detail: h.detail,
        at: h.created_at,
      })),
    };
  });
}
