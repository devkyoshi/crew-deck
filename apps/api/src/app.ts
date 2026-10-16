import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { registerAuthHooks } from './auth/plugin.js';
import { createGoogleClient, type GoogleClient } from './auth/google.js';
import { authRoutes } from './auth/routes.js';
import { SessionStore } from './auth/sessions.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { auditRoutes } from './routes/audit.js';
import { invitationRoutes } from './routes/invitations.js';
import { groupRoutes } from './routes/groups.js';
import { accessRequestRoutes } from './routes/access-requests.js';
import { spaceMemberRoutes } from './routes/space-members.js';
import { checkinRoutes } from './routes/checkin.js';
import { crmRecordRoutes } from './routes/crm-records.js';
import { crmDealRoutes } from './routes/crm-deals.js';
import { crmActivityRoutes } from './routes/crm-activity.js';
import { crmIoRoutes } from './routes/crm-io.js';
import { spaceRoutes } from './routes/spaces.js';
import { workSettingsRoutes } from './routes/work-settings.js';
import { statusRoutes } from './routes/statuses.js';
import { boardRoutes } from './routes/board.js';
import { workItemRoutes } from './routes/work-items.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { timeRoadmapRoutes } from './routes/time-roadmap.js';
import { reportRoutes } from './routes/reports.js';
import { spaceDocRoutes } from './routes/space-docs.js';
import { versionRoutes } from './routes/versions.js';
import { workWorkflowRoutes } from './routes/work-workflow.js';
import { workCopyRoutes } from './routes/work-copy.js';
import { workFindRoutes } from './routes/work-find.js';
import { notificationRoutes } from './routes/notifications.js';
import { sprintRoutes } from './routes/sprints.js';
import { liveRoutes } from './routes/live.js';
import { LiveHub, registerLive } from './lib/live.js';
import { messagingRoutes } from './routes/messaging.js';
import { RedisEventSink, type EventSink } from './messaging/events.js';
import { RateLimiter, type RateLimits } from './messaging/rate-limit.js';
import { workDepthRoutes } from './routes/work-depth.js';
import { attachmentRoutes, MAX_UPLOAD_BYTES } from './routes/attachments.js';
import multipart from '@fastify/multipart';
import { createStorage, type StorageDriver } from './storage/index.js';
import { workMoveRoutes } from './routes/work-move.js';
import { labelRoutes } from './routes/labels.js';
import type { EnqueueRebalance } from './work/jobs.js';
import { memberRoutes } from './routes/members.js';
import { planRoutes } from './routes/plan.js';
import { platformRoutes } from './routes/platform.js';
import { signupRoutes, type SendMail } from './routes/signup.js';
import { workspaceRoutes } from './routes/workspaces.js';
import type { EnqueueInviteEmail } from './email/queue.js';

/** Routes registered by `buildApp` (filled as routes are added). */
export const ROUTES: { method: string | string[]; url: string; hasPreHandler: boolean; config: unknown }[] = [];

export interface AppDeps {
  db: Db;
  redis: Redis;
  config: Config;
  /** Override Google (tests). Defaults to the real client when credentials are configured. */
  google?: GoogleClient | null;
  /** Queues an invite email (BullMQ in the server, a fake in tests). */
  enqueueInviteEmail?: EnqueueInviteEmail;
  /** Sends a one-off email (sign-up verification). Logs in development, Brevo in production. */
  sendMail?: SendMail;
  /** Queues a rank rebalance for one board column (BullMQ in the server, a fake in tests). */
  enqueueRebalance?: EnqueueRebalance;
  /** Where attachments live. Defaults to the driver named in the config. */
  storage?: StorageDriver;
  /** Heartbeat and access re-check intervals for live streams (shortened in tests). */
  liveTiming?: { heartbeatMs?: number; recheckMs?: number };
  /** Where messaging events go. Defaults to Redis, which the realtime gateway delivers from. */
  events?: EventSink;
  /** Message rate limits (tests tighten them). */
  messageLimits?: RateLimits;
}

export function buildApp({
  db,
  redis,
  config,
  google,
  enqueueInviteEmail,
  sendMail,
  enqueueRebalance,
  storage = createStorage(config),
  liveTiming = {},
  events = new RedisEventSink(redis),
  messageLimits,
}: AppDeps) {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  // Every route, recorded as it is added, so a test can check each one is protected (see routes.test.ts).
  app.addHook('onRoute', (route) => {
    ROUTES.push({ method: route.method, url: route.url, hasPreHandler: !!route.preHandler, config: route.config });
  });
  const live = new LiveHub(redis);
  registerLive(app, live);
  app.addHook('onClose', async () => live.close());
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 } });
  // preHandler (not onRequest) so the key generator can read the parsed body.
  app.register(rateLimit, { global: false, hook: 'preHandler' });

  const sessions = new SessionStore(redis, config.SESSION_TTL_SECONDS);
  registerAuthHooks(app, { config });
  // API responses are personal and never cacheable; they are JSON and must not be sniffed or framed.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    // File downloads set their own (private, short) caching.
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  });

  const googleClient =
    google !== undefined
      ? google
      : config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? createGoogleClient({
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
            redirectUri: `${config.WEB_ORIGIN}/api/v1/auth/sso/google/callback`,
          })
        : null;

  // Plugin-per-module: each module registers under /api/v1.
  app.register(healthRoutes, { prefix: '/api/v1', db });
  app.register(authRoutes, { prefix: '/api/v1/auth', db, config, sessions, google: googleClient, events });
  const authDeps = { db, config, sessions };
  app.register(meRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(memberRoutes, { prefix: '/api/v1', ...authDeps, events });
  app.register(messagingRoutes, {
    prefix: '/api/v1',
    ...authDeps,
    redis,
    messaging: { db, events, limiter: new RateLimiter(redis, messageLimits) },
  });
  app.register(invitationRoutes, {
    prefix: '/api/v1',
    ...authDeps,
    enqueueInviteEmail: enqueueInviteEmail ?? (async () => {}),
  });
  app.register(groupRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(spaceRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(spaceMemberRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(statusRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(boardRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(workItemRoutes, { prefix: '/api/v1', ...authDeps, storage });
  app.register(workWorkflowRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(dashboardRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(timeRoadmapRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(reportRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(versionRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(workMoveRoutes, { prefix: '/api/v1', ...authDeps, enqueueRebalance, storage });
  app.register(workDepthRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(workCopyRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(workFindRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(notificationRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(sprintRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(liveRoutes, { prefix: '/api/v1', ...authDeps, live, ...liveTiming });
  app.register(attachmentRoutes, { prefix: '/api/v1', ...authDeps, storage });
  app.register(spaceDocRoutes, { prefix: '/api/v1', ...authDeps, storage });
  app.register(labelRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(accessRequestRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(workSettingsRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(checkinRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(crmRecordRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(crmDealRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(crmActivityRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(crmIoRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(auditRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(platformRoutes, {
    prefix: '/api/v1',
    ...authDeps,
    redis,
    sendMail: sendMail ?? (async () => {}),
  });
  app.register(planRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(workspaceRoutes, { prefix: '/api/v1', ...authDeps });
  app.register(signupRoutes, {
    prefix: '/api/v1',
    ...authDeps,
    sendMail: sendMail ?? (async () => {}),
  });

  return app;
}
