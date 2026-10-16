'use client';

import { create } from 'zustand';
import type { PresenceState } from '@crew-deck/shared';
import type { MessageDoc } from '@/lib/messaging-api';

/**
 * Live, non-persistent state: the connection, who is typing, presence and messages that are on their
 * way. Message history itself lives in the React Query cache so the list, search and (later) threads
 * share one copy.
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface PendingMessage {
  clientMsgId: string;
  channelId: string;
  body: MessageDoc;
  text: string;
  status: 'sending' | 'failed';
  error?: string;
  createdAt: number;
}

interface MessagingState {
  status: ConnectionStatus;
  /** channelId -> userId -> when the "typing" signal expires (ms). */
  typing: Record<string, Record<string, number>>;
  presence: Record<string, PresenceState>;
  pending: Record<string, PendingMessage[]>;
  /** The conversation the person is looking at, so it does not count as unread. */
  activeChannelId: string | null;
  setStatus: (s: ConnectionStatus) => void;
  setActive: (id: string | null) => void;
  setTyping: (channelId: string, userId: string, ttlMs?: number) => void;
  clearTyping: (channelId: string, userId: string) => void;
  setPresence: (userId: string, state: PresenceState) => void;
  addPending: (m: PendingMessage) => void;
  updatePending: (clientMsgId: string, patch: Partial<PendingMessage>) => void;
  removePending: (clientMsgId: string) => void;
}

export const useMessaging = create<MessagingState>((set) => ({
  status: 'connecting',
  typing: {},
  presence: {},
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
export const usePendingFor = (channelId: string) =>
  useMessaging((s) => s.pending[channelId] ?? EMPTY);
