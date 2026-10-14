import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { timezoneSchema } from '../auth/routes.js';
import { listUserOrgs, loadAuthUser } from '../auth/service.js';
import { withTenant } from '../db/client.js';
import { loadPlan } from '../plans/index.js';
import { ADMIN_ACTIONS, can } from '../permissions/can.js';

export async function meRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function profile(req: Parameters<typeof requireAuth>[0]) {
    const user = req.user!;
    const org = req.org!;
    const orgs = await listUserOrgs(deps.db, user.id);
    const actor = { userId: user.id, orgId: org.id, orgRole: user.orgRole };
    const { plan, branding, modules } = await withTenant(deps.db, org.id, async (t) => {
      const o = await t.organization();
      const settings = await t.tenantSettings.findOne({});
      return {
        plan: await loadPlan(t, org.id),
        modules: settings?.enabledModules ?? ['members', 'spaces', 'checkin'],
        branding: {
          logoUrl: o?.logoUrl ?? null,
          accentColor: o?.accentColor ?? null,
          domainRestricted: o?.domainRestricted ?? true,
        },
      };
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        jobTitle: user.jobTitle,
        timezone: user.timezone,
      },
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        domain: org.domain,
        workType: org.work_type,
        usage: org.usage,
        modules,
        ...branding,
      },
      plan: {
        key: plan.key,
        name: plan.name,
        onTrial: plan.onTrial,
        trialEndsAt: plan.trialEndsAt,
        features: plan.features,
      },
      impersonatedBy: req.impersonatedBy ?? null,
      orgRole: user.orgRole,
      // Mirrors can() for the UI. The server still enforces every action itself.
      permissions: ADMIN_ACTIONS.filter((a) => can(actor, a)),
      orgs,
    };
  }

  r.get('/me', { preHandler: requireAuth }, async (req) => profile(req));

  r.patch(
    '/me',
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({
            name: z.string().trim().min(1).max(100),
            avatarUrl: z.string().url().max(500).nullable(),
            jobTitle: z.string().trim().max(100).nullable(),
            timezone: timezoneSchema,
          })
          .partial()
          .strict(),
      },
    },
    async (req) => {
      const user = req.user!;
      if (Object.keys(req.body).length > 0) {
        await withTenant(deps.db, req.org!.id, (t) => t.updateUser(user.id, req.body));
        req.user = (await loadAuthUser(deps.db, req.org!.id, user.id)) ?? user;
      }
      return profile(req);
    },
  );
}
