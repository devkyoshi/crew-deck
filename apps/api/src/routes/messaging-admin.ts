import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { AppError } from '../lib/errors.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { exportFile, getExport, listExports, requestExport } from '../messaging/export.js';
import type { MessagingCtx } from '../messaging/context.js';
import { listRetentionOverrides, setChannelRetention } from '../messaging/retention.js';
import { getMessagingSettings, updateMessagingSettings } from '../messaging/settings.js';
import { createWebhook, ingestWebhook, listWebhooks, revokeWebhook } from '../messaging/webhooks.js';

const id = z.object({ id: z.string().uuid() });

/**
 * Chat administration (brief section 10): the workspace's chat rules, retention, copies of the data, and
 * incoming webhooks. The owner changes rules, retention and exports; owners and admins manage webhooks.
 */
export async function messagingAdminRoutes(
  app: FastifyInstance,
  deps: AuthDeps & { messaging: MessagingCtx },
) {
  const requireAuth = makeRequireAuth(deps);
  const pre = { preHandler: requireAuth };
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ctx = deps.messaging;

  // ---- Settings and retention ------------------------------------------------------------------------
  r.get('/admin/messaging-settings', pre, async (req) => getMessagingSettings(ctx, actorOf(req)));
  r.put('/admin/messaging-settings', { ...pre, schema: { body: z.unknown() } }, async (req) =>
    updateMessagingSettings(ctx, actorOf(req), req.body),
  );
  r.get('/admin/retention', pre, async (req) => ({ channels: await listRetentionOverrides(ctx, actorOf(req)) }));
  r.put(
    '/admin/channels/:id/retention',
    {
      ...pre,
      schema: { params: id, body: z.object({ days: z.number().int().nullable() }) },
    },
    async (req) => setChannelRetention(ctx, actorOf(req), req.params.id, req.body.days),
  );

  // ---- Export ------------------------------------------------------------------------------------------
  r.post('/admin/export', pre, async (req, reply) => {
    const out = await requestExport(ctx, actorOf(req));
    reply.status(202);
    return { export: out };
  });
  r.get('/admin/export', pre, async (req) => ({ exports: await listExports(ctx, actorOf(req)) }));
  r.get('/admin/export/:id', { ...pre, schema: { params: id } }, async (req) => ({
    export: await getExport(ctx, actorOf(req), req.params.id),
  }));
  r.get('/admin/export/:id/file', { ...pre, schema: { params: id } }, async (req, reply) => {
    const { stream, size } = await exportFile(ctx, actorOf(req), req.params.id);
    reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', 'attachment; filename="chat-export.ndjson.gz"')
      .header('cache-control', 'private, no-store');
    if (size !== undefined) reply.header('content-length', String(size));
    return reply.send(stream);
  });

  // ---- Webhooks ----------------------------------------------------------------------------------------
  r.get('/channels/:id/webhooks', { ...pre, schema: { params: id } }, async (req) => ({
    webhooks: await listWebhooks(ctx, actorOf(req), req.params.id),
  }));
  r.post(
    '/channels/:id/webhooks',
    { ...pre, schema: { params: id, body: z.object({ name: z.string().trim().min(1).max(60) }) } },
    async (req, reply) => {
      const out = await createWebhook(ctx, actorOf(req), req.params.id, req.body.name);
      reply.status(201);
      return out;
    },
  );
  r.delete('/webhooks/:id', { ...pre, schema: { params: id } }, async (req, reply) => {
    await revokeWebhook(ctx, actorOf(req), req.params.id);
    return reply.status(204).send();
  });
}

/**
 * The public ingest address. No session and no tenant host: the secret in the address is the credential.
 * JSON only, a small body, and limited per webhook and per workspace.
 */
export async function hookRoutes(app: FastifyInstance, deps: { messaging: MessagingCtx }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post(
    '/hooks/:token',
    { bodyLimit: 16 * 1024, schema: { params: z.object({ token: z.string().min(1).max(80) }) } },
    async (req, reply) => {
      // JSON only: Fastify also reads plain text, which is not what a webhook sends.
      if (!/^application\/json(;|$)/i.test(req.headers['content-type'] ?? ''))
        throw new AppError(415, 'unsupported_media_type', 'Send the body as application/json');
      const out = await ingestWebhook(deps.messaging, req.params.token, req.body);
      reply.status(201);
      return { ok: true, id: out.id };
    },
  );
}
