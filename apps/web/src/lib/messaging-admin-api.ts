'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChatExportDTO,
  MessagingSettingsDTO,
  MessagingSettingsResponse,
  WebhookDTO,
} from '@crew-deck/shared';
import { api } from '@/lib/api';

export const adminKeys = {
  settings: ['messaging', 'admin', 'settings'] as const,
  retention: ['messaging', 'admin', 'retention'] as const,
  exports: ['messaging', 'admin', 'exports'] as const,
  webhooks: (channelId: string) => ['messaging', 'webhooks', channelId] as const,
};

export interface RetentionOverride {
  channelId: string;
  name: string | null;
  type: string;
  retentionDays: number;
}

export function useMessagingSettings(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api<MessagingSettingsResponse>('/admin/messaging-settings'),
    enabled,
    retry: false,
  });
}

export function useSaveMessagingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MessagingSettingsDTO) =>
      api<MessagingSettingsResponse>('/admin/messaging-settings', { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData(adminKeys.settings, data),
  });
}

export function useRetentionOverrides(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.retention,
    queryFn: async () => (await api<{ channels: RetentionOverride[] }>('/admin/retention')).channels,
    enabled,
  });
}

export function useSetChannelRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channelId: string; days: number | null }) =>
      api(`/admin/channels/${v.channelId}/retention`, { method: 'PUT', body: { days: v.days } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.retention });
      void qc.invalidateQueries({ queryKey: ['messaging', 'channels'] });
    },
  });
}

export function useExports(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.exports,
    queryFn: async () => (await api<{ exports: ChatExportDTO[] }>('/admin/export')).exports,
    enabled,
    // While one is being prepared, look again every few seconds.
    refetchInterval: (q) =>
      q.state.data?.some((e) => e.status === 'queued' || e.status === 'running') ? 3000 : false,
  });
}

export function useRequestExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ export: ChatExportDTO }>('/admin/export', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.exports }),
  });
}

export function useWebhooks(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.webhooks(channelId),
    queryFn: async () =>
      (await api<{ webhooks: WebhookDTO[] }>(`/channels/${channelId}/webhooks`)).webhooks,
    enabled,
    retry: false,
  });
}

export function useCreateWebhook(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<{ webhook: WebhookDTO; token: string }>(`/channels/${channelId}/webhooks`, {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.webhooks(channelId) }),
  });
}

export function useRevokeWebhook(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.webhooks(channelId) }),
  });
}

/** Opens (creating if needed) the chat channel of a CRM deal or company. */
export function openCrmChannel(kind: 'deals' | 'companies', id: string) {
  return api<{ channel: { id: string } }>(`/crm/${kind}/${id}/channel`, { method: 'POST' });
}
