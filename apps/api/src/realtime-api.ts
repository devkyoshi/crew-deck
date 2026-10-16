// Fastify's cookie typings, so programs that include API source (the gateway) type-check it too.
import '@fastify/cookie';
/**
 * What the realtime gateway (apps/realtime) uses from the API. The gateway runs the same messaging
 * services and the same can() module as the REST routes, so behaviour and permissions never diverge.
 */
export { loadConfig, type Config } from './config.js';
export { createDb, type Db } from './db/client.js';
export { createRedis, orgKey } from './lib/redis.js';
export { sha256 } from './lib/crypto.js';
export { AppError } from './lib/errors.js';
export { SESSION_COOKIE, SessionStore } from './auth/sessions.js';
export { findOrgBySlug, loadAuthUser, tenantSlugFromHost } from './auth/service.js';
export {
  RedisEventSink,
  channelRoom,
  userRoom,
  orgRoom,
  sessionRoom,
  type EventSink,
} from './messaging/events.js';
export { RateLimiter } from './messaging/rate-limit.js';
export { Presence, announcePresence } from './messaging/presence.js';
export type { MessagingCtx } from './messaging/context.js';
export { sendMessage, editMessage, deleteMessage, syncChannels } from './messaging/messages.js';
export { setRead } from './messaging/read-state.js';
export { toggleReaction } from './messaging/reactions.js';
export { createLinkPreviewEnqueuer } from './messaging/link-preview.js';
export { createStorage } from './storage/index.js';
export { ensureBootstrap } from './messaging/channels.js';
export type { Actor } from './permissions/can.js';
