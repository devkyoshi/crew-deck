import type { Db } from '../db/client.js';
import type { EventSink } from './events.js';
import type { StorageDriver } from '../storage/index.js';
import type { EnqueueLinkPreviews } from './link-preview.js';
import type { Presence } from './presence.js';
import type { RateLimiter } from './rate-limit.js';

/** What every messaging service needs. The REST routes and the realtime gateway build the same one. */
export interface MessagingCtx {
  db: Db;
  events: EventSink;
  /** Absent in unit tests that do not care about limits. */
  limiter?: RateLimiter;
  /** Where message files live. Needed to remove the bytes when a message or channel is deleted. */
  storage?: StorageDriver;
  /** Queues link lookups (BullMQ in the servers). Without it messages simply get no link cards. */
  enqueueLinkPreviews?: EnqueueLinkPreviews;
  /** Who is online, away or looking at which conversation (for @here and "not while viewing"). */
  presence?: Presence;
  /**
   * Runs follow-up work (notifications) after a send has been acknowledged. The default does not wait;
   * tests pass one that collects the work so they can await it.
   */
  defer?: (work: () => Promise<unknown>) => void;
}

/** Runs `work` after the caller's response, never failing or delaying it. */
export function runLater(ctx: MessagingCtx, work: () => Promise<unknown>) {
  if (ctx.defer) return ctx.defer(work);
  void work().catch((e: Error) => console.error(`messaging follow-up failed: ${e.message}`));
}
