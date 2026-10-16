'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { ApiError } from '@/lib/api';
import { dateRange, useBurndown, useSprintReport, useSprints, type Burndown } from '@/lib/sprints-api';
import { FoundItems } from './found-items';
import { ItemSheet } from './item-sheet';
import { useVocabulary } from './use-vocabulary';

/** Sprint reports: the burndown and what got done, for any started sprint of the space. */
export function SprintReports() {
  const space = useSpace();
  const vocab = useVocabulary();
  const sprints = useSprints(space.key);
  const started = (sprints.data?.items ?? []).filter((s) => s.state !== 'planned');
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!id && started[0]) setId(started[0].id);
  }, [id, started]);
  const report = useSprintReport(id);
  const burndown = useBurndown(id, true);

  if (sprints.isError) return <LoadError what="the sprints" onRetry={() => sprints.refetch()} />;
  if (!sprints.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (started.length === 0) {
    return <EmptyState title="No sprint reports yet" description="Reports appear once a sprint has started. Plan and start one from the backlog." />;
  }
  const locked = burndown.error instanceof ApiError && burndown.error.status === 402;

  return (
    <div className="space-y-6">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="report-sprint">Sprint</Label>
        <Select value={id ?? ''} onValueChange={setId}>
          <SelectTrigger id="report-sprint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {started.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.state === 'active' ? 'running' : dateRange(s)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section aria-labelledby="burndown-title" className="bg-card space-y-3 rounded-xl border p-4">
        <h2 id="burndown-title" className="font-semibold">
          Burndown
        </h2>
        {locked ? (
          <p className="text-muted-foreground inline-flex items-center gap-2 text-sm">
            <Lock className="size-4" aria-hidden /> Burndown charts are part of the Business plan.
          </p>
        ) : burndown.data ? (
          <BurndownChart data={burndown.data} />
        ) : burndown.isError ? (
          <LoadError what="the burndown" onRetry={() => burndown.refetch()} />
        ) : (
          <p className="text-muted-foreground text-sm">Loading…</p>
        )}
      </section>

      {report.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          {(
            [
              ['Completed', report.data.completed],
              ['Not completed', report.data.notCompleted],
              ['Added after the start', report.data.addedAfterStart],
            ] as const
          ).map(([title, items]) => (
            <section key={title} aria-label={title} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {title} <span className="text-muted-foreground font-normal">{items.length}</span>
              </h2>
              {items.length ? <FoundItems items={items} showSpace={false} /> : <p className="text-muted-foreground text-sm">No {vocab.nounPlural}.</p>}
            </section>
          ))}
        </div>
      )}
      <ItemSheet />
    </div>
  );
}

/** Ideal line against points remaining, with a data table for screen readers and exact values. */
function BurndownChart({ data }: { data: Burndown }) {
  const W = 640;
  const H = 240;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const days = data.ideal.map((d) => d.date);
  const max = Math.max(1, data.startPoints, ...data.actual.map((a) => a.points), ...data.actual.map((a) => a.total ?? 0));
  const x = (i: number) => pad.l + (days.length > 1 ? (i * (W - pad.l - pad.r)) / (days.length - 1) : 0);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (pts: { date: string; points: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(days.indexOf(p.date)).toFixed(1)},${y(p.points).toFixed(1)}`).join(' ');
  const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const every = Math.max(1, Math.ceil(days.length / 7));

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={`Burndown for ${data.sprint.name}: ${data.startPoints} points at the start, ${data.actual.at(-1)?.points ?? data.startPoints} remaining.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % every === 0 || i === days.length - 1 ? (
            <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {short(d)}
            </text>
          ) : null,
        )}
        <path d={path(data.ideal)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="5 4" />
        <path d={path(data.actual)} fill="none" className="stroke-primary" strokeWidth={2.5} />
        {data.actual.map((p) => (
          <circle key={p.date} cx={x(days.indexOf(p.date))} cy={y(p.points)} r={3} className="fill-primary" />
        ))}
        {data.scopeChanges.map((c, i) => {
          const at = days.indexOf(c.date);
          return at < 0 ? null : (
            <g key={i}>
              <line x1={x(at)} x2={x(at)} y1={pad.t} y2={H - pad.b} className="stroke-amber-500" strokeWidth={1} strokeDasharray="2 3" />
            </g>
          );
        })}
      </svg>
      <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-primary inline-block h-0.5 w-5" aria-hidden /> Remaining
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="border-muted-foreground inline-block w-5 border-t border-dashed" aria-hidden /> Ideal
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 border-l border-dashed border-amber-500" aria-hidden /> Scope change
        </span>
      </div>
      <details>
        <summary className="text-primary cursor-pointer text-sm">Show the numbers</summary>
        <table className="mt-2 w-full max-w-lg text-sm">
          <caption className="sr-only">Points remaining each day</caption>
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">
                Day
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Ideal
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Remaining
              </th>
            </tr>
          </thead>
          <tbody>
            {data.ideal.map((d) => (
              <tr key={d.date} className="border-t">
                <th scope="row" className="py-1 text-left font-normal">
                  {short(d.date)}
                </th>
                <td className="py-1 text-right tabular-nums">{d.points}</td>
                <td className="py-1 text-right tabular-nums">{data.actual.find((a) => a.date === d.date)?.points ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.scopeChanges.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {data.scopeChanges.map((c, i) => (
              <li key={i}>
                {short(c.date)}: {c.kind === 'added' ? 'added' : 'removed'} “{c.title}” ({c.points} pts)
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
