'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Flag, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { LockedButton } from '@/components/plans/locked-button';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDuration, useRoadmap, useSaveEpicDates, type RoadmapEpic } from '@/lib/time-api';
import { toastError } from '@/lib/work-api';
import { cn } from '@/lib/utils';
import { ItemSheet, useOpenItem } from './item-sheet';
import { useVocabulary } from './use-vocabulary';

const DAY = 86_400_000;
const ZOOMS = {
  weeks: { label: 'Weeks', px: 16 },
  months: { label: 'Months', px: 6 },
  quarters: { label: 'Quarters', px: 2 },
} as const;
type Zoom = keyof typeof ZOOMS;

const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const today = () => toDay(new Date().toLocaleDateString('en-CA'));
const label = (n: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(n * DAY).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });

interface Span {
  start: number;
  end: number;
}

/** Epics and releases on a timeline. Drag a bar to move it, drag an end to resize it, or open it to type the dates. */
export function RoadmapView() {
  const space = useSpace();
  const vocab = useVocabulary();
  const roadmap = useRoadmap(space.key);
  const save = useSaveEpicDates(space.key);
  const open = useOpenItem();
  const [zoom, setZoom] = useState<Zoom>('months');
  const [edit, setEdit] = useState<RoadmapEpic | null>(null);
  const [draft, setDraft] = useState<Record<string, Span>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const px = ZOOMS[zoom].px;

  const data = roadmap.data;
  const scheduled = (data?.items ?? []).filter((e) => e.dueDate || e.startDate);
  const unscheduled = (data?.items ?? []).filter((e) => !e.dueDate && !e.startDate);
  const spanOf = (e: RoadmapEpic): Span => {
    const d = draft[e.id];
    if (d) return d;
    const s = e.startDate ? toDay(e.startDate) : toDay(e.dueDate!) - 14;
    const f = e.dueDate ? toDay(e.dueDate) : s + 14;
    return { start: s, end: Math.max(s, f) };
  };

  // The visible range: from two weeks before the earliest date to a month after the latest.
  const range = useMemo(() => {
    const days = [today()];
    for (const e of scheduled)
      days.push(toDay(e.startDate ?? e.dueDate!), toDay(e.dueDate ?? e.startDate!));
    for (const v of data?.versions ?? [])
      for (const d of [v.startDate, v.releaseDate]) if (d) days.push(toDay(d));
    return { from: Math.min(...days) - 14, to: Math.max(...days) + 30 };
  }, [data]);
  const width = (range.to - range.from + 1) * px;
  const x = (day: number) => (day - range.from) * px;

  // Start the view near today.
  useEffect(() => {
    if (scroller.current && data?.enabled)
      scroller.current.scrollLeft = Math.max(0, x(today()) - 120);
  }, [data?.enabled, zoom]);

  if (roadmap.isError)
    return <LoadError what="the roadmap" onRetry={() => void roadmap.refetch()} />;
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!data.enabled) {
    return (
      <EmptyState
        icon={Lock}
        title="The roadmap is part of the Team plan"
        description={`See your ${vocab.typeLabel('epic').toLowerCase()}s and releases on a timeline.`}
        action={<LockedButton>See the plans</LockedButton>}
      />
    );
  }

  const canEdit = data.permissions.edit;
  function commit(e: RoadmapEpic, s: Span) {
    setDraft((d) => {
      const { [e.id]: _drop, ...rest } = d;
      void _drop;
      return rest;
    });
    const startDate = fromDay(s.start);
    const dueDate = fromDay(s.end);
    if (startDate === e.startDate && dueDate === e.dueDate) return;
    save.mutate(
      { item: e, startDate, dueDate },
      { onError: (err) => toastError(err, 'Could not save the dates') },
    );
  }

  /** Dragging: `mode` says whether the whole bar moves or one end. */
  function startDrag(e: RoadmapEpic, mode: 'move' | 'start' | 'end', ev: React.PointerEvent) {
    if (!canEdit) return;
    ev.preventDefault();
    ev.stopPropagation();
    const origin = spanOf(e);
    const x0 = ev.clientX;
    let moved = false;
    let latest = origin;
    const onMove = (m: PointerEvent) => {
      const delta = Math.round((m.clientX - x0) / px);
      if (delta !== 0) moved = true;
      latest =
        mode === 'move'
          ? { start: origin.start + delta, end: origin.end + delta }
          : mode === 'start'
            ? { start: Math.min(origin.start + delta, origin.end), end: origin.end }
            : { start: origin.start, end: Math.max(origin.end + delta, origin.start) };
      setDraft((d) => ({ ...d, [e.id]: latest }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) commit(e, latest);
      else {
        setDraft((d) => {
          const { [e.id]: _drop, ...rest } = d;
          void _drop;
          return rest;
        });
        open(e.key);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function nudge(e: RoadmapEpic, ev: React.KeyboardEvent) {
    if (!canEdit || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
    ev.preventDefault();
    const step = ev.key === 'ArrowRight' ? 1 : -1;
    const s = spanOf(e);
    const next = ev.shiftKey
      ? { start: s.start, end: Math.max(s.start, s.end + step) }
      : { start: s.start + step, end: s.end + step };
    setDraft((d) => ({ ...d, [e.id]: next }));
  }

  // Month (or week) gridlines.
  const ticks: { day: number; text: string }[] = [];
  for (let d = range.from; d <= range.to; d++) {
    const date = new Date(d * DAY);
    if (zoom === 'weeks' ? date.getUTCDay() === 1 : date.getUTCDate() === 1) {
      ticks.push({
        day: d,
        text: label(
          d,
          zoom === 'weeks'
            ? { day: 'numeric', month: 'short' }
            : { month: 'short', year: '2-digit' },
        ),
      });
    }
  }
  const rowH = 44;
  const headH = 56;
  const todayX = x(today());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rm-zoom">Zoom</Label>
          <Select value={zoom} onValueChange={(v) => setZoom(v as Zoom)}>
            <SelectTrigger id="rm-zoom" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
                <SelectItem key={z} value={z}>
                  {ZOOMS[z].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            scroller.current?.scrollTo({ left: Math.max(0, todayX - 120), behavior: 'smooth' })
          }
        >
          <CalendarClock /> Today
        </Button>
        {canEdit && (
          <p className="text-muted-foreground text-xs">
            Drag a bar to move it or drag its ends to resize it. With a bar focused, arrow keys move
            it a day (Shift changes the end).
          </p>
        )}
      </div>

      {scheduled.length === 0 && unscheduled.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={`No ${vocab.typeLabel('epic').toLowerCase()}s yet`}
          description={`Create ${vocab.typeLabel('epic').toLowerCase()}s on the ${vocab.typeLabel('epic')}s tab, then give them dates here.`}
        />
      ) : (
        <div className="bg-card flex overflow-hidden rounded-lg border">
          <div className="w-56 shrink-0 border-r sm:w-72">
            <div
              className="text-muted-foreground border-b px-3 text-xs font-medium"
              style={{ height: headH, lineHeight: `${headH}px` }}
            >
              {vocab.typeLabel('epic')}
            </div>
            <ul>
              {scheduled.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 border-b px-3 text-sm"
                  style={{ height: rowH }}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left hover:underline"
                    onClick={() => open(e.key)}
                  >
                    <span className="text-muted-foreground tabular-nums">{e.key}</span>{' '}
                    <span className="truncate">{e.title}</span>
                  </button>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {e.progress.done}/{e.progress.total}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div
            ref={scroller}
            className="min-w-0 flex-1 overflow-x-auto"
            tabIndex={0}
            aria-label="Timeline"
          >
            <div className="relative" style={{ width, height: headH + scheduled.length * rowH }}>
              {/* Header: months or weeks, and releases */}
              {ticks.map((t) => (
                <div
                  key={t.day}
                  className="absolute top-0 bottom-0 border-l"
                  style={{ left: x(t.day) }}
                >
                  <span className="text-muted-foreground absolute top-1 left-1.5 text-xs whitespace-nowrap">
                    {t.text}
                  </span>
                </div>
              ))}
              {data.versions
                .filter((v) => v.releaseDate)
                .map((v) => (
                  <div
                    key={v.id}
                    className="absolute top-0 z-10"
                    style={{
                      left: x(toDay(v.releaseDate!)),
                      height: headH + scheduled.length * rowH,
                    }}
                  >
                    <div
                      className={cn(
                        'h-full border-l border-dashed',
                        v.state === 'released' ? 'border-success' : 'border-violet',
                      )}
                    />
                    <span
                      className={cn(
                        'absolute top-6 left-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
                        v.state === 'released'
                          ? 'bg-success-soft text-success-soft-foreground '
                          : 'bg-violet-soft text-violet-soft-foreground ',
                      )}
                    >
                      <Flag className="size-3" aria-hidden /> {v.name}
                    </span>
                  </div>
                ))}
              <div
                className="absolute top-0 bottom-0 z-10 border-l-2 border-danger"
                style={{ left: todayX }}
                aria-hidden
              >
                <span className="absolute top-1 left-1 rounded-sm bg-danger px-1 text-xs font-semibold text-white">
                  Today
                </span>
              </div>

              {scheduled.map((e, i) => {
                const s = spanOf(e);
                const w = Math.max(px, (s.end - s.start + 1) * px);
                const pct = e.progress.total ? (e.progress.done / e.progress.total) * 100 : 0;
                const dragging = !!draft[e.id];
                return (
                  <div
                    key={e.id}
                    className="absolute border-b"
                    style={{ top: headH + i * rowH, left: 0, width, height: rowH }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${e.key} ${e.title}, ${fromDay(s.start)} to ${fromDay(s.end)}, ${e.progress.done} of ${e.progress.total} done. ${canEdit ? 'Arrow keys move it, Enter edits the dates.' : 'Enter opens it.'}`}
                      onPointerDown={(ev) => startDrag(e, 'move', ev)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') {
                          ev.preventDefault();
                          if (canEdit) setEdit(e);
                          else open(e.key);
                        } else nudge(e, ev);
                      }}
                      onKeyUp={(ev) => {
                        if (draft[e.id] && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'))
                          commit(e, draft[e.id]!);
                      }}
                      className={cn(
                        'focus-visible:ring-ring absolute top-2.5 flex h-6 items-center overflow-hidden rounded-md border border-violet bg-violet-soft text-xs font-medium text-violet outline-none focus-visible:ring-2 ',
                        canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                        dragging
                          ? 'shadow-lg'
                          : 'transition-[left,width] duration-150 motion-reduce:transition-none',
                      )}
                      style={{ left: x(s.start), width: w }}
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-violet/70 "
                        style={{ width: `${pct}%` }}
                        aria-hidden
                      />
                      <span className="relative truncate px-2">{e.title}</span>
                      {canEdit && (
                        <>
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-violet/40"
                            onPointerDown={(ev) => startDrag(e, 'start', ev)}
                          />
                          <span
                            aria-hidden
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-violet/40"
                            onPointerDown={(ev) => startDrag(e, 'end', ev)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {unscheduled.length > 0 && (
        <section aria-labelledby="rm-unscheduled" className="space-y-2">
          <h2 id="rm-unscheduled" className="text-sm font-semibold">
            Without dates{' '}
            <span className="text-muted-foreground font-normal">{unscheduled.length}</span>
          </h2>
          <ul className="divide-y rounded-lg border">
            {unscheduled.map((e) => (
              <li key={e.id} className="flex items-center gap-3 p-2.5 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:underline"
                  onClick={() => open(e.key)}
                >
                  <span className="text-muted-foreground tabular-nums">{e.key}</span> {e.title}
                </button>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setEdit(e)}>
                    Set dates
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The same information as text, for screen readers and exact values. */}
      {scheduled.length > 0 && (
        <details>
          <summary className="text-primary cursor-pointer text-sm">
            Show the dates as a table
          </summary>
          <table className="mt-2 w-full max-w-3xl text-sm">
            <caption className="sr-only">Roadmap dates and progress</caption>
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">
                  {vocab.typeLabel('epic')}
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  Start
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  Due
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Done
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {scheduled.map((e) => (
                <tr key={e.id} className="border-t">
                  <th scope="row" className="py-1 text-left font-normal">
                    {e.key} {e.title}
                  </th>
                  <td className="py-1">{e.startDate ?? '–'}</td>
                  <td className="py-1">{e.dueDate ?? '–'}</td>
                  <td className="py-1 text-right tabular-nums">
                    {e.progress.done}/{e.progress.total}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatDuration(e.progress.spentMinutes)} of{' '}
                    {formatDuration(e.progress.plannedMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {edit && (
        <DatesDialog
          epic={edit}
          onClose={() => setEdit(null)}
          onSave={(startDate, dueDate) =>
            save.mutateAsync({ item: edit, startDate, dueDate }).then(
              () => {
                toast.success('Dates saved');
                setEdit(null);
              },
              (err) => toastError(err, 'Could not save the dates'),
            )
          }
        />
      )}
      <ItemSheet />
    </div>
  );
}

function DatesDialog({
  epic,
  onClose,
  onSave,
}: {
  epic: RoadmapEpic;
  onClose: () => void;
  onSave: (start: string | null, due: string | null) => Promise<unknown>;
}) {
  const [start, setStart] = useState(epic.startDate ?? fromDay(today()));
  const [due, setDue] = useState(epic.dueDate ?? fromDay(today() + 14));
  const bad = !!start && !!due && due < start;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Dates for {epic.key}</DialogTitle>
          <DialogDescription>{epic.title}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rm-start">Start</Label>
            <Input
              id="rm-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rm-due">Due</Label>
            <Input
              id="rm-due"
              type="date"
              value={due}
              aria-invalid={bad}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>
        {bad && (
          <p role="alert" className="text-destructive text-xs">
            The due date cannot be before the start.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={bad || !start || !due}
            onClick={() => void onSave(start || null, due || null)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
