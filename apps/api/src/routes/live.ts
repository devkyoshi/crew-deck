import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import type { LiveHub } from '../lib/live.js';
import { resolveSpace } from './spaces.js';

export interface LiveDeps extends AuthDeps {
  live: LiveHub;
  /** Heartbeat and access re-check intervals (shortened in tests). */
  heartbeatMs?: number;
  recheckMs?: number;
}

/** Open streams per person, so one browser left open in many tabs cannot exhaust the server. */
const MAX_STREAMS_PER_USER = 12;
const open = new Map<string, number>();

/**
 * `GET /spaces/:id/events`: a server-sent event stream of changes in one space. The session cookie
 * authenticates it like any request; access to the space is checked on connect and again every
 * minute, and the stream ends when it is lost. Heartbeats keep proxies from closing an idle stream.
 */
export async function liveRoutes(app: FastifyInstance, deps: LiveDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const heartbeatMs = deps.heartbeatMs ?? 20_000;
  const recheckMs = deps.recheckMs ?? 60_000;

  r.get(
    '/spaces/:id/events',
    { preHandler: requireAuth, schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (req, reply) => {
      const actor = actorOf(req);
      const space = await withTenant(deps.db, actor.orgId, (t) => resolveSpace(t, actor, req.params.id));
      const count = open.get(actor.userId) ?? 0;
      if (count >= MAX_STREAMS_PER_USER) {
        throw new AppError(429, 'too_many_streams', 'Too many live connections. Close some tabs and try again.');
      }
      open.set(actor.userId, count + 1);

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Tells nginx (and similar proxies) not to buffer the stream.
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      });
      let seq = 0;
      const send = (event: string, data: unknown) => {
        if (!res.writableEnded) res.write(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      res.write('retry: 3000\n\n');
      send('ready', { spaceId: space.id });

      let closed = false;
      const stopListening = await deps.live.listen(actor.orgId, space.id, (msg) => send('change', msg));
      const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), heartbeatMs);
      // Access can be taken away while the stream is open (removed from a private space, deactivated).
      const recheck = setInterval(() => {
        void (async () => {
          const still = await withTenant(deps.db, actor.orgId, async (t) => {
            const member = await t.memberships.findOne({ userId: actor.userId, status: 'active' });
            if (!member) return false;
            return resolveSpace(t, { ...actor, orgRole: member.orgRole }, space.id)
              .then(() => true)
              .catch(() => false);
          }).catch(() => false);
          if (!still) {
            send('revoked', { spaceId: space.id });
            finish();
          }
        })();
      }, recheckMs);

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(recheck);
        void stopListening();
        const n = (open.get(actor.userId) ?? 1) - 1;
        if (n <= 0) open.delete(actor.userId);
        else open.set(actor.userId, n);
        if (!res.writableEnded) res.end();
      };
      req.raw.on('close', finish);
    },
  );
}
