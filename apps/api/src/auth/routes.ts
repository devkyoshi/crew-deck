import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { devLoginEnabled } from '../config.js';
import { AppError } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import {
  assertOrgActive,
  clearSessionCookie,
  makeRequireTenant,
  setSessionCookie,
  type AuthDeps,
} from './plugin.js';
import type { GoogleClient } from './google.js';
import { MIN_PASSWORD_LENGTH, verifyPassword } from './password.js';
import {
  acceptInvitation,
  emailMatchesOrg,
  findOrgById,
  findOrgBySlug,
  findPendingInvitation,
  findUsableInvitation,
  lookupUserByEmail,
  touchLastLogin,
  type Org,
} from './service.js';
import { SESSION_COOKIE } from './sessions.js';

const email = z.string().trim().toLowerCase().email().max(254);
const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Invalid email or password');

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const timezoneSchema = z.string().refine(isValidTimezone, 'Unknown timezone');

/** Rate limit key: client + the email being attempted, so one attacker cannot lock others out. */
const attemptKey = (req: { ip: string; body?: unknown }) =>
  `${req.ip}:${String((req.body as { email?: string } | undefined)?.email ?? '').toLowerCase()}`;
const attemptLimit = (max: number) => ({
  config: { rateLimit: { max, timeWindow: '1 minute', keyGenerator: attemptKey } },
});

export async function authRoutes(
  app: FastifyInstance,
  opts: AuthDeps & { google: GoogleClient | null },
) {
  const { db, config, sessions, google } = opts;
  const requireTenant = makeRequireTenant(opts);
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function startSession(reply: FastifyReply, org: Org, userId: string) {
    const sid = await sessions.create(org.id, userId);
    await touchLastLogin(db, org.id, userId);
    setSessionCookie(reply, config, sid);
    return sid;
  }

  const tenantOrigin = (slug: string) => config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', slug);

  // Which sign-in methods the UI should offer for this host.
  r.get('/providers', async (req) => {
    let tenant: { name: string; slug: string; suspended: boolean } | null = null;
    if (req.tenantSlug) {
      const org = await findOrgBySlug(db, req.tenantSlug);
      if (org) tenant = { name: org.name, slug: org.slug, suspended: org.status === 'suspended' };
    }
    return { tenant, password: true, google: google !== null, devLogin: devLoginEnabled(config) };
  });

  r.post(
    '/login',
    {
      schema: { body: z.object({ email, password: z.string().min(1).max(200) }) },
      ...attemptLimit(config.AUTH_RATE_LIMIT_MAX),
    },
    async (req, reply) => {
      await requireTenant(req);
      const org = req.org!;
      const user = await lookupUserByEmail(db, org.id, req.body.email);
      const ok = await verifyPassword(user?.password_hash, req.body.password);
      if (!user || !ok) throw invalidCredentials();
      if (user.status !== 'active') {
        throw new AppError(403, 'account_inactive', 'This account is not active');
      }
      await startSession(reply, org, user.id);
      return { ok: true };
    },
  );

  if (devLoginEnabled(config)) {
    // Local development only: sign in as any existing member without a password.
    r.post(
      '/dev-login',
      { schema: { body: z.object({ email }) }, ...attemptLimit(config.AUTH_RATE_LIMIT_MAX * 3) },
      async (req, reply) => {
        await requireTenant(req);
        const user = await lookupUserByEmail(db, req.org!.id, req.body.email);
        if (!user || user.status !== 'active') throw invalidCredentials();
        await startSession(reply, req.org!, user.id);
        return { ok: true };
      },
    );
  }

  r.post('/logout', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid && req.tenantSlug) {
      const org = await findOrgBySlug(db, req.tenantSlug);
      if (org) await sessions.destroy(org.id, sid);
    }
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  // ---- Invitations -------------------------------------------------------------------------

  r.post(
    '/invite/preview',
    {
      schema: { body: z.object({ token: z.string().min(10).max(200) }) },
      ...attemptLimit(config.AUTH_RATE_LIMIT_MAX),
    },
    async (req) => {
      const inv = await findUsableInvitation(db, req.body.token);
      const org = await orgById(inv.org_id);
      return { email: inv.email, orgName: org.name, orgSlug: org.slug };
    },
  );

  r.post(
    '/invite/accept',
    {
      schema: {
        body: z.object({
          token: z.string().min(10).max(200),
          name: z.string().trim().min(1).max(100),
          password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
          timezone: timezoneSchema.default('UTC'),
          avatarUrl: z.string().url().max(500).optional(),
        }),
      },
      ...attemptLimit(config.AUTH_RATE_LIMIT_MAX),
    },
    async (req, reply) => {
      const inv = await findUsableInvitation(db, req.body.token);
      const org = await orgById(inv.org_id);
      // The invite is bound to one tenant: it must be accepted on that tenant's host.
      if (req.tenantSlug && req.tenantSlug !== org.slug)
        throw new AppError(400, 'invalid_invitation', 'This invitation is invalid or has expired');
      const userId = await acceptInvitation(
        db,
        org,
        { id: inv.id, email: inv.email, role: inv.org_role, groupIds: inv.group_ids },
        {
          name: req.body.name,
          password: req.body.password,
          timezone: req.body.timezone,
          avatarUrl: req.body.avatarUrl,
        },
      );
      await startSession(reply, org, userId);
      return { ok: true, orgSlug: org.slug };
    },
  );

  async function orgById(id: string): Promise<Org> {
    const org = await findOrgById(db, id);
    if (!org) throw new AppError(404, 'tenant_not_found', 'Workspace not found');
    assertOrgActive(org);
    return org;
  }

  // ---- Google SSO --------------------------------------------------------------------------

  r.get(
    '/sso/google',
    { schema: { querystring: z.object({ tenant: z.string().max(63).optional() }) } },
    async (req, reply) => {
      if (!google)
        throw new AppError(501, 'sso_not_configured', 'Google sign-in is not configured');
      const slug = req.tenantSlug ?? req.query.tenant;
      const org = slug ? await findOrgBySlug(db, slug) : null;
      if (!org) throw new AppError(404, 'tenant_not_found', 'Workspace not found');
      assertOrgActive(org);
      const state = randomToken();
      const nonce = randomToken();
      await sessions.saveState(state, { slug: org.slug, nonce });
      return reply.redirect(
        google.authUrl({
          state,
          nonce,
          domainHint: org.domain_restricted ? org.domain : undefined,
        }),
      );
    },
  );

  r.get(
    '/sso/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().optional(),
          state: z.string(),
          error: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!google)
        throw new AppError(501, 'sso_not_configured', 'Google sign-in is not configured');
      const saved = await sessions.consumeState<{ slug: string; nonce: string }>(req.query.state);
      if (!saved) throw new AppError(400, 'invalid_state', 'Sign-in session expired, try again');
      const fail = (code: string) =>
        reply.redirect(`${tenantOrigin(saved.slug)}/sign-in?error=${encodeURIComponent(code)}`);
      if (req.query.error || !req.query.code) return fail('sso_cancelled');

      const org = await findOrgBySlug(db, saved.slug);
      if (!org) return fail('tenant_not_found');
      if (org.status === 'suspended') return fail('workspace_suspended');

      let profile;
      try {
        profile = await google.exchange(req.query.code, saved.nonce);
      } catch (err) {
        req.log.warn({ err }, 'google exchange failed');
        return fail('sso_failed');
      }
      if (!profile.emailVerified) return fail('email_not_verified');
      if (org.domain_restricted && !emailMatchesOrg(profile.email, org))
        return fail('domain_not_allowed');

      let userId: string;
      const existing = await lookupUserByEmail(db, org.id, profile.email);
      if (existing) {
        if (existing.status !== 'active') return fail('account_inactive');
        userId = existing.id;
      } else {
        const pending = await findPendingInvitation(db, org.id, profile.email);
        if (!pending) return fail('not_invited');
        userId = await acceptInvitation(
          db,
          org,
          {
            id: pending.id,
            email: profile.email,
            role: pending.org_role,
            groupIds: pending.group_ids,
          },
          { name: profile.name, avatarUrl: profile.picture },
        );
      }
      const sid = await sessions.create(org.id, userId);
      await touchLastLogin(db, org.id, userId);
      // The callback runs on the apex host; hand the session to the tenant host via a one-time ticket.
      const ticket = await sessions.createTicket(org.id, sid);
      return reply.redirect(
        `${tenantOrigin(org.slug)}/api/v1/auth/sso/complete?ticket=${encodeURIComponent(ticket)}`,
      );
    },
  );

  r.get(
    '/sso/complete',
    { schema: { querystring: z.object({ ticket: z.string().min(10).max(200) }) } },
    async (req, reply) => {
      await requireTenant(req);
      const t = await sessions.consumeTicket(req.query.ticket);
      if (!t || t.orgId !== req.org!.id) {
        return reply.redirect('/sign-in?error=sso_failed');
      }
      setSessionCookie(reply, config, t.sid);
      return reply.redirect('/');
    },
  );
}
