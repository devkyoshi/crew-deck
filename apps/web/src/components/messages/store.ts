'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import type { CheckinBadge, PresenceState } from '@crew-deck/shared';
import type { AttachmentDTO } from '@crew-deck/shared';
import type { MessageDoc } from '@/lib/messaging-api';

/**
 * Live, non-persistent state: the connection, who is typing, presence and messages that are on their
 * way. Message history itself lives in the React Query cache so the list, search and (later) threads
 * share one copy.
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** A person's custom status line, as the presence lookups last reported it. */
export interface CustomStatus {
  emoji: string | null;
  text: string | null;
  expiresAt: string | null;
}

export interface PendingMessage {
  clientMsgId: string;
  channelId: string;
  body: MessageDoc;
  text: string;
  /** Set for replies: the pending message belongs to this thread, not the channel timeline. */
  threadRootId?: string;
  alsoInChannel?: boolean;
  attachmentIds?: string[];
  /** The files being sent, for showing them while the message is on its way. */
  files?: AttachmentDTO[];
  status: 'sending' | 'failed';
  error?: string;
  createdAt: number;
}

interface MessagingState {
  status: ConnectionStatus;
  /** channelId -> userId -> when the "typing" signal expires (ms). */
  typing: Record<string, Record<string, number>>;
  presence: Record<string, PresenceState>;
  /** Where people work today (status only). */
  checkin: Record<string, CheckinBadge | null>;
  /** Custom status lines by user (null when they have none). */
  customStatus: Record<string, CustomStatus | null>;
  pending: Record<string, PendingMessage[]>;
  /** The conversation the person is looking at, so it does not count as unread. */
  activeChannelId: string | null;
  setStatus: (s: ConnectionStatus) => void;
  setActive: (id: string | null) => void;
  setTyping: (channelId: string, userId: string, ttlMs?: number) => void;
  clearTyping: (channelId: string, userId: string) => void;
  setPresence: (userId: string, state: PresenceState) => void;
  setCheckin: (userId: string, badge: CheckinBadge | null) => void;
  setCustomStatus: (userId: string, status: CustomStatus | null) => void;
  addPending: (m: PendingMessage) => void;
  updatePending: (clientMsgId: string, patch: Partial<PendingMessage>) => void;
  removePending: (clientMsgId: string) => void;
}

export const useMessaging = create<MessagingState>((set) => ({
  status: 'connecting',
  typing: {},
  presence: {},
  checkin: {},
  customStatus: {},
  pending: {},
  activeChannelId: null,
  setStatus: (status) => set({ status }),
  setActive: (activeChannelId) => set({ activeChannelId }),
  setTyping: (channelId, userId, ttlMs = 5000) =>
    set((s) => ({
      typing: {
        ...s.typing,
        [channelId]: { ...s.typing[channelId], [userId]: Date.now() + ttlMs },
      },
    })),
  clearTyping: (channelId, userId) =>
    set((s) => {
      const room = { ...s.typing[channelId] };
      delete room[userId];
      return { typing: { ...s.typing, [channelId]: room } };
    }),
  setPresence: (userId, state) => set((s) => ({ presence: { ...s.presence, [userId]: state } })),
  setCheckin: (userId, badge) => set((s) => ({ checkin: { ...s.checkin, [userId]: badge } })),
  setCustomStatus: (userId, status) =>
    set((s) => ({ customStatus: { ...s.customStatus, [userId]: status } })),
  addPending: (m) =>
    set((s) => ({
      pending: { ...s.pending, [m.channelId]: [...(s.pending[m.channelId] ?? []), m] },
    })),
  updatePending: (clientMsgId, patch) =>
    set((s) => ({
      pending: Object.fromEntries(
        Object.entries(s.pending).map(([ch, list]) => [
          ch,
          list.map((p) => (p.clientMsgId === clientMsgId ? { ...p, ...patch } : p)),
        ]),
      ),
    })),
  removePending: (clientMsgId) =>
    set((s) => ({
      pending: Object.fromEntries(
        Object.entries(s.pending).map(([ch, list]) => [
          ch,
          list.filter((p) => p.clientMsgId !== clientMsgId),
        ]),
      ),
    })),
}));

const EMPTY: PendingMessage[] = [];
/** Pending messages of a channel's timeline (thread replies are shown in their thread instead). */
export const usePendingFor = (channelId: string) => {
  const all = useMessaging((s) => s.pending[channelId]) ?? EMPTY;
  return useMemo(() => all.filter((p) => !p.threadRootId || p.alsoInChannel), [all]);
};
export const usePendingInThread = (channelId: string, rootId: string) => {
  const all = useMessaging((s) => s.pending[channelId]) ?? EMPTY;
  return useMemo(() => all.filter((p) => p.threadRootId === rootId), [all, rootId]);
};
