'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ActivityRulesDTO,
  CheckinBadge,
  CommandResult,
  CreateFromMessageResult,
  ItemCardDTO,
  SlashCommandDTO,
  ParsedSearch,
  SearchHit,
  SidebarSectionDTO,
  AttachmentDTO,
  ChannelDTO,
  MessageDTO,
  MyChannelDTO,
  NotificationLevel,
  PersonDTO,
  PresenceState,
} from '@crew-deck/shared';
import { api, ApiError, qs, type Member, type Page } from '@/lib/api';
import { mergeMessages, type ChannelView } from '@/lib/messaging-logic';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { useMe } from '@/components/shell/me-context';

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
  /** Where they work today, as a status only. */
  checkin: CheckinBadge | null;
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
  thread: (rootId: string) => ['messaging', 'thread', rootId] as const,
  pins: (channelId: string) => ['messaging', 'pins', channelId] as const,
  files: (channelId: string) => ['messaging', 'files', channelId] as const,
  saved: ['messaging', 'saved'] as const,
  threads: ['messaging', 'threads'] as const,
  sections: ['messaging', 'sections'] as const,
  activity: ['messaging', 'activity'] as const,
  search: (q: string, page: number) => ['messaging', 'search', q, page] as const,
  searchFiles: (q: string) => ['messaging', 'search-files', q] as const,
};

/** A thread: its root message and replies (oldest first). */
export interface ThreadView {
  root: MessageDTO;
  replies: MessageDTO[];
  hasMore: boolean;
  following: boolean;
  lastReadSeq: number;
}

export interface SavedItem {
  message: MessageDTO;
  channel: { id: string; type: ChannelDTO['type']; name: string | null };
  savedAt: string;
}

export interface ChannelFile extends AttachmentDTO {
  messageId: string;
  seq: number | null;
  uploader: PersonDTO | null;
  createdAt: string;
}

export interface ThreadSummary {
  root: MessageDTO;
  unread: number;
  latestReply: MessageDTO | null;
}

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
    historyLimited?: boolean;
  }>(`/channels/${channelId}/messages${qs({ limit: 50, ...query })}`);
  return {
    messages: r.messages,
    lastSeq: r.lastSeq,
    hasOlder: r.hasOlder,
    hasNewer: r.hasNewer,
    historyLimited: r.historyLimited === true,
  };
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
    cur
      ? {
          ...mergeMessages(cur, older.messages),
          hasOlder: older.hasOlder,
          historyLimited: older.historyLimited,
        }
      : cur,
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
  channel: Pick<ChannelDTO, 'type' | 'isArchived' | 'isAnnouncement' | 'readOnly'> & {
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
    isArchived: channel.isArchived,
    canPost:
      member &&
      !channel.isArchived &&
      !channel.readOnly &&
      (!channel.isAnnouncement || owner || isAdmin),
    canManage: !isDm && (isAdmin || owner),
    canDeleteChannel: !isDm && isAdmin,
    canModerate: !isDm && (owner || (isAdmin && (channel.type === 'public' || member))),
    canLeave: member && channel.type !== 'dm',
    /** Reacting and replying in a thread stay open to members of announcement channels. */
    canReact: member && !channel.isArchived,
    canReply: member && !channel.isArchived && !channel.readOnly,
    canPin: member && !channel.isArchived && (isDm || owner || isAdmin),
  };
}

/** Whether I may create channels here: everyone, unless the workspace limited it to admins. */
export function useCanCreateChannel() {
  const me = useMe();
  return me.chat.channelCreation === 'all' || me.orgRole !== 'member';
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
    if (c.notificationLevel === 'none') continue;
    // Mentions count like direct messages: they are addressed to me.
    dms += c.mentionCount;
    if (c.unread <= 0) continue;
    if (c.type === 'dm' || c.type === 'group_dm') dms += c.unread;
    else channels += 1;
  }
  return { dms, channels };
}

// ---- Threads, pins, saved and files --------------------------------------------------------------------

export const useThread = (rootId: string | null) =>
  useQuery({
    queryKey: keys.thread(rootId ?? ''),
    queryFn: () => api<ThreadView>(`/messages/${rootId}/replies`),
    enabled: !!rootId,
    staleTime: Infinity,
  });

export const usePins = (channelId: string, enabled = true) =>
  useQuery({
    queryKey: keys.pins(channelId),
    queryFn: async () => (await api<{ pins: MessageDTO[] }>(`/channels/${channelId}/pins`)).pins,
    enabled,
  });

export const useSaved = () =>
  useQuery({
    queryKey: keys.saved,
    queryFn: async () => (await api<{ saved: SavedItem[] }>('/me/saved')).saved,
    staleTime: 60_000,
  });

export const useChannelFiles = (channelId: string, enabled = true) =>
  useQuery({
    queryKey: keys.files(channelId),
    queryFn: async () =>
      (await api<{ files: ChannelFile[] }>(`/channels/${channelId}/files`)).files,
    enabled,
  });

export const useThreadsList = () =>
  useQuery({
    queryKey: keys.threads,
    queryFn: async () => (await api<{ threads: ThreadSummary[] }>('/threads')).threads,
    staleTime: 30_000,
  });

/**
 * Applies a change to one message wherever it is cached: the channel timeline, an open thread (as root or
 * reply), the pin list and the saved list. Used for reactions, pins and edits arriving live.
 */
export function patchMessageEverywhere(
  qc: QueryClient,
  messageId: string,
  fn: (m: MessageDTO) => MessageDTO,
) {
  const touch = (m: MessageDTO) => (m.id === messageId ? fn(m) : m);
  qc.setQueriesData<ChannelView>({ queryKey: ['messaging', 'messages'] }, (v) =>
    v && v.messages.some((m) => m.id === messageId) ? { ...v, messages: v.messages.map(touch) } : v,
  );
  qc.setQueriesData<ThreadView>({ queryKey: ['messaging', 'thread'] }, (v) =>
    v && (v.root.id === messageId || v.replies.some((m) => m.id === messageId))
      ? { ...v, root: touch(v.root), replies: v.replies.map(touch) }
      : v,
  );
  qc.setQueriesData<MessageDTO[]>({ queryKey: ['messaging', 'pins'] }, (v) =>
    v?.some((m) => m.id === messageId) ? v.map(touch) : v,
  );
  qc.setQueriesData<SavedItem[]>({ queryKey: keys.saved }, (v) =>
    v?.some((s) => s.message.id === messageId)
      ? v.map((s) => ({ ...s, message: touch(s.message) }))
      : v,
  );
}

export function useSetPinned(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { messageId: string; pinned: boolean }) =>
      v.pinned
        ? api<{ message: MessageDTO }>(`/channels/${channelId}/pins`, {
            method: 'POST',
            body: { messageId: v.messageId },
          })
        : api<{ message: MessageDTO }>(`/channels/${channelId}/pins/${v.messageId}`, {
            method: 'DELETE',
          }),
    onSuccess: ({ message }) => {
      patchMessageEverywhere(qc, message.id, () => message);
      void qc.invalidateQueries({ queryKey: keys.pins(channelId) });
    },
  });
}

export function useSetSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { messageId: string; saved: boolean }) =>
      api<{ saved: boolean }>(`/me/saved/${v.messageId}`, { method: v.saved ? 'PUT' : 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.saved }),
  });
}

/** The ids of the messages I saved, for the star on each message. */
export function useSavedIds() {
  const hydrated = useHydrated();
  const saved = useSaved().data;
  return new Set(hydrated ? (saved ?? []).map((s) => s.message.id) : []);
}

export function useSetFollow(rootId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (follow: boolean) =>
      api<{ following: boolean }>(`/messages/${rootId}/follow`, {
        method: follow ? 'PUT' : 'DELETE',
      }),
    onSuccess: ({ following }) => {
      qc.setQueryData<ThreadView>(keys.thread(rootId), (v) => (v ? { ...v, following } : v));
      void qc.invalidateQueries({ queryKey: keys.threads });
    },
  });
}

/** Uploads one file for a channel. Reports progress and can be cancelled. Resolves with the unsent file. */
export function uploadChannelFile(
  channelId: string,
  file: File,
  opts: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<AttachmentDTO> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/channels/${channelId}/uploads`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { file?: AttachmentDTO; message?: string; code?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.file) return resolve(data.file);
      if (xhr.status === 401) window.location.assign('/sign-in');
      reject(
        new ApiError(
          xhr.status,
          data?.code ?? 'error',
          data?.message ?? 'Could not upload that file',
        ),
      );
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'network', 'Could not upload. Check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    opts.signal?.addEventListener('abort', () => xhr.abort());
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export const discardUpload = (fileId: string) =>
  api<void>(`/uploads/${fileId}`, { method: 'DELETE' }).catch(() => undefined);

// ---- Mention suggestions -------------------------------------------------------------------------------------

export interface Mentionable {
  kind: 'user' | 'group' | 'channel' | 'here';
  id: string;
  label: string;
  sub?: string;
  avatarUrl?: string | null;
}

/** People, groups, and @channel / @here matching what was typed after the @. */
export async function searchMentionables(query: string): Promise<Mentionable[]> {
  const q = query.trim();
  const [people, groups] = await Promise.all([
    api<Page<Member>>(`/members${qs({ q: q || undefined, status: 'active', pageSize: 6 })}`).catch(
      () => null,
    ),
    api<{ items: { id: string; name: string; memberCount: number }[] }>(
      `/groups${qs({ q: q || undefined, pageSize: 3 })}`,
    ).catch(() => null),
  ]);
  // Names that start with what was typed (first or last name) come before names that merely contain it.
  const starts = (m: Member) =>
    q === '' ||
    (m.name ?? m.email)
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.startsWith(q.toLowerCase()));
  const ranked = [...(people?.items ?? [])].sort((a, b) => Number(starts(b)) - Number(starts(a)));
  const out: Mentionable[] = ranked.map((m) => ({
    kind: 'user',
    id: m.id,
    label: m.name ?? m.email,
    sub: m.jobTitle ?? m.email,
    avatarUrl: m.avatarUrl,
  }));
  for (const g of groups?.items ?? []) {
    out.push({ kind: 'group', id: g.id, label: g.name, sub: `Group · ${g.memberCount} people` });
  }
  const special: Mentionable[] = [
    { kind: 'channel', id: 'channel', label: 'channel', sub: 'Notify everyone in this channel' },
    { kind: 'here', id: 'here', label: 'here', sub: 'Notify people who are online' },
  ];
  out.push(...special.filter((s) => !q || s.label.startsWith(q.toLowerCase())));
  return out.slice(0, 10);
}

// ---- Search, activity, sections, status ----------------------------------------------------------------------

export interface SearchResponse {
  hits: SearchHit[];
  parsed: ParsedSearch;
  unresolved: string[];
  page: number;
  hasMore: boolean;
}

export interface SearchFile extends AttachmentDTO {
  channel: { id: string; type: ChannelDTO['type']; name: string | null };
  messageId: string;
  seq: number | null;
  createdAt: string;
}

export const useMessageSearch = (q: string, page: number) =>
  useQuery({
    queryKey: keys.search(q, page),
    queryFn: () => api<SearchResponse>(`/search/messages${qs({ q, page })}`),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  });

export const useFileSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: keys.searchFiles(q),
    queryFn: async () => (await api<{ files: SearchFile[] }>(`/search/files${qs({ q })}`)).files,
    enabled: enabled && q.trim().length > 0,
    staleTime: 30_000,
  });

export interface ActivityItem {
  kind: 'mention' | 'reaction';
  at: string;
  message: MessageDTO;
  channel: { id: string; type: ChannelDTO['type']; name: string | null };
  by: PersonDTO | null;
  emoji?: string;
}

export const useActivity = () =>
  useQuery({
    queryKey: keys.activity,
    queryFn: async () => (await api<{ items: ActivityItem[] }>('/me/activity')).items,
    staleTime: 30_000,
  });

export const useSections = () =>
  useQuery({
    queryKey: keys.sections,
    queryFn: async () =>
      (await api<{ sections: SidebarSectionDTO[] }>('/me/sidebar-sections')).sections,
    staleTime: 5 * 60_000,
  });

export function useSectionMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.sections });
    void qc.invalidateQueries({ queryKey: keys.channels });
  };
  return {
    create: useMutation({
      mutationFn: (name: string) =>
        api<{ section: SidebarSectionDTO }>('/me/sidebar-sections', {
          method: 'POST',
          body: { name },
        }),
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) =>
        api(`/me/sidebar-sections/${v.id}`, { method: 'PATCH', body: { name: v.name } }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/me/sidebar-sections/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    /** Saves the section order and/or moves channels between sections. */
    order: useMutation({
      mutationFn: (body: { sections?: string[]; assign?: Record<string, string | null> }) =>
        api<{ sections: SidebarSectionDTO[] }>('/me/sidebar-order', { method: 'PUT', body }),
      onMutate: async (body) => {
        // Show the new order at once; the server's answer settles it.
        if (body.sections) {
          qc.setQueryData<SidebarSectionDTO[]>(keys.sections, (cur) =>
            cur
              ? body.sections!.map((id, position) => ({
                  ...cur.find((s) => s.id === id)!,
                  position,
                }))
              : cur,
          );
        }
        if (body.assign) {
          qc.setQueryData<MyChannelDTO[]>(keys.channels, (cur) =>
            cur?.map((c) =>
              c.id in body.assign! ? { ...c, sectionId: body.assign![c.id] ?? null } : c,
            ),
          );
        }
      },
      onSettled: refresh,
    }),
  };
}

/** Do not disturb for some minutes (or off), and my custom status. */
export function useStatusMutations() {
  const qc = useQueryClient();
  return {
    dnd: useMutation({
      mutationFn: (minutes: number | null) =>
        api<{ until: string | null }>('/me/dnd', { method: 'PUT', body: { minutes } }),
    }),
    status: useMutation({
      mutationFn: (body: {
        emoji: string | null;
        text: string | null;
        expiresAt?: string | null;
      }) => api<{ ok: boolean }>('/me/status', { method: 'PUT', body }),
      // Everything that shows a status line (the profile menu, cards, lists) reads it again.
      onSuccess: () => void qc.invalidateQueries({ queryKey: ['messaging', 'presence'] }),
    }),
  };
}

/** Available, Away or Do not disturb (for some minutes), chosen from the profile menu. */
export function usePresenceMode() {
  return useMutation({
    mutationFn: (v: { mode: 'auto' | 'away' | 'dnd'; minutes?: number }) =>
      api<{ state: PresenceState; until: string | null }>('/me/presence', { method: 'PUT', body: v }),
  });
}

// ---- Platform integration (M4) ------------------------------------------------------------------------------

/** A work item's card for me. Cards read live data, so they are refetched when the tab regains focus. */
export function useItemCard(ref: string) {
  return useQuery({
    queryKey: ['messaging', 'item-card', ref],
    queryFn: async () => (await api<{ card: ItemCardDTO }>(`/items/${encodeURIComponent(ref)}/card`)).card,
    staleTime: 30_000,
    retry: false,
  });
}

/** Refresh every card on screen (a work item changed). */
export function refreshItemCards(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['messaging', 'item-card'] });
}

/** The channel that belongs to a space (created the first time it is asked for). */
export function useSpaceChannel(spaceKey: string, enabled = true) {
  return useQuery({
    queryKey: ['messaging', 'space-channel', spaceKey],
    queryFn: async () =>
      (await api<{ channel: ChannelDTO & { member: boolean } }>(`/spaces/${spaceKey}/channel`)).channel,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useActivityRules(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['messaging', 'activity-rules', channelId],
    queryFn: () => api<ActivityRulesDTO>(`/channels/${channelId}/activity-rules`),
    enabled,
    retry: false,
  });
}

export function useSetActivityRules(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventTypes: string[]) =>
      api<ActivityRulesDTO>(`/channels/${channelId}/activity-rules`, {
        method: 'PUT',
        body: { eventTypes },
      }),
    onSuccess: (data) => qc.setQueryData(['messaging', 'activity-rules', channelId], data),
  });
}

/** The slash commands I can use (a module that is off hides its commands). */
export function useCommands() {
  return useQuery({
    queryKey: ['messaging', 'commands'],
    queryFn: async () => (await api<{ commands: SlashCommandDTO[] }>('/commands')).commands,
    staleTime: 5 * 60_000,
  });
}

export async function executeCommand(name: string, args: string, channelId: string | null) {
  return (
    await api<{ result: CommandResult }>('/commands/execute', {
      method: 'POST',
      body: { name, args, channelId },
    })
  ).result;
}

/** Ties an item I just created to the message it came from; the Tasks bot answers in the thread. */
export function linkItemToMessage(messageId: string, itemId: string) {
  return api<CreateFromMessageResult>(`/messages/${messageId}/create-work-item`, {
    method: 'POST',
    body: { itemId },
  });
}
