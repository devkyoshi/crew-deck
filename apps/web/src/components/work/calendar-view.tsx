'use client';

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Rocket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { useCalendar } from '@/lib/time-api';
import type { WorkItem } from '@/lib/work';
import { cn } from '@/lib/utils';
import { ItemSheet, useOpenItem } from './item-sheet';
import { useVocabulary } from './use-vocabulary';
import { TypeIcon, UserAvatar } from './work-bits';

type View = 'week' | 'month';
type Filter = 'all' | 'due' | 'releases' | 'overdue';
type Release = { id: string; name: string; state: string; date: string | null };

const ymd = (d: Date) => d.toLocaleDateString('en-CA');
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) =>
  addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All scheduled' },
  { id: 'due', label: 'Due' },
  { id: 'releases', label: 'Releases' },
  { id: 'overdue', label: 'Overdue' },
];

function ItemBlock({
  item,
  today,
  compact,
  onOpen,
}: {
  item: WorkItem;
  today: string;
  compact?: boolean;
  onOpen: (key: string) => void;
}) {
  const done = item.status.category === 'done';
  const overdue = !done && !!item.dueDate && item.dueDate < today;
  return (
    <button
      type="button"
      onClick={() => onOpen(item.key)}
      className={cn(
        'w-full rounded-md text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'flex items-center gap-1.5 px-1.5 py-1 text-xs' : 'space-y-1.5 p-2.5 text-label',
        done && 'bg-muted text-muted-foreground hover:bg-muted/70',
        overdue && 'bg-danger-soft text-danger-soft-foreground hover:bg-danger-soft/70',
        !done && !overdue && 'bg-info-soft text-info-soft-foreground hover:bg-info-soft/70',
      )}
    >
      {compact ? (
        <>
          <TypeIcon type={item.type} />
          <span className={cn('truncate', done && 'line-through')}>{item.title}</span>
        </>
      ) : (
        <>
          <span className={cn('line-clamp-2 leading-snug font-medium', done && 'line-through')}>
            {item.title}
          </span>
          <span className="flex items-center gap-1.5 text-xs opacity-80">
            <TypeIcon type={item.type} />
            <span className="tnum font-mono">{item.key}</span>
            <span className="ml-auto">
              {item.assignee && <UserAvatar person={item.assignee} size={20} />}
            </span>
          </span>
        </>
      )}
      <span className="sr-only">, {item.key}</span>
    </button>
  );
}

function ReleaseBlock({ release, compact }: { release: Release; compact?: boolean }) {
  return (
    <div
      className={cn(
        'bg-orange-soft text-orange-soft-foreground flex w-full items-center gap-1.5 rounded-md font-medium',
        compact ? 'px-1.5 py-1 text-xs' : 'p-2.5 text-label',
      )}
    >
      <Flag className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{release.name}</span>
    </div>
  );
}

/** A summary tile above the grid: a headline, one line of detail and a coloured status strip. */
function SummaryCard({
  tone,
  icon: Icon,
  title,
  detail,
  status,
}: {
  tone: 'success' | 'orange' | 'danger';
  icon: typeof Rocket;
  title: string;
  detail: string;
  status: string;
}) {
  const strip = {
    success: 'bg-success-soft text-success-soft-foreground',
    orange: 'bg-orange-soft text-orange-soft-foreground',
    danger: 'bg-danger-soft text-danger-soft-foreground',
  }[tone];
  return (
    <div className="bg-card min-w-0 rounded-lg border p-1.5 shadow-xs">
      <div className="px-2.5 pt-2 pb-2.5">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground tnum truncate text-xs">{detail}</p>
      </div>
      <div
        className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', strip)}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{status}</span>
      </div>
    </div>
  );
}

/** What is due when, and which releases land on which day, as a week or a month. */
export function CalendarView() {
  const space = useSpace();
  const vocab = useVocabulary();
  const open = useOpenItem();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>('month');
  const [filter, setFilter] = useState<Filter>('all');
  const [cursor, setCursor] = useState(() => new Date());
  const [dir, setDir] = useState(1);
  const today = ymd(new Date());

  // Month: six weeks from the Monday on or before the 1st, so the grid never changes height.
  const days = useMemo(() => {
    const first =
      view === 'week'
        ? startOfWeek(cursor)
        : startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDays(first, i));
  }, [view, cursor]);
  const from = ymd(days[0]!);
  const to = ymd(days[days.length - 1]!);
  const data = useCalendar(space.key, from, to);

  const items = data.data?.items ?? [];
  const releases = (data.data?.releases ?? []).filter((r) => r.date);
  const overdue = items.filter(
    (i) => i.status.category !== 'done' && i.dueDate && i.dueDate < today,
  );
  const dueToday = items.filter((i) => i.dueDate === today);
  const releasesToday = releases.filter((r) => r.date === today);
  const nextRelease = releases
    .filter((r) => r.date! >= today)
    .sort((a, b) => a.date!.localeCompare(b.date!))[0];

  const counts: Record<Filter, number> = {
    all: items.length + releases.length,
    due: items.length,
    releases: releases.length,
    overdue: overdue.length,
  };

  const byDay = useMemo(() => {
    const map = new Map<string, { items: WorkItem[]; releases: Release[] }>();
    const cell = (k: string) => map.get(k) ?? map.set(k, { items: [], releases: [] }).get(k)!;
    const list = data.data?.items ?? [];
    const rels = (data.data?.releases ?? []).filter((r) => r.date);
    if (filter !== 'releases') {
      for (const i of list) {
        if (!i.dueDate) continue;
        if (filter === 'overdue' && !(i.status.category !== 'done' && i.dueDate < today)) continue;
        cell(i.dueDate).items.push(i);
      }
    }
    if (filter === 'all' || filter === 'releases') for (const r of rels) cell(r.date!).releases.push(r);
    return map;
  }, [data.data, filter, today]);

  const move = (n: number) => {
    setDir(n);
    setCursor((c) =>
      view === 'week' ? addDays(c, 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1),
    );
  };
  const goToday = () => {
    setDir(ymd(cursor) > today ? -1 : 1);
    setCursor(new Date());
  };
  const monthIdx = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getMonth();
  const title =
    view === 'month'
      ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : `${shortDate(days[0]!)} - ${shortDate(days[6]!)} ${days[6]!.getFullYear()}`;

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const summary = `${plural(dueToday.length, 'item', 'items')} due and ${plural(releasesToday.length, 'release', 'releases')}`;
  const daysUntil = nextRelease
    ? Math.round(
        (new Date(`${nextRelease.date}T00:00:00`).getTime() -
          new Date(`${today}T00:00:00`).getTime()) /
          86_400_000,
      )
    : 0;

  const renderDay = (d: Date, compact: boolean) => {
    const cell = byDay.get(ymd(d));
    const shown = compact ? (cell?.items.slice(0, 3) ?? []) : (cell?.items ?? []);
    const rest = (cell?.items.length ?? 0) - shown.length;
    return (
      <>
        {cell?.releases.map((r) => (
          <ReleaseBlock key={r.id} release={r} compact={compact} />
        ))}
        {shown.map((i) => (
          <ItemBlock key={i.id} item={i} today={today} compact={compact} onOpen={open} />
        ))}
        {rest > 0 && <p className="text-muted-foreground px-1 text-xs">+{rest} more</p>}
      </>
    );
  };
  const dayLabel = (d: Date) =>
    `${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${ymd(d) === today ? ', today' : ''}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-card flex size-11 shrink-0 items-center justify-center rounded-full border shadow-xs">
          <CalendarDays className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-title">
            {new Date().toLocaleDateString(undefined, {
              month: 'long',
              day: '2-digit',
              year: 'numeric',
            })}
          </p>
          <p className="text-muted-foreground text-sm">
            {data.data ? `You have ${summary} today.` : 'Loading the calendar…'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={goToday}>
          Today
        </Button>
        <div className="bg-muted flex rounded-lg p-0.5" role="group" aria-label="Calendar view">
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setDir(1);
              }}
              className={cn(
                'text-muted-foreground rounded-md px-3 py-1 text-label font-medium capitalize outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                view === v && 'bg-background text-foreground shadow-xs',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="bg-card flex items-center rounded-lg border shadow-xs">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Previous ${view}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </Button>
          <h2
            className="tnum flex min-w-44 items-center justify-center gap-2 px-1 text-center text-label font-medium"
            aria-live="polite"
          >
            <CalendarRange className="text-muted-foreground size-4" aria-hidden />
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Next ${view}`}
            onClick={() => move(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <span className="text-muted-foreground ml-auto text-xs">
          {data.data ? `${items.length} due in view` : ''}
        </span>
      </div>

      <div role="group" aria-label="Filter the calendar" className="flex gap-6 overflow-x-auto border-b">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={cn(
                'text-muted-foreground hover:text-foreground relative flex items-center gap-2 py-2.5 text-label font-medium whitespace-nowrap outline-none transition-colors duration-150',
                on && 'text-foreground',
              )}
            >
              {f.label}
              <span className="bg-muted text-muted-foreground tnum rounded-full px-1.5 text-xs">
                {counts[f.id]}
              </span>
              {on && (
                <motion.span
                  layoutId="calendar-filter-underline"
                  className="bg-foreground absolute inset-x-0 -bottom-px h-0.5 rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 42 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {data.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            tone="orange"
            icon={Rocket}
            title={nextRelease ? nextRelease.name : 'No upcoming release'}
            detail={
              nextRelease
                ? new Date(`${nextRelease.date}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })
                : 'Nothing scheduled in view'
            }
            status={
              nextRelease
                ? daysUntil === 0
                  ? 'Today'
                  : `In ${plural(daysUntil, 'day', 'days')}`
                : 'Clear'
            }
          />
          <SummaryCard
            tone="success"
            icon={CheckCircle2}
            title={`${dueToday.length} due today`}
            detail={dueToday[0]?.title ?? `No ${vocab.nounPlural} due today`}
            status={dueToday.length ? 'Today' : 'All clear'}
          />
          <SummaryCard
            tone="danger"
            icon={AlertTriangle}
            title={`${overdue.length} overdue`}
            detail={overdue[0]?.title ?? `No overdue ${vocab.nounPlural}`}
            status={overdue.length ? `${overdue.length} need attention` : 'On track'}
          />
        </div>
      )}

      {data.isError ? (
        <LoadError what="the calendar" onRetry={() => void data.refetch()} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border shadow-xs">
          <motion.div
            key={`${view}-${from}`}
            initial={reduce ? false : { opacity: 0, x: dir * 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            role="grid"
            aria-label={`${title}, ${vocab.nounPlural} by due date`}
            className="min-w-[44rem]"
          >
            <div role="row" className="grid grid-cols-7 border-b">
              {days.slice(0, 7).map((d, i) => (
                <div
                  key={i}
                  role="columnheader"
                  className={cn(
                    'text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase not-last:border-r',
                    view === 'week' && ymd(d) === today && 'text-primary',
                  )}
                >
                  {view === 'week' ? (
                    <span className="tnum">
                      {String(d.getDate()).padStart(2, '0')} {WEEKDAYS[i]}
                    </span>
                  ) : (
                    WEEKDAYS[i]
                  )}
                </div>
              ))}
            </div>
            {view === 'week' ? (
              <div role="row" className="grid grid-cols-7">
                {days.map((d) => (
                  <div
                    key={ymd(d)}
                    role="gridcell"
                    aria-label={dayLabel(d)}
                    className={cn(
                      'min-h-80 space-y-2 p-2 not-last:border-r',
                      ymd(d) === today && 'bg-primary-soft/40',
                    )}
                  >
                    {renderDay(d, false)}
                  </div>
                ))}
              </div>
            ) : (
              Array.from({ length: 6 }, (_, w) => (
                <div key={w} role="row" className="grid grid-cols-7 border-b last:border-b-0">
                  {days.slice(w * 7, w * 7 + 7).map((d) => {
                    const inMonth = d.getMonth() === monthIdx;
                    return (
                      <div
                        key={ymd(d)}
                        role="gridcell"
                        aria-label={dayLabel(d)}
                        className={cn(
                          'min-h-28 space-y-1 p-1.5 not-last:border-r',
                          !inMonth && 'bg-muted/40',
                        )}
                      >
                        <span
                          className={cn(
                            'tnum mb-0.5 inline-flex size-6 items-center justify-center rounded-full text-xs',
                            !inMonth && 'text-muted-foreground',
                            ymd(d) === today && 'bg-primary text-primary-foreground font-semibold',
                          )}
                        >
                          {d.getDate()}
                        </span>
                        {renderDay(d, true)}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </motion.div>
        </div>
      )}
      <ItemSheet />
    </div>
  );
}
