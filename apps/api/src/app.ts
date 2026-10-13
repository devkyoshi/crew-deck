import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Db } from './db/client.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  db: Db;
  logLevel?: string;
}

export function buildApp({ db, logLevel = 'info' }: AppDeps) {
  const app = Fastify({
    logger: {
      level: logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  // Plugin-per-module: each module registers under /api/v1.
  app.register(healthRoutes, { prefix: '/api/v1', db });

  return app;
}
