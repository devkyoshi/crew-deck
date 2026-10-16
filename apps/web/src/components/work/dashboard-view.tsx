'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoadError } from '@/components/shared/load-error';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, qs, ApiError, type Page, type Space } from '@/lib/api';
import { useBacklog } from '@/lib/sprints-api';
import { useMyItems, useSavedFilters } from '@/lib/work-find-api';
import { useVersions } from '@/lib/versions-api';
import { toastError } from '@/lib/work-api';
import type { WorkItem } from '@/lib/work';
import { FoundItems } from './found-items';
import { ItemSheet } from './item-sheet';

type GadgetType = 'assigned' | 'filter' | 'sprint' | 'versions' | 'flow';
interface Gadget {
  id: string;
  type: GadgetType;
  spaceId: string | null;
  filterId: string | null;
}

const TYPES: { type: GadgetType; label: string; needsSpace: boolean; hint: string }[] = [
  {
    type: 'assigned',
    label: 'Assigned to me',
    needsSpace: false,
    hint: 'Open work assigned to you in every space.',
  },
  {
    type: 'filter',
    label: 'Saved filter',
    needsSpace: false,
    hint: 'The results of a filter you saved.',
  },
  {
    type: 'sprint',
    label: 'Sprint health',
    needsSpace: true,
    hint: 'How the running sprint of a Scrum space is going.',
  },
  {
    type: 'versions',
    label: 'Release progress',
    needsSpace: true,
    hint: 'How far along the open releases of a space are.',
  },
  {
    type: 'flow',
    label: 'Created vs resolved',
    needsSpace: true,
    hint: 'Work added against work finished in the last 14 days (Business plan).',
  },
];

const key = 'dashboard';
const useDashboard = () =>
  useQuery({
    queryKey: [key],
    queryFn: () => api<{ gadgets: Gadget[]; custom: boolean }>('/me/dashboard'),
  });

function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gadgets: Omit<Gadget, 'id'>[] | Gadget[]) =>
      api<{ gadgets: Gadget[]; custom: boolean }>('/me/dashboard', {
        method: 'PUT',
        body: { gadgets },
      }),
    onSuccess: (data) => qc.setQueryData([key], data),
  });
}
function useResetDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ gadgets: Gadget[]; custom: boolean }>('/me/dashboard', { method: 'DELETE' }),
    onSuccess: (data) => qc.setQueryData([key], data),
  });
}
const useSpaces = () =>
  useQuery({
    queryKey: ['spaces', 'dashboard-picker'],
    queryFn: () => api<Page<Space>>(`/spaces${qs({ status: 'active', pageSize: 100, page: 1 })}`),
  });

/** A personal dashboard of tiles: pick what matters, in the order you want. */
export function DashboardView() {
  const dash = useDashboard();
  const save = useSaveDashboard();
  const reset = useResetDashboard();
  const [adding, setAdding] = useState(false);

  if (dash.isError) return <LoadError what="your dashboard" onRetry={() => void dash.refetch()} />;
  if (!dash.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const gadgets = dash.data.gadgets;

  const persist = (next: Gadget[]) =>
    save.mutate(next, { onError: (e) => toastError(e, 'Could not save your dashboard') });
  const move = (i: number, by: number) => {
    const next = [...gadgets];
    const [g] = next.splice(i, 1);
    next.splice(i + by, 0, g!);
    persist(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setAdding(true)} disabled={gadgets.length >= 12}>
          <Plus /> Add a tile
        </Button>
        {dash.data.custom && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => reset.mutate(undefined, { onError: (e) => toastError(e) })}
          >
            <RotateCcw /> Back to the default
          </Button>
        )}
        <span className="text-muted-foreground text-xs">{gadgets.length} of 12 tiles</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {gadgets.map((g, i) => (
          <section
            key={g.id}
            aria-label={TYPES.find((t) => t.type === g.type)?.label}
            className="bg-card space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-center gap-1">
              <h2 className="font-semibold">{TYPES.find((t) => t.type === g.type)?.label}</h2>
              <div className="ml-auto flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Move down"
                  disabled={i === gadgets.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Remove this tile"
                  onClick={() => persist(gadgets.filter((x) => x.id !== g.id))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <GadgetBody gadget={g} />
          </section>
        ))}
      </div>
      <ItemSheet />

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onAdd={(g) => {
            persist([...gadgets, { ...g, id: crypto.randomUUID() }]);
            setAdding(false);
            toast.success('Tile added');
          }}
        />
      )}
    </div>
  );
}

function GadgetBody({ gadget }: { gadget: Gadget }) {
  switch (gadget.type) {
    case 'assigned':
      return <AssignedGadget />;
    case 'filter':
      return <FilterGadget filterId={gadget.filterId} />;
    case 'sprint':
      return <SprintGadget space={gadget.spaceId} />;
    case 'versions':
      return <VersionsGadget space={gadget.spaceId} />;
    case 'flow':
      return <FlowGadget space={gadget.spaceId} />;
  }
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground text-sm">{children}</p>
);

function AssignedGadget() {
  const mine = useMyItems('assigned', 'open');
  if (mine.isError) return <LoadError what="your work" onRetry={() => void mine.refetch()} />;
  if (!mine.data) return <Note>Loading…</Note>;
  if (mine.data.items.length === 0) return <Note>Nothing is assigned to you.</Note>;
  return (
    <div className="space-y-2">
      <FoundItems items={mine.data.items.slice(0, 8)} />
      {mine.data.items.length > 8 && (
        <Link href="/my-work" className="text-primary text-sm hover:underline">
          See all {mine.data.items.length} in My work
        </Link>
      )}
    </div>
  );
}

function FilterGadget({ filterId }: { filterId: string | null }) {
  const filters = useSavedFilters();
  const filter = filters.data?.items.find((f) => f.id === filterId);
  const results = useQuery({
    queryKey: ['gadget-filter', filter?.id, filter?.query],
    enabled: !!filter?.spaceId,
    queryFn: () =>
      api<{ items: WorkItem[]; total: number }>(
        `/spaces/${filter!.spaceId}/list?${filter!.query}${filter!.query ? '&' : ''}limit=8`,
      ),
  });
  if (filters.isError || results.isError)
    return <Note>This filter is not available to you any more.</Note>;
  if (!filters.data) return <Note>Loading…</Note>;
  if (!filter) return <Note>This filter was deleted. Remove the tile or pick another.</Note>;
  if (!filter.spaceId)
    return <Note>“{filter.name}” is not tied to a space, so it cannot be shown here.</Note>;
  if (!results.data) return <Note>Loading…</Note>;
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        {filter.name} · {results.data.total} {results.data.total === 1 ? 'result' : 'results'}
      </p>
      {results.data.items.length ? (
        <FoundItems items={results.data.items} showSpace={false} />
      ) : (
        <Note>No results.</Note>
      )}
    </div>
  );
}

function SprintGadget({ space }: { space: string | null }) {
  const backlog = useBacklog(space ?? '');
  if (!space) return <Note>Choose a space.</Note>;
  if (backlog.isError) {
    const notScrum = backlog.error instanceof ApiError && backlog.error.code === 'not_scrum';
    return (
      <Note>
        {notScrum
          ? 'That space uses a Kanban board, so it has no sprints.'
          : 'Could not load the sprint.'}
      </Note>
    );
  }
  if (!backlog.data) return <Note>Loading…</Note>;
  const active = backlog.data.sprints.find((s) => s.state === 'active');
  if (!active) return <Note>No sprint is running in this space.</Note>;
  const s = active.summary;
  const left = active.endDate
    ? Math.ceil((Date.parse(`${active.endDate}T23:59:59`) - Date.now()) / 86_400_000)
    : null;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium">{active.name}</span>
        {active.goal && <span className="text-muted-foreground"> · {active.goal}</span>}
      </p>
      <Progress
        value={s.count ? (s.done / s.count) * 100 : 0}
        aria-label="Items done in the sprint"
        className="h-2"
      />
      <p className="text-muted-foreground text-xs tabular-nums">
        {s.done} of {s.count} done · {s.donePoints} of {s.points} points
        {left !== null &&
          (left >= 0
            ? ` · ${left} day${left === 1 ? '' : 's'} left`
            : ` · ${-left} day${left === -1 ? '' : 's'} over`)}
      </p>
      <Link href={`/spaces/${space}/board`} className="text-primary text-sm hover:underline">
        Open the board
      </Link>
    </div>
  );
}

function VersionsGadget({ space }: { space: string | null }) {
  const versions = useVersions(space ?? '');
  if (!space) return <Note>Choose a space.</Note>;
  if (versions.isError) return <Note>Could not load the releases.</Note>;
  if (!versions.data) return <Note>Loading…</Note>;
  const open = versions.data.items.filter((v) => v.state === 'unreleased');
  if (open.length === 0) return <Note>No open releases in this space.</Note>;
  return (
    <ul className="space-y-3">
      {open.slice(0, 5).map((v) => (
        <li key={v.id} className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{v.name}</span>
            {v.overdue && (
              <span className="rounded-full bg-red-100 px-1.5 text-[11px] font-medium text-red-900 dark:bg-red-500/15 dark:text-red-200">
                Overdue
              </span>
            )}
            <span className="text-muted-foreground ml-auto text-xs tabular-nums">
              {v.done}/{v.total}
            </span>
          </div>
          <Progress
            value={v.total ? (v.done / v.total) * 100 : 0}
            aria-label={`${v.name} progress`}
            className="h-1.5"
          />
        </li>
      ))}
    </ul>
  );
}

function FlowGadget({ space }: { space: string | null }) {
  const report = useQuery({
    queryKey: ['gadget-flow', space],
    enabled: !!space,
    queryFn: () =>
      api<{ throughput: { date: string; created: number; resolved: number; open: number }[] }>(
        `/spaces/${space}/reports?days=14`,
      ),
    retry: false,
  });
  if (!space) return <Note>Choose a space.</Note>;
  if (report.error instanceof ApiError && report.error.status === 402)
    return <Note>Flow reports are part of the Business plan.</Note>;
  if (report.isError) return <Note>Could not load the numbers.</Note>;
  if (!report.data) return <Note>Loading…</Note>;
  const rows = report.data.throughput;
  const created = rows.reduce((s, r) => s + r.created, 0);
  const resolved = rows.reduce((s, r) => s + r.resolved, 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.resolved]));
  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${rows.length * 12} 48`}
        className="h-24 w-full"
        role="img"
        aria-label={`${created} created and ${resolved} resolved in 14 days`}
      >
        {rows.map((r, i) => (
          <g key={r.date}>
            <rect
              x={i * 12 + 1}
              y={46 - (r.created / max) * 44}
              width={4.5}
              height={(r.created / max) * 44}
              className="fill-amber-400 stroke-amber-600 dark:fill-amber-500"
              strokeWidth={0.3}
            />
            <rect
              x={i * 12 + 6}
              y={46 - (r.resolved / max) * 44}
              width={4.5}
              height={(r.resolved / max) * 44}
              className="fill-emerald-500 stroke-emerald-600"
              strokeWidth={0.3}
            />
          </g>
        ))}
      </svg>
      <p className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 border border-amber-600 bg-amber-400"
            aria-hidden
          />{' '}
          Created {created}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 border border-emerald-600 bg-emerald-500"
            aria-hidden
          />{' '}
          Resolved {resolved}
        </span>
      </p>
    </div>
  );
}

function AddDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (g: Omit<Gadget, 'id'>) => void;
}) {
  const spaces = useSpaces();
  const filters = useSavedFilters();
  const [type, setType] = useState<GadgetType>('assigned');
  const [spaceId, setSpaceId] = useState('');
  const [filterId, setFilterId] = useState('');
  const meta = TYPES.find((t) => t.type === type)!;
  const ready = type === 'filter' ? !!filterId : meta.needsSpace ? !!spaceId : true;
  const usable = (filters.data?.items ?? []).filter((f) => f.spaceId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a tile</DialogTitle>
          <DialogDescription>{meta.hint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="g-type">Tile</Label>
            <Select value={type} onValueChange={(v) => setType(v as GadgetType)}>
              <SelectTrigger id="g-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {meta.needsSpace && (
            <div className="space-y-1.5">
              <Label htmlFor="g-space">Space</Label>
              <Select value={spaceId} onValueChange={setSpaceId}>
                <SelectTrigger id="g-space">
                  <SelectValue placeholder="Choose a space" />
                </SelectTrigger>
                <SelectContent>
                  {(spaces.data?.items ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === 'filter' && (
            <div className="space-y-1.5">
              <Label htmlFor="g-filter">Saved filter</Label>
              <Select value={filterId} onValueChange={setFilterId}>
                <SelectTrigger id="g-filter">
                  <SelectValue
                    placeholder={usable.length ? 'Choose a filter' : 'No saved filters yet'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usable.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Save a filter from a board or list first (Saved menu).
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() =>
              onAdd({
                type,
                spaceId: meta.needsSpace ? spaceId : null,
                filterId: type === 'filter' ? filterId : null,
              })
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
