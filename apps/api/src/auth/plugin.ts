import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { isProd } from '../config.js';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, type SessionStore } from './sessions.js';
import {
  findOrgBySlug,
  loadAuthUser,
  tenantSlugFromHost,
  type AuthUser,
  type Org,
} from './service.js';

export interface AuthDeps {
  db: Db;
  config: Config;
  sessions: SessionStore;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Slug from the request host, if any (set for every request). */
    tenantSlug: string | null;
    /** Set by requireTenant / requireAuth. */
    org?: Org;
    /** Set by requireAuth. */
    user?: AuthUser;
    sessionId?: string;
    /** Email of the platform admin when this is an impersonated, read-only session. */
    impersonatedBy?: string;
  }
}

export const requestHost = (req: FastifyRequest) =>
  (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;

export function cookieOptions(config: Config) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd(config),
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS,
  };
}

export function setSessionCookie(reply: FastifyReply, config: Config, sid: string) {
  reply.setCookie(SESSION_COOKIE, sid, cookieOptions(config));
}

export function clearSessionCookie(reply: FastifyReply, _config: Config) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** A suspended workspace cannot be used at all: no sign-in, no invitations, and live sessions stop. */
export function assertOrgActive(org: Org) {
  if (org.status === 'suspended') {
    throw new AppError(
      403,
      'workspace_suspended',
      'This workspace is suspended. Contact your administrator or support.',
    );
  }
}

/** Resolves the tenant from the host. A request with no resolvable tenant is rejected. */
export function makeRequireTenant({ db }: AuthDeps) {
  return async (req: FastifyRequest) => {
    if (req.org) return;
    if (!req.tenantSlug) throw new AppError(400, 'tenant_required', 'No workspace in this request');
    const org = await findOrgBySlug(db, req.tenantSlug);
    if (!org) throw new AppError(404, 'tenant_not_found', 'Workspace not found');
    assertOrgActive(org);
    req.org = org;
  };
}

export function makeRequireAuth(deps: AuthDeps) {
  const requireTenant = makeRequireTenant(deps);
  return async (req: FastifyRequest) => {
    await requireTenant(req);
    const sid = req.cookies[SESSION_COOKIE];
    if (!sid) throw new AppError(401, 'unauthenticated', 'Sign in required');
    const session = await deps.sessions.get(req.org!.id, sid);
    if (!session) throw new AppError(401, 'unauthenticated', 'Sign in required');
    const user = await loadAuthUser(deps.db, req.org!.id, session.userId);
    if (!user || user.status !== 'active') {
      await deps.sessions.destroy(req.org!.id, sid);
      throw new AppError(401, 'unauthenticated', 'Sign in required');
    }
    if (session.impersonatedBy) {
      // A platform admin looking around can read everything and change nothing.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new AppError(403, 'impersonation_read_only', 'Impersonated sessions are read-only');
      }
      req.impersonatedBy = session.impersonatedBy;
    }
    req.user = user;
    req.sessionId = sid;
  };
}

/**
 * Registers request-level hooks: tenant slug from host, and a same-origin check on state-changing
 * requests (defence in depth on top of SameSite=Lax cookies).
 */
export function registerAuthHooks(
  app: import('fastify').FastifyInstance,
  { config }: Pick<AuthDeps, 'config'>,
) {
  app.decorateRequest('tenantSlug', null);
  app.addHook('onRequest', async (req) => {
    req.tenantSlug = tenantSlugFromHost(requestHost(req), config.BASE_DOMAIN);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && req.headers['sec-fetch-site'] !== 'none') {
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          /* malformed origin */
        }
        if (originHost !== requestHost(req)) {
          throw new AppError(403, 'bad_origin', 'Cross-origin request blocked');
        }
      }
    }
  });
}
