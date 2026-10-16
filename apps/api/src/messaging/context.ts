import type { Db } from '../db/client.js';
import type { EventSink } from './events.js';
import type { RateLimiter } from './rate-limit.js';

/** What every messaging service needs. The REST routes and the realtime gateway build the same one. */
export interface MessagingCtx {
  db: Db;
  events: EventSink;
  /** Absent in unit tests that do not care about limits. */
  limiter?: RateLimiter;
}
