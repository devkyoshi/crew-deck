'use client';

import Link from 'next/link';
import { ConfettiBurst } from '@/components/shared/celebrate';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  GripVertical,
  Kanban,
  Keyboard,
  Link2,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings2,
  SquareCheck,
  Trash2,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BlockedMoveDialog, movesBlockedForward } from './item-extras';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useMe } from '@/components/shell/me-context';
import {
  boardKey,
  toastError,
  loadMoreColumn,
  useBoard,
  useCreateItem,
  useDeleteItem,
  useMoveItem,
  useUpdateItem,
  type MoveBody,
} from '@/lib/work-api';
import {
  NO_FILTERS,
  FILTER_KEYS,
  filterString,
  hasActiveFilters,
  parseFilters,
  type Filters,
} from '@/lib/work-filters';
import { PRIORITY_META, type BoardData, type WorkItem } from '@/lib/work';
import { cn } from '@/lib/utils';
import { BoardSettingsSheet } from './board-settings';
import { BoardColumn, ColumnCreateRow, ColumnHeader, ColumnSkeleton } from './board-bits';
import { BulkBar } from './bulk-bar';
import { CreateItemDialog } from './create-item-dialog';
import { FilterBar } from './filter-bar';
import { SavedFilters } from './saved-filters';
import { dateRange } from '@/lib/sprints-api';
import { useSpace } from '@/components/spaces/space-context';
import { ItemDetail } from './item-detail';
import { ShortcutsOverlay } from './shortcuts-overlay';
import { UserAvatar } from './work-bits';
import { WorkItemCard, type Density } from './work-card';
import { useVocabulary } from './use-vocabulary';

// ---- Per-person view preferences (density, collapsed columns). Storage may be blocked; that is fine. ----

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** True when the key press came from somewhere the person is typing, or from inside a dialog. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || !!t.closest('[role="dialog"]'));

// ---- Cells: one list of cards per (swimlane, status) ---------------------------------------------------

type Cells = Record<string, WorkItem[]>;
type Status = BoardData['statuses'][number];
type LaneMode = BoardData['board']['settings']['swimlane'];
interface Lane {
  id: string;
  label: string;
  person?: WorkItem['assignee'];
}

const cellKey = (lane: string, statusId: string) => `${lane}|${statusId}`;
const splitKey = (key: string) => {
  const i = key.indexOf('|');
  return [key.slice(0, i), key.slice(i + 1)] as const;
};
const laneOf = (item: WorkItem, mode: LaneMode) =>
  mode === 'assignee'
    ? (item.assignee?.id ?? 'none')
    : mode === 'priority'
      ? item.priority
      : mode === 'epic'
        ? item.parent?.type === 'epic'
          ? item.parent.id
          : 'none'
        : 'all';

function buildLanes(mode: LaneMode, items: WorkItem[]): Lane[] {
  if (mode === 'none') return [{ id: 'all', label: '' }];
  if (mode === 'priority') {
    return (['highest', 'high', 'medium', 'low', 'lowest'] as const).map((p) => ({
      id: p,
      label: PRIORITY_META[p].label,
    }));
  }
  const seen = new Map<string, Lane>();
  for (const i of items) {
    if (mode === 'assignee' && i.assignee && !seen.has(i.assignee.id)) {
      seen.set(i.assignee.id, { id: i.assignee.id, label: i.assignee.name ?? i.assignee.email, person: i.assignee });
    }
    if (mode === 'epic' && i.parent?.type === 'epic' && !seen.has(i.parent.id)) {
      seen.set(i.parent.id, { id: i.parent.id, label: i.parent.title });
    }
  }
  const named = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  return [...named, { id: 'none', label: mode === 'assignee' ? 'Unassigned' : 'No epic' }];
}

function buildCells(data: BoardData | undefined, mode: LaneMode): { cells: Cells; lanes: Lane[] } {
  if (!data) return { cells: {}, lanes: [] };
  const all = data.columns.flatMap((c) => c.items);
  const lanes = buildLanes(mode, all);
  const cells: Cells = {};
  for (const lane of lanes) for (const s of data.statuses) cells[cellKey(lane.id, s.id)] = [];
  for (const col of data.columns) {
    for (const item of col.items) {
      const key = cellKey(laneOf(item, mode), col.statusId);
      (cells[key] ??= []).push(item);
    }
  }
  return { cells, lanes };
}

// ---- Drag and drop pieces ------------------------------------------------------------------------------

interface CardCtx {
  spaceKey: string;
  statuses: Status[];
  density: Density;
  fields: BoardData['board']['settings']['cardFields'];
  canEdit: boolean;
  canDelete: (i: WorkItem) => boolean;
  onOpen: (key: string, e: React.MouseEvent) => void;
  onMove: (item: WorkItem, statusId: string) => void;
  onDelete: (item: WorkItem) => void;
  onToggleSelect: (id: string) => void;
}

const SortableCard = memo(function SortableCard({
  item,
  ctx,
  selected,
  opened,
}: {
  item: WorkItem;
  ctx: CardCtx;
  selected: boolean;
  opened: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !ctx.canEdit,
  });
  // The whole card can be dragged with a mouse or a finger. Keyboard users use the handle: only it gets
  // the key listener, so Enter and Space on the title still open the card.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'z-10')}
      {...(ctx.canEdit ? pointerListeners : {})}
    >
      <WorkItemCard
        item={item}
        density={ctx.density}
        fields={ctx.fields}
        selected={selected || opened}
        dragging={isDragging}
        onOpen={(e) => ctx.onOpen(item.key, e)}
        handle={
          ctx.canEdit ? (
            <button
              type="button"
              {...attributes}
              onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLButtonElement> | undefined}
              aria-label={`Move ${item.key}: ${item.title}. Press space to pick up.`}
              className="text-muted-foreground hover:bg-accent focus-visible:ring-ring flex size-6 cursor-grab items-center justify-center rounded-sm outline-none focus-visible:ring-2 active:cursor-grabbing"
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          ) : null
        }
        menu={
          <CardMenu
            item={item}
            statuses={ctx.statuses}
            canEdit={ctx.canEdit}
            canDelete={ctx.canDelete(item)}
            spaceKey={ctx.spaceKey}
            selected={selected}
            onOpen={() => ctx.onOpen(item.key, { ctrlKey: false, metaKey: false } as React.MouseEvent)}
            onMove={(statusId) => ctx.onMove(item, statusId)}
            onDelete={() => ctx.onDelete(item)}
            onToggleSelect={() => ctx.onToggleSelect(item.id)}
          />
        }
      />
    </div>
  );
});

function Cell({
  id,
  ids,
  lane,
  label,
  dragging,
  className,
  children,
}: {
  id: string;
  ids: string[];
  lane: string;
  label: string;
  dragging: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        role={ids.length ? 'list' : 'group'}
        aria-label={label}
        data-cell={id}
        data-lane={lane}
        className={cn(
          'flex shrink-0 grow basis-auto flex-col gap-2 rounded-lg transition-colors',
          dragging && 'outline-primary/25 outline-1 -outline-offset-2 outline-dashed',
          isOver && 'bg-primary/10 outline-primary/60',
          className,
        )}
      >
        {children}
      </div>
    </SortableContext>
  );
}

// ---- The board -----------------------------------------------------------------------------------------

export function BoardView({ spaceKey }: { spaceKey: string }) {
  const vocab = useVocabulary();
  const space = useSpace();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();

  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const filterStr = filterString(filters);
  const board = useBoard(spaceKey, filterStr);
  const create = useCreateItem(spaceKey);
  const update = useUpdateItem();
  const move = useMoveItem();
  const [burst, setBurst] = useState(0);
  const del = useDeleteItem();

  const [density, setDensity] = useState<Density>('comfortable');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [collapsedLanes, setCollapsedLanes] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toDelete, setToDelete] = useState<WorkItem | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blockedMove, setBlockedMove] = useState<{ item: WorkItem; body: MoveBody } | null>(null);
  const [confirmLane, setConfirmLane] = useState<{ item: WorkItem; body: MoveBody; text: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const prefKey = `board:${me.user.id}`;
  useEffect(() => {
    setDensity(readPref<Density>(`${prefKey}:density`, 'comfortable'));
    setCollapsed(readPref<string[]>(`${prefKey}:${spaceKey}:collapsed`, []));
    setCollapsedLanes(readPref<string[]>(`${prefKey}:${spaceKey}:lanes`, []));
  }, [prefKey, spaceKey]);

  // ---- URL state: filters and the open item live in the address, so any view can be shared. ----
  const pushParams = useCallback(
    (mutate: (p: URLSearchParams) => void, replace = false) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      const q = next.toString();
      const url = q ? `${pathname}?${q}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [params, pathname, router],
  );
  const openRef = params.get('item');
  const setOpenItem = useCallback(
    (key: string | null) => pushParams((p) => (key ? p.set('item', key) : p.delete('item'))),
    [pushParams],
  );
  const setFilters = useCallback(
    (next: Filters) =>
      pushParams((p) => {
        for (const k of FILTER_KEYS) p.delete(k);
        new URLSearchParams(filterString(next)).forEach((v, k) => p.set(k, v));
      }, true),
    [pushParams],
  );

  const data = board.data;
  const mode: LaneMode = data?.board.settings.swimlane ?? 'none';
  const server = useMemo(() => buildCells(data, mode), [data, mode]);

  // The local copy is what the drag moves around. It follows the server whenever no drag is under way.
  const [cells, setCells] = useState<Cells>(server.cells);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setCells(server.cells);
  }, [server.cells]);
  const origin = useRef<{ key: string; index: number } | null>(null);

  const perms = data?.permissions;
  const canCreate = perms?.createItem ?? false;
  const isReporter = useCallback((i: WorkItem) => i.reporter.id === me.user.id, [me.user.id]);
  const canDelete = useCallback(
    (i: WorkItem) => !!perms && (perms.manageBoard || (perms.editItem && isReporter(i))),
    [perms, isReporter],
  );

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && selected.length && !isTyping(e.target) && !dragging.current) {
        setSelected([]);
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key.toLowerCase() === 'c' && canCreate) {
        e.preventDefault();
        setCreateOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate, selected.length]);

  /** Arrow keys walk between cards: up and down inside a cell, left and right to the next column. */
  function onBoardKeyDown(e: React.KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-card-open]');
    const cell = btn?.closest<HTMLElement>('[data-cell]');
    if (!btn || !cell) return;
    const cards = [...cell.querySelectorAll<HTMLElement>('[data-card-open]')];
    const i = cards.indexOf(btn);
    let target: HTMLElement | undefined;
    if (e.key === 'ArrowDown') target = cards[i + 1];
    else if (e.key === 'ArrowUp') target = cards[i - 1];
    else {
      const row = [...(scrollRef.current?.querySelectorAll<HTMLElement>(`[data-cell][data-lane="${cell.dataset.lane}"]`) ?? [])];
      const step = e.key === 'ArrowRight' ? 1 : -1;
      for (let j = row.indexOf(cell) + step; j >= 0 && j < row.length; j += step) {
        const there = row[j]!.querySelectorAll<HTMLElement>('[data-card-open]');
        if (there.length) {
          target = there[Math.min(i, there.length - 1)];
          break;
        }
      }
    }
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }

  // ---- Drag and drop ----
  const statusOrder = useRef<string[]>([]);
  statusOrder.current = (data?.statuses ?? []).map((st) => st.id);
  /**
   * Arrow keys while a card is picked up: up and down step through the cards of the same column, left
   * and right jump to the neighbouring column (at the same height). The card is placed over its target
   * and the collision logic does the rest.
   */
  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback((event, { context, currentCoordinates }) => {
    const { active, droppableRects, collisionRect } = context;
    if (!active || !collisionRect || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return undefined;
    event.preventDefault();
    const all = cellsRef.current;
    const here = Object.keys(all).find((k) => all[k]!.some((i) => i.id === active.id));
    if (!here) return undefined;
    const list = all[here]!;
    const index = list.findIndex((i) => i.id === active.id);
    let rect: { left: number; top: number } | undefined;
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      const neighbour = list[index + (event.code === 'ArrowDown' ? 1 : -1)];
      rect = neighbour ? droppableRects.get(neighbour.id) : undefined;
    } else {
      const [lane, statusId] = splitKey(here);
      const order = statusOrder.current;
      const step = event.code === 'ArrowRight' ? 1 : -1;
      const next = order[order.indexOf(statusId) + step];
      if (next) {
        const key = cellKey(lane, next);
        const there = all[key] ?? [];
        const card = there[Math.min(index, there.length - 1)];
        rect = (card ? droppableRects.get(card.id) : undefined) ?? droppableRects.get(key);
      }
    }
    // The distance from where the card is now to where the target is, applied to the sensor's own
    // position: both rects share a coordinate space, so a scrolled board does not throw it off.
    return rect
      ? {
          x: currentCoordinates.x + (rect.left - collisionRect.left),
          y: currentCoordinates.y + (rect.top - collisionRect.top),
        }
      : undefined;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const findCell = (id: string | number): string | undefined =>
    String(id) in cells ? String(id) : Object.keys(cells).find((k) => cells[k]!.some((i) => i.id === id));
  const itemById = (id: string | number) => {
    for (const list of Object.values(cells)) {
      const hit = list.find((i) => i.id === id);
      if (hit) return hit;
    }
    return undefined;
  };
  const statusName = (cell: string | undefined) =>
    cell ? (data?.statuses.find((s) => s.id === splitKey(cell)[1])?.name ?? 'a column') : 'a column';
  const laneName = (cell: string | undefined) => {
    if (!cell || mode === 'none') return '';
    const lane = server.lanes.find((l) => l.id === splitKey(cell)[0]);
    return lane ? `, ${lane.label}` : '';
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const item = itemById(active.id);
      const cell = findCell(active.id);
      return item
        ? `Picked up ${item.key}, ${item.title}, from ${statusName(cell)}${laneName(cell)}, position ${(cells[cell!]?.findIndex((i) => i.id === active.id) ?? 0) + 1} of ${cells[cell!]?.length ?? 1}.`
        : 'Picked up a card.';
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const cell = findCell(over.id);
      const list = cell ? cells[cell] : undefined;
      const idx = list?.findIndex((i) => i.id === active.id) ?? -1;
      return `${itemById(active.id)?.key ?? 'Card'} is over ${statusName(cell)}${laneName(cell)}${idx >= 0 ? `, position ${idx + 1} of ${list!.length}` : ''}.`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return `${itemById(active.id)?.key ?? 'Card'} was dropped outside a column and returned.`;
      const cell = findCell(active.id);
      const list = cell ? cells[cell] : undefined;
      let idx = list?.findIndex((i) => i.id === active.id) ?? 0;
      // Dropping on another card in the same column swaps places with it, which is not in `cells` yet.
      if (list && over.id !== active.id && !(String(over.id) in cells) && findCell(over.id) === cell) {
        idx = list.findIndex((i) => i.id === over.id);
      }
      return `Dropped ${itemById(active.id)?.key ?? 'card'} in ${statusName(cell)}${laneName(cell)}, position ${idx + 1} of ${list?.length ?? 1}.`;
    },
    onDragCancel: ({ active }) => `Move cancelled. ${itemById(active.id)?.key ?? 'The card'} went back.`,
  };

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    lastOver.current = null;
    setActiveId(String(e.active.id));
    const key = findCell(e.active.id);
    origin.current = key ? { key, index: cells[key]!.findIndex((i) => i.id === e.active.id) } : null;
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findCell(active.id);
    const to = findCell(over.id);
    if (!from || !to || from === to) return;
    setCells((prev) => {
      const fromItems = prev[from]!;
      const toItems = prev[to]!;
      const moving = fromItems.find((i) => i.id === active.id);
      if (!moving) return prev;
      let index = toItems.length;
      if (!(String(over.id) in prev)) {
        const overIndex = toItems.findIndex((i) => i.id === over.id);
        const translated = active.rect.current.translated;
        const below = !!translated && translated.top > over.rect.top + over.rect.height / 2;
        index = overIndex + (below ? 1 : 0);
      }
      return {
        ...prev,
        [from]: fromItems.filter((i) => i.id !== active.id),
        [to]: [...toItems.slice(0, index), moving, ...toItems.slice(index)],
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    dragging.current = false;
    lastOver.current = null;
    setActiveId(null);
    const start = origin.current;
    origin.current = null;
    if (!over || !start) {
      setCells(server.cells);
      return;
    }
    const current = findCell(active.id);
    if (!current) return;
    let next = cells;
    const overCell = findCell(over.id);
    if (overCell === current && active.id !== over.id && !(String(over.id) in cells)) {
      const list = cells[current]!;
      const from = list.findIndex((i) => i.id === active.id);
      const to = list.findIndex((i) => i.id === over.id);
      if (from >= 0 && to >= 0) next = { ...cells, [current]: arrayMove(list, from, to) };
    }
    setCells(next);
    const list = next[current]!;
    const index = list.findIndex((i) => i.id === active.id);
    if (current === start.key && index === start.index) return;

    const item = list[index]!;
    const [lane, statusId] = splitKey(current);
    const [fromLane] = splitKey(start.key);
    const prev = list[index - 1];
    const following = list[index + 1];
    const body: MoveBody = {
      statusId,
      ...(prev ? { afterItemId: prev.id } : following ? { beforeItemId: following.id } : {}),
    };
    let ask = '';
    if (lane !== fromLane && mode !== 'none') {
      if (mode === 'assignee') {
        body.assigneeId = lane === 'none' ? null : lane;
        const who = server.lanes.find((l) => l.id === lane)?.label ?? 'nobody';
        ask = lane === 'none' ? `Unassign ${item.key}?` : `Assign ${item.key} to ${who}?`;
      } else if (mode === 'priority') body.priority = lane as WorkItem['priority'];
      else body.epicId = lane === 'none' ? null : lane;
    }
    const category = data?.statuses.find((s) => s.id === statusId)?.category;
    if (ask) setConfirmLane({ item, body, text: ask });
    else if (category && movesBlockedForward(item, category)) setBlockedMove({ item, body });
    else {
      move.mutate({ item, body });
      // Moving a card into a Done column earns a little celebration.
      if (category === 'done' && start.key !== current) setBurst((n) => n + 1);
    }
  }

  function onDragCancel() {
    dragging.current = false;
    lastOver.current = null;
    setActiveId(null);
    origin.current = null;
    setCells(server.cells);
  }

  // ---- Actions ----
  const onOpen = useCallback(
    (key: string, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const id = Object.values(cellsRef.current).flat().find((i) => i.key === key)?.id;
        if (id) setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
      } else setOpenItem(key);
    },
    [setOpenItem],
  );
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  /**
   * Which card or column the dragged card is over. Under the pointer when there is one, otherwise by
   * overlap (the keyboard). A column resolves to the nearest card inside it, so the card lands next to
   * its neighbour instead of jumping to the column's end.
   */
  const lastOver = useRef<string | number | null>(null);
  const collide: CollisionDetection = useCallback((args) => {
    const hits = pointerWithin(args);
    const found = hits.length ? hits : rectIntersection(args);
    // While the drag overlay is still being measured, the first reading barely touches anything.
    // That is not a real hover, so the card stays "over itself" until it overlaps something properly.
    const best = Number(found[0]?.data?.value ?? 0);
    if (!hits.length && best < 0.1) {
      return [{ id: lastOver.current ?? args.active.id }];
    }
    let overId = getFirstCollision(found, 'id');
    if (overId == null) return lastOver.current != null ? [{ id: lastOver.current }] : [];
    const inside = cellsRef.current[String(overId)];
    if (inside?.length) {
      const nearest = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => c.id !== overId && inside.some((i) => i.id === c.id),
        ),
      })[0];
      if (nearest) overId = nearest.id;
    }
    lastOver.current = overId;
    return [{ id: overId }];
  }, []);

  const statuses = data?.statuses ?? [];
  const ctx: CardCtx = useMemo(
    () => ({
      spaceKey,
      statuses,
      density,
      fields: data?.board.settings.cardFields ?? [],
      canEdit: perms?.editItem ?? false,
      canDelete,
      onOpen,
      onMove: (item, statusId) => {
        const s = statuses.find((x) => x.id === statusId)!;
        update.mutate({
          item,
          patch: { statusId },
          optimistic: { statusId, status: { id: s.id, name: s.name, category: s.category, color: s.color } },
        });
      },
      onDelete: setToDelete,
      onToggleSelect: (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    }),
    [spaceKey, data?.statuses, density, data?.board.settings.cardFields, perms?.editItem, canDelete, onOpen],
  );

  function toggleCollapsed(id: string) {
    setCollapsed((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writePref(`${prefKey}:${spaceKey}:collapsed`, next);
      return next;
    });
  }
  function toggleLane(id: string) {
    setCollapsedLanes((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writePref(`${prefKey}:${spaceKey}:lanes`, next);
      return next;
    });
  }
  function chooseDensity(d: Density) {
    setDensity(d);
    writePref(`${prefKey}:density`, d);
  }

  async function loadMore(statusId: string, cursor: string) {
    setLoadingMore(statusId);
    try {
      await loadMoreColumn(qc, spaceKey, filterStr, statusId, cursor);
    } catch (e) {
      toastError(e, 'Could not load more');
    } finally {
      setLoadingMore(null);
    }
  }

  /** New cards inherit what the filters imply: one chosen assignee ("my items" too) and one label. */
  async function quickCreate(statusId: string, title: string) {
    const oneAssignee = filters.assignee.length === 1 && filters.assignee[0] !== 'none' ? filters.assignee[0] : undefined;
    try {
      const item = await create.mutateAsync({
        type: 'task',
        title,
        statusId,
        assigneeId: oneAssignee ?? (filters.mine && !filters.assignee.length ? me.user.id : undefined),
        labelIds: filters.label.length === 1 ? filters.label : undefined,
      });
      toast.success(`${item.key} created`);
    } catch (e) {
      toastError(e, `Could not create the ${vocab.noun}`);
    }
  }

  if (board.isPending) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2" aria-busy="true" aria-label="Loading board">
        {[0, 1, 2, 3].map((i) => (
          <ColumnSkeleton key={i} density={density} />
        ))}
      </div>
    );
  }
  if (board.isError || !data || !perms) {
    return <LoadError what="the board" onRetry={() => board.refetch()} />;
  }

  const totalShown = data.columns.reduce((n, c) => n + c.total, 0);
  const totalAll = data.columns.reduce((n, c) => n + c.wipCount, 0);
  const filtered = hasActiveFilters(filters);
  const activeItem = activeId ? itemById(activeId) : undefined;
  const lanes = server.lanes;
  const laned = mode !== 'none';

  const renderCards = (key: string) => {
    const list = cells[key] ?? [];
    return list.map((item) => (
      <SortableCard
        key={item.id}
        item={item}
        ctx={ctx}
        selected={selected.includes(item.id)}
        opened={openRef?.toUpperCase() === item.key}
      />
    ));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <FilterBar space={spaceKey} filters={filters} onChange={setFilters} searchRef={searchRef} />
        </div>
        <SavedFilters
          spaceKey={spaceKey}
          spaceId={space.id}
          current={filterStr}
          onApply={(q) => setFilters(parseFilters(new URLSearchParams(q)))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {filtered ? `${totalShown} of ${vocab.count(totalAll)}` : `${vocab.count(totalAll)} on the board`}
          {board.isFetching && !board.isPending && (
            <Loader2 className="ml-2 inline size-3 animate-spin" aria-label="Refreshing" />
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts">
            <Keyboard />
          </Button>
          <div role="group" aria-label="Card density" className="bg-muted flex rounded-lg p-0.5 text-xs">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={density === d}
                onClick={() => chooseDensity(d)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium capitalize outline-none focus-visible:ring-2',
                  density === d ? 'bg-background shadow-sm' : 'text-muted-foreground',
                )}
              >
                {d}
              </button>
            ))}
          </div>
          {perms.manageBoard && (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 /> Board settings
            </Button>
          )}
          {perms.createItem && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> Create
              <kbd className="bg-primary-foreground/20 ml-1 hidden rounded-sm px-1 text-xs sm:inline">C</kbd>
            </Button>
          )}
        </div>
      </div>

      {data.board.features.includes('sprints') && data.sprint && (
        <div className="bg-primary/5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm">
          <span className="font-medium">{data.sprint.name}</span>
          <span className="text-muted-foreground">{dateRange(data.sprint)}</span>
          {data.sprint.goal && <span className="text-muted-foreground">Goal: {data.sprint.goal}</span>}
          <Link href={`/spaces/${spaceKey}/backlog`} className="text-primary ml-auto hover:underline">
            Backlog
          </Link>
        </div>
      )}
      {data.board.features.includes('sprints') && !data.sprint && !filtered && (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={Kanban}
            title="No active sprint"
            description={`The board shows the running sprint. Plan one and start it from the backlog.`}
            action={
              <Button asChild>
                <Link href={`/spaces/${spaceKey}/backlog`}>Go to the backlog</Link>
              </Button>
            }
          />
        </div>
      )}
      {totalAll === 0 && !filtered && !data.board.features.includes('sprints') && (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={Kanban}
            title={`No ${vocab.nounPlural} yet`}
            description={
              perms.createItem
                ? `Create the first ${vocab.noun} and it appears in the first column. Drag it across as the work progresses.`
                : 'Nothing has been added to this board yet.'
            }
            action={
              perms.createItem ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> Create the first {vocab.noun}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {filtered && totalShown === 0 && (
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={ListFilter}
            title="Nothing matches these filters"
            description="Try removing a filter, or clear them all to see the whole board."
            action={
              <Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        </div>
      )}

      <ConfettiBurst burst={burst} />
      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        // Measure every card's position as a drag begins: cards moved by an earlier drag are elsewhere now.
        measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To pick up a card, press space. Use the arrow keys to move it between and within columns, space to drop it, or escape to cancel.',
          },
        }}
      >
        <div
          ref={scrollRef}
          onKeyDown={onBoardKeyDown}
          className="-mx-1 snap-x snap-mandatory overflow-x-auto px-1 pb-3 sm:snap-none"
          role="region"
          aria-label={`${data.space.name} board`}
        >
          {!laned ? (
            <div className="flex items-start gap-3">
              {statuses.map((status) => {
                const col = data.columns.find((c) => c.statusId === status.id);
                const key = cellKey('all', status.id);
                const list = cells[key] ?? [];
                const isCollapsed = collapsed.includes(status.id);
                return (
                  <BoardColumn
                    key={status.id}
                    category={status.category}
                    density={density}
                    collapsed={isCollapsed}
                    className="max-h-[calc(100dvh-20rem)] min-h-40 snap-start max-sm:w-[85vw]"
                    header={
                      <ColumnHeader
                        name={status.name}
                        category={status.category}
                        color={status.color}
                        count={col?.wipCount ?? 0}
                        total={col?.total ?? 0}
                        wipLimit={status.wipLimit}
                        collapsed={isCollapsed}
                        onToggle={() => toggleCollapsed(status.id)}
                      />
                    }
                    footer={
                      perms.createItem ? (
                        <ColumnCreateRow busy={create.isPending} onCreate={(title) => quickCreate(status.id, title)} />
                      ) : undefined
                    }
                  >
                    <Cell
                      id={key}
                      ids={list.map((i) => i.id)}
                      lane="all"
                      label={`${status.name}, ${vocab.count(col?.total ?? 0)}`}
                      dragging={!!activeId}
                      className="min-h-16"
                    >
                      {list.length === 0 && (
                        <p className="text-muted-foreground px-2 py-6 text-center text-xs">
                          {filtered ? `No matching ${vocab.nounPlural}` : perms.createItem ? `No ${vocab.nounPlural}. Create one below.` : `No ${vocab.nounPlural}`}
                        </p>
                      )}
                      {renderCards(key)}
                    </Cell>
                    {col?.nextCursor && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loadingMore === status.id}
                        onClick={() => loadMore(status.id, col.nextCursor!)}
                        className="text-muted-foreground shrink-0"
                      >
                        {loadingMore === status.id ? 'Loading…' : `Show more (${col.total - col.items.length} left)`}
                      </Button>
                    )}
                  </BoardColumn>
                );
              })}
            </div>
          ) : (
            <div className="min-w-max space-y-3">
              <div className="bg-background/95 sticky top-0 z-20 flex gap-3 pb-1">
                {statuses.map((status) => {
                  const col = data.columns.find((c) => c.statusId === status.id);
                  return (
                    <div
                      key={status.id}
                      className={cn('bg-muted/50 rounded-lg px-3 py-3', density === 'compact' ? 'w-[264px]' : 'w-[288px]')}
                    >
                      <ColumnHeader
                        name={status.name}
                        category={status.category}
                        color={status.color}
                        count={col?.wipCount ?? 0}
                        total={col?.total ?? 0}
                        wipLimit={status.wipLimit}
                      />
                    </div>
                  );
                })}
              </div>
              {lanes.map((lane) => {
                const open = !collapsedLanes.includes(lane.id);
                const count = statuses.reduce((n, s) => n + (cells[cellKey(lane.id, s.id)]?.length ?? 0), 0);
                return (
                  <section key={lane.id} aria-label={`Lane: ${lane.label}`} className="space-y-2">
                    <button
                      type="button"
                      onClick={() => toggleLane(lane.id)}
                      aria-expanded={open}
                      className="hover:bg-accent sticky left-0 flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2"
                    >
                      <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} aria-hidden />
                      {lane.person !== undefined ? (
                        <UserAvatar person={lane.person} size={20} />
                      ) : lane.id === 'none' && mode === 'assignee' ? (
                        <UserAvatar person={null} size={20} />
                      ) : null}
                      {lane.label}
                      <span className="text-muted-foreground text-xs font-normal tabular-nums">{count}</span>
                    </button>
                    {open && (
                      <div className="flex gap-3">
                        {statuses.map((status) => {
                          const key = cellKey(lane.id, status.id);
                          const list = cells[key] ?? [];
                          return (
                            <Cell
                              key={key}
                              id={key}
                              ids={list.map((i) => i.id)}
                              lane={lane.id}
                              label={`${lane.label}, ${status.name}, ${vocab.count(list.length)}`}
                              dragging={!!activeId}
                              className={cn('bg-muted/50 min-h-20 shrink-0 p-2', density === 'compact' ? 'w-[264px]' : 'w-[288px]')}
                            >
                              {renderCards(key)}
                            </Cell>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
              {statuses.some((s) => data.columns.find((c) => c.statusId === s.id)?.nextCursor) && (
                <p className="text-muted-foreground text-xs">
                  Only the first 50 cards of each column are loaded. Turn swimlanes off to load more.
                </p>
              )}
            </div>
          )}
        </div>

        {/* In the page body, not inside the layout: a transformed ancestor would offset a fixed overlay. */}
        {createPortal(
                  <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activeItem ? (
              <div className={density === 'compact' ? 'w-[248px]' : 'w-[272px]'}>
                <WorkItemCard item={activeItem} density={density} fields={ctx.fields} overlay />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>

      {selected.length > 0 && (
        <BulkBar
          space={spaceKey}
          ids={selected}
          statuses={statuses}
          canDelete={perms.editItem}
          onClear={() => setSelected([])}
        />
      )}

      {/* The open item: a side panel, so the board stays visible behind it. */}
      <Sheet open={!!openRef} onOpenChange={(o) => !o && setOpenItem(null)}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-3xl">
          <SheetTitle className="sr-only">Work item {openRef}</SheetTitle>
          <SheetDescription className="sr-only">Details and fields for the selected work item</SheetDescription>
          {openRef && (
            <ItemDetail
              itemRef={openRef}
              variant="panel"
              onClose={() => setOpenItem(null)}
              onOpenItem={(key) => setOpenItem(key)}
            />
          )}
        </SheetContent>
      </Sheet>

      <CreateItemDialog
        spaceKey={spaceKey}
        statuses={statuses}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaults={{
          assignee:
            filters.assignee.length === 1 && filters.assignee[0] !== 'none'
              ? (data.columns.flatMap((c) => c.items).find((i) => i.assignee?.id === filters.assignee[0])?.assignee ?? null)
              : filters.mine && !filters.assignee.length
                ? { id: me.user.id, name: me.user.name, email: me.user.email, avatarUrl: me.user.avatarUrl }
                : null,
        }}
      />

      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {perms.manageBoard && (
        <BoardSettingsSheet
          spaceKey={spaceKey}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          board={data.board}
          onSaved={() => qc.invalidateQueries({ queryKey: boardKey(spaceKey) })}
        />
      )}

      <BlockedMoveDialog
        item={blockedMove?.item ?? null}
        onConfirm={() => {
          const pending = blockedMove!;
          setBlockedMove(null);
          move.mutate({ item: pending.item, body: pending.body });
        }}
        onCancel={() => {
          setBlockedMove(null);
          setCells(server.cells);
        }}
      />

      <AlertDialog open={!!confirmLane} onOpenChange={(o) => !o && (setConfirmLane(null), setCells(server.cells))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmLane?.text}</AlertDialogTitle>
            <AlertDialogDescription>
              Dropping a card into another person’s lane changes who it is assigned to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = confirmLane!;
                setConfirmLane(null);
                move.mutate({ item: pending.item, body: pending.body });
              }}
            >
              Change assignee
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{toDelete?.title}” will be removed from the board and from search
              {toDelete && toDelete.subtasks.total > 0 && toDelete.type !== 'epic'
                ? `, along with its ${toDelete.subtasks.total} subtask${toDelete.subtasks.total === 1 ? '' : 's'}`
                : ''}
              . The history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = toDelete!;
                del.mutate(target, {
                  onSuccess: () => {
                    toast.success(`${target.key} deleted`);
                    if (openRef?.toUpperCase() === target.key) setOpenItem(null);
                  },
                });
                setToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CardMenu({
  item,
  statuses,
  canEdit,
  canDelete,
  spaceKey,
  selected,
  onOpen,
  onMove,
  onDelete,
  onToggleSelect,
}: {
  item: WorkItem;
  statuses: BoardData['statuses'];
  canEdit: boolean;
  canDelete: boolean;
  spaceKey: string;
  selected: boolean;
  onOpen: () => void;
  onMove: (statusId: string) => void;
  onDelete: () => void;
  onToggleSelect: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label={`Actions for ${item.key}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
        {canEdit && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {statuses
                .filter((s) => s.id !== item.statusId)
                .map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)}>
                    {s.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {canEdit && (
          <DropdownMenuItem onSelect={onToggleSelect}>
            <SquareCheck /> {selected ? 'Unselect' : 'Select'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await navigator.clipboard.writeText(`${window.location.origin}/spaces/${spaceKey}/items/${item.key}`);
              toast.success('Link copied');
            } catch {
              toast.error('Could not copy');
            }
          }}
        >
          <Link2 /> Copy link
        </DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
