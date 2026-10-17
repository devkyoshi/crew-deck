'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Columns3, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useMe } from '@/components/shell/me-context';
import { useSpace } from '@/components/spaces/space-context';
import { formatDue, PRIORITY_META, type BoardData, type WorkItem } from '@/lib/work';
import { useStatuses } from '@/lib/work-api';
import { csvHref, LIST_SORTS, useItemList, type ListSort } from '@/lib/work-find-api';
import {
  FILTER_KEYS,
  filterString,
  hasActiveFilters,
  NO_FILTERS,
  parseFilters,
  type Filters,
} from '@/lib/work-filters';
import { cn } from '@/lib/utils';
import { BulkBar } from './bulk-bar';
import { FilterBar } from './filter-bar';
import { ItemSheet, useUrlState } from './item-sheet';
import { SavedFilters } from './saved-filters';
import { SlaSummary } from './sla-badge';
import { NewTicketButton } from './new-ticket';
import { useVocabulary } from './use-vocabulary';
import { PriorityIcon, StatusChip, TypeIcon, UserAvatar } from './work-bits';

type ColumnId =
  | 'type'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'estimate'
  | 'due'
  | 'labels'
  | 'updated'
  | 'created'
  | 'reporter'
  | 'sla';

const COLUMNS: { id: ColumnId; label: string; sort?: ListSort }[] = [
  { id: 'type', label: 'Type' },
  { id: 'status', label: 'Status', sort: 'status' },
  { id: 'priority', label: 'Priority', sort: 'priority' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'estimate', label: 'Estimate', sort: 'estimate' },
  { id: 'due', label: 'Due', sort: 'due' },
  { id: 'labels', label: 'Labels' },
  { id: 'updated', label: 'Updated', sort: 'updated' },
  { id: 'created', label: 'Created', sort: 'created' },
  { id: 'reporter', label: 'Requester' },
  { id: 'sla', label: 'Deadline' },
];
const DEFAULT_COLUMNS: ColumnId[] = ['type', 'status', 'priority', 'assignee', 'due'];
/** A service desk's queue leads with who asked and how the deadline stands. */
const SERVICE_COLUMNS: ColumnId[] = ['reporter', 'status', 'priority', 'assignee', 'sla'];

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function readColumns(key: string, fallback: ColumnId[]): ColumnId[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
    if (Array.isArray(v)) return v.filter((c): c is ColumnId => COLUMNS.some((x) => x.id === c));
  } catch {
    // storage unavailable
  }
  return fallback;
}

/** Every item of the space as a sortable table, sharing the board's filters, selection and bulk actions. */
export function ListView({ ticketsOnly = false }: { ticketsOnly?: boolean } = {}) {
  const space = useSpace();
  const me = useMe();
  const vocab = useVocabulary();
  const { params, push } = useUrlState();
  const filters = useMemo(() => {
    const parsed = parseFilters(new URLSearchParams(params.toString()));
    // The tickets queue is the list narrowed to tickets, whatever the URL says about type.
    return ticketsOnly ? { ...parsed, type: ['ticket' as const] } : parsed;
  }, [params, ticketsOnly]);
  const filterStr = filterString(filters);
  const sort = (LIST_SORTS as readonly string[]).includes(params.get('sort') ?? '')
    ? (params.get('sort') as ListSort)
    : 'key';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const list = useItemList(space.key, filterStr, sort, dir);
  const statuses = useStatuses(space.key);
  const [selected, setSelected] = useState<string[]>([]);
  const isService = ticketsOnly;
  const defaults = isService ? SERVICE_COLUMNS : DEFAULT_COLUMNS;
  const prefKey = `list:${me.user.id}:${isService ? 'queue' : 'columns'}`;
  const [columns, setColumns] = useState<ColumnId[]>(defaults);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => setColumns(readColumns(prefKey, defaults)), [prefKey]);

  const setFilters = (next: Filters) =>
    push((p) => {
      for (const k of FILTER_KEYS) p.delete(k);
      new URLSearchParams(filterString(next)).forEach((v, k) => p.set(k, v));
    }, true);
  const setSort = (s: ListSort) =>
    push((p) => {
      p.set('sort', s);
      p.set('dir', s === sort && dir === 'desc' ? 'asc' : 'desc');
    }, true);
  const toggleColumn = (id: ColumnId) => {
    const next = columns.includes(id)
      ? columns.filter((c) => c !== id)
      : COLUMNS.map((c) => c.id).filter((c) => c === id || columns.includes(c));
    setColumns(next);
    try {
      window.localStorage.setItem(prefKey, JSON.stringify(next));
    } catch {
      // storage unavailable
    }
  };

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const first = list.data?.pages[0];
  const total = first?.total ?? 0;
  const canEdit = !!first?.permissions.editItem;
  // Only the rows in view are drawn; blank spacer rows keep the scrollbar honest for long lists.
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 41,
    overscan: 12,
  });
  const rows = virtual.getVirtualItems();
  const padTop = rows.length ? rows[0]!.start : 0;
  const padBottom = rows.length ? virtual.getTotalSize() - rows[rows.length - 1]!.end : 0;
  const colSpan = 2 + (canEdit ? 1 : 0) + columns.length;
  const allSelected = items.length > 0 && items.every((i) => selected.includes(i.id));
  const open = (key: string) => push((p) => p.set('item', key));

  const SortHeader = ({
    label,
    s,
    className,
  }: {
    label: string;
    s?: ListSort;
    className?: string;
  }) => (
    <th
      scope="col"
      className={cn('px-3 py-2 text-left font-medium', className)}
      aria-sort={s && sort === s ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {s ? (
        <button
          type="button"
          onClick={() => setSort(s)}
          className="hover:text-foreground inline-flex items-center gap-1"
        >
          {label}
          {sort === s &&
            (dir === 'asc' ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            ))}
        </button>
      ) : (
        label
      )}
    </th>
  );

  const cell = (item: WorkItem, id: ColumnId) => {
    switch (id) {
      case 'type':
        return <TypeIcon type={item.type} />;
      case 'status':
        return (
          <StatusChip
            name={item.status.name}
            category={item.status.category}
            color={item.status.color}
          />
        );
      case 'priority':
        return (
          <span className="inline-flex items-center gap-1.5">
            <PriorityIcon priority={item.priority} /> {PRIORITY_META[item.priority].label}
          </span>
        );
      case 'assignee':
        return item.assignee ? (
          <span className="inline-flex items-center gap-1.5">
            <UserAvatar person={item.assignee} size={20} />
            <span className="truncate">{item.assignee.name ?? item.assignee.email}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        );
      case 'estimate':
        return item.estimate ?? '';
      case 'due':
        return item.dueDate ? formatDue(item.dueDate) : '';
      case 'labels':
        return item.labels.map((l) => l.name).join(', ');
      case 'updated':
        return shortDate(item.updatedAt);
      case 'created':
        return shortDate(item.createdAt);
      case 'reporter':
        return (
          <span className="inline-flex items-center gap-1.5">
            <UserAvatar person={item.reporter} size={20} />
            <span className="truncate">{item.reporter.name ?? item.reporter.email}</span>
          </span>
        );
      case 'sla':
        return item.sla ? <SlaSummary sla={item.sla} /> : '';
    }
  };

  return (
    <div className="space-y-4">
      {isService && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show tickets" className="flex flex-wrap gap-1.5">
            {(
              [
                ['', 'All'],
                ['breached', 'Missed deadline'],
                ['due_soon', 'Due soon'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.sla === value}
                onClick={() => setFilters({ ...filters, sla: value })}
                className={cn(
                  'hover:bg-accent rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-2',
                  filters.sla === value && 'border-primary bg-accent ring-primary/30 font-medium ring-1',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <NewTicketButton spaceKey={space.key} statuses={statuses.data?.items ?? []} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <FilterBar
            space={space.key}
            filters={filters}
            onChange={setFilters}
            searchRef={searchRef}
          />
        </div>
        <SavedFilters
          spaceKey={space.key}
          spaceId={space.id}
          current={filterStr}
          onApply={(q) => setFilters(parseFilters(new URLSearchParams(q)))}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <Columns3 /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={columns.includes(c.id)}
                onCheckedChange={() => toggleColumn(c.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="h-8" asChild>
          <a href={csvHref(space.key, filterStr, sort, dir)} download>
            <Download /> Export CSV
          </a>
        </Button>
      </div>

      {list.isError ? (
        <LoadError what={`the ${vocab.nounPlural}`} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <p className="text-muted-foreground text-sm" aria-busy="true">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          title={
            hasActiveFilters(filters)
              ? `No matching ${vocab.nounPlural}`
              : `No ${vocab.nounPlural} yet`
          }
          description={
            hasActiveFilters(filters)
              ? 'Try other filters.'
              : isService
                ? 'Raise a ticket to start the queue.'
                : `Create ${vocab.nounPlural} from the board.`
          }
          action={
            hasActiveFilters(filters) ? (
              <Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div ref={scrollRef} className="bg-card max-h-[70vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {vocab.Noun} list, {vocab.count(total)}
            </caption>
            <thead className="text-muted-foreground bg-card sticky top-0 z-10 border-b text-xs">
              <tr>
                {canEdit && (
                  <th scope="col" className="w-10 px-3 py-2">
                    <Checkbox
                      aria-label="Select all shown"
                      checked={allSelected}
                      onCheckedChange={(v) => setSelected(v === true ? items.map((i) => i.id) : [])}
                    />
                  </th>
                )}
                <SortHeader label="Key" s="key" className="w-24" />
                <SortHeader label="Title" s="title" />
                {COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
                  <SortHeader key={c.id} label={c.label} s={c.sort} className="whitespace-nowrap" />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {padTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={colSpan} style={{ height: padTop, padding: 0 }} />
                </tr>
              )}
              {rows.map((vr) => {
                const item = items[vr.index]!;
                return (
                  <tr
                    key={item.id}
                    data-index={vr.index}
                    ref={virtual.measureElement}
                    className={cn(
                      'hover:bg-muted/40',
                      selected.includes(item.id) && 'bg-primary/5',
                    )}
                  >
                    {canEdit && (
                      <td className="px-3 py-2">
                        <Checkbox
                          aria-label={`Select ${item.key}`}
                          checked={selected.includes(item.id)}
                          onCheckedChange={(v) =>
                            setSelected((s) =>
                              v === true ? [...s, item.id] : s.filter((x) => x !== item.id),
                            )
                          }
                        />
                      </td>
                    )}
                    <td className="text-muted-foreground px-3 py-2 tabular-nums whitespace-nowrap">
                      {item.key}
                    </td>
                    <td className="max-w-md px-3 py-2">
                      <button
                        type="button"
                        onClick={() => open(item.key)}
                        className="w-full truncate text-left font-medium hover:underline"
                      >
                        {item.title}
                      </button>
                    </td>
                    {COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
                      <td key={c.id} className="px-3 py-2 whitespace-nowrap">
                        {cell(item, c.id)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {padBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={colSpan} style={{ height: padBottom, padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span aria-live="polite">{total > 0 && `${items.length} of ${vocab.count(total)}`}</span>
        {list.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {list.isFetchingNextPage && <Loader2 className="animate-spin" />} Show more
          </Button>
        )}
      </div>

      {selected.length > 0 && statuses.data && (
        <BulkBar
          space={space.key}
          ids={selected}
          statuses={statuses.data.items as BoardData['statuses']}
          canDelete={canEdit}
          onClear={() => setSelected([])}
        />
      )}
      <ItemSheet />
    </div>
  );
}
