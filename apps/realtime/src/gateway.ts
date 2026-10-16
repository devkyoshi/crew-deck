import type { Server as HttpServer } from 'node:http';
import {
  AppError,
  announcePresence,
  channelRoom,
  deleteMessage,
  editMessage,
  ensureBootstrap,
  findOrgBySlug,
  loadAuthUser,
  orgRoom,
  sendMessage,
  sessionRoom,
  setRead,
  toggleReaction,
  sha256,
  SESSION_COOKIE,
  syncChannels,
  tenantSlugFromHost,
  userRoom,
  type Actor,
  type Config,
  type Db,
  type MessagingCtx,
  type Presence,
  type RateLimiter,
  type SessionStore,
} from '@crew-deck/api/realtime';
import {
  C2S,
  S2C,
  SOCKET_PATH,
  messageDeleteSchema,
  messageEditSchema,
  messageSendSchema,
  presenceUpdateSchema,
  viewUpdateSchema,
  reactionToggleSchema,
  readUpdateSchema,
  syncSchema,
  typingSchema,
  type Ack,
  type SocketErrorCode,
} from '@crew-deck/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import type { ZodType } from 'zod';

export interface GatewayDeps {
  db: Db;
  config: Config;
  sessions: SessionStore;
  /** Publishing connection. The adapter's subscriber is a duplicate of it. */
  redis: Redis;
  messaging: MessagingCtx;
  presence: Presence;
  limiter: RateLimiter;
  /** How often a connection's session and membership are re-validated (default 5 minutes). */
  recheckMs?: number;
  log?: { info: (m: string) => void; error: (m: string, e?: unknown) => void };
}

interface SocketData {
  actor: Actor;
  sessionHash: string;
  readOnly: boolean;
  /** Rooms the server puts this socket in: decided during the handshake, before the client is told it is connected. */
  rooms: string[];
}

// Event payloads are validated with zod at the edge, so the event maps stay loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Events = Record<string, (...args: any[]) => void>;
type S = Socket<Events, Events, Record<string, never>, SocketData>;

const parseCookies = (header: string | undefined) => {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

const hostOf = (headers: Record<string, string | string[] | undefined>) =>
  (headers['x-forwarded-host'] as string | undefined) ?? (headers.host as string | undefined);

const hostname = (hostWithPort: string | undefined) =>
  (hostWithPort ?? '').split(':')[0]!.toLowerCase();

/** Maps a service error to the coded errors in brief section 6. */
function toSocketError(
  e: unknown,
  channelScoped: boolean,
): { code: SocketErrorCode; message: string } {
  if (e instanceof AppError) {
    if (e.code === 'channel_archived') return { code: 'CHANNEL_ARCHIVED', message: e.message };
    if (e.statusCode === 429) return { code: 'RATE_LIMITED', message: e.message };
    if (e.statusCode === 413) return { code: 'PAYLOAD_TOO_LARGE', message: e.message };
    // A channel the caller cannot see answers the same as one that does not exist, so ids cannot be probed.
    if (e.statusCode === 403 || (e.statusCode === 404 && channelScoped))
      return { code: 'FORBIDDEN', message: 'You cannot do that here' };
    if (e.statusCode === 404) return { code: 'NOT_FOUND', message: e.message };
    return { code: 'VALIDATION', message: e.message };
  }
  return { code: 'VALIDATION', message: 'Something went wrong' };
}

/**
 * The realtime gateway. Stateless: rooms live in the Socket.IO Redis adapter, presence in Redis, and
 * every decision goes through the same services and can() module the REST API uses. The tenant is
 * checked at the handshake, on every subscribe (the server decides which rooms a socket is in), on
 * every publish (the service re-checks membership in the database) and on history fetches.
 */
export function createGateway(httpServer: HttpServer, deps: GatewayDeps) {
  const { db, config, sessions, messaging, presence, limiter } = deps;
  const recheckMs = deps.recheckMs ?? 5 * 60_000;
  const log = deps.log ?? { info: () => {}, error: () => {} };

  const io = new Server<Events, Events, Record<string, never>, SocketData>(httpServer, {
    path: SOCKET_PATH,
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 15_000,
    pingTimeout: 20_000,
    // The page may live on another port in development, so CORS reflects the origin; the real
    // cross-site check is `allowRequest` below.
    cors: { origin: true, credentials: true },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true); // not a browser (tests, tools): the session cookie still decides
      try {
        cb(null, hostname(new URL(origin).host) === hostname(hostOf(req.headers)));
      } catch {
        cb(null, false);
      }
    },
  });
  const sub = deps.redis.duplicate();
  io.adapter(createAdapter(deps.redis, sub));

  // ---- Handshake: tenant from the host, person from the session cookie -----------------------------
  io.use(async (socket, next) => {
    try {
      const headers = socket.handshake.headers;
      const slug = tenantSlugFromHost(hostOf(headers), config.BASE_DOMAIN);
      const sid = parseCookies(headers.cookie)[SESSION_COOKIE];
      if (!slug || !sid) return next(new Error('UNAUTHENTICATED'));
      const org = await findOrgBySlug(db, slug);
      if (!org || org.status === 'suspended') return next(new Error('UNAUTHENTICATED'));
      const session = await sessions.get(org.id, sid);
      if (!session) return next(new Error('UNAUTHENTICATED'));
      const user = await loadAuthUser(db, org.id, session.userId);
      if (!user || user.status !== 'active') return next(new Error('UNAUTHENTICATED'));
      const actor: Actor = {
        userId: user.id,
        orgId: org.id,
        orgRole: user.orgRole,
        crmRole: user.crmRole,
      };
      const t = db.tenant(org.id);
      await ensureBootstrap(messaging, t, user.id);
      // The server decides the rooms: a personal one, the workspace's presence room, this session's own
      // (so logout can end it), and one per channel the person belongs to.
      const memberships = await t.channelMembers.find(
        { userId: user.id },
        { projection: { channelId: 1 } },
      );
      const sessionHash = sha256(sid);
      socket.data = {
        actor,
        sessionHash,
        readOnly: !!session.impersonatedBy,
        rooms: [
          userRoom(org.id, user.id),
          orgRoom(org.id),
          sessionRoom(org.id, sessionHash),
          ...memberships.map((m) => channelRoom(org.id, m.channelId)),
        ],
      };
      next();
    } catch (e) {
      log.error('handshake failed', e);
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: S) => {
    onConnection(socket);
  });

  // Everything async happened in the handshake, so rooms and handlers are in place the moment the
  // client sees "connected" and can start sending.
  function onConnection(socket: S) {
    const { actor } = socket.data;
    void socket.join(socket.data.rooms);

    void presence
      .beat(actor.orgId, actor.userId, socket.id, 'active')
      .then((c) => announcePresence(messaging, actor.orgId, actor.userId, c))
      .catch((e) => log.error('presence failed', e));

    // Re-validate the session and membership every few minutes (brief section 6, Auth).
    const timer = setInterval(() => {
      void (async () => {
        const stillThere = await sessions.get(
          actor.orgId,
          parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE] ?? '',
        );
        const user = stillThere ? await loadAuthUser(db, actor.orgId, actor.userId) : null;
        if (!user || user.status !== 'active') socket.disconnect(true);
        else socket.data.actor = { ...actor, orgRole: user.orgRole, crmRole: user.crmRole };
      })().catch(() => undefined);
    }, recheckMs);
    timer.unref();

    socket.on('disconnect', () => {
      clearInterval(timer);
      void presence
        .drop(actor.orgId, actor.userId, socket.id)
        .then((c) => announcePresence(messaging, actor.orgId, actor.userId, c))
        .catch((e) => log.error('presence drop failed', e));
    });

    /** Parses a payload, runs the handler and acknowledges with its result or a coded error. */
    const handle = <P, R>(
      event: string,
      schema: ZodType<P>,
      fn: (payload: P, actor: Actor) => Promise<R>,
      opts: { channelScoped?: boolean; write?: boolean } = {},
    ) => {
      socket.on(event, async (raw: unknown, ack?: (a: Ack<R>) => void) => {
        const reply = typeof ack === 'function' ? ack : () => undefined;
        try {
          if (opts.write && socket.data.readOnly)
            return reply({ ok: false, code: 'FORBIDDEN', message: 'This session is read-only' });
          const parsed = schema.safeParse(raw);
          if (!parsed.success)
            return reply({ ok: false, code: 'VALIDATION', message: 'Invalid request' });
          reply({ ok: true, data: await fn(parsed.data, socket.data.actor) });
        } catch (e) {
          const err = toSocketError(e, opts.channelScoped ?? false);
          if (!(e instanceof AppError)) log.error(`${event} failed`, e);
          reply({ ok: false, ...err });
        }
      });
    };

    handle(C2S.messageSend, messageSendSchema, (p, a) => sendMessage(messaging, a, p), {
      channelScoped: true,
      write: true,
    });
    handle(
      C2S.messageEdit,
      messageEditSchema,
      (p, a) => editMessage(messaging, a, p.messageId, p.body),
      { write: true },
    );
    handle(
      C2S.messageDelete,
      messageDeleteSchema,
      (p, a) => deleteMessage(messaging, a, p.messageId),
      { write: true },
    );
    handle(C2S.readUpdate, readUpdateSchema, (p, a) => setRead(messaging, a, p.channelId, p.seq), {
      channelScoped: true,
    });
    handle(
      C2S.reactionToggle,
      reactionToggleSchema,
      async (p, a) => ({ reactions: await toggleReaction(messaging, a, p.messageId, p.emoji) }),
      { write: true },
    );
    // Which conversation this tab is looking at (reported only while its window is focused). It stops
    // notifications for that conversation, and lapses on its own if the tab goes quiet.
    handle(C2S.viewUpdate, viewUpdateSchema, async (p) => {
      if (p.channelId !== null && !socket.rooms.has(channelRoom(actor.orgId, p.channelId)))
        return { ok: true };
      await presence.setViewing(actor.orgId, actor.userId, socket.id, p.channelId);
      return { ok: true };
    });
    handle(C2S.sync, syncSchema, (p, a) => syncChannels(messaging, a, p.channels));
    handle(C2S.presenceUpdate, presenceUpdateSchema, async (p) => {
      const change = await presence.beat(actor.orgId, actor.userId, socket.id, p.state);
      announcePresence(messaging, actor.orgId, actor.userId, change);
      return { state: change.after };
    });

    // Typing: a signal, not a record. Only for rooms the server put this socket in, throttled to one
    // per 3 seconds per person and channel, and never stored.
    socket.on(C2S.typingStart, (raw: unknown) => {
      const p = typingSchema.safeParse(raw);
      if (!p.success) return;
      const room = channelRoom(actor.orgId, p.data.channelId);
      if (!socket.rooms.has(room)) {
        socket.emit(S2C.error, { code: 'FORBIDDEN', message: 'You cannot do that here' });
        return;
      }
      void limiter
        .cooldown(`org:${actor.orgId}:typing:${actor.userId}:${p.data.channelId}`, 3000)
        .then(
          (ok) =>
            ok &&
            socket.to(room).emit(S2C.typing, { channelId: p.data.channelId, userId: actor.userId }),
        )
        .catch(() => undefined);
    });
  }

  return {
    io,
    async close() {
      await io.close();
      sub.disconnect();
    },
  };
}
