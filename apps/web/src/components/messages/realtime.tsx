'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  C2S,
  S2C,
  SEND_TIMEOUT_MS,
  SOCKET_PATH,
  type Ack,
  type ChannelDTO,
  type MembershipEvent,
  type MessageDTO,
  type MyChannelDTO,
  type PresenceEvent,
  type ReadSyncedEvent,
  type SyncResult,
  type TypingEvent,
} from '@crew-deck/shared';
import { api, ApiError } from '@/lib/api';
import {
  fetchView,
  hasGap,
  keys,
  mergeMessages,
  type ChannelView,
  type MessageDoc,
} from '@/lib/messaging-api';
import { useMe } from '@/components/shell/me-context';
import { useMessaging } from './store';

/**
 * The browser's side of the realtime protocol (brief section 6). It keeps the React Query cache
 * current from pushed events, sends messages optimistically (shown as sending until the server
 * acknowledges them, failed after 10 seconds, retried with the same client id so a retry can never
 * duplicate), and resyncs after a reconnect.
 */
export interface RealtimeApi {
  send: (channelId: string, body: MessageDoc, text: string) => Promise<void>;
  retry: (clientMsgId: string) => Promise<void>;
  discard: (clientMsgId: string) => void;
  typing: (channelId: string) => void;
  markRead: (channelId: string, seq: number) => void;
}

const Ctx = createContext<RealtimeApi | null>(null);

export function useRealtime() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  return v;
}

/** In development the gateway has its own port on the same host (cookies ignore ports); in production it sits behind /realtime. */
function realtimeUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (fromEnv) return fromEnv;
  const { protocol, hostname, origin } = window.location;
  return hostname === 'localhost' || hostname.endsWith('.localhost')
    ? `${protocol}//${hostname}:4100`
    : origin;
}

class SendError extends Error {}

function patchChannel(qc: QueryClient, channelId: string, fn: (c: MyChannelDTO) => MyChannelDTO) {
  qc.setQueryData<MyChannelDTO[]>(keys.channels, (list) =>
    list?.map((c) => (c.id === channelId ? fn(c) : c)),
  );
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meId = useMe().user.id;
  const socketRef = useRef<Socket | null>(null);
  const typingSentAt = useRef(new Map<string, number>());
  const readSent = useRef(new Map<string, number>());

  /** Puts a stored message in the open view of its channel, backfilling if a push was missed. */
  const receive = useCallback(
    (msg: MessageDTO) => {
      const key = keys.messages(msg.channelId);
      const view = qc.getQueryData<ChannelView>(key);
      if (view) {
        if (hasGap(view, msg.seq)) {
          void fetchView(msg.channelId, { after_seq: view.lastSeq, limit: 100 })
            .then((more) =>
              qc.setQueryData<ChannelView>(key, (cur) =>
                cur
                  ? { ...mergeMessages(cur, [...more.messages, msg]), hasNewer: more.hasNewer }
                  : cur,
              ),
            )
            .catch(() => void qc.invalidateQueries({ queryKey: key }));
        } else {
          qc.setQueryData<ChannelView>(key, (cur) => (cur ? mergeMessages(cur, [msg]) : cur));
        }
      }
      const st = useMessaging.getState();
      if (msg.clientMsgId) st.removePending(msg.clientMsgId);
      if (msg.authorId) st.clearTyping(msg.channelId, msg.authorId);
    },
    [qc],
  );

  const onNew = useCallback(
    (msg: MessageDTO) => {
      receive(msg);
      const known = qc
        .getQueryData<MyChannelDTO[]>(keys.channels)
        ?.some((c) => c.id === msg.channelId);
      if (!known) return void qc.invalidateQueries({ queryKey: keys.channels });
      const looking =
        useMessaging.getState().activeChannelId === msg.channelId && document.hasFocus();
      patchChannel(qc, msg.channelId, (c) => ({
        ...c,
        lastSeq: Math.max(c.lastSeq, msg.seq),
        lastMessageAt: msg.createdAt,
        unread: msg.authorId === meId || looking ? c.unread : c.unread + 1,
      }));
    },
    [qc, receive, meId],
  );

  /** After a reconnect: ask for what was missed per open channel, then refresh counts. */
  const resync = useCallback(
    (socket: Socket) => {
      const open = qc
        .getQueriesData<ChannelView>({ queryKey: ['messaging', 'messages'] })
        .flatMap(([key, v]) => (v ? [{ channelId: key[2] as string, lastSeq: v.lastSeq }] : []));
      void qc.invalidateQueries({ queryKey: keys.channels });
      if (open.length === 0) return;
      socket.emit(C2S.sync, { channels: open }, (ack: Ack<SyncResult>) => {
        if (!ack.ok) return void qc.invalidateQueries({ queryKey: ['messaging', 'messages'] });
        for (const r of ack.data) {
          if (r.refetch) void qc.invalidateQueries({ queryKey: keys.messages(r.channelId) });
          else if (r.messages.length) r.messages.forEach(receive);
        }
        // Edits and deletions that happened while away do not have a new seq: reload the open conversation.
        const active = useMessaging.getState().activeChannelId;
        if (active) void qc.invalidateQueries({ queryKey: keys.messages(active) });
      });
    },
    [qc, receive],
  );

  useEffect(() => {
    // Connect on the next tick: React's development double-mount then never opens a throwaway socket.
    let stop: (() => void) | undefined;
    const starter = setTimeout(() => {
      stop = connectSocket();
    }, 0);
    return () => {
      clearTimeout(starter);
      stop?.();
    };

    function connectSocket() {
      const st = useMessaging.getState();
      st.setStatus('connecting');
      const socket = io(realtimeUrl(), {
        path: SOCKET_PATH,
        withCredentials: true,
        // WebSocket only: no sticky sessions are needed behind the load balancer.
        transports: ['websocket'],
        reconnectionDelayMax: 10_000,
      });
      socketRef.current = socket;
      let everConnected = false;
      let lastActivity = Date.now();
      let lastSent: 'active' | 'away' = 'active';

      const heartbeat = () => {
        const away = document.hidden || Date.now() - lastActivity > 10 * 60_000;
        lastSent = away ? 'away' : 'active';
        if (socket.connected) socket.emit(C2S.presenceUpdate, { state: lastSent });
      };
      const activity = () => {
        lastActivity = Date.now();
        if (lastSent === 'away' && !document.hidden) heartbeat();
      };
      const timer = window.setInterval(heartbeat, 30_000);
      window.addEventListener('pointermove', activity, { passive: true });
      window.addEventListener('keydown', activity);
      document.addEventListener('visibilitychange', heartbeat);

      socket.on('connect', () => {
        useMessaging.getState().setStatus('connected');
        heartbeat();
        if (everConnected) resync(socket);
        everConnected = true;
      });
      socket.on('disconnect', (reason) => {
        useMessaging.getState().setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        // The server ended the session (logout, deactivation, role change): reconnect, which fails if it is really over.
        if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 1500);
      });
      socket.on('connect_error', (err) => {
        useMessaging.getState().setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        if (err.message === 'UNAUTHENTICATED') {
          // Either the session ended (the API will send us to sign in) or the gateway is briefly unavailable.
          void api('/me').catch(() => undefined);
        }
      });

      socket.on(S2C.messageNew, onNew);
      socket.on(S2C.messageUpdated, receive);
      socket.on(S2C.messageDeleted, receive);
      socket.on(S2C.typing, (e: TypingEvent) =>
        useMessaging.getState().setTyping(e.channelId, e.userId),
      );
      socket.on(S2C.presenceChanged, (e: PresenceEvent) =>
        useMessaging.getState().setPresence(e.userId, e.state),
      );
      socket.on(S2C.channelUpdated, (c: ChannelDTO) =>
        patchChannel(qc, c.id, (cur) => ({ ...cur, ...c, people: c.people ?? cur.people })),
      );
      socket.on(S2C.channelMembership, (e: MembershipEvent) => {
        void qc.invalidateQueries({ queryKey: keys.channels });
        void qc.invalidateQueries({ queryKey: keys.members(e.channelId) });
        if (e.change === 'removed') qc.removeQueries({ queryKey: keys.messages(e.channelId) });
      });
      socket.on(S2C.readSynced, (e: ReadSyncedEvent) => {
        readSent.current.set(e.channelId, e.seq);
        patchChannel(qc, e.channelId, (c) => ({
          ...c,
          lastReadSeq: e.seq,
          unread: e.seq >= c.lastSeq ? 0 : c.unread,
        }));
        // Moving back (mark as unread) or partial reads change the count: let the server recount.
        const ch = qc
          .getQueryData<MyChannelDTO[]>(keys.channels)
          ?.find((c) => c.id === e.channelId);
        if (ch && e.seq < ch.lastSeq) void qc.invalidateQueries({ queryKey: keys.channels });
      });

      const online = () => socket.connect();
      window.addEventListener('online', online);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener('pointermove', activity);
        window.removeEventListener('keydown', activity);
        document.removeEventListener('visibilitychange', heartbeat);
        window.removeEventListener('online', online);
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [qc, onNew, receive, resync]);

  const deliver = useCallback(
    async (clientMsgId: string) => {
      const store = useMessaging.getState();
      const p = Object.values(store.pending)
        .flat()
        .find((x) => x.clientMsgId === clientMsgId);
      if (!p) return;
      store.updatePending(clientMsgId, { status: 'sending', error: undefined });
      const payload = { channelId: p.channelId, clientMsgId, body: p.body };
      try {
        const socket = socketRef.current;
        let message: MessageDTO;
        if (socket?.connected) {
          const ack = (await socket
            .timeout(SEND_TIMEOUT_MS)
            .emitWithAck(C2S.messageSend, payload)) as Ack<{ message: MessageDTO }>;
          if (!ack.ok) throw new SendError(ack.message);
          message = ack.data.message;
        } else {
          // Not connected: the REST endpoint is idempotent on the same client id, so this cannot duplicate.
          const res = await api<{ message: MessageDTO }>(`/channels/${p.channelId}/messages`, {
            method: 'POST',
            body: { clientMsgId, body: p.body },
          });
          message = res.message;
        }
        receive(message);
        patchChannel(qc, message.channelId, (c) => ({
          ...c,
          lastSeq: Math.max(c.lastSeq, message.seq),
          lastReadSeq: Math.max(c.lastReadSeq, message.seq),
          lastMessageAt: message.createdAt,
          unread: 0,
        }));
      } catch (e) {
        // The server said no (archived, no permission, too long): show its words. Otherwise it timed out.
        const reason =
          e instanceof SendError || e instanceof ApiError
            ? e.message
            : 'Not sent. Check your connection and try again.';
        useMessaging.getState().updatePending(clientMsgId, { status: 'failed', error: reason });
      }
    },
    [qc, receive],
  );

  const api2 = useMemo<RealtimeApi>(
    () => ({
      send: async (channelId, body, text) => {
        const clientMsgId = crypto.randomUUID();
        useMessaging.getState().addPending({
          clientMsgId,
          channelId,
          body,
          text,
          status: 'sending',
          createdAt: Date.now(),
        });
        await deliver(clientMsgId);
      },
      retry: deliver,
      discard: (id) => useMessaging.getState().removePending(id),
      typing: (channelId) => {
        const last = typingSentAt.current.get(channelId) ?? 0;
        if (Date.now() - last < 3000 || !socketRef.current?.connected) return;
        typingSentAt.current.set(channelId, Date.now());
        socketRef.current.emit(C2S.typingStart, { channelId });
      },
      markRead: (channelId, seq) => {
        if ((readSent.current.get(channelId) ?? -1) >= seq) return;
        readSent.current.set(channelId, seq);
        patchChannel(qc, channelId, (c) => ({
          ...c,
          lastReadSeq: Math.max(c.lastReadSeq, seq),
          unread: seq >= c.lastSeq ? 0 : c.unread,
        }));
        const socket = socketRef.current;
        if (socket?.connected) socket.emit(C2S.readUpdate, { channelId, seq });
        else
          void api(`/channels/${channelId}/read`, { method: 'PUT', body: { seq } }).catch(
            () => undefined,
          );
      },
    }),
    [qc, deliver],
  );

  return <Ctx.Provider value={api2}>{children}</Ctx.Provider>;
}
