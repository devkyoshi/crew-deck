'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanComparison } from '@/components/plans/plan-comparison';
import { api } from '@/lib/api';
import { formatLimit, formatPrice, type PlanInfo } from '@/lib/plans';
import { cn } from '@/lib/utils';

const BLURB: Record<string, { line: string; points: string[] }> = {
  free: {
    line: 'For a small team getting started.',
    points: ['Up to 5 people', 'Spaces, groups and check-in', 'A simple CRM to start'],
  },
  team: {
    line: 'For growing companies.',
    points: [
      'Up to 50 people',
      'Unlimited spaces',
      'CRM with import and export',
      'Attendance reports',
    ],
  },
  business: {
    line: 'For companies that need control.',
    points: [
      'Unlimited people',
      'Per-space audit log',
      'Your logo and colours',
      'Priority support',
    ],
  },
};

export default function PricingPage() {
  const query = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => api<{ trialDays: number; plans: PlanInfo[] }>('/public/plans'),
  });

  return (
    <div className="space-y-10 pt-6">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Simple plans for every team
        </h1>
        <p className="text-muted-foreground text-lg">
          Start with a {query.data?.trialDays ?? 14}-day trial of everything in Business. When it
          ends you move to Free automatically. Nothing is ever deleted.
        </p>
      </div>

      {query.isPending && (
        <Skeleton role="status" aria-label="Loading plans" className="h-72 w-full rounded-2xl" />
      )}
      {query.isError && (
        <p role="alert" className="text-destructive text-center">
          Could not load the plans. Refresh to try again.
        </p>
      )}

      {query.data && (
        <>
          <ul className="grid gap-4 md:grid-cols-3">
            {query.data.plans.map((p) => (
              <li
                key={p.key}
                className={cn(
                  'bg-card flex flex-col gap-4 rounded-2xl border p-6',
                  p.key === 'team' && 'border-primary ring-primary/20 ring-4',
                )}
              >
                <div>
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <p className="text-muted-foreground text-sm">{BLURB[p.key]?.line}</p>
                </div>
                <p>
                  <span className="text-4xl font-semibold tracking-tight">
                    {formatPrice(p.priceCents)}
                  </span>
                  {p.priceCents ? (
                    <span className="text-muted-foreground text-sm"> per person / month</span>
                  ) : (
                    <span className="text-muted-foreground text-sm"> forever</span>
                  )}
                </p>
                <ul className="flex-1 space-y-2 text-sm">
                  {(BLURB[p.key]?.points ?? []).map((pt) => (
                    <li key={pt} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> {pt}
                    </li>
                  ))}
                  <li className="text-muted-foreground flex items-start gap-2 pl-6">
                    {formatLimit('storage_mb', p.limits.storage_mb)} storage
                  </li>
                </ul>
                <Button asChild variant={p.key === 'team' ? 'default' : 'outline'}>
                  <Link href="/signup">
                    {p.key === 'free' ? 'Start for free' : 'Start free trial'}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
          <section aria-labelledby="compare" className="space-y-3">
            <h2 id="compare" className="text-xl font-semibold">
              Compare plans
            </h2>
            <PlanComparison plans={query.data.plans} />
            <p className="text-muted-foreground text-sm">
              Need more people, custom limits or help moving over? Enterprise is tailored to you.
              Contact us. Prices are per person per month, billed annually. Billing is not switched
              on yet, so nothing is charged.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
