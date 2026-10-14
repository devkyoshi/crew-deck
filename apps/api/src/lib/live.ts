import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

/**
 * Live updates (server-sent events). Changes are noted while a request runs (`liveTouch`, called by
 * the activity log and a few other writers) and published only after the response succeeded, so a
 * rolled-back change is never announced. Messages go through Redis pub/sub, so every API instance
 * hears them; each instance fans them out to its own open streams. Channels are per workspace and
 * space (`live:org:{org}:space:{space}`), and a stream only subscribes after its space access check.
 */

export interface LiveChange {
  orgId: string;
  spaceId: string;
  /** What happened, for clients that care (they mostly just refresh). */
  kind: string;
  itemId?: string | null;
}

export interface LiveMessage {
  spaceId: string;
  kinds: string[];
  itemIds: string[];
  /** Who made the change, so their own tab can skip the refresh it already did. */
  actorId: string | null;
  at: string;
}

const store = new AsyncLocalStorage<{ changes: LiveChange[] }>();

/** Notes a change for the current request (no-op outside a request, e.g. in scripts and jobs). */
export function liveTouch(change: LiveChange) {
  store.getStore()?.changes.push(change);
}

export const channelOf = (orgId: string, spaceId: string) => `live:org:${orgId}:space:${spaceId}`;

type Listener = (msg: LiveMessage) => void;

export class LiveHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly sub: Redis;

  constructor(private readonly pub: Redis) {
    this.sub = pub.duplicate();
    this.sub.on('message', (channel: string, raw: string) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      let msg: LiveMessage;
      try {
        msg = JSON.parse(raw) as LiveMessage;
      } catch {
        return;
      }
      for (const fn of set) fn(msg);
    });
  }

  async publish(orgId: string, msg: LiveMessage) {
    await this.pub.publish(channelOf(orgId, msg.spaceId), JSON.stringify(msg));
  }

  /** Listens to one space; returns the function that stops listening. */
  async listen(orgId: string, spaceId: string, fn: Listener) {
    const channel = channelOf(orgId, spaceId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(fn);
    return async () => {
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(channel);
        await this.sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  close() {
    this.sub.disconnect();
  }
}

/** Collects each request's changes and publishes them once it has succeeded. */
export function registerLive(app: FastifyInstance, hub: LiveHub) {
  app.addHook('onRequest', (req, _reply, done) => {
    store.run({ changes: [] }, () => done());
  });
  app.addHook('onResponse', async (req, reply) => {
    const s = store.getStore();
    if (!s || s.changes.length === 0 || reply.statusCode >= 300) return;
    // One message per space, whatever the number of changes in the request (bulk moves, transfers).
    const bySpace = new Map<string, { orgId: string; kinds: Set<string>; itemIds: Set<string> }>();
    for (const c of s.changes) {
      const key = `${c.orgId}:${c.spaceId}`;
      const e = bySpace.get(key) ?? { orgId: c.orgId, kinds: new Set(), itemIds: new Set() };
      e.kinds.add(c.kind);
      if (c.itemId) e.itemIds.add(c.itemId);
      bySpace.set(key, e);
    }
    const at = new Date().toISOString();
    const actorId = req.user?.id ?? null;
    for (const [key, e] of bySpace) {
      const spaceId = key.slice(key.indexOf(':') + 1);
      await hub
        .publish(e.orgId, { spaceId, kinds: [...e.kinds], itemIds: [...e.itemIds], actorId, at })
        .catch((err: Error) => req.log.error(err, 'live publish failed'));
    }
    s.changes.length = 0;
  });
}
