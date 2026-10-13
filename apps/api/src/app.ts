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

export interface AppDeps {
  db: Db;
  redis: Redis;
  config: Config;
  /** Override Google (tests). Defaults to the real client when credentials are configured. */
  google?: GoogleClient | null;
}

export function buildApp({ db, redis, config, google }: AppDeps) {
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
  app.register(cookie);
  // preHandler (not onRequest) so the key generator can read the parsed body.
  app.register(rateLimit, { global: false, hook: 'preHandler' });

  const sessions = new SessionStore(redis, config.SESSION_TTL_SECONDS);
  registerAuthHooks(app, { config });

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
  app.register(authRoutes, { prefix: '/api/v1/auth', db, config, sessions, google: googleClient });
  app.register(meRoutes, { prefix: '/api/v1', db, config, sessions });

  return app;
}
