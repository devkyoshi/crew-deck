'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ItemType, Person, Resolution } from '@/lib/work';

export interface Version {
  id: string;
  name: string;
  description: string;
  startDate: string | null;
  releaseDate: string | null;
  state: 'unreleased' | 'released' | 'archived';
  releasedAt: string | null;
  total: number;
  done: number;
  open: number;
  overdue: boolean;
}

export interface VersionList {
  items: Version[];
  permissions: { manage: boolean; release: boolean; manageComponents: boolean };
  /** False when the plan does not include releases. */
  feature: boolean;
}

export interface SpaceComponent {
  id: string;
  name: string;
  description: string;
  lead: Person | null;
  defaultAssignee: Person | null;
  itemCount: number;
}

export interface ReleaseNotes {
  version: { id: string; name: string; state: string; releaseDate: string | null; description: string };
  groups: { type: ItemType; items: NoteItem[] }[];
  notShipped: NoteItem[];
}
interface NoteItem {
  id: string;
  key: string;
  type: ItemType;
  title: string;
  resolution: Resolution | null;
}

export const versionsKey = (space: string) => ['versions', space.toUpperCase()] as const;
export const componentsKey = (space: string) => ['components', space.toUpperCase()] as const;

export const useVersions = (space: string) =>
  useQuery({
    queryKey: versionsKey(space),
    queryFn: () => api<VersionList>(`/spaces/${space}/versions`),
    enabled: !!space,
  });

export const useComponents = (space: string) =>
  useQuery({
    queryKey: componentsKey(space),
    queryFn: () =>
      api<{ items: SpaceComponent[]; permissions: VersionList['permissions'] }>(`/spaces/${space}/components`),
    enabled: !!space,
  });

export const useReleaseNotes = (id: string | null) =>
  useQuery({
    queryKey: ['release-notes', id],
    queryFn: () => api<ReleaseNotes>(`/versions/${id}/notes`),
    enabled: !!id,
  });

/** Versions change what items show, so every list that carries them is refreshed too. */
function useRefresh(space: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: versionsKey(space) });
    void qc.invalidateQueries({ queryKey: componentsKey(space) });
    void qc.invalidateQueries({ queryKey: ['release-notes'] });
    void qc.invalidateQueries({ queryKey: ['board'] });
    void qc.invalidateQueries({ queryKey: ['item'] });
    void qc.invalidateQueries({ queryKey: ['list'] });
  };
}

export function useVersionMutations(space: string) {
  const refresh = useRefresh(space);
  const opts = { onSuccess: refresh };
  return {
    create: useMutation({
      mutationFn: (body: { name: string; description?: string; startDate?: string | null; releaseDate?: string | null }) =>
        api<Version>(`/spaces/${space}/versions`, { method: 'POST', body }),
      ...opts,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Partial<Pick<Version, 'name' | 'description' | 'startDate' | 'releaseDate'>> & { state?: 'unreleased' | 'archived' }) =>
        api<Version>(`/versions/${id}`, { method: 'PATCH', body }),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<{ ok: true }>(`/versions/${id}`, { method: 'DELETE' }),
      ...opts,
    }),
    release: useMutation({
      mutationFn: ({ id, moveOpenTo }: { id: string; moveOpenTo: string | null }) =>
        api<{ moved: number; removed: number }>(`/versions/${id}/release`, { method: 'POST', body: { moveOpenTo } }),
      ...opts,
    }),
  };
}

export function useComponentMutations(space: string) {
  const refresh = useRefresh(space);
  const opts = { onSuccess: refresh };
  return {
    create: useMutation({
      mutationFn: (body: { name: string; description?: string; leadId?: string | null; defaultAssigneeId?: string | null }) =>
        api<SpaceComponent>(`/spaces/${space}/components`, { method: 'POST', body }),
      ...opts,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; leadId?: string | null; defaultAssigneeId?: string | null }) =>
        api<SpaceComponent>(`/components/${id}`, { method: 'PATCH', body }),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<{ ok: true }>(`/components/${id}`, { method: 'DELETE' }),
      ...opts,
    }),
  };
}
