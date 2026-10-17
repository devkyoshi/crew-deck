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
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { toast } from '@/lib/toast';
import {
  C2S,
  S2C,
  SEND_TIMEOUT_MS,
  SOCKET_PATH,
  type Ack,
  type AttachmentDTO,
  type ChannelDTO,
  type MembershipEvent,
  type MessageDTO,
  type MyChannelDTO,
  type NotificationEvent,
  type PresenceBatchEvent,
  type PresenceEvent,
  type ReactionEvent,
  type ReadSyncedEvent,
  type SendResult,
  type SyncResult,
  type ThreadEvent,
  type TypingEvent,
} from '@crew-deck/shared';
import { api, ApiError } from '@/lib/api';
import {
  fetchView,
  hasGap,
  keys,
  mergeMessages,
  patchMessageEverywhere,
  personName,
  type ChannelView,
  type MessageDoc,
  type ThreadView,
} from '@/lib/messaging-api';
import type { PreferencesResponse } from '@/lib/notifications-api';
import { useMe } from '@/components/shell/me-context';
import { useMessaging } from './store';

/**
 * The browser's side of the realtime protocol (brief section 6). It keeps the React Query cache
 * current from pushed events, sends messages optimistically (shown as sending until the server
 * acknowledges them, failed after 10 seconds, retried with the same client id so a retry can never
 * duplicate), and resyncs after a reconnect.
 */
export interface SendOptions {
  /** Reply in this message's thread. */
  threadRootId?: string;
  /** For replies: also show the reply in the channel. */
  alsoInChannel?: boolean;
  /** Files already uploaded for this message. */
  files?: AttachmentDTO[];
}

export interface RealtimeApi {
  send: (channelId: string, body: MessageDoc, text: string, opts?: SendOptions) => Promise<void>;
  retry: (clientMsgId: string) => Promise<void>;
  discard: (clientMsgId: string) => void;
  typing: (channelId: string) => void;
  markRead: (channelId: string, seq: number) => void;
  /** Adds my reaction, or removes it if I already reacted with this emoji. */
  react: (message: MessageDTO, emoji: string) => Promise<void>;
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

/** A reply that belongs only to its thread (it was not also sent to the channel). */
const threadOnly = (m: MessageDTO) => !!m.threadRootId && !m.alsoInChannel;

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meId = useMe().user.id;
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const socketRef = useRef<Socket | null>(null);
  const typingSentAt = useRef(new Map<string, number>());
  const readSent = useRef(new Map<string, number>());

  /** Adds a reply to its open thread, once. */
  const addToThread = useCallback(
    (msg: MessageDTO) => {
      if (!msg.threadRootId) return;
      qc.setQueryData<ThreadView>(keys.thread(msg.threadRootId), (v) =>
        v && !v.replies.some((r) => r.id === msg.id)
          ? { ...v, replies: [...v.replies, msg].sort((a, b) => a.seq - b.seq) }
          : v,
      );
    },
    [qc],
  );

  /** Puts a stored message where it belongs: the channel timeline, and/or its thread. Backfills a missed push. */
  const receive = useCallback(
    (msg: MessageDTO) => {
      const key = keys.messages(msg.channelId);
      const view = qc.getQueryData<ChannelView>(key);
      if (msg.threadRootId) addToThread(msg);
      if (view) {
        if (threadOnly(msg)) {
          // It has a channel seq but is not on the timeline: keep gap detection honest.
          qc.setQueryData<ChannelView>(key, (cur) =>
            cur ? { ...cur, lastSeq: Math.max(cur.lastSeq, msg.seq) } : cur,
          );
        } else if (hasGap(view, msg.seq)) {
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
    [qc, addToThread],
  );

  /** A message changed (edit, delete, pin, link preview): update it wherever it is cached. */
  const changed = useCallback(
    (msg: MessageDTO) => patchMessageEverywhere(qc, msg.id, () => msg),
    [qc],
  );

  const onNew = useCallback(
    (msg: MessageDTO) => {
      receive(msg);
      const known = qc
        .getQueryData<MyChannelDTO[]>(keys.channels)
        ?.some((c) => c.id === msg.channelId);
      if (!known) return void qc.invalidateQueries({ queryKey: keys.channels });
      if (msg.threadRootId) void qc.invalidateQueries({ queryKey: keys.threads });
      const looking =
        useMessaging.getState().activeChannelId === msg.channelId && document.hasFocus();
      const mine = msg.authorId === meId;
      const onTimeline = !threadOnly(msg);
      const mentionsMe = msg.mentions.some(
        (x) => (x.type === 'user' && x.id === meId) || x.type === 'channel' || x.type === 'here',
      );
      patchChannel(qc, msg.channelId, (c) => ({
        ...c,
        lastSeq: Math.max(c.lastSeq, msg.seq),
        lastMessageAt: msg.createdAt,
        unread: !onTimeline || mine || looking ? c.unread : c.unread + 1,
        mentionCount:
          onTimeline && !mine && !looking && mentionsMe ? c.mentionCount + 1 : c.mentionCount,
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
      void qc.invalidateQueries({ queryKey: ['messaging', 'thread'] });
      void qc.invalidateQueries({ queryKey: keys.threads });
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

      // Which conversation this tab is looking at: only while the window is focused and visible.
      let lastView: string | null = null;
      const reportView = (force = false) => {
        const looking =
          document.hasFocus() && !document.hidden ? useMessaging.getState().activeChannelId : null;
        if (!force && looking === lastView) return;
        lastView = looking;
        if (socket.connected) socket.emit(C2S.viewUpdate, { channelId: looking });
      };
      const heartbeat = () => {
        const away = document.hidden || Date.now() - lastActivity > 10 * 60_000;
        lastSent = away ? 'away' : 'active';
        if (socket.connected) {
          socket.emit(C2S.presenceUpdate, { state: lastSent });
          // Refreshed with every heartbeat, so a closed laptop stops counting as "viewing".
          reportView(true);
        }
      };
      const unsubscribeView = useMessaging.subscribe((s, prev) => {
        if (s.activeChannelId !== prev.activeChannelId) reportView();
      });
      const onFocusChange = () => reportView();
      window.addEventListener('focus', onFocusChange);
      window.addEventListener('blur', onFocusChange);
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
        // The first connection may be a moment after the list was loaded: anything that changed in
        // between (a channel I was just added to) would otherwise be missed until the next reload.
        else void qc.invalidateQueries({ queryKey: keys.channels });
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

      // Desktop alerts: only if the person turned them on and allowed them, and not while they are looking at it.
      let desktop = false;
      const loadDesktop = () => {
        const cached = qc.getQueryData<PreferencesResponse>(['notification-preferences']);
        if (cached) return void (desktop = cached.desktop);
        void api<PreferencesResponse>('/me/notification-preferences')
          .then((p) => {
            desktop = p.desktop;
          })
          .catch(() => undefined);
      };
      loadDesktop();
      const stopWatching = qc.getQueryCache().subscribe((ev) => {
        if (ev.query.queryKey[0] === 'notification-preferences') loadDesktop();
      });
      socket.on(S2C.notificationNew, (e: NotificationEvent) => {
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        if (
          e.silent ||
          !desktop ||
          typeof Notification === 'undefined' ||
          Notification.permission !== 'granted'
        )
          return;
        const here = useMessaging.getState().activeChannelId === e.channelId && document.hasFocus();
        if (here) return;
        try {
          const n = new Notification('Crew Deck', { body: e.text, tag: e.id });
          n.onclick = () => {
            window.focus();
            routerRef.current.push(e.href);
            n.close();
          };
        } catch {
          /* some browsers only allow notifications from a service worker: the inbox badge still shows it */
        }
      });

      socket.on(S2C.messageNew, onNew);
      socket.on(S2C.messageUpdated, changed);
      socket.on(S2C.messageDeleted, changed);
      socket.on(S2C.reactionUpdated, (e: ReactionEvent) =>
        patchMessageEverywhere(qc, e.messageId, (m) => ({ ...m, reactions: e.reactions })),
      );
      socket.on(S2C.threadUpdated, (e: ThreadEvent) =>
        patchMessageEverywhere(qc, e.rootId, (m) => ({
          ...m,
          replyCount: e.replyCount,
          lastReplyAt: e.lastReplyAt,
          replyAuthors: e.replyAuthors,
        })),
      );
      socket.on(S2C.typing, (e: TypingEvent) =>
        useMessaging.getState().setTyping(e.channelId, e.userId),
      );
      socket.on(S2C.presenceChanged, (e: PresenceEvent) =>
        useMessaging.getState().setPresence(e.userId, e.state),
      );
      socket.on(S2C.presenceBatch, (e: PresenceBatchEvent) => {
        for (const c of e.changes) useMessaging.getState().setPresence(c.userId, c.state);
      });
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
          mentionCount: e.seq >= c.lastSeq ? 0 : c.mentionCount,
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
        window.removeEventListener('focus', onFocusChange);
        window.removeEventListener('blur', onFocusChange);
        unsubscribeView();
        stopWatching();
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [qc, onNew, receive, changed, resync]);

  /** Offers to add mentioned people who are not in the channel. */
  const offerToAdd = useCallback(
    (channelId: string, people: SendResult['notInChannel']) => {
      if (people.length === 0) return;
      const ch = qc.getQueryData<MyChannelDTO[]>(keys.channels)?.find((c) => c.id === channelId);
      const names = people.map((p) => personName(p).split(' ')[0]).join(', ');
      const canAdd = ch?.type === 'public' || ch?.role === 'owner';
      if (!canAdd) {
        toast.info(`${names} ${people.length === 1 ? 'is' : 'are'} not in this private channel`, {
          description: 'Ask a channel owner to add them so they can see your message.',
        });
        return;
      }
      toast(`${names} ${people.length === 1 ? 'is' : 'are'} not in this channel`, {
        description: 'They will not see your message unless you add them.',
        action: {
          label: 'Add',
          onClick: () =>
            void api(`/channels/${channelId}/members`, {
              method: 'POST',
              body: { userIds: people.map((p) => p.id) },
            })
              .then(() => toast.success('Added'))
              .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Could not add them')),
        },
      });
    },
    [qc],
  );

  const deliver = useCallback(
    async (clientMsgId: string) => {
      const store = useMessaging.getState();
      const p = Object.values(store.pending)
        .flat()
        .find((x) => x.clientMsgId === clientMsgId);
      if (!p) return;
      store.updatePending(clientMsgId, { status: 'sending', error: undefined });
      const payload = {
        channelId: p.channelId,
        clientMsgId,
        body: p.body,
        ...(p.attachmentIds?.length ? { attachmentIds: p.attachmentIds } : {}),
        ...(p.threadRootId
          ? { threadRootId: p.threadRootId, alsoInChannel: !!p.alsoInChannel }
          : {}),
      };
      try {
        const socket = socketRef.current;
        let result: SendResult;
        if (socket?.connected) {
          const ack = (await socket
            .timeout(SEND_TIMEOUT_MS)
            .emitWithAck(C2S.messageSend, payload)) as Ack<SendResult>;
          if (!ack.ok) throw new SendError(ack.message);
          result = ack.data;
        } else {
          // Not connected: the REST endpoint is idempotent on the same client id, so this cannot duplicate.
          result = await api<SendResult>(
            p.threadRootId
              ? `/messages/${p.threadRootId}/replies`
              : `/channels/${p.channelId}/messages`,
            {
              method: 'POST',
              body: {
                clientMsgId,
                body: p.body,
                attachmentIds: p.attachmentIds,
                alsoInChannel: p.alsoInChannel,
              },
            },
          );
        }
        const message = result.message;
        receive(message);
        if (!threadOnly(message)) {
          patchChannel(qc, message.channelId, (c) => ({
            ...c,
            lastSeq: Math.max(c.lastSeq, message.seq),
            lastReadSeq: Math.max(c.lastReadSeq, message.seq),
            lastMessageAt: message.createdAt,
            unread: 0,
            mentionCount: 0,
          }));
        }
        offerToAdd(message.channelId, result.notInChannel ?? []);
      } catch (e) {
        // The server said no (archived, no permission, too long): show its words. Otherwise it timed out.
        const reason =
          e instanceof SendError || e instanceof ApiError
            ? e.message
            : 'Not sent. Check your connection and try again.';
        useMessaging.getState().updatePending(clientMsgId, { status: 'failed', error: reason });
      }
    },
    [qc, receive, offerToAdd],
  );

  const api2 = useMemo<RealtimeApi>(
    () => ({
      send: async (channelId, body, text, opts = {}) => {
        const clientMsgId = crypto.randomUUID();
        useMessaging.getState().addPending({
          clientMsgId,
          channelId,
          body,
          text,
          threadRootId: opts.threadRootId,
          alsoInChannel: opts.alsoInChannel,
          attachmentIds: opts.files?.map((f) => f.id),
          files: opts.files,
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
          mentionCount: seq >= c.lastSeq ? 0 : c.mentionCount,
        }));
        const socket = socketRef.current;
        if (socket?.connected) socket.emit(C2S.readUpdate, { channelId, seq });
        else
          void api(`/channels/${channelId}/read`, { method: 'PUT', body: { seq } }).catch(
            () => undefined,
          );
      },
      react: async (message, emoji) => {
        const has = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId);
        // Optimistic: the chip moves at once, and the server's answer (or a refetch on failure) settles it.
        patchMessageEverywhere(qc, message.id, (m) => {
          const rest = m.reactions.filter((r) => r.emoji !== emoji);
          const cur = m.reactions.find((r) => r.emoji === emoji);
          if (has) {
            const next =
              cur && cur.count > 1
                ? [
                    {
                      ...cur,
                      count: cur.count - 1,
                      userIds: cur.userIds.filter((id) => id !== meId),
                    },
                  ]
                : [];
            return {
              ...m,
              reactions: cur ? m.reactions.flatMap((r) => (r.emoji === emoji ? next : [r])) : rest,
            };
          }
          const added = {
            emoji,
            count: (cur?.count ?? 0) + 1,
            userIds: [...(cur?.userIds ?? []), meId],
          };
          return {
            ...m,
            reactions: cur
              ? m.reactions.map((r) => (r.emoji === emoji ? added : r))
              : [...m.reactions, added],
          };
        });
        try {
          const res = await api<{ reactions: MessageDTO['reactions'] }>(
            `/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`,
            { method: has ? 'DELETE' : 'PUT' },
          );
          patchMessageEverywhere(qc, message.id, (m) => ({ ...m, reactions: res.reactions }));
        } catch (e) {
          patchMessageEverywhere(qc, message.id, (m) => ({ ...m, reactions: message.reactions }));
          toast.error(e instanceof ApiError ? e.message : 'Could not add the reaction');
        }
      },
    }),
    [qc, deliver, meId],
  );

  return <Ctx.Provider value={api2}>{children}</Ctx.Provider>;
}
