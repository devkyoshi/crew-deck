'use client';

import { Notice } from '@/components/shared/notice';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, KanbanSquare, MoreHorizontal, Plus, Search, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { api, ApiError, qs } from '@/lib/api';
import {
  money,
  recordHref,
  totalsText,
  useCrmAccess,
  type Board,
  type BoardColumn,
  type Deal,
} from '@/lib/crm';
import { cn } from '@/lib/utils';
import { CrmGate, TagList, useDebounced } from './crm-bits';
import { ENTITIES } from './entities';
import { RecordDialog, toBody } from './record-dialog';
import { RecordList } from './record-list';

type View = 'board' | 'table';

function CardBody({
  deal,
  columns,
  onMove,
  canEdit,
  handle,
}: {
  deal: Deal;
  columns: BoardColumn[];
  onMove: (stageId: string) => void;
  canEdit: boolean;
  handle?: React.ReactNode;
}) {
  const overdue =
    deal.status === 'open' &&
    deal.expectedClose &&
    deal.expectedClose < new Date().toISOString().slice(0, 10);
  return (
    <div
      className="bg-card flex items-start gap-1 rounded-xl border p-3 shadow-xs"
      data-testid="deal-card"
    >
      {handle}
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={recordHref('deal', deal.id)}
          className="block truncate font-medium hover:underline"
        >
          {deal.title}
        </Link>
        <p className="text-muted-foreground truncate text-xs">{deal.companyName ?? 'No company'}</p>
        <p className="flex items-center justify-between text-sm">
          <span className="font-medium tabular-nums">{money(deal.value, deal.currency)}</span>
          {deal.expectedClose && (
            <span
              className={cn(
                'text-xs',
                overdue ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-muted-foreground',
              )}
            >
              {overdue ? 'Overdue · ' : ''}
              {new Date(deal.expectedClose + 'T12:00:00').toLocaleDateString('en', {
                day: 'numeric',
                month: 'short',
              })}
            </span>
          )}
        </p>
        {deal.tags.length > 0 && <TagList tags={deal.tags} />}
      </div>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Actions for ${deal.title}`}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
            {columns.map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={c.id === deal.stageId}
                onSelect={() => onMove(c.id)}
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function SortableCard({
  deal,
  columns,
  onMove,
  canEdit,
}: {
  deal: Deal;
  columns: BoardColumn[];
  onMove: (stageId: string) => void;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stageId: deal.stageId },
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
    >
      <CardBody
        deal={deal}
        columns={columns}
        onMove={onMove}
        canEdit={canEdit}
        handle={
          canEdit && (
            <button
              type="button"
              aria-label={`Drag ${deal.title}`}
              className="text-muted-foreground hover:text-foreground -ml-1 mt-0.5 cursor-grab touch-none rounded p-0.5"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          )
        }
      />
    </li>
  );
}

function QuickAdd({
  stageId,
  pipelineId,
  onAdded,
}: {
  stageId: string;
  pipelineId: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      api('/crm/deals', { method: 'POST', body: { title: title.trim(), stageId, pipelineId } }),
    onSuccess: () => {
      setTitle('');
      setOpen(false);
      onAdded();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add the deal'),
  });
  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden /> Add deal
      </Button>
    );
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!title.trim()) return setError('Enter a title');
        add.mutate();
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Deal title"
        aria-label="New deal title"
        maxLength={160}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={add.isPending}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <Notice variant="error">{error}</Notice>}
    </form>
  );
}

function Column({
  col,
  columns,
  pipelineId,
  canEdit,
  onMove,
  onAdded,
}: {
  col: BoardColumn;
  columns: BoardColumn[];
  pipelineId: string;
  canEdit: boolean;
  onMove: (dealId: string, stageId: string) => void;
  onAdded: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}`, data: { stageId: col.id } });
  return (
    <section
      aria-label={`${col.name}, ${col.count} deals`}
      className={cn(
        'bg-muted/50 flex w-72 shrink-0 flex-col rounded-2xl p-2',
        isOver && 'ring-primary ring-2',
      )}
    >
      <header className="px-2 py-1.5">
        <h3 className="flex items-center justify-between text-sm font-semibold">
          <span>{col.name}</span>
          <span className="text-muted-foreground rounded-full bg-background px-2 text-xs font-normal tabular-nums">
            {col.count}
          </span>
        </h3>
        <p className="text-muted-foreground text-xs tabular-nums">{totalsText(col.totals)}</p>
      </header>
      <ul ref={setNodeRef} className="min-h-12 flex-1 space-y-2 p-1">
        <SortableContext items={col.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {col.deals.map((d) => (
            <SortableCard
              key={d.id}
              deal={d}
              columns={columns}
              canEdit={canEdit}
              onMove={(stageId) => onMove(d.id, stageId)}
            />
          ))}
        </SortableContext>
        {col.count > col.deals.length && (
          <li className="text-muted-foreground px-1 text-xs">
            Showing {col.deals.length} of {col.count}. Use search to narrow down.
          </li>
        )}
      </ul>
      {canEdit && !col.isWon && !col.isLost && (
        <QuickAdd stageId={col.id} pipelineId={pipelineId} onAdded={onAdded} />
      )}
    </section>
  );
}

/** Pure helper: the board after a card moved to `stageId`, placed before `beforeDealId` (or last). */
export function applyMove(
  board: Board,
  dealId: string,
  stageId: string,
  beforeDealId: string | null,
): Board {
  let moved: Deal | undefined;
  const without = board.columns.map((c) => {
    const found = c.deals.find((d) => d.id === dealId);
    if (found) moved = found;
    return { ...c, deals: c.deals.filter((d) => d.id !== dealId) };
  });
  if (!moved) return board;
  const card = { ...moved, stageId };
  const columns = without.map((c) => {
    if (c.id !== stageId) return c;
    const at = beforeDealId ? c.deals.findIndex((d) => d.id === beforeDealId) : -1;
    const deals = [...c.deals];
    deals.splice(at === -1 ? deals.length : at, 0, card);
    return { ...c, deals };
  });
  // Counts and totals follow the cards that are shown; the server sends the real figures on refresh.
  return {
    ...board,
    columns: columns.map((c) => {
      const was = board.columns.find((x) => x.id === c.id)!;
      const delta = c.deals.length - was.deals.length;
      const totals: Record<string, number> = {};
      for (const d of c.deals) totals[d.currency] = (totals[d.currency] ?? 0) + d.value;
      return delta === 0 && c.deals.every((d, i) => d.id === was.deals[i]?.id)
        ? c
        : { ...c, count: was.count + delta, totals };
    }),
  };
}

function BoardView({ params }: { params: Record<string, string | undefined> }) {
  const qc = useQueryClient();
  const canEdit = useCrmAccess().data?.canEdit ?? false;
  const key = useMemo(() => ['crm', 'board', params], [params]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<Board>(`/crm/deals/board${qs(params)}`),
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = useMutation({
    mutationFn: (v: { dealId: string; stageId: string; beforeDealId: string | null }) =>
      api(`/crm/deals/${v.dealId}/move`, {
        method: 'POST',
        body: { stageId: v.stageId, beforeDealId: v.beforeDealId },
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Board>(key);
      if (prev) qc.setQueryData<Board>(key, applyMove(prev, v.dealId, v.stageId, v.beforeDealId));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e instanceof ApiError ? e.message : 'Could not move the deal');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading board" className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-72 shrink-0 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorView error={query.error} reset={() => query.refetch()} />;

  const board = query.data;
  const all = board.columns.flatMap((c) => c.deals);
  const byId = new Map(all.map((d) => [d.id, d]));
  const stageName = (id: string | undefined) =>
    board.columns.find((c) => c.id === id || `col:${c.id}` === id)?.name ?? 'a column';
  const titleOf = (id: string | number) => byId.get(String(id))?.title ?? 'deal';
  const stageOfOver = (overId: string | number | undefined) => {
    if (overId === undefined) return undefined;
    const s = String(overId);
    if (s.startsWith('col:')) return s.slice(4);
    return byId.get(s)?.stageId;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is over ${stageName(stageOfOver(over.id))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} was dropped in ${stageName(stageOfOver(over.id))}.`
        : `${titleOf(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const dealId = String(e.active.id);
    const deal = byId.get(dealId);
    if (!deal || !e.over) return;
    const overId = String(e.over.id);
    const stageId = stageOfOver(overId);
    if (!stageId) return;
    const target = board.columns.find((c) => c.id === stageId)!;
    let beforeDealId: string | null = null;
    if (!overId.startsWith('col:') && overId !== dealId) {
      const idx = target.deals.findIndex((d) => d.id === overId);
      const from = target.deals.findIndex((d) => d.id === dealId);
      // Dragging down within a column drops after the card you are over.
      const after = stageId === deal.stageId && from !== -1 && from < idx;
      beforeDealId = after ? (target.deals[idx + 1]?.id ?? null) : overId;
    } else if (overId === dealId) {
      return;
    }
    if (stageId === deal.stageId && beforeDealId === null && target.deals.at(-1)?.id === dealId)
      return;
    move.mutate({ dealId, stageId, beforeDealId });
  }

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements }}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4" data-testid="deal-board">
        {board.columns.map((c) => (
          <Column
            key={c.id}
            col={c}
            columns={board.columns}
            pipelineId={board.pipeline.id}
            canEdit={canEdit}
            onMove={(dealId, stageId) => move.mutate({ dealId, stageId, beforeDealId: null })}
            onAdded={() => qc.invalidateQueries({ queryKey: ['crm'] })}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <CardBody deal={active} columns={board.columns} canEdit={false} onMove={() => {}} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function DealsView() {
  return (
    <CrmGate>
      <DealsInner />
    </CrmGate>
  );
}

function DealsInner() {
  const qc = useQueryClient();
  const access = useCrmAccess().data;
  const def = ENTITIES.deal;
  const [view, setView] = useState<View>('board');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const pipelines = useQuery({
    queryKey: ['crm', 'pipelines'],
    queryFn: () =>
      api<{ items: { id: string; name: string; isDefault: boolean }[] }>('/crm/pipelines'),
  });
  const params = useMemo(() => ({ q: q || undefined, pipelineId }), [q, pipelineId]);
  const fieldKeys = def.fields.map((f) => f.key);

  return (
    <div>
      <PageHeader
        title="Deals"
        description="Drag cards between stages, or use the card menu to move them with the keyboard."
        action={
          access?.canEdit && (
            <RecordDialog
              title="New deal"
              fields={def.fields}
              initial={def.blank}
              submitLabel="Create deal"
              successMessage="Deal created"
              trigger={
                <Button>
                  <Plus className="size-4" aria-hidden /> New deal
                </Button>
              }
              onSubmit={async (v) => {
                await api('/crm/deals', {
                  method: 'POST',
                  body: { ...toBody(v, fieldKeys), pipelineId },
                });
                await qc.invalidateQueries({ queryKey: ['crm'] });
              }}
            />
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals or companies"
            aria-label="Search deals or companies"
            className="pl-9"
          />
        </div>
        {pipelines.data && pipelines.data.items.length > 1 && (
          <Select
            value={pipelineId ?? pipelines.data.items.find((p) => p.isDefault)?.id}
            onValueChange={setPipelineId}
          >
            <SelectTrigger className="w-48" aria-label="Pipeline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pipelines.data.items.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div role="group" aria-label="View" className="ml-auto flex rounded-xl border p-0.5">
          {(
            [
              ['board', 'Board', KanbanSquare],
              ['table', 'Table', Table2],
            ] as const
          ).map(([v, label, Icon]) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={view === v ? 'secondary' : 'ghost'}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </Button>
          ))}
        </div>
      </div>
      {view === 'board' ? <BoardView params={params} /> : <RecordList type="deal" bare />}
    </div>
  );
}
