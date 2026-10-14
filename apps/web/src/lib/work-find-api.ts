'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, qs } from '@/lib/api';
import type { WorkItem } from '@/lib/work';

// ---- Shapes (apps/api/src/routes/work-find.ts) ------------------------------------------------------------

export type FoundItem = WorkItem & { spaceName?: string };

export interface SavedFilter {
  id: string;
  name: string;
  query: string;
  spaceId: string | null;
  shared: boolean;
  mine: boolean;
  canEdit: boolean;
  createdAt: string;
}

export type EpicRow = WorkItem & { progress: { total: number; done: number; points: number; donePoints: number } };

export const LIST_SORTS = ['key', 'title', 'status', 'priority', 'due', 'updated', 'created', 'estimate'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

const noRetryOn4xx = (n: number, e: unknown) => !(e instanceof ApiError && e.status < 500) && n < 1;

// ---- Search and My work -----------------------------------------------------------------------------------

export const useSearch = (q: string, opts: { limit?: number; space?: string; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['search', q, opts.space ?? '', opts.limit ?? 25],
    queryFn: () =>
      api<{ items: FoundItem[]; nextOffset: number | null }>(
        `/search${qs({ q, space: opts.space, limit: opts.limit ?? 25 })}`,
      ),
    enabled: (opts.enabled ?? true) && q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

export const useMyItems = (role: 'assigned' | 'reported' | 'watching', state: 'open' | 'done' | 'all') =>
  useQuery({
    queryKey: ['my-items', role, state],
    queryFn: () => api<{ items: FoundItem[] }>(`/me/items${qs({ role, state })}`),
  });

// ---- Saved filters ----------------------------------------------------------------------------------------

export const useSavedFilters = (space?: string) =>
  useQuery({
    queryKey: ['filters', space ?? ''],
    queryFn: () => api<{ items: SavedFilter[]; canShare: boolean }>(`/filters${qs({ space })}`),
    retry: noRetryOn4xx,
  });

export function useSaveFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; query: string; spaceId: string | null; shared: boolean }) =>
      api<SavedFilter>('/filters', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filters'] }),
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filters'] }),
  });
}

// ---- Epics and list ---------------------------------------------------------------------------------------

export const useEpics = (space: string) =>
  useQuery({
    queryKey: ['epics', space.toUpperCase()],
    queryFn: () => api<{ items: EpicRow[]; permissions: { create: boolean } }>(`/spaces/${space}/epics`),
    retry: noRetryOn4xx,
  });

export const useItemList = (space: string, filters: string, sort: ListSort, dir: 'asc' | 'desc') =>
  useInfiniteQuery({
    queryKey: ['list', space.toUpperCase(), filters, sort, dir],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{
        items: WorkItem[];
        total: number;
        nextOffset: number | null;
        permissions: { editItem: boolean; createItem: boolean };
      }>(`/spaces/${space}/list?${filters ? `${filters}&` : ''}${new URLSearchParams({ sort, dir, offset: String(pageParam), limit: '100' })}`),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    retry: noRetryOn4xx,
  });

export const csvHref = (space: string, filters: string, sort: ListSort, dir: 'asc' | 'desc') =>
  `/api/v1/spaces/${space}/items.csv?${filters ? `${filters}&` : ''}${new URLSearchParams({ sort, dir })}`;
