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

  private indexKey(orgId: string, userId: string) {
    return orgKey(orgId, 'usess', userId);
  }

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
    // An index of the person's sessions, so "sign out everywhere else" can find them.
    if (!opts.impersonatedBy) {
      const idx = this.indexKey(orgId, userId);
      await this.redis.multi().sadd(idx, sha256(sid)).expire(idx, this.ttl).exec();
    }
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

  /** Ends every session of this person except the one named. Returns how many were ended. */
  async destroyOthers(orgId: string, userId: string, keepSid: string | null) {
    const idx = this.indexKey(orgId, userId);
    const keep = keepSid ? sha256(keepSid) : null;
    let ended = 0;
    for (const h of await this.redis.smembers(idx)) {
      if (h === keep) continue;
      ended += await this.redis.del(orgKey(orgId, 'sess', h));
      await this.redis.srem(idx, h);
    }
    return ended;
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
