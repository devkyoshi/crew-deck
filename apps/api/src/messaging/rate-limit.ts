import type { Redis } from 'ioredis';
import { AppError } from '../lib/errors.js';
import { orgKey } from '../lib/redis.js';

/**
 * Token bucket in Redis, shared by every API and gateway instance. One bucket per person and one per
 * workspace, so a single tenant cannot starve the rest (brief section 7).
 */
const TAKE = `
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(d[1])
local ts = tonumber(d[2])
if tokens == nil then tokens = cap; ts = now end
tokens = math.min(cap, tokens + math.max(0, now - ts) * rate)
local ok = 0
if tokens >= 1 then tokens = tokens - 1; ok = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate) + 1000)
return ok
`;

export interface RateLimits {
  /** Messages per window for one person (default 20 per 10 seconds). */
  userMax: number;
  /** Messages per window for a whole workspace. */
  orgMax: number;
  windowMs: number;
}

export const DEFAULT_LIMITS: RateLimits = { userMax: 20, orgMax: 300, windowMs: 10_000 };

export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limits: RateLimits = DEFAULT_LIMITS,
  ) {}

  private async take(key: string, max: number) {
    const rate = max / this.limits.windowMs;
    const ok = await this.redis.eval(TAKE, 1, key, max, rate, Date.now());
    return ok === 1;
  }

  /** Throws a 429 when the person or their workspace is sending too fast. */
  async message(orgId: string, userId: string) {
    const [u, o] = await Promise.all([
      this.take(orgKey(orgId, 'rl', 'msg', 'user', userId), this.limits.userMax),
      this.take(orgKey(orgId, 'rl', 'msg', 'org'), this.limits.orgMax),
    ]);
    if (!u || !o)
      throw new AppError(
        429,
        'rate_limited',
        'You are sending messages too fast. Slow down a little.',
      );
  }

  /** A simple cooldown: true when the action is allowed now. Used to throttle typing events. */
  async cooldown(key: string, ms: number) {
    return (await this.redis.set(key, '1', 'PX', ms, 'NX')) === 'OK';
  }
}
