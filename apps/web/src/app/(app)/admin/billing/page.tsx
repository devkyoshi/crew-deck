'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Sparkles } from 'lucide-react';
import { PlanComparison } from '@/components/plans/plan-comparison';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { daysUntil } from '@/lib/format';
import { formatLimit, formatPrice, LIMIT_LABEL, type LimitKey, type PlanState } from '@/lib/plans';

const METERS: LimitKey[] = ['seats', 'spaces', 'crm_records', 'pipelines', 'sites', 'storage_mb'];

export default function BillingPage() {
  const isAdmin = useIsAdmin();
  const query = useQuery({
    queryKey: ['plan'],
    queryFn: () => api<PlanState>('/plan'),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to see the plan and usage."
      />
    );
  }
  if (query.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />;
  if (query.isError) return <ErrorView error={query.error} reset={() => query.refetch()} />;

  const { plan, usage, plans } = query.data;
  const current = plans.find((p) => p.key === plan.key);
  const days = plan.trialEndsAt ? Math.max(0, daysUntil(plan.trialEndsAt)) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan and billing"
        description="What your workspace includes, and how much of it you use."
      />

      <section
        aria-labelledby="current-plan"
        className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5"
      >
        <div className="space-y-1">
          <h2 id="current-plan" className="flex items-center gap-2 text-lg font-semibold">
            {plan.name}
            {plan.onTrial && (
              <span className="bg-accent text-accent-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                <Sparkles className="size-3" aria-hidden /> Trial
              </span>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            {plan.onTrial && days !== null
              ? `Your trial ends in ${days} day${days === 1 ? '' : 's'}. After that the workspace moves to Free. Nothing is deleted.`
              : plan.key === null
                ? 'This workspace has no plan limits.'
                : current?.priceCents
                  ? `${formatPrice(current.priceCents)} per person / month`
                  : 'Free plan'}
          </p>
        </div>
        <p className="text-muted-foreground max-w-sm text-sm">
          Billing is not switched on yet, so nothing is charged. To change your plan, contact your
          Crew Deck representative.
        </p>
      </section>

      {usage && (
        <section aria-labelledby="usage" className="bg-card space-y-4 rounded-2xl border p-5">
          <h2 id="usage" className="text-lg font-semibold">
            Usage
          </h2>
          <ul className="grid gap-5 sm:grid-cols-2">
            {METERS.map((k) => {
              const used = usage[k] ?? 0;
              const max = plan.limits[k];
              const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
              return (
                <li key={k} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span>{LIMIT_LABEL[k]}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {k === 'storage_mb' ? `${used} MB` : used} of {formatLimit(k, max)}
                    </span>
                  </div>
                  {max !== undefined ? (
                    <Progress
                      value={pct}
                      aria-label={`${LIMIT_LABEL[k]} used`}
                      className={
                        pct >= 100 ? '[&>div]:bg-rose-600' : pct >= 80 ? '[&>div]:bg-amber-500' : ''
                      }
                    />
                  ) : (
                    <p className="text-muted-foreground text-xs">No limit on your plan</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-muted-foreground text-xs">
            When you reach a limit you cannot add more, but nothing you already have is changed or
            removed.
          </p>
        </section>
      )}

      <section aria-labelledby="compare" className="space-y-3">
        <h2 id="compare" className="text-lg font-semibold">
          Compare plans
        </h2>
        <PlanComparison plans={plans} current={plan.key} />
      </section>
    </div>
  );
}
