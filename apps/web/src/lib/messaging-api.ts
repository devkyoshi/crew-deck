'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ChannelDTO,
  MessageDTO,
  MyChannelDTO,
  NotificationLevel,
  PersonDTO,
  PresenceState,
} from '@crew-deck/shared';
import { api, qs, type Member, type Page } from '@/lib/api';
import { mergeMessages, type ChannelView } from '@/lib/messaging-logic';
import { useHydrated } from '@/components/checkin/use-hydrated';

export {
  conversationName,
  hasGap,
  mergeMessages,
  personName,
  type ChannelView,
} from '@/lib/messaging-logic';
export type { ChannelDTO, MessageDTO, MyChannelDTO, NotificationLevel, PersonDTO, PresenceState };

/** A document in the Tiptap / ProseMirror JSON subset the API accepts. */
export type MessageDoc = { type: 'doc'; content?: unknown[] };

export interface ChannelMember {
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  person: PersonDTO | null;
}

export interface BrowsedChannel extends ChannelDTO {
  joined: boolean;
}

export interface PresenceInfo {
  id: string;
  state: PresenceState;
  status: { emoji: string | null; text: string | null; expiresAt: string | null } | null;
}

// ---- Keys --------------------------------------------------------------------------------------------

export const keys = {
  channels: ['messaging', 'channels'] as const,
  messages: (channelId: string) => ['messaging', 'messages', channelId] as const,
  members: (channelId: string) => ['messaging', 'members', channelId] as const,
  browse: (search: string) => ['messaging', 'browse', search] as const,
  people: (search: string) => ['messaging', 'people', search] as const,
  presence: (ids: string) => ['messaging', 'presence', ids] as const,
};

// ---- Pure helpers on the cached view ----------------------------------------------------------------

// ---- Queries -----------------------------------------------------------------------------------------

export const useChannels = () =>
  useQuery({
    queryKey: keys.channels,
    queryFn: async () => (await api<{ channels: MyChannelDTO[] }>('/channels')).channels,
    staleTime: 60_000,
  });

/** The channel from my list, or (for a public channel I have not joined) fetched for preview. */
export function useChannel(id: string) {
  const list = useChannels();
  const mine = list.data?.find((c) => c.id === id) ?? null;
  const fetched = useQuery({
    queryKey: ['messaging', 'channel', id],
    queryFn: async () =>
      (await api<{ channel: ChannelDTO | MyChannelDTO }>(`/channels/${id}`)).channel,
    enabled: list.isSuccess && !mine,
    retry: false,
  });
  return {
    channel: (mine ?? fetched.data ?? null) as (ChannelDTO & Partial<MyChannelDTO>) | null,
    isMember: !!mine,
    isLoading: list.isLoading || (!mine && fetched.isLoading),
    error: !mine && fetched.isError ? fetched.error : null,
  };
}

export async function fetchView(
  channelId: string,
  query: Record<string, number | undefined> = {},
): Promise<ChannelView> {
  const r = await api<{
    messages: MessageDTO[];
    lastSeq: number;
    hasOlder: boolean;
    hasNewer: boolean;
  }>(`/channels/${channelId}/messages${qs({ limit: 50, ...query })}`);
  return { messages: r.messages, lastSeq: r.lastSeq, hasOlder: r.hasOlder, hasNewer: r.hasNewer };
}

export const useMessages = (channelId: string) =>
  useQuery({
    queryKey: keys.messages(channelId),
    queryFn: () => fetchView(channelId),
    // Live events keep it current; a reconnect refetches the open conversation.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });

export async function loadOlder(qc: QueryClient, channelId: string) {
  const view = qc.getQueryData<ChannelView>(keys.messages(channelId));
  const first = view?.messages[0];
  if (!view || !first || !view.hasOlder) return;
  const older = await fetchView(channelId, { before_seq: first.seq });
  qc.setQueryData<ChannelView>(keys.messages(channelId), (cur) =>
    cur ? { ...mergeMessages(cur, older.messages), hasOlder: older.hasOlder } : cur,
  );
}

export const useMembers = (channelId: string, enabled = true) =>
  useQuery({
    queryKey: keys.members(channelId),
    queryFn: async () =>
      (await api<{ members: ChannelMember[] }>(`/channels/${channelId}/members`)).members,
    enabled,
  });

export const useBrowse = (search: string, enabled = true) =>
  useQuery({
    queryKey: keys.browse(search),
    queryFn: async () =>
      (
        await api<{ channels: BrowsedChannel[] }>(
          `/channels/browse${qs({ search: search || undefined })}`,
        )
      ).channels,
    enabled,
  });

/** Active members of the workspace, for pickers. */
export const usePeople = (search: string, enabled = true) =>
  useQuery({
    queryKey: keys.people(search),
    queryFn: async () =>
      (
        await api<Page<Member>>(
          `/members${qs({ q: search || undefined, status: 'active', pageSize: 50 })}`,
        )
      ).items,
    enabled,
    staleTime: 60_000,
  });

export const usePresence = (ids: string[]) => {
  const key = [...new Set(ids)].sort().slice(0, 100).join(',');
  return useQuery({
    queryKey: keys.presence(key),
    queryFn: async () =>
      (await api<{ people: PresenceInfo[] }>(`/presence${qs({ ids: key })}`)).people,
    enabled: key.length > 0,
    staleTime: 30_000,
  });
};

// ---- Mutations ---------------------------------------------------------------------------------------

/** Mutations whose result changes the channel list simply refetch it. */
function useChannelMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.channels }),
  });
}

export const useCreateChannel = () =>
  useChannelMutation(
    (body: {
      name: string;
      type: 'public' | 'private';
      topic?: string | null;
      description?: string | null;
      isAnnouncement?: boolean;
      memberIds?: string[];
    }) => api<{ channel: ChannelDTO }>('/channels', { method: 'POST', body }),
  );

export const useOpenDm = () =>
  useChannelMutation((userIds: string[]) =>
    api<{ channel: ChannelDTO }>('/dms', { method: 'POST', body: { userIds } }),
  );

export const useJoinChannel = () =>
  useChannelMutation((id: string) => api<void>(`/channels/${id}/join`, { method: 'POST' }));

export const useLeaveChannel = () =>
  useChannelMutation((id: string) => api<void>(`/channels/${id}/leave`, { method: 'POST' }));

export const useUpdateChannel = () =>
  useChannelMutation(
    (v: { id: string; topic?: string | null; description?: string | null; name?: string }) => {
      const { id, ...body } = v;
      return api<{ channel: ChannelDTO }>(`/channels/${id}`, { method: 'PATCH', body });
    },
  );

export const useArchiveChannel = () =>
  useChannelMutation((v: { id: string; archived: boolean }) =>
    api<{ channel: ChannelDTO }>(`/channels/${v.id}/${v.archived ? 'archive' : 'unarchive'}`, {
      method: 'POST',
    }),
  );

export const useDeleteChannel = () =>
  useChannelMutation((id: string) => api<void>(`/channels/${id}`, { method: 'DELETE' }));

export function useAddMembers(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<{ added: number }>(`/channels/${channelId}/members`, {
        method: 'POST',
        body: { userIds },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members(channelId) });
      void qc.invalidateQueries({ queryKey: keys.channels });
    },
  });
}

export function useRemoveMember(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/channels/${channelId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members(channelId) });
      void qc.invalidateQueries({ queryKey: keys.channels });
    },
  });
}

export function useSetMemberRole(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; role: 'owner' | 'member' }) =>
      api<void>(`/channels/${channelId}/members/${v.userId}`, {
        method: 'PATCH',
        body: { role: v.role },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.members(channelId) }),
  });
}

export function useUpdateMyMembership(channelId: string) {
  return useChannelMutation(
    (body: {
      notificationLevel?: NotificationLevel;
      mutedUntil?: string | null;
      isStarred?: boolean;
    }) => api<void>(`/channels/${channelId}/me`, { method: 'PATCH', body }),
  );
}

export const useEditMessage = () =>
  useMutation({
    mutationFn: (v: { id: string; body: MessageDoc }) =>
      api<{ message: MessageDTO }>(`/messages/${v.id}`, {
        method: 'PATCH',
        body: { body: v.body },
      }),
  });

export const useDeleteMessage = () =>
  useMutation({
    mutationFn: (id: string) =>
      api<{ message: MessageDTO }>(`/messages/${id}`, { method: 'DELETE' }),
  });

export const useMarkUnread = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ channelId: string; lastReadSeq: number }>(`/messages/${id}/unread`, { method: 'PUT' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.channels }),
  });
};

export const useReadAll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ channels: number }>('/me/read-all', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.channels }),
  });
};

// ---- Display helpers ---------------------------------------------------------------------------------

/** A message's text as a plain string, for previews and the clipboard. */
export const previewOf = (m: MessageDTO) =>
  m.deletedAt ? 'This message was deleted' : (m.bodyText ?? '');

/** UI mirror of the server's can() for channels. The API still enforces every action. */
export function channelPerms(
  channel: Pick<ChannelDTO, 'type' | 'isArchived' | 'isAnnouncement'> & {
    role?: 'owner' | 'member';
  },
  isAdmin: boolean,
) {
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const member = !!channel.role;
  const owner = channel.role === 'owner';
  return {
    isDm,
    member,
    owner,
    canPost: member && !channel.isArchived && (!channel.isAnnouncement || owner || isAdmin),
    canManage: !isDm && (isAdmin || owner),
    canDeleteChannel: !isDm && isAdmin,
    canModerate: !isDm && (owner || (isAdmin && (channel.type === 'public' || member))),
    canLeave: member && channel.type !== 'dm',
  };
}

/** For the sidebar: unread direct messages (a count) and how many channels have unread messages. */
export function useUnreadSummary() {
  // Nothing on the first client render, so it matches the server HTML even when the cache is already full.
  const hydrated = useHydrated();
  const list = useChannels().data;
  if (!hydrated) return { dms: 0, channels: 0 };
  let dms = 0;
  let channels = 0;
  for (const c of list ?? []) {
    if (c.unread <= 0 || c.notificationLevel === 'none') continue;
    if (c.type === 'dm' || c.type === 'group_dm') dms += c.unread;
    else channels += 1;
  }
  return { dms, channels };
}
