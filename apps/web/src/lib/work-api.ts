'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, qs } from '@/lib/api';
import type { BoardData, Label, Person, StatusColor, WorkItem, WorkStatus } from '@/lib/work';

// ---- Query keys ---------------------------------------------------------------------------------------

/** Board data is cached per space and filter set; `boardKey(space)` alone matches every filter set. */
export const boardKey = (space: string, filters?: string) =>
  (filters === undefined ? ['board', space.toUpperCase()] : ['board', space.toUpperCase(), filters]) as readonly string[];
export const labelsKey = (space: string) => ['labels', space.toUpperCase()] as const;
export const itemKey = (ref: string) => ['item', ref.toUpperCase()] as const;
export const statusesKey = (space: string) => ['statuses', space.toUpperCase()] as const;

export const errorText = (e: unknown, fallback = 'Something went wrong') =>
  e instanceof ApiError ? e.message : fallback;

/** True when the plan, not the request, refused it: a limit was reached or a feature is not included. */
export const isPlanError = (e: unknown) => e instanceof ApiError && (e.code === 'plan_limit' || e.code === 'feature_locked');

/** Shows an error toast; a plan limit gets a link to the plans so the next step is clear. */
export function toastError(e: unknown, fallback?: string) {
  if (isPlanError(e)) {
    toast.error(errorText(e, fallback), { action: { label: 'See plans', onClick: () => window.location.assign('/admin/billing') } });
  } else {
    toast.error(errorText(e, fallback));
  }
}

// ---- Reads --------------------------------------------------------------------------------------------

/** Refetches on window focus (the QueryClient default); live updates arrive in a later phase. */
export const useBoard = (space: string, filters = '') =>
  useQuery({
    queryKey: boardKey(space, filters),
    queryFn: () => api<BoardData>(`/spaces/${space}/board${filters ? `?${filters}` : ''}`),
    // Keep showing the old cards while a new filter loads, so the board does not flash empty.
    placeholderData: (previous) => previous,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  });

export const useItem = (ref: string) =>
  useQuery({
    queryKey: itemKey(ref),
    queryFn: () => api<WorkItem>(`/items/${encodeURIComponent(ref)}`),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  });

export const useSubtasks = (ref: string, enabled = true) =>
  useQuery({
    queryKey: ['subtasks', ref.toUpperCase()],
    queryFn: () => api<{ items: WorkItem[] }>(`/items/${encodeURIComponent(ref)}/subtasks`),
    enabled,
  });

export const useLabels = (space: string) =>
  useQuery({
    queryKey: labelsKey(space),
    queryFn: () => api<{ items: Label[] }>(`/spaces/${space}/labels`),
    staleTime: 30_000,
  });

export const useStatuses = (space: string) =>
  useQuery({
    queryKey: statusesKey(space),
    queryFn: () => api<{ items: WorkStatus[]; max: number }>(`/spaces/${space}/statuses`),
  });

export async function searchAssignees(space: string, q: string) {
  return (await api<{ items: Person[] }>(`/spaces/${space}/assignees${qs({ q })}`)).items;
}

export async function searchItems(space: string, params: Record<string, string>) {
  return (await api<{ items: WorkItem[] }>(`/spaces/${space}/items${qs({ ...params, limit: 15 })}`))
    .items;
}

// ---- Cache helpers ------------------------------------------------------------------------------------

/** Rewrites an item wherever it is cached (board columns, item view, subtask lists). */
function replaceEverywhere(qc: QueryClient, item: WorkItem) {
  qc.setQueryData<WorkItem>(itemKey(item.key), item);
  qc.setQueryData<WorkItem>(itemKey(item.id), item);
  qc.setQueriesData<BoardData>({ queryKey: ['board'] }, (board) =>
    board
      ? {
          ...board,
          columns: board.columns.map((col) => ({
            ...col,
            items: col.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)),
          })),
        }
      : board,
  );
  qc.setQueriesData<{ items: WorkItem[] }>({ queryKey: ['subtasks'] }, (list) =>
    list ? { items: list.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)) } : list,
  );
}

export const refreshWork = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['board'] }),
    qc.invalidateQueries({ queryKey: ['subtasks'] }),
    qc.invalidateQueries({ queryKey: ['statuses'] }),
    qc.invalidateQueries({ queryKey: ['list'] }),
    qc.invalidateQueries({ queryKey: ['epics'] }),
    qc.invalidateQueries({ queryKey: ['my-items'] }),
    qc.invalidateQueries({ queryKey: ['search'] }),
    qc.invalidateQueries({ queryKey: ['backlog'] }),
  ]);

// ---- Mutations ----------------------------------------------------------------------------------------

export type ItemPatch = Partial<{
  title: string;
  description: string | null;
  descriptionDoc: unknown;
  type: WorkItem['type'];
  parentId: string | null;
  statusId: string;
  priority: WorkItem['priority'];
  assigneeId: string | null;
  estimate: number | null;
  dueDate: string | null;
  labelIds: string[];
}>;

/**
 * Saves a change with the item's last-seen `updatedAt` as If-Match, so a stale edit is refused (412)
 * instead of overwriting someone else's. The change shows immediately and rolls back on failure.
 */
export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    // Saves run one at a time, each using the newest confirmed version, so quick successive edits
    // never trip the stale-write check against ourselves.
    scope: { id: 'work-item-update' },
    mutationFn: ({ item, patch }: { item: WorkItem; patch: ItemPatch; optimistic?: Partial<WorkItem> }) => {
      const current = qc.getQueryData<WorkItem>(itemKey(item.id)) ?? item;
      return api<WorkItem>(`/items/${item.id}`, {
        method: 'PATCH',
        body: patch,
        headers: { 'If-Match': current.updatedAt },
      });
    },
    onMutate: async ({ item, optimistic }) => {
      if (!optimistic) return { previous: undefined };
      await qc.cancelQueries({ queryKey: ['board'] });
      const previous = {
        item: qc.getQueryData<WorkItem>(itemKey(item.key)),
        boards: qc.getQueriesData<BoardData>({ queryKey: ['board'] }),
      };
      replaceEverywhere(qc, { ...item, ...optimistic });
      return { previous };
    },
    onSuccess: (saved, { patch }) => {
      replaceEverywhere(qc, saved);
      // Lists and searches show fields too; they refetch quietly in the background.
      for (const key of ['list', 'epics', 'my-items', 'search', 'backlog']) void qc.invalidateQueries({ queryKey: [key] });
      // A status change moves the card to another column, so let the board reorder itself.
      if (patch.statusId !== undefined || patch.type !== undefined || patch.parentId !== undefined) {
        void refreshWork(qc);
      }
    },
    onError: (e, { item }, ctx) => {
      if (ctx?.previous) {
        if (ctx.previous.item) qc.setQueryData(itemKey(item.key), ctx.previous.item);
        for (const [key, data] of ctx.previous.boards) qc.setQueryData(key, data);
      }
      if (e instanceof ApiError && e.status === 412) {
        toast.error('Someone else changed this item. Reloaded the latest version.');
        void qc.invalidateQueries({ queryKey: ['item'] });
        void refreshWork(qc);
      } else {
        toast.error(errorText(e, 'Could not save that change'));
      }
    },
  });
}

export interface NewItem {
  type: WorkItem['type'];
  title: string;
  description?: string;
  parentId?: string | null;
  statusId?: string;
  priority?: WorkItem['priority'];
  assigneeId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: string[];
}

export function useCreateItem(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewItem) =>
      api<WorkItem>(`/spaces/${space}/items`, { method: 'POST', body }),
    onSuccess: () => {
      void refreshWork(qc);
      void qc.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: Pick<WorkItem, 'id'>) =>
      api<{ deleted: number; subtasks: number }>(`/items/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void refreshWork(qc);
      void qc.invalidateQueries({ queryKey: ['item'] });
      void qc.invalidateQueries({ queryKey: ['plan'] });
    },
    onError: (e) => toast.error(errorText(e, 'Could not delete the item')),
  });
}

// ---- Moving cards -------------------------------------------------------------------------------------

export interface MoveBody {
  statusId: string;
  afterItemId?: string;
  beforeItemId?: string;
  assigneeId?: string | null;
  priority?: WorkItem['priority'];
  epicId?: string | null;
}
export type MovedItem = WorkItem & { wip: { limit: number | null; count: number } };

/** The newest updated_at we know for an item, from the item view or any cached board. */
function freshVersion(qc: QueryClient, item: WorkItem) {
  const cached = qc.getQueryData<WorkItem>(itemKey(item.id));
  if (cached) return cached.updatedAt;
  for (const [, board] of qc.getQueriesData<BoardData>({ queryKey: ['board'] })) {
    for (const col of board?.columns ?? []) {
      const hit = col.items.find((i) => i.id === item.id);
      if (hit) return hit.updatedAt;
    }
  }
  return item.updatedAt;
}

/** Puts a moved card in its new column (in rank order) in every cached board, without a refetch. */
export function applyMoveToBoardCache(qc: QueryClient, saved: WorkItem) {
  qc.setQueriesData<BoardData>({ queryKey: ['board'] }, (board) => {
    if (!board) return board;
    let wasThere = false;
    const without = board.columns.map((col) => {
      const had = col.items.some((i) => i.id === saved.id);
      if (!had) return col;
      wasThere = true;
      return {
        ...col,
        items: col.items.filter((i) => i.id !== saved.id),
        total: col.total - 1,
        wipCount: col.wipCount - 1,
      };
    });
    if (!wasThere) return board;
    return {
      ...board,
      columns: without.map((col) => {
        if (col.statusId !== saved.statusId) return col;
        const items = [...col.items, saved].sort((a, b) =>
          a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1,
        );
        return { ...col, items, total: col.total + 1, wipCount: col.wipCount + 1 };
      }),
    };
  });
}

export function useMoveItem() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: 'work-item-update' },
    mutationFn: ({ item, body }: { item: WorkItem; body: MoveBody }) =>
      api<MovedItem>(`/items/${item.id}/move`, {
        method: 'POST',
        body,
        headers: { 'If-Match': freshVersion(qc, item) },
      }),
    onSuccess: (saved) => {
      const { wip, ...item } = saved;
      qc.setQueryData(itemKey(item.key), item);
      qc.setQueryData(itemKey(item.id), item);
      applyMoveToBoardCache(qc, item);
      if (wip.limit !== null && wip.count > wip.limit) {
        toast.warning(`${item.status.name} is over its limit: ${wip.count} of ${wip.limit}`);
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 412) {
        toast.error('Someone else changed that card. The board was refreshed.');
      } else if (e instanceof ApiError && e.code === 'invalid_neighbor') {
        toast.error('That column changed while you were dragging. The board was refreshed.');
      } else toast.error(errorText(e, 'Could not move that card'));
      void qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
}

/** Appends the next page of a column to every cached board for the same filters. */
export async function loadMoreColumn(
  qc: QueryClient,
  space: string,
  filters: string,
  statusId: string,
  cursor: string,
) {
  const q = new URLSearchParams(filters);
  q.set('cursor', cursor);
  const page = await api<{ items: WorkItem[]; nextCursor: string | null }>(
    `/spaces/${space}/board/columns/${statusId}?${q.toString()}`,
  );
  qc.setQueryData<BoardData>(boardKey(space, filters), (board) =>
    board
      ? {
          ...board,
          columns: board.columns.map((col) =>
            col.statusId === statusId
              ? {
                  ...col,
                  items: [...col.items, ...page.items.filter((n) => !col.items.some((i) => i.id === n.id))],
                  nextCursor: page.nextCursor,
                }
              : col,
          ),
        }
      : board,
  );
}

// ---- Bulk and labels ----------------------------------------------------------------------------------

export type BulkBody =
  | { action: 'move'; ids: string[]; statusId: string }
  | { action: 'assign'; ids: string[]; assigneeId: string | null }
  | { action: 'label'; ids: string[]; labelId: string; mode: 'add' | 'remove' }
  | { action: 'delete'; ids: string[] };

export function useBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkBody) =>
      api<{ updated: number; failed: { id: string; key: string; reason: string }[] }>('/items/bulk', {
        method: 'POST',
        body,
      }),
    onSettled: () => {
      void refreshWork(qc);
      void qc.invalidateQueries({ queryKey: ['item'] });
    },
  });
}

export function useCreateLabel(space: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color?: StatusColor }) =>
      api<Label>(`/spaces/${space}/labels`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: labelsKey(space) }),
  });
}
