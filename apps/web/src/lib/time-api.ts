'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Person, VersionRef, WorkItem } from '@/lib/work';

export interface Worklog {
  id: string;
  itemId: string;
  minutes: number;
  date: string;
  note: string;
  createdAt: string;
  user: Person | null;
  permissions: { edit: boolean; delete: boolean };
}

export interface WorklogList {
  items: Worklog[];
  total: number;
  permissions: { add: boolean };
}

export interface RoadmapEpic extends WorkItem {
  progress: { total: number; done: number; points: number; donePoints: number; plannedMinutes: number; spentMinutes: number };
}

export interface Roadmap {
  enabled: boolean;
  items: RoadmapEpic[];
  versions: { id: string; name: string; state: VersionRef['state']; startDate: string | null; releaseDate: string | null }[];
  permissions: { edit: boolean };
}

export interface CalendarData {
  items: WorkItem[];
  releases: { id: string; name: string; state: string; date: string | null }[];
}

/** "1h 30m", "90m", "2h", "1.5h" or a bare number of minutes into minutes; null when it cannot be read. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(t);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
}

/** 90 -> "1h 30m", 45 -> "45m", 120 -> "2h". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '–';
  if (minutes === 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
}

export const worklogsKey = (itemId: string) => ['worklogs', itemId] as const;

export const useWorklogs = (itemId: string) =>
  useQuery({
    queryKey: worklogsKey(itemId),
    queryFn: () => api<WorklogList>(`/items/${itemId}/worklogs`),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  });

/** Logging time changes the item (time left, time spent), so its views refresh as well. */
export function useWorklogMutations(itemId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: worklogsKey(itemId) });
    void qc.invalidateQueries({ queryKey: ['item'] });
    void qc.invalidateQueries({ queryKey: ['roadmap'] });
  };
  return {
    add: useMutation({
      mutationFn: (body: { minutes: number; date?: string; note?: string; remainingMinutes?: number | null }) =>
        api<Worklog>(`/items/${itemId}/worklogs`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; minutes?: number; date?: string; note?: string }) =>
        api<Worklog>(`/worklogs/${id}`, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<{ ok: true }>(`/worklogs/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

export const useRoadmap = (space: string) =>
  useQuery({
    queryKey: ['roadmap', space.toUpperCase()],
    queryFn: () => api<Roadmap>(`/spaces/${space}/roadmap`),
    enabled: !!space,
  });

export const useCalendar = (space: string, from: string, to: string) =>
  useQuery({
    queryKey: ['calendar', space.toUpperCase(), from, to],
    queryFn: () => api<CalendarData>(`/spaces/${space}/calendar?from=${from}&to=${to}`),
    placeholderData: (previous) => previous,
  });

/** Dates of an epic are saved through the normal item update, with the version check. */
export function useSaveEpicDates(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ item, startDate, dueDate }: { item: WorkItem; startDate: string | null; dueDate: string | null }) =>
      api<WorkItem>(`/items/${item.id}`, {
        method: 'PATCH',
        body: { startDate, dueDate },
        headers: { 'If-Match': item.updatedAt },
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['roadmap', space.toUpperCase()] });
      void qc.invalidateQueries({ queryKey: ['epics', space.toUpperCase()] });
    },
  });
}
