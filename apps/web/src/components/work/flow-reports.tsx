'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { LockedButton } from '@/components/plans/locked-button';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { useVocabulary } from './use-vocabulary';

interface FlowData {
  days: number;
  timezone: string;
  velocity: { name: string; committed: number; completed: number; endDate: string | null }[] | null;
  flow: { date: string; todo: number; in_progress: number; done: number }[];
  throughput: { date: string; created: number; resolved: number; open: number }[];
  cycle: {
    points: {
      id: string;
      key: string;
      title: string;
      resolvedAt: string;
      days: number;
      leadDays: number;
      rolling: number;
    }[];
    summary: {
      count: number;
      average: number | null;
      p50: number | null;
      p85: number | null;
      p95: number | null;
    };
  };
}

const short = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });

// Series colours: a sequential blue-green ramp with different lightness, plus a label or pattern in every legend.
const COLOR = {
  todo: 'fill-muted-foreground stroke-muted-foreground ',
  in_progress: 'fill-info stroke-info ',
  done: 'fill-success stroke-success ',
};

/** Flow reports for the space: velocity (Scrum), cumulative flow, created against resolved, cycle time. */
export function FlowReports() {
  const space = useSpace();
  const vocab = useVocabulary();
  const [days, setDays] = useState('30');
  const access = useQuery({
    queryKey: ['report-access', space.key],
    queryFn: () => api<{ enabled: boolean }>(`/spaces/${space.key}/reports/access`),
  });
  const data = useQuery({
    queryKey: ['flow-reports', space.key, days],
    queryFn: () => api<FlowData>(`/spaces/${space.key}/reports?days=${days}`),
    enabled: access.data?.enabled === true,
  });

  if (access.isError) return <LoadError what="the reports" onRetry={() => void access.refetch()} />;
  if (!access.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!access.data.enabled) {
    return (
      <EmptyState
        icon={Lock}
        title="Flow reports are part of the Business plan"
        description="Velocity, cumulative flow, cycle time and created against resolved."
        action={<LockedButton plan="Business">See the plans</LockedButton>}
      />
    );
  }
  if (data.isError) {
    return data.error instanceof ApiError && data.error.status === 402 ? null : (
      <LoadError what="the reports" onRetry={() => void data.refetch()} />
    );
  }
  if (!data.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const d = data.data;

  return (
    <div className="space-y-6">
      <div className="max-w-[10rem] space-y-1.5">
        <Label htmlFor="flow-days">Period</Label>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger id="flow-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['14', '30', '60', '90'].map((n) => (
              <SelectItem key={n} value={n}>
                Last {n} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {d.velocity && (
        <Section
          title="Velocity"
          note="Points planned at the start of each finished sprint, against points finished."
        >
          {d.velocity.length === 0 ? (
            <Empty text="Velocity appears after a sprint has been completed." />
          ) : (
            <VelocityChart rows={d.velocity} />
          )}
        </Section>
      )}

      <Section
        title="Cumulative flow"
        note={`How many ${vocab.nounPlural} were waiting, in progress and done at the end of each day. Bands that widen show a bottleneck.`}
      >
        <FlowChart rows={d.flow} />
      </Section>

      <Section
        title="Created against resolved"
        note={`${vocab.Noun} added each day against ${vocab.nounPlural} finished.`}
      >
        <ThroughputChart rows={d.throughput} />
      </Section>

      <Section
        title="Cycle time"
        note="Days from first starting work to finishing, for work finished in this period."
      >
        {d.cycle.summary.count === 0 ? (
          <Empty text={`No ${vocab.nounPlural} were finished in this period.`} />
        ) : (
          <CycleChart cycle={d.cycle} />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  const id = `fr-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="bg-card space-y-3 rounded-lg border p-4">
      <div>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => (
  <p className="text-muted-foreground text-sm">{text}</p>
);

const W = 640;
const H = 240;
const pad = { l: 36, r: 12, t: 12, b: 28 };

function Axes({ max, labels, every }: { max: number; labels: string[]; every: number }) {
  const x = (i: number) =>
    pad.l + (labels.length > 1 ? (i * (W - pad.l - pad.r)) / (labels.length - 1) : 0);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  return (
    <>
      {[...new Set([0, Math.round(max / 2), max])].map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(t)}
            y2={y(t)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={pad.l - 6}
            y={y(t) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-xs"
          >
            {t}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <text
            key={l + i}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-xs"
          >
            {l}
          </text>
        ) : null,
      )}
    </>
  );
}

function Legend({ items }: { items: { label: string; swatch: React.ReactNode }[] }) {
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-4 text-xs">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.swatch} {i.label}
        </li>
      ))}
    </ul>
  );
}

function NumbersTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details>
      <summary className="text-primary cursor-pointer text-sm">Show the numbers</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full max-w-xl text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-muted-foreground bg-card sticky top-0 text-xs">
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`py-1 font-medium ${i ? 'text-right' : 'text-left'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="py-1 text-left font-normal">
                      {c}
                    </th>
                  ) : (
                    <td key={j} className="py-1 text-right tabular-nums">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function VelocityChart({ rows }: { rows: NonNullable<FlowData['velocity']> }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.committed, r.completed]));
  const slot = (W - pad.l - pad.r) / rows.length;
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const bar = Math.min(28, slot / 3);
  const avg = rows.reduce((s, r) => s + r.completed, 0) / rows.length;
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-3xl"
        role="img"
        aria-label={`Velocity of the last ${rows.length} sprints. Average ${avg.toFixed(1)} points finished.`}
      >
        <Axes max={max} labels={rows.map(() => '')} every={1} />
        {rows.map((r, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={r.name}>
              <rect
                x={cx - bar - 2}
                y={y(r.committed)}
                width={bar}
                height={H - pad.b - y(r.committed)}
                className="fill-muted-foreground stroke-muted-foreground "
                strokeWidth={1}
              />
              <rect
                x={cx + 2}
                y={y(r.completed)}
                width={bar}
                height={H - pad.b - y(r.completed)}
                className={COLOR.done}
                strokeWidth={1}
              />
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-xs"
              >
                {r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend
        items={[
          {
            label: 'Planned',
            swatch: (
              <span
                className="inline-block size-3 border border-border bg-muted "
                aria-hidden
              />
            ),
          },
          {
            label: 'Finished',
            swatch: (
              <span
                className="inline-block size-3 border border-success bg-success"
                aria-hidden
              />
            ),
          },
        ]}
      />
      <NumbersTable
        caption="Points planned and finished per sprint"
        head={['Sprint', 'Planned', 'Finished']}
        rows={rows.map((r) => [r.name, r.committed, r.completed])}
      />
    </div>
  );
}

function FlowChart({ rows }: { rows: FlowData['flow'] }) {
  const totals = rows.map((r) => r.todo + r.in_progress + r.done);
  const max = Math.max(1, ...totals);
  const x = (i: number) =>
    pad.l + (rows.length > 1 ? (i * (W - pad.l - pad.r)) / (rows.length - 1) : 0);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  // Stack from the bottom: done, then in progress, then waiting.
  const band = (
    lower: (r: FlowData['flow'][number]) => number,
    upper: (r: FlowData['flow'][number]) => number,
  ) =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(upper(r)).toFixed(1)}`).join(' ') +
    ' ' +
    [...rows]
      .map((r, i) => ({ r, i }))
      .reverse()
      .map(({ r, i }) => `L${x(i).toFixed(1)},${y(lower(r)).toFixed(1)}`)
      .join(' ') +
    ' Z';
  const last = rows.at(-1);
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-3xl"
        role="img"
        aria-label={`Cumulative flow over ${rows.length} days. Today: ${last?.todo ?? 0} waiting, ${last?.in_progress ?? 0} in progress, ${last?.done ?? 0} done.`}
      >
        <Axes
          max={max}
          labels={rows.map((r) => short(r.date))}
          every={Math.max(1, Math.ceil(rows.length / 7))}
        />
        <path
          d={band(
            () => 0,
            (r) => r.done,
          )}
          className={COLOR.done}
          fillOpacity={0.85}
          strokeWidth={1}
        />
        <path
          d={band(
            (r) => r.done,
            (r) => r.done + r.in_progress,
          )}
          className={COLOR.in_progress}
          fillOpacity={0.85}
          strokeWidth={1}
        />
        <path
          d={band(
            (r) => r.done + r.in_progress,
            (r) => r.done + r.in_progress + r.todo,
          )}
          className={COLOR.todo}
          fillOpacity={0.7}
          strokeWidth={1}
        />
      </svg>
      <Legend
        items={[
          {
            label: 'To do',
            swatch: (
              <span
                className="inline-block size-3 border border-border bg-muted-foreground/40"
                aria-hidden
              />
            ),
          },
          {
            label: 'In progress',
            swatch: (
              <span className="inline-block size-3 border border-info bg-info" aria-hidden />
            ),
          },
          {
            label: 'Done',
            swatch: (
              <span
                className="inline-block size-3 border border-success bg-success"
                aria-hidden
              />
            ),
          },
        ]}
      />
      <NumbersTable
        caption="Cards per status category at the end of each day"
        head={['Day', 'To do', 'In progress', 'Done']}
        rows={rows.map((r) => [short(r.date), r.todo, r.in_progress, r.done])}
      />
    </div>
  );
}

function ThroughputChart({ rows }: { rows: FlowData['throughput'] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.resolved]));
  const slot = (W - pad.l - pad.r) / rows.length;
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const bar = Math.max(2, Math.min(10, slot / 2 - 1));
  const totalCreated = rows.reduce((s, r) => s + r.created, 0);
  const totalResolved = rows.reduce((s, r) => s + r.resolved, 0);
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-3xl"
        role="img"
        aria-label={`${totalCreated} created and ${totalResolved} resolved in ${rows.length} days.`}
      >
        <Axes
          max={max}
          labels={rows.map((r) => short(r.date))}
          every={Math.max(1, Math.ceil(rows.length / 7))}
        />
        {rows.map((r, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={r.date}>
              <rect
                x={cx - bar - 0.5}
                y={y(r.created)}
                width={bar}
                height={H - pad.b - y(r.created)}
                className="fill-warning stroke-warning "
                strokeWidth={0.5}
              />
              <rect
                x={cx + 0.5}
                y={y(r.resolved)}
                width={bar}
                height={H - pad.b - y(r.resolved)}
                className={COLOR.done}
                strokeWidth={0.5}
              />
            </g>
          );
        })}
      </svg>
      <Legend
        items={[
          {
            label: `Created (${totalCreated})`,
            swatch: (
              <span
                className="inline-block size-3 border border-warning bg-warning"
                aria-hidden
              />
            ),
          },
          {
            label: `Resolved (${totalResolved})`,
            swatch: (
              <span
                className="inline-block size-3 border border-success bg-success"
                aria-hidden
              />
            ),
          },
        ]}
      />
      <NumbersTable
        caption="Created and resolved per day"
        head={['Day', 'Created', 'Resolved', 'Open']}
        rows={rows.map((r) => [short(r.date), r.created, r.resolved, r.open])}
      />
    </div>
  );
}

function CycleChart({ cycle }: { cycle: FlowData['cycle'] }) {
  const pts = cycle.points;
  const max = Math.max(1, ...pts.map((p) => p.days), cycle.summary.p95 ?? 0);
  const x = (i: number) =>
    pad.l +
    (pts.length > 1 ? (i * (W - pad.l - pad.r)) / (pts.length - 1) : (W - pad.l - pad.r) / 2);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const s = cycle.summary;
  const avgPath = pts
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rolling).toFixed(1)}`)
    .join(' ');
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {[
          ['Finished', s.count],
          ['Average', s.average === null ? '–' : `${s.average} d`],
          ['Half within', s.p50 === null ? '–' : `${s.p50} d`],
          ['85% within', s.p85 === null ? '–' : `${s.p85} d`],
          ['95% within', s.p95 === null ? '–' : `${s.p95} d`],
        ].map(([k, v]) => (
          <div key={k} className="bg-muted/40 rounded-lg px-3 py-2">
            <dt className="text-muted-foreground text-xs">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-3xl"
        role="img"
        aria-label={`Cycle time of ${s.count} finished cards. Average ${s.average} days, 85 percent within ${s.p85} days.`}
      >
        <Axes
          max={max}
          labels={pts.map((p) => short(p.resolvedAt))}
          every={Math.max(1, Math.ceil(pts.length / 7))}
        />
        {s.p85 !== null && (
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(s.p85)}
            y2={y(s.p85)}
            className="stroke-warning"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
        <path d={avgPath} fill="none" className="stroke-primary" strokeWidth={2} />
        {pts.map((p, i) => (
          <circle
            key={p.id}
            cx={x(i)}
            cy={y(p.days)}
            r={3.5}
            className="fill-info stroke-background"
            strokeWidth={1}
          >
            <title>{`${p.key} ${p.title}: ${p.days} days`}</title>
          </circle>
        ))}
      </svg>
      <Legend
        items={[
          {
            label: 'A finished card',
            swatch: <span className="inline-block size-2.5 rounded-full bg-info" aria-hidden />,
          },
          {
            label: 'Rolling average of 5',
            swatch: <span className="bg-primary inline-block h-0.5 w-5" aria-hidden />,
          },
          {
            label: '85% line',
            swatch: (
              <span
                className="inline-block w-5 border-t border-dashed border-warning"
                aria-hidden
              />
            ),
          },
        ]}
      />
      <NumbersTable
        caption="Cycle time and lead time of each finished card"
        head={['Card', 'Cycle (days)', 'Lead (days)']}
        rows={pts.map((p) => [`${p.key} ${p.title}`.slice(0, 48), p.days, p.leadDays])}
      />
    </div>
  );
}
