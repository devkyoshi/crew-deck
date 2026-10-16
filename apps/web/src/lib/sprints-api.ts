'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { SpaceFeature } from '@crew-deck/shared';
import type { WorkItem } from '@/lib/work';
import { refreshWork } from '@/lib/work-api';

export interface Sprint {
  id: string;
  spaceId: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  state: 'planned' | 'active' | 'closed';
  startedAt: string | null;
  closedAt: string | null;
}

export interface Summary {
  count: number;
  done: number;
  points: number;
  donePoints: number;
}

export type SprintSection = Sprint & { items: WorkItem[]; summary: Summary };

export interface BacklogData {
  sprints: SprintSection[];
  backlog: { items: WorkItem[]; summary: Summary };
  permissions: { create: boolean; start: boolean; complete: boolean; moveItems: boolean };
  features: { sprints: boolean; burndown: boolean };
}

export interface Burndown {
  sprint: Sprint;
  startPoints: number;
  ideal: { date: string; points: number }[];
  actual: { date: string; points: number; total: number | null }[];
  scopeChanges: { date: string; kind: 'added' | 'removed'; points: number; title: string }[];
}

const noRetryOn4xx = (n: number, e: unknown) => !(e instanceof ApiError && e.status < 500) && n < 1;

export const useBacklog = (space: string) =>
  useQuery({
    queryKey: ['backlog', space.toUpperCase()],
    queryFn: () => api<BacklogData>(`/spaces/${space}/backlog`),
    retry: noRetryOn4xx,
  });

export const useSprints = (space: string) =>
  useQuery({
    queryKey: ['sprints', space.toUpperCase()],
    queryFn: () => api<{ items: Sprint[] }>(`/spaces/${space}/sprints`),
  });

export const useSprintReport = (id: string | null) =>
  useQuery({
    queryKey: ['sprint-report', id],
    queryFn: () =>
      api<{ sprint: Sprint; completed: WorkItem[]; notCompleted: WorkItem[]; addedAfterStart: WorkItem[] }>(`/sprints/${id}/report`),
    enabled: !!id,
  });

export const useBurndown = (id: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['burndown', id],
    queryFn: () => api<Burndown>(`/sprints/${id}/burndown`),
    enabled: !!id && enabled,
    retry: noRetryOn4xx,
  });

function useSprintMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['backlog'] });
      void qc.invalidateQueries({ queryKey: ['sprints'] });
      void qc.invalidateQueries({ queryKey: ['sprint-report'] });
      void qc.invalidateQueries({ queryKey: ['burndown'] });
      void refreshWork(qc);
    },
  });
}

export const useCreateSprint = (space: string) =>
  useSprintMutation((body: Partial<Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate'>>) =>
    api<Sprint>(`/spaces/${space}/sprints`, { method: 'POST', body }),
  );

export const useUpdateSprint = () =>
  useSprintMutation(({ id, ...body }: Partial<Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate'>> & { id: string }) =>
    api<Sprint>(`/sprints/${id}`, { method: 'PATCH', body }),
  );

export const useDeleteSprint = () =>
  useSprintMutation((id: string) => api<{ ok: true; movedToBacklog: number }>(`/sprints/${id}`, { method: 'DELETE' }));

export const useStartSprint = () =>
  useSprintMutation(({ id, ...body }: { id: string; startDate: string; endDate: string; goal?: string | null }) =>
    api<Sprint & { items: number; points: number }>(`/sprints/${id}/start`, { method: 'POST', body }),
  );

export const useCompleteSprint = () =>
  useSprintMutation(({ id, destination }: { id: string; destination: string }) =>
    api<Sprint & { completed: number; moved: number; movedTo: { id: string; name: string } | null }>(`/sprints/${id}/complete`, {
      method: 'POST',
      body: { destination },
    }),
  );

export const useMoveToSprint = () =>
  useSprintMutation(({ ids, sprintId }: { ids: string[]; sprintId: string | null }) =>
    api<{ updated: number }>('/items/sprint', { method: 'POST', body: { ids, sprintId } }),
  );

export const useReorderBacklog = (space: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, ids }: { sprintId: string | null; ids: string[] }) =>
      api<{ ok: true }>(`/spaces/${space}/backlog/order`, { method: 'PUT', body: { sprintId, ids } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['backlog'] }),
  });
};

export const useSetSpaceFeatures = (space: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (features: SpaceFeature[]) =>
      api<{ features: SpaceFeature[]; movedToBacklog: number }>(`/spaces/${space}/features`, {
        method: 'PUT',
        body: { features },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['space'] });
      void qc.invalidateQueries({ queryKey: ['spaces'] });
      void qc.invalidateQueries({ queryKey: ['backlog'] });
      void qc.invalidateQueries({ queryKey: ['sla'] });
      void refreshWork(qc);
    },
  });
};

export const useSetBoardType = (space: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: 'kanban' | 'scrum') =>
      api<{ type: string; movedToBacklog: number }>(`/spaces/${space}/board-type`, { method: 'PUT', body: { type } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['space'] });
      void qc.invalidateQueries({ queryKey: ['backlog'] });
      void refreshWork(qc);
    },
  });
};

/** "3 Oct – 14 Oct" */
export const dateRange = (s: Pick<Sprint, 'startDate' | 'endDate'>) => {
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return s.startDate && s.endDate ? `${f(s.startDate)} – ${f(s.endDate)}` : 'No dates yet';
};
