'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Workflow {
  restricted: boolean;
  /** Source status id -> status ids it may move to. A status that is not a key is unrestricted. */
  transitions: Record<string, string[]>;
}

export const workflowKey = (space: string) => ['workflow', space.toUpperCase()] as const;
export const templatesKey = (space: string) => ['checklist-templates', space.toUpperCase()] as const;

export const useWorkflow = (space: string) =>
  useQuery({
    queryKey: workflowKey(space),
    queryFn: () => api<Workflow & { permissions: { manage: boolean } }>(`/spaces/${space}/workflow`),
    enabled: !!space,
  });

export function useSaveWorkflow(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: Workflow) => api<Workflow>(`/spaces/${space}/workflow`, { method: 'PUT', body: w }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKey(space) }),
  });
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  items: string[];
}

export const useChecklistTemplates = (space: string, enabled = true) =>
  useQuery({
    queryKey: templatesKey(space),
    queryFn: () =>
      api<{ items: ChecklistTemplate[]; permissions: { manage: boolean } }>(`/spaces/${space}/checklist-templates`),
    enabled: !!space && enabled,
  });

export function useCreateTemplate(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; items: string[] }) =>
      api<ChecklistTemplate>(`/spaces/${space}/checklist-templates`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey(space) }),
  });
}

export function useDeleteTemplate(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/checklist-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey(space) }),
  });
}
