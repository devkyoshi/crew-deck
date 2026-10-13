import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

/** Every error leaves the API as { code, message, fields? }. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ code: 'not_found', message: 'Route not found' });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ code: err.code, message: err.message, fields: err.fields });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields: Record<string, string> = {};
      for (const issue of err.validation) {
        const path = issue.instancePath.replace(/^\//, '').replace(/\//g, '.') || '_';
        fields[path] ??= issue.message ?? 'Invalid value';
      }
      return reply
        .status(400)
        .send({ code: 'validation_error', message: 'Invalid request', fields });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply
        .status(429)
        .send({ code: 'rate_limited', message: 'Too many attempts, try again shortly' });
    }
    if (status && status < 500) {
      return reply.status(status).send({ code: 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ code: 'internal_error', message: 'Something went wrong' });
  });
}
