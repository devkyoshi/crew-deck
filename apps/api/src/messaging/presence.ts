import { S2C, type PresenceEvent, type PresenceState } from '@crew-deck/shared';
import type { Redis } from 'ioredis';
import { orgKey } from '../lib/redis.js';
import type { MessagingCtx } from './context.js';

/**
 * Presence lives only in Redis (brief section 5): a hash per person with one field per open
 * connection, so several tabs merge into one state. The whole key expires 90 seconds after the last
 * heartbeat (clients beat every 30), and each field carries its own expiry so a crashed tab is
 * dropped even while another tab keeps the key alive. Nothing here touches the database.
 */
export const PRESENCE_TTL_S = 90;
export type ConnectionState = 'active' | 'away';

const key = (orgId: string, userId: string) => orgKey(orgId, 'presence', userId);
const dndKey = (orgId: string, userId: string) => orgKey(orgId, 'dnd', userId);

export class Presence {
  constructor(private readonly redis: Redis) {}

  /** Records a heartbeat for one connection. Returns the merged state before and after. */
  async beat(orgId: string, userId: string, connId: string, state: ConnectionState) {
    const before = await this.stateOf(orgId, userId);
    const k = key(orgId, userId);
    await this.redis
      .multi()
      .hset(k, connId, `${state}|${Date.now() + PRESENCE_TTL_S * 1000}`)
      .expire(k, PRESENCE_TTL_S)
      .exec();
    return { before, after: await this.stateOf(orgId, userId) };
  }

  /** Drops one connection (the socket closed). */
  async drop(orgId: string, userId: string, connId: string) {
    const before = await this.stateOf(orgId, userId);
    await this.redis.hdel(key(orgId, userId), connId);
    await this.redis.hdel(orgKey(orgId, 'viewing', userId), connId);
    return { before, after: await this.stateOf(orgId, userId) };
  }

  async setDnd(orgId: string, userId: string, minutes: number | null) {
    const before = await this.stateOf(orgId, userId);
    if (minutes === null) await this.redis.del(dndKey(orgId, userId));
    else
      await this.redis.set(
        dndKey(orgId, userId),
        '1',
        'EX',
        Math.max(60, Math.round(minutes * 60)),
      );
    return { before, after: await this.stateOf(orgId, userId) };
  }

  /**
   * Which conversation each open connection is looking at (reported only while the window is focused).
   * Expires with the heartbeat, so a closed laptop stops counting as "viewing" within 90 seconds.
   */
  async setViewing(orgId: string, userId: string, connId: string, channelId: string | null) {
    const k = orgKey(orgId, 'viewing', userId);
    if (channelId === null) {
      await this.redis.hdel(k, connId);
      return;
    }
    await this.redis
      .multi()
      .hset(k, connId, `${channelId}|${Date.now() + PRESENCE_TTL_S * 1000}`)
      .expire(k, PRESENCE_TTL_S)
      .exec();
  }

  /** True when any live connection of this person is looking at the channel right now. */
  async isViewing(orgId: string, userId: string, channelId: string) {
    const fields = await this.redis.hgetall(orgKey(orgId, 'viewing', userId));
    const now = Date.now();
    return Object.values(fields).some((v) => {
      const [ch, exp] = v.split('|');
      return ch === channelId && Number(exp) > now;
    });
  }

  async isDnd(orgId: string, userId: string) {
    return (await this.redis.exists(dndKey(orgId, userId))) === 1;
  }

  async dndUntil(orgId: string, userId: string): Promise<Date | null> {
    const ttl = await this.redis.ttl(dndKey(orgId, userId));
    return ttl > 0 ? new Date(Date.now() + ttl * 1000) : null;
  }

  async stateOf(orgId: string, userId: string): Promise<PresenceState> {
    return (await this.statesOf(orgId, [userId])).get(userId) ?? 'offline';
  }

  async statesOf(orgId: string, userIds: string[]): Promise<Map<string, PresenceState>> {
    const out = new Map<string, PresenceState>();
    if (userIds.length === 0) return out;
    const pipe = this.redis.pipeline();
    for (const id of userIds) {
      pipe.hgetall(key(orgId, id));
      pipe.exists(dndKey(orgId, id));
    }
    const res = (await pipe.exec()) ?? [];
    const now = Date.now();
    userIds.forEach((id, i) => {
      const fields = (res[i * 2]?.[1] ?? {}) as Record<string, string>;
      const dnd = res[i * 2 + 1]?.[1] === 1;
      let active = false;
      let away = false;
      for (const v of Object.values(fields)) {
        const [state, exp] = v.split('|');
        if (Number(exp) < now) continue;
        if (state === 'active') active = true;
        else away = true;
      }
      if (!active && !away) out.set(id, 'offline');
      else if (dnd) out.set(id, 'dnd');
      else out.set(id, active ? 'online' : 'away');
    });
    return out;
  }
}

/** Tells the workspace when a person's merged state changed. */
export function announcePresence(
  ctx: MessagingCtx,
  orgId: string,
  userId: string,
  change: { before: PresenceState; after: PresenceState },
) {
  if (change.before === change.after) return;
  ctx.events.toOrg(orgId, S2C.presenceChanged, {
    userId,
    state: change.after,
  } satisfies PresenceEvent);
}
