'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Person } from '@/lib/work';

export interface DocFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdBy: Person | null;
  createdAt: string;
  permissions: { add: boolean; delete: boolean };
}

export interface DocFile {
  id: string;
  folderId: string | null;
  name: string;
  mime: string;
  size: number;
  isImage: boolean;
  uploader: Person | null;
  createdAt: string;
  /** A short-lived signed link. */
  url: string;
  permissions: { add: boolean; delete: boolean };
}

export interface DocListing {
  path: { id: string; name: string }[];
  folders: DocFolder[];
  files: DocFile[];
  permissions: { add: boolean; delete: boolean };
  maxFileMb: number;
}

export const docsKey = (space: string, folder: string | null) => ['space-docs', space.toUpperCase(), folder ?? 'root'] as const;

export const useDocuments = (space: string, folder: string | null) =>
  useQuery({
    queryKey: docsKey(space, folder),
    queryFn: () => api<DocListing>(`/spaces/${space}/documents${folder ? `?folder=${folder}` : ''}`),
    // File links last 15 minutes; refresh well before that.
    refetchInterval: 10 * 60 * 1000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  });

function useRefresh(space: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['space-docs', space.toUpperCase()] });
}

export function useDocMutations(space: string) {
  const refresh = useRefresh(space);
  const opts = { onSuccess: refresh };
  return {
    createFolder: useMutation({
      mutationFn: (body: { name: string; parentId: string | null }) =>
        api<DocFolder>(`/spaces/${space}/folders`, { method: 'POST', body }),
      ...opts,
    }),
    updateFolder: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; parentId?: string | null }) =>
        api<DocFolder>(`/folders/${id}`, { method: 'PATCH', body }),
      ...opts,
    }),
    deleteFolder: useMutation({
      mutationFn: (id: string) => api<{ ok: true }>(`/folders/${id}`, { method: 'DELETE' }),
      ...opts,
    }),
    updateFile: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; folderId?: string | null }) =>
        api<DocFile>(`/space-files/${id}`, { method: 'PATCH', body }),
      ...opts,
    }),
    deleteFile: useMutation({
      mutationFn: (id: string) => api<{ ok: true }>(`/space-files/${id}`, { method: 'DELETE' }),
      ...opts,
    }),
  };
}

/** Every folder of the space as a flat list with its path, for the "Move to" picker. */
export function useFolderTree(space: string, enabled: boolean) {
  return useQuery({
    queryKey: ['space-docs', space.toUpperCase(), 'tree'],
    enabled,
    queryFn: async () => {
      const out: { id: string; label: string; depth: number }[] = [];
      const walk = async (parent: string | null, prefix: string, depth: number) => {
        const page = await api<DocListing>(`/spaces/${space}/documents${parent ? `?folder=${parent}` : ''}`);
        for (const f of page.folders) {
          const label = prefix ? `${prefix} / ${f.name}` : f.name;
          out.push({ id: f.id, label, depth });
          if (depth < 7) await walk(f.id, label, depth + 1);
        }
      };
      await walk(null, '', 0);
      return out;
    },
  });
}

/** Uploads one file into a folder with progress (fetch cannot report upload progress, XMLHttpRequest can). */
export function uploadDocument(space: string, folder: string | null, file: File, onProgress: (pct: number) => void) {
  return new Promise<DocFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/spaces/${space}/files${folder ? `?folder=${folder}` : ''}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { code?: string; message?: string; fields?: Record<string, string> } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as DocFile);
      else reject(new ApiError(xhr.status, data?.code ?? 'error', data?.message ?? 'The upload failed', data?.fields));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload failed. Check your connection.'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
