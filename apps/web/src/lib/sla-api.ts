'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Priority } from '@crew-deck/shared';
import { api } from '@/lib/api';

export interface SlaTarget {
  responseMinutes: number;
  resolveMinutes: number;
}
export interface SlaPolicy {
  businessHours: boolean;
  targets: Record<Priority, SlaTarget>;
}

export const slaKey = (space: string) => ['sla', space.toUpperCase()] as const;

export const useSla = (space: string) =>
  useQuery({
    queryKey: slaKey(space),
    queryFn: () =>
      api<{ enabled: boolean; policy: SlaPolicy; permissions: { manage: boolean } }>(`/spaces/${space}/sla`),
    enabled: !!space,
  });

export function useSaveSla(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policy: SlaPolicy) => api(`/spaces/${space}/sla`, { method: 'PUT', body: policy }),
    onSuccess: () => qc.invalidateQueries({ queryKey: slaKey(space) }),
  });
}
