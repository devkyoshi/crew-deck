import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx } from '../db/client.js';
import { AppError, forbidden } from '../lib/errors.js';
import { assertFeature, loadPlan, loadUsage } from '../plans/index.js';
import { can } from '../permissions/can.js';

/** Contrast of white text on this colour (WCAG formula), so buttons stay readable. */
function contrastWithWhite(hex: string) {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return 1.05 / (lum + 0.05);
}

export async function planRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // The workspace's plan, what it includes, and how much of each limit is used.
  r.get('/plan', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => {
      const plan = await loadPlan(tx, actor.orgId);
      const isAdmin = can(actor, 'settings.manage');
      const plans = (await tx.listPlans()).filter((p) => p.public);
      return {
        plan: {
          key: plan.key,
          name: plan.name,
          onTrial: plan.onTrial,
          trialEndsAt: plan.trialEndsAt,
          limits: plan.limits,
          features: plan.features,
        },
        // Usage is for admins; everyone else only needs to know what is included.
        usage: isAdmin ? await loadUsage(tx, actor.orgId) : null,
        plans: plans.map((p) => ({
          key: p.key,
          name: p.name,
          priceCents: p.priceCents,
          limits: p.limits,
          features: p.features,
        })),
      };
    });
  });

  r.put(
    '/settings/branding',
    {
      preHandler: requireAuth,
      schema: {
        body: z
          .object({
            name: z.string().trim().min(2).max(80),
            logoUrl: z
              .string()
              .trim()
              .url()
              .max(500)
              .refine((u) => u.startsWith('https://'), 'Use an https address')
              .nullable(),
            accentColor: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2f5bff')
              .nullable(),
            domainRestricted: z.boolean(),
          })
          .partial()
          .strict()
          .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const plan = await loadPlan(tx, actor.orgId);
        if (b.name !== undefined) assertFeature(plan, 'branding_name', 'Renaming the workspace');
        if (b.logoUrl !== undefined || b.accentColor !== undefined) {
          assertFeature(plan, 'branding_full', 'Logo and accent colour');
        }
        if (b.domainRestricted !== undefined) {
          assertFeature(plan, 'domain_lock', 'Locking invitations to your email domain');
        }
        if (b.accentColor && contrastWithWhite(b.accentColor) < 4.5) {
          throw new AppError(400, 'validation_error', 'That colour is too light for white text', {
            accentColor: 'Choose a darker colour so buttons stay readable',
          });
        }
        const before = await tx.organization();
        await tx.updateBranding(b);
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'settings.branding_updated',
          targetType: 'settings',
          targetId: actor.orgId,
          before: Object.fromEntries(
            Object.keys(b).map((k) => [k, before?.[k as keyof typeof before] ?? null]),
          ),
          after: b,
        });
        const after = await tx.organization();
        return {
          name: after!.name,
          logoUrl: after!.logoUrl,
          accentColor: after!.accentColor,
          domainRestricted: after!.domainRestricted,
        };
      });
    },
  );
}
