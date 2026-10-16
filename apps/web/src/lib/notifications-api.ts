'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type { Person } from '@/lib/work';

export type NotificationType =
  | 'assigned'
  | 'mentioned'
  | 'commented'
  | 'status_changed'
  | 'due_soon'
  | 'ticket_received'
  | 'sla_due_soon'
  | 'sla_breached'
  | 'sprint_started'
  | 'sprint_completed'
  | 'dm'
  | 'mention'
  | 'thread_reply'
  | 'channel_message'
  | 'added_to_channel';

export interface AppNotification {
  id: string;
  type: NotificationType;
  itemId: string | null;
  data: {
    key?: string;
    title?: string;
    spaceKey?: string;
    excerpt?: string | null;
    from?: string;
    to?: string;
    sprint?: string;
    // Chat
    channelId?: string;
    channelName?: string | null;
    channelType?: string;
    seq?: string;
    threadRootId?: string | null;
  };
  text: string;
  actor: Person | null;
  readAt: string | null;
  createdAt: string;
}

export type Preferences = Record<NotificationType, { inApp: boolean; email: boolean }>;

export const TYPE_LABELS: Record<NotificationType, string> = {
  assigned: 'Something is assigned to me',
  mentioned: 'Someone mentions me',
  commented: 'A comment on something I watch',
  status_changed: 'The status changes on something I reported or am assigned',
  due_soon: 'My work is due today or tomorrow',
  ticket_received: 'A ticket is raised in a service desk I run',
  sla_due_soon: 'A ticket is close to its deadline',
  sla_breached: 'A ticket misses its deadline',
  sprint_started: 'A sprint starts in my space',
  sprint_completed: 'A sprint completes in my space',
  dm: 'Someone sends me a direct message',
  mention: 'Someone mentions me (or @channel, @here, or my group) in a channel',
  thread_reply: 'Someone replies in a thread I follow',
  channel_message: 'A new message in a channel I set to every message',
  added_to_channel: 'I am added to a channel',
};

/** Where a notification leads. */
export const hrefOf = (n: AppNotification) =>
  n.data.channelId
    ? `/messages/${n.data.channelId}${n.data.seq ? `?m=${n.data.seq}` : ''}${n.data.threadRootId ? `${n.data.seq ? '&' : '?'}thread=${n.data.threadRootId}` : ''}`
    : n.data.key && n.data.spaceKey
      ? `/spaces/${n.data.spaceKey}/items/${n.data.key}`
      : n.data.spaceKey
        ? `/spaces/${n.data.spaceKey}/backlog`
        : '/notifications';

/** The unread count for the bell. Refreshes on focus and every minute (live updates refresh it sooner). */
export const useUnreadCount = () =>
  useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api<{ unread: number }>('/notifications/count'),
    refetchInterval: 60_000,
  });

export const useNotifications = (unreadOnly: boolean) =>
  useInfiniteQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<{ items: AppNotification[]; unreadCount: number; nextCursor: string | null }>(
        `/notifications${qs({ unread: unreadOnly ? '1' : undefined, cursor: pageParam || undefined, limit: 30 })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) =>
      api<{ updated: number }>('/notifications/read', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export interface PreferencesResponse {
  preferences: Preferences;
  digest: boolean;
  quiet: { enabled: boolean; start: string; end: string };
  emailDelayMinutes: number;
  desktop: boolean;
}

export const usePreferences = () =>
  useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<PreferencesResponse>('/me/notification-preferences'),
  });

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      preferences?: Partial<Preferences>;
      digest?: boolean;
      quiet?: PreferencesResponse['quiet'];
      emailDelayMinutes?: number;
      desktop?: boolean;
    }) => api<PreferencesResponse>('/me/notification-preferences', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(['notification-preferences'], data),
  });
}
