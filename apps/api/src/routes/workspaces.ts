import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  isWorkType,
  modulesFor,
  usageNeedsCrm,
  USAGE_KEYS,
  WORK_TYPES,
  WORKSPACE_TEMPLATES,
  workTypesOf,
} from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { assertOrgActive, makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { findOrgBySlug, listUserOrgs, touchLastLogin } from '../auth/service.js';
import { withTenantTx } from '../db/client.js';
import { AppError, forbidden } from '../lib/errors.js';
import { provisionWorkspace } from '../onboarding/provision.js';
import {
  emailDomainOf,
  isFreeEmailDomain,
  slugMessage,
  slugProblem,
} from '../onboarding/rules.js';
import { getPlatformSettings } from '../onboarding/settings.js';
import { can } from '../permissions/can.js';

/** How many workspaces one person may own, so the form cannot be used to flood the platform. */
export const MAX_OWNED_WORKSPACES = 10;

const slug = z.string().trim().toLowerCase().max(40);
const usageSchema = z.array(z.enum(USAGE_KEYS as [string, ...string[]])).max(20);
const workTypesSchema = z.array(z.enum(WORK_TYPES)).min(1).max(WORK_TYPES.length);

export async function workspaceRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { db, config, sessions } = deps;
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Every workspace this person belongs to, for the switcher and the "my workspaces" page.
  r.get('/workspaces', { preHandler: requireAuth }, async (req) => {
    const orgs = await listUserOrgs(db, req.user!.id);
    const full = await db.global.organizations.find({ id: { $in: orgs.map((o) => o.id) } });
    const typeOf = new Map(full.map((o) => [o.id, o.workType]));
    const owned = orgs.filter((o) => o.orgRole === 'owner').length;
    return {
      items: orgs.map((o) => ({
        ...o,
        workType: typeOf.get(o.id) ?? null,
        current: o.id === req.org!.id,
        url: config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', o.slug),
      })),
      canCreate: owned < MAX_OWNED_WORKSPACES,
    };
  });

  r.get(
    '/workspaces/check',
    { preHandler: requireAuth, schema: { querystring: z.object({ slug }) } },
    async (req) => {
      const problem = slugProblem(req.query.slug);
      const state = problem ?? ((await findOrgBySlug(db, req.query.slug)) ? 'taken' : 'ok');
      return { available: state === 'ok', reason: state === 'ok' ? null : slugMessage[state] };
    },
  );

  // A signed-in person starts another workspace. They become its owner; their account is reused.
  r.post(
    '/workspaces',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          company: z.string().trim().min(2, 'Enter a name').max(80),
          slug,
          workType: z.enum(WORK_TYPES).optional(),
          workTypes: workTypesSchema.optional(),
          usage: usageSchema.optional(),
        }).refine((v) => v.workType || v.workTypes, { message: 'Choose the kind of work', path: ['workTypes'] }),
      },
    },
    async (req) => {
      if (req.impersonatedBy) throw forbidden('Impersonated sessions cannot create workspaces');
      const s = await getPlatformSettings(db);
      if (!s.signupsEnabled) {
        throw new AppError(403, 'signups_closed', 'New workspaces are closed right now.');
      }
      const user = req.user!;
      const owned = (await listUserOrgs(db, user.id)).filter((o) => o.orgRole === 'owner');
      if (owned.length >= MAX_OWNED_WORKSPACES) {
        throw new AppError(
          409,
          'workspace_limit',
          `You can own up to ${MAX_OWNED_WORKSPACES} workspaces`,
        );
      }
      const b = req.body;
      const problem = slugProblem(b.slug);
      if (problem) {
        throw new AppError(400, 'validation_error', slugMessage[problem], {
          slug: slugMessage[problem],
        });
      }
      if (await findOrgBySlug(db, b.slug)) {
        throw new AppError(409, 'slug_taken', slugMessage.taken, { slug: slugMessage.taken });
      }
      const domain = emailDomainOf(user.email);
      const out = await provisionWorkspace(db, {
        name: b.company,
        slug: b.slug,
        domain,
        ownerEmail: user.email,
        ownerName: user.name,
        timezone: user.timezone,
        plan: 'business',
        trialDays: s.trialDays,
        domainRestricted: !isFreeEmailDomain(domain),
        via: 'signup',
        ownerMode: 'verified',
        createdBy: user.email,
        workTypes: workTypesOf(b.workTypes?.[0] ?? b.workType, b.workTypes),
        usage: b.usage,
      });
      const sid = await sessions.create(out.orgId, out.userId!);
      const ticket = await sessions.createTicket(out.orgId, sid);
      const origin = config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', out.slug);
      return {
        ok: true,
        slug: out.slug,
        url: `${origin}/api/v1/auth/sso/complete?ticket=${encodeURIComponent(ticket)}`,
      };
    },
  );

  // One sign-in across your workspaces: from inside one workspace, open another you belong to without
  // signing in again. The session is per workspace address, so a new one is created for the target and
  // handed over with the same one-time ticket sign-up uses. Anything you are not an active member of
  // looks like it does not exist.
  r.post(
    '/workspaces/:slug/open',
    { preHandler: requireAuth, schema: { params: z.object({ slug }) } },
    async (req) => {
      if (req.impersonatedBy) throw forbidden('Impersonated sessions cannot switch workspaces');
      const missing = () => new AppError(404, 'not_found', 'Workspace not found');
      const target = await findOrgBySlug(db, req.params.slug);
      if (!target) throw missing();
      const userId = req.user!.id;
      const membership = await db.global.all.memberships.findOne({ orgId: target.id, userId });
      if (!membership || membership.status !== 'active') throw missing();
      assertOrgActive(target);
      const sid = await sessions.create(target.id, userId);
      await touchLastLogin(db, target.id, userId);
      const ticket = await sessions.createTicket(target.id, sid);
      const origin = config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', target.slug);
      return { url: `${origin}/api/v1/auth/sso/complete?ticket=${encodeURIComponent(ticket)}` };
    },
  );

  // ---- What the workspace is for ------------------------------------------------------------------
  r.get('/settings/workspace', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    const org = req.org!;
    const settings = await db.tenant(actor.orgId).tenantSettings.findOne({});
    return {
      workType: org.work_type,
      workTypes: org.work_types,
      usage: org.usage,
      modules: settings?.enabledModules ?? ['members', 'spaces', 'checkin'],
      template:
        org.work_type && isWorkType(org.work_type) ? WORKSPACE_TEMPLATES[org.work_type] : null,
    };
  });

  r.put(
    '/settings/workspace',
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({
            workType: z.enum(WORK_TYPES).optional(),
            workTypes: workTypesSchema.optional(),
            usage: usageSchema,
          })
          .refine((v) => v.workType || v.workTypes, {
            message: 'Choose the kind of work',
            path: ['workTypes'],
          }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      const b = req.body;
      const workTypes = workTypesOf(b.workTypes?.[0] ?? b.workType, b.workTypes);
      const workType = workTypes[0]!;
      return withTenantTx(db, actor.orgId, async (t) => {
        const before = await t.organization();
        await db.global.organizations.updateOne(
          { id: actor.orgId },
          { workType, workTypes, usage: b.usage },
        );
        // Switching on what the team now plans to use never switches anything off.
        const current = (await t.tenantSettings.findOne({}))?.enabledModules ?? [];
        // The CRM follows the usage the team chose; every other module is only ever added.
        const crmWasOn = current.includes('crm');
        const crmOn = usageNeedsCrm(b.usage);
        const modules = [...new Set([...current, ...modulesFor(workTypes, b.usage)])].filter(
          (m) => m !== 'crm' || crmOn,
        );
        await t.tenantSettings.upsert({}, { enabledModules: modules, updatedAt: new Date() });
        await writeAudit(t, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'settings.workspace_updated',
          targetType: 'settings',
          targetId: actor.orgId,
          before: {
            workType: before?.workType ?? null,
            workTypes: before?.workTypes ?? [],
            usage: before?.usage ?? [],
          },
          after: { workType, workTypes, usage: b.usage },
        });
        if (crmWasOn !== crmOn) {
          await writeAudit(t, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'crm.module_toggled',
            targetType: 'settings',
            targetId: actor.orgId,
            after: { crmEnabled: crmOn },
          });
        }
        return { workType, workTypes, usage: b.usage, modules };
      });
    },
  );
}
