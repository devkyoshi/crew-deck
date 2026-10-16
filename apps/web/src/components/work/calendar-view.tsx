'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { useCalendar } from '@/lib/time-api';
import { cn } from '@/lib/utils';
import { ItemSheet, useOpenItem } from './item-sheet';
import { useVocabulary } from './use-vocabulary';
import { TypeIcon } from './work-bits';

const ymd = (d: Date) => d.toLocaleDateString('en-CA');
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A month grid of what is due when, and which releases land on which day. */
export function CalendarView() {
  const space = useSpace();
  const vocab = useVocabulary();
  const open = useOpenItem();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  // Six weeks starting on the Monday on or before the 1st, so the grid never changes height.
  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    first.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      return d;
    });
  }, [month]);
  const from = ymd(days[0]!);
  const to = ymd(days[41]!);
  const data = useCalendar(space.key, from, to);
  const today = ymd(new Date());

  const byDay = useMemo(() => {
    const map = new Map<
      string,
      {
        items: NonNullable<typeof data.data>['items'];
        releases: NonNullable<typeof data.data>['releases'];
      }
    >();
    const cell = (k: string) => map.get(k) ?? map.set(k, { items: [], releases: [] }).get(k)!;
    for (const i of data.data?.items ?? []) if (i.dueDate) cell(i.dueDate).items.push(i);
    for (const r of data.data?.releases ?? []) if (r.date) cell(r.date).releases.push(r);
    return map;
  }, [data.data]);

  const move = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const dueCount = data.data?.items.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Previous month"
          onClick={() => move(-1)}
        >
          <ChevronLeft />
        </Button>
        <h2 className="min-w-40 text-center font-semibold" aria-live="polite">
          {title}
        </h2>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Next month"
          onClick={() => move(1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
        >
          Today
        </Button>
        <span className="text-muted-foreground ml-auto text-xs">
          {data.data ? `${dueCount} due in view` : ''}
        </span>
      </div>

      {data.isError ? (
        <LoadError what="the calendar" onRetry={() => void data.refetch()} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <div
            role="grid"
            aria-label={`${title}, ${vocab.nounPlural} by due date`}
            className="min-w-[44rem]"
          >
            <div
              role="row"
              className="text-muted-foreground grid grid-cols-7 border-b text-xs font-medium"
            >
              {WEEKDAYS.map((d) => (
                <div key={d} role="columnheader" className="px-2 py-1.5">
                  {d}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, w) => (
              <div key={w} role="row" className="grid grid-cols-7 border-b last:border-b-0">
                {days.slice(w * 7, w * 7 + 7).map((d) => {
                  const key = ymd(d);
                  const cell = byDay.get(key);
                  const inMonth = d.getMonth() === month.getMonth();
                  return (
                    <div
                      key={key}
                      role="gridcell"
                      aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${key === today ? ', today' : ''}`}
                      className={cn(
                        'min-h-24 border-r p-1 last:border-r-0',
                        !inMonth && 'bg-muted/30',
                      )}
                    >
                      <span
                        className={cn(
                          'mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                          !inMonth && 'text-muted-foreground',
                          key === today && 'bg-primary text-primary-foreground font-semibold',
                        )}
                      >
                        {d.getDate()}
                      </span>
                      <ul className="space-y-0.5">
                        {cell?.releases.map((r) => (
                          <li
                            key={r.id}
                            className="inline-flex w-full items-center gap-1 rounded bg-violet-100 px-1 py-0.5 text-[11px] font-medium text-violet-900 dark:bg-violet-500/20 dark:text-violet-200"
                          >
                            <Flag className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{r.name}</span>
                          </li>
                        ))}
                        {cell?.items.slice(0, 4).map((i) => (
                          <li key={i.id}>
                            <button
                              type="button"
                              onClick={() => open(i.key)}
                              className={cn(
                                'hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight',
                                i.status.category === 'done' &&
                                  'text-muted-foreground line-through',
                              )}
                            >
                              <TypeIcon type={i.type} />
                              <span className="truncate">{i.title}</span>
                              <span className="sr-only">, {i.key}</span>
                            </button>
                          </li>
                        ))}
                        {cell && cell.items.length > 4 && (
                          <li className="text-muted-foreground px-1 text-[11px]">
                            +{cell.items.length - 4} more
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <ItemSheet />
    </div>
  );
}
