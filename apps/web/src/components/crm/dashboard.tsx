'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarCheck, Handshake, UserPlus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { api } from '@/lib/api';
import { totalsText, useCrmAccess, type CrmDashboard } from '@/lib/crm';
import { CrmGate } from './crm-bits';
import { ActivityRow } from './timeline';

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Handshake;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon className="size-4" aria-hidden /> {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; count: number; extra?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {r.count}
              {r.extra ? ` · ${r.extra}` : ''}
            </span>
          </div>
          <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CrmDashboardView() {
  return (
    <CrmGate>
      <Inner />
    </CrmGate>
  );
}

function Inner() {
  const qc = useQueryClient();
  const canEdit = useCrmAccess().data?.canEdit ?? false;
  const query = useQuery({
    queryKey: ['crm', 'dashboard'],
    queryFn: () => api<CrmDashboard>('/crm/dashboard'),
  });

  if (query.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />;
  if (query.isError) return <ErrorView error={query.error} reset={() => query.refetch()} />;
  const d = query.data;

  const openTotals: Record<string, number> = {};
  let openCount = 0;
  for (const r of d.openDealsByStage) {
    openTotals[r.currency] = (openTotals[r.currency] ?? 0) + r.total;
    openCount += r.count;
  }
  const wonTotals = Object.fromEntries(d.wonThisMonth.map((w) => [w.currency, w.total]));
  const wonCount = d.wonThisMonth.reduce((s, w) => s + w.count, 0);

  // One bar per stage, with the value of the stage across currencies.
  const stages = new Map<
    string,
    { label: string; count: number; totals: Record<string, number>; position: number }
  >();
  for (const r of d.openDealsByStage) {
    const k = `${r.pipeline}|${r.stageId}`;
    const cur = stages.get(k) ?? { label: r.stage, count: 0, totals: {}, position: r.position };
    cur.count += r.count;
    cur.totals[r.currency] = (cur.totals[r.currency] ?? 0) + r.total;
    stages.set(k, cur);
  }
  const stageRows = [...stages.values()]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ label: s.label, count: s.count, extra: totalsText(s.totals) }));

  return (
    <div>
      <PageHeader title="CRM" description="Where your pipeline stands today." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Handshake} label="Open deals" value={openCount} hint={totalsText(openTotals)} />
        <Stat
          icon={BadgeCheck}
          label="Won this month"
          value={wonCount}
          hint={wonCount ? totalsText(wonTotals) : 'No deals won yet'}
        />
        <Stat
          icon={UserPlus}
          label="Open leads"
          value={d.leads.open}
          hint={`${d.leads.converted} converted`}
        />
        <Stat
          icon={CalendarCheck}
          label="My overdue"
          value={d.myOverdue.length}
          hint={d.myOverdue.length ? 'Needs your attention' : 'All caught up'}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="by-stage" className="bg-card rounded-2xl border p-4">
          <h2 id="by-stage" className="mb-3 text-sm font-semibold">
            Open deals by stage
          </h2>
          {stageRows.length ? (
            <Bars rows={stageRows} />
          ) : (
            <EmptyState
              icon={Handshake}
              title="No open deals"
              description="Deals you create appear here by stage."
              action={
                <Link className="text-primary text-sm hover:underline" href="/crm/deals">
                  Go to deals
                </Link>
              }
            />
          )}
        </section>
        <section aria-labelledby="by-source" className="bg-card rounded-2xl border p-4">
          <h2 id="by-source" className="mb-3 text-sm font-semibold">
            Leads by source
          </h2>
          {d.leadsBySource.length ? (
            <Bars rows={d.leadsBySource.map((s) => ({ label: s.source, count: s.count }))} />
          ) : (
            <EmptyState
              icon={UserPlus}
              title="No leads yet"
              description="Capture a lead to see where they come from."
              action={
                <Link className="text-primary text-sm hover:underline" href="/crm/leads">
                  Go to leads
                </Link>
              }
            />
          )}
        </section>
        <section aria-labelledby="overdue" className="bg-card rounded-2xl border p-4 lg:col-span-2">
          <h2 id="overdue" className="mb-3 text-sm font-semibold">
            My overdue activities
          </h2>
          {d.myOverdue.length ? (
            <ul className="space-y-2">
              {d.myOverdue.map((a) => (
                <ActivityRow
                  key={a.id}
                  a={a}
                  canEdit={canEdit}
                  onChanged={() => qc.invalidateQueries({ queryKey: ['crm'] })}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing overdue.</p>
          )}
        </section>
      </div>
    </div>
  );
}
