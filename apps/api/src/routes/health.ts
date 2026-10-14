import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client.js';

export async function healthRoutes(app: FastifyInstance, opts: { db: Db }) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        response: { 200: z.object({ status: z.literal('ok'), db: z.boolean() }) },
      },
    },
    async () => {
      await opts.db.handle.command({ ping: 1 });
      return { status: 'ok' as const, db: true };
    },
  );
}
