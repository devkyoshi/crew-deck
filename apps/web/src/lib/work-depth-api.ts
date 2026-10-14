'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LinkType } from '@crew-deck/shared';
import { api, ApiError, qs } from '@/lib/api';
import type { RichDoc } from '@/components/shared/rich-text';
import type { ItemType, Person, StatusCategory, StatusColor, WorkItem } from '@/lib/work';
import { refreshWork } from '@/lib/work-api';

// ---- Shapes (apps/api/src/routes/work-depth.ts, attachments.ts, work-copy.ts) ----------------------------

export interface Comment {
  id: string;
  itemId: string;
  author: Person | null;
  body: RichDoc | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  permissions: { edit: boolean; delete: boolean };
}

export interface ItemLink {
  id: string;
  linkType: LinkType;
  direction: 'outward' | 'inward';
  label: string;
  item: {
    id: string;
    key: string;
    title: string;
    type: ItemType;
    status: { id: string; name: string; category: StatusCategory; color: StatusColor };
  };
}

export interface ActivityEvent {
  id: string;
  kind:
    | 'created'
    | 'updated'
    | 'moved'
    | 'deleted'
    | 'commented'
    | 'comment_deleted'
    | 'linked'
    | 'unlinked'
    | 'attachment_added'
    | 'attachment_removed'
    | 'transferred'
    | 'duplicated';
  field: string | null;
  // Display snapshots; their shape depends on the field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldValue: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newValue: any;
  actor: Person | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  itemId: string;
  name: string;
  mime: string;
  size: number;
  isImage: boolean;
  uploader: Person | null;
  createdAt: string;
  url: string;
  permissions: { delete: boolean };
}

export const LINK_OPTIONS: { value: LinkType; label: string }[] = [
  { value: 'relates_to', label: 'relates to' },
  { value: 'blocks', label: 'blocks' },
  { value: 'duplicates', label: 'duplicates' },
];

// ---- Keys -----------------------------------------------------------------------------------------------

const k = {
  comments: (id: string) => ['comments', id] as const,
  links: (id: string) => ['links', id] as const,
  watchers: (id: string) => ['watchers', id] as const,
  activity: (id: string) => ['activity', id] as const,
  attachments: (id: string) => ['attachments', id] as const,
};

const notFoundIsFinal = (n: number, e: unknown) => !(e instanceof ApiError && e.status < 500) && n < 1;

// ---- Comments -------------------------------------------------------------------------------------------

export const useComments = (itemId: string) =>
  useQuery({
    queryKey: k.comments(itemId),
    queryFn: () =>
      api<{ items: Comment[]; nextCursor: string | null; permissions: { create: boolean } }>(
        `/items/${itemId}/comments${qs({ limit: 100 })}`,
      ),
    retry: notFoundIsFinal,
  });

function useAfterChange(itemId: string) {
  const qc = useQueryClient();
  return (...keys: (keyof typeof k)[]) =>
    Promise.all([
      ...keys.map((key) => qc.invalidateQueries({ queryKey: k[key](itemId) })),
      qc.invalidateQueries({ queryKey: k.activity(itemId) }),
    ]);
}

export function useAddComment(itemId: string) {
  const after = useAfterChange(itemId);
  return useMutation({
    mutationFn: (body: RichDoc) => api<Comment>(`/items/${itemId}/comments`, { method: 'POST', body: { body } }),
    onSuccess: () => after('comments', 'watchers'),
  });
}

export function useEditComment(itemId: string) {
  const after = useAfterChange(itemId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RichDoc }) =>
      api<Comment>(`/comments/${id}`, { method: 'PATCH', body: { body } }),
    onSuccess: () => after('comments', 'watchers'),
  });
}

export function useDeleteComment(itemId: string) {
  const after = useAfterChange(itemId);
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => after('comments'),
  });
}

// ---- Watchers -------------------------------------------------------------------------------------------

export const useWatchers = (itemId: string) =>
  useQuery({
    queryKey: k.watchers(itemId),
    queryFn: () => api<{ watching: boolean; items: Person[] }>(`/items/${itemId}/watchers`),
    retry: notFoundIsFinal,
  });

export function useToggleWatch(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (watch: boolean) =>
      api<{ watching: boolean }>(`/items/${itemId}/watch`, { method: watch ? 'PUT' : 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: k.watchers(itemId) }),
  });
}

// ---- Links ----------------------------------------------------------------------------------------------

export const useLinks = (itemId: string) =>
  useQuery({
    queryKey: k.links(itemId),
    queryFn: () =>
      api<{ items: ItemLink[]; permissions: { create: boolean; delete: boolean } }>(`/items/${itemId}/links`),
    retry: notFoundIsFinal,
  });

export function useAddLink(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target: string; linkType: LinkType }) =>
      api<{ id: string }>(`/items/${itemId}/links`, { method: 'POST', body }),
    onSuccess: (_r, { target }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: k.links(itemId) }),
        qc.invalidateQueries({ queryKey: k.activity(itemId) }),
        qc.invalidateQueries({ queryKey: k.links(target) }),
      ]),
  });
}

export function useRemoveLink(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api<{ ok: true }>(`/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['links'] }),
        qc.invalidateQueries({ queryKey: k.activity(itemId) }),
      ]),
  });
}

// ---- Activity -------------------------------------------------------------------------------------------

export const useActivity = (itemId: string) =>
  useInfiniteQuery({
    queryKey: k.activity(itemId),
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<{ items: ActivityEvent[]; nextCursor: string | null }>(
        `/items/${itemId}/activity${qs({ limit: 30, cursor: pageParam || undefined })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: notFoundIsFinal,
  });

// ---- Attachments ----------------------------------------------------------------------------------------

export const useAttachments = (itemId: string) =>
  useQuery({
    queryKey: k.attachments(itemId),
    queryFn: () =>
      api<{ items: Attachment[]; permissions: { add: boolean }; maxFileMb: number }>(`/items/${itemId}/attachments`),
    retry: notFoundIsFinal,
    // File links last 15 minutes; refresh well before that.
    refetchInterval: 10 * 60 * 1000,
  });

/** Uploads one file with progress (fetch cannot report upload progress, XMLHttpRequest can). */
export function uploadAttachment(itemId: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<Attachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/items/${itemId}/attachments`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { code?: string; message?: string; fields?: Record<string, string> } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as Attachment);
      else reject(new ApiError(xhr.status, data?.code ?? 'error', data?.message ?? 'The upload failed', data?.fields));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload failed. Check your connection.'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export function useAttachmentsChanged(itemId: string) {
  const after = useAfterChange(itemId);
  const qc = useQueryClient();
  return () => Promise.all([after('attachments'), qc.invalidateQueries({ queryKey: ['plan'] })]);
}

export function useDeleteAttachment(itemId: string) {
  const changed = useAttachmentsChanged(itemId);
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => changed(),
  });
}

// ---- Duplicate and transfer -----------------------------------------------------------------------------

export function useDuplicateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ item, includeSubtasks }: { item: WorkItem; includeSubtasks: boolean }) =>
      api<WorkItem & { subtasksCopied: number }>(`/items/${item.id}/duplicate`, {
        method: 'POST',
        body: { includeSubtasks },
      }),
    onSuccess: () => {
      void refreshWork(qc);
      void qc.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

export function useTransferItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ item, spaceId }: { item: WorkItem; spaceId: string }) =>
      api<WorkItem & { subtasksMoved: number; previousKey: string }>(`/items/${item.id}/transfer`, {
        method: 'POST',
        body: { spaceId },
      }),
    // Not awaited, and the old key is left alone: refetching it now would 404 and close the dialog
    // before it can open the item at its new key.
    onSuccess: () => {
      void refreshWork(qc);
    },
  });
}
