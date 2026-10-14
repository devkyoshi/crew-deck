import type { Redis } from 'ioredis';
import { randomToken, sha256 } from '../lib/crypto.js';
import { orgKey } from '../lib/redis.js';

export const SESSION_COOKIE = 'cd_session';

/**
 * Sessions live in Redis under org:{id}:sess:{hash}. The tenant comes from the request host, so a
 * session cookie replayed against another tenant's host simply finds nothing.
 * Pre-tenant keys (SSO state, one-time tickets) use the auth: prefix.
 */
export class SessionStore {
  constructor(
    private redis: Redis,
    private ttl: number,
  ) {}

  private key(orgId: string, sid: string) {
    return orgKey(orgId, 'sess', sha256(sid));
  }

  /**
   * `impersonatedBy` marks a platform admin's read-only visit: it has its own short lifetime that is
   * never extended by activity.
   */
  async create(
    orgId: string,
    userId: string,
    opts: { impersonatedBy?: string; ttl?: number } = {},
  ) {
    const sid = randomToken();
    const value = opts.impersonatedBy
      ? { userId, impersonatedBy: opts.impersonatedBy }
      : { userId };
    await this.redis.set(this.key(orgId, sid), JSON.stringify(value), 'EX', opts.ttl ?? this.ttl);
    return sid;
  }

  async get(
    orgId: string,
    sid: string,
  ): Promise<{ userId: string; impersonatedBy?: string } | null> {
    const raw = await this.redis.get(this.key(orgId, sid));
    if (!raw) return null;
    const session = JSON.parse(raw) as { userId: string; impersonatedBy?: string };
    if (!session.impersonatedBy) await this.redis.expire(this.key(orgId, sid), this.ttl);
    return session;
  }

  async destroy(orgId: string, sid: string) {
    await this.redis.del(this.key(orgId, sid));
  }

  async saveState(state: string, value: object) {
    await this.redis.set(`auth:sso:state:${sha256(state)}`, JSON.stringify(value), 'EX', 600);
  }

  async consumeState<T>(state: string): Promise<T | null> {
    const raw = await this.redis.getdel(`auth:sso:state:${sha256(state)}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async createTicket(orgId: string, sid: string) {
    const ticket = randomToken();
    await this.redis.set(`auth:ticket:${sha256(ticket)}`, JSON.stringify({ orgId, sid }), 'EX', 60);
    return ticket;
  }

  async consumeTicket(ticket: string): Promise<{ orgId: string; sid: string } | null> {
    const raw = await this.redis.getdel(`auth:ticket:${sha256(ticket)}`);
    return raw ? JSON.parse(raw) : null;
  }
}
