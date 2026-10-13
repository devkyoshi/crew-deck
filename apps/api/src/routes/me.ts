import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { timezoneSchema } from '../auth/routes.js';
import { loadAuthUser } from '../auth/service.js';
import { withTenant } from '../db/client.js';
import { users } from '../db/schema.js';
import { ADMIN_ACTIONS, can } from '../permissions/can.js';

export async function meRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function profile(req: Parameters<typeof requireAuth>[0]) {
    const user = req.user!;
    const org = req.org!;
    const orgs = await deps.db.execute<{
      id: string;
      name: string;
      slug: string;
      org_role: string;
    }>(sql`select * from auth_user_orgs(${user.id})`);
    const actor = { userId: user.id, orgId: org.id, orgRole: user.orgRole };
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        jobTitle: user.jobTitle,
        timezone: user.timezone,
      },
      org: { id: org.id, name: org.name, slug: org.slug, domain: org.domain },
      orgRole: user.orgRole,
      // Mirrors can() for the UI. The server still enforces every action itself.
      permissions: ADMIN_ACTIONS.filter((a) => can(actor, a)),
      orgs: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, orgRole: o.org_role })),
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
        await withTenant(deps.db, req.org!.id, (tx) =>
          tx.update(users).set(req.body).where(eq(users.id, user.id)),
        );
        req.user = (await loadAuthUser(deps.db, req.org!.id, user.id)) ?? user;
      }
      return profile(req);
    },
  );
}
