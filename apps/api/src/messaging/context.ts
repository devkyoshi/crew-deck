import type { Db } from '../db/client.js';
import type { EventSink } from './events.js';
import type { StorageDriver } from '../storage/index.js';
import type { EnqueueLinkPreviews } from './link-preview.js';
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
}
