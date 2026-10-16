import type { FastifyInstance } from 'fastify';
import type { MessagingCtx } from '../messaging/context.js';
import {
  reconcileLater,
  syncSpaceRefLater,
} from '../messaging/space-channels.js';

/**
 * Keeps each space's channel in step with the space (brief section 4). After any successful change to a
 * space, its people or a group, the affected channel is synced in the background: a person added to a
 * space is in its channel within seconds, and a removed one is out. Registered at the root so it sees
 * the routes of the spaces, groups and members modules without those modules knowing about chat.
 */
export function registerSpaceChannelSync(app: FastifyInstance, ctx: MessagingCtx) {
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || reply.statusCode >= 300) return;
    if (!req.user || !req.org) return;
    const url = req.routeOptions.url ?? '';
    const orgId = req.org.id;
    const params = req.params as { id?: string };
    try {
      if (url === '/api/v1/spaces') return reconcileLater(ctx, orgId);
      if (url === '/api/v1/spaces/:id' || url.startsWith('/api/v1/spaces/:id/')) {
        const rest = url.slice('/api/v1/spaces/:id'.length);
        const relevant =
          rest === '' ||
          rest === '/members' ||
          rest.startsWith('/members/') ||
          rest === '/archive' ||
          rest === '/restore';
        if (relevant && params.id) return syncSpaceRefLater(ctx, orgId, params.id);
        return;
      }
      if (url.startsWith('/api/v1/groups/') || url.startsWith('/api/v1/members/')) {
        return reconcileLater(ctx, orgId);
      }
    } catch (e) {
      req.log.error({ err: e }, 'space channel sync could not be queued');
    }
  });
}
