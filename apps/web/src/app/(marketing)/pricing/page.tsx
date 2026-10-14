'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Layers,
  MailCheck,
  Rocket,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanComparison } from '@/components/plans/plan-comparison';
import { JiraSpotIcon } from '@/components/illustrations/jira-illustrations';
import { api } from '@/lib/api';
import { formatLimit, formatPrice, type PlanInfo } from '@/lib/plans';
import { cn } from '@/lib/utils';

const BLURB: Record<string, { line: string; points: string[] }> = {
  free: {
    line: 'For a small team getting started with agility.',
    points: ['Up to 5 people', 'Spaces, groups and daily check-in', 'Kanban boards and CRM to start'],
  },
  team: {
    line: 'For growing companies needing full collaboration.',
    points: [
      'Up to 50 people',
      'Unlimited spaces & boards',
      'Full CRM with import & export',
      'Attendance & team reports',
    ],
  },
  business: {
    line: 'For organizations demanding governance & scale.',
    points: [
      'Unlimited teammates',
      'Per-space & org audit log',
      'Custom branding & logo',
      'Priority support & SLA',
    ],
  },
};

const STEPS = [
  {
    icon: Rocket,
    color: 'blue' as const,
    title: 'Sign up in a minute',
    text: 'Tell us your name, company and work email. No credit card needed.',
  },
  {
    icon: MailCheck,
    color: 'emerald' as const,
    title: 'Confirm your email',
    text: 'Open the one-time link we send. Your workspace is provisioned instantly.',
  },
  {
    icon: UsersRound,
    color: 'purple' as const,
    title: 'Invite your team',
    text: 'Create spaces, launch sprints, check in. You are on a full 14-day trial of everything.',
  },
];

const FAQ = [
  {
    q: 'What happens when the trial ends?',
    a: 'Your workspace moves to the Free plan automatically. Nothing is deleted: anything above the Free limits stays readable, you just cannot add more until you move to a bigger plan.',
  },
  {
    q: 'Do I need a credit card to start?',
    a: 'No. Billing is not switched on yet, so nothing is charged on any plan during your evaluation.',
  },
  {
    q: 'Can I use a personal email address?',
    a: 'Yes. A company email is recommended, because it lets you restrict invitations to your own domain, but it is not required.',
  },
  {
    q: 'Is my company’s data kept separate?',
    a: 'Yes. Every company has its own address and its data is isolated from every other company at the database level with strict multi-tenancy.',
  },
  {
    q: 'Can I change plan later?',
    a: 'Yes. A platform administrator can move your workspace between plans at any time, and the billing page displays your current usage in real time.',
  },
];

export default function PricingPage() {
  const query = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => api<{ trialDays: number; plans: PlanInfo[] }>('/public/plans'),
  });
  const trial = query.data?.trialDays ?? 14;

  return (
    <div className="space-y-16 sm:space-y-24">
      {/* Clean, Apple/Jira-inspired Hero Section (No Stock Photos) */}
      <section className="relative overflow-hidden pt-8 pb-12 sm:pt-14 sm:pb-16 text-center">
        {/* Subtle ambient radial backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent opacity-80"
        />

        <div className="mx-auto max-w-4xl px-5 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary shadow-xs">
            <Sparkles className="size-3.5" aria-hidden />
            <span>14-day full Business trial • No credit card required</span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Simple plans for every team
          </h1>

          <p className="mx-auto max-w-2xl text-base text-muted-foreground sm:text-lg">
            Start with a {trial}-day trial of everything in Business. When it ends, your workspace moves to
            Free automatically, and nothing is ever deleted.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button size="lg" className="h-11 rounded-xl px-6 font-medium shadow-sm" asChild>
              <Link href="/signup">
                Start free trial <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 rounded-xl px-6 font-medium"
              asChild
            >
              <a href="#compare">Compare plans</a>
            </Button>
          </div>

          <div className="flex items-center justify-center gap-6 pt-2 text-xs text-muted-foreground font-medium">
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-600" aria-hidden /> No credit card needed
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-600" aria-hidden /> 60-second setup
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-600" aria-hidden /> 100% data isolation
            </span>
          </div>
        </div>
      </section>

      {/* Plans Grid */}
      <div className="mx-auto max-w-6xl px-5 space-y-20">
        {query.isPending && (
          <Skeleton role="status" aria-label="Loading plans" className="h-96 w-full rounded-2xl" />
        )}
        {query.isError && (
          <p role="alert" className="text-destructive text-center">
            Could not load the plans. Refresh to try again.
          </p>
        )}

        {query.data && (
          <ul className="grid gap-6 md:grid-cols-3 items-stretch">
            {query.data.plans.map((p) => {
              const isTeam = p.key === 'team';
              return (
                <li
                  key={p.key}
                  className={cn(
                    'bg-card relative flex flex-col justify-between rounded-2xl border p-7 transition-all shadow-xs',
                    isTeam
                      ? 'border-primary shadow-lg ring-2 ring-primary/20 md:-translate-y-2'
                      : 'border-border/80 hover:border-border',
                  )}
                >
                  {isTeam && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground rounded-full px-3.5 py-1 text-xs font-bold tracking-wide uppercase shadow-xs">
                        Most popular
                      </span>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-foreground">{p.name}</h2>
                      <p className="text-muted-foreground text-xs mt-1 min-h-[32px]">{BLURB[p.key]?.line}</p>
                    </div>

                    <div className="py-2 border-y border-border/50">
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-extrabold tracking-tight text-foreground">
                          {formatPrice(p.priceCents)}
                        </span>
                        <span className="text-muted-foreground text-xs font-medium">
                          {p.priceCents ? ' / person / mo' : ' forever'}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {p.priceCents ? 'Billed annually or monthly' : 'Free for small teams'}
                      </p>
                    </div>

                    <ul className="space-y-2.5 text-xs text-foreground/90 pt-1">
                      {(BLURB[p.key]?.points ?? []).map((pt) => (
                        <li key={pt} className="flex items-start gap-2.5">
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 mt-0.5">
                            <Check className="size-2.5 font-bold" aria-hidden />
                          </span>
                          <span className="leading-snug">{pt}</span>
                        </li>
                      ))}
                      <li className="flex items-start gap-2.5 text-muted-foreground">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
                          <Check className="size-2.5 text-muted-foreground font-bold" aria-hidden />
                        </span>
                        <span>{formatLimit('storage_mb', p.limits.storage_mb)} workspace storage</span>
                      </li>
                    </ul>
                  </div>

                  <div className="pt-6">
                    <Button
                      asChild
                      variant={isTeam ? 'default' : 'outline'}
                      className="w-full h-10 rounded-xl font-medium"
                    >
                      <Link href="/signup">
                        {p.key === 'free' ? 'Start for free' : 'Start free trial'}
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Up and Running in Three Steps */}
        <section aria-labelledby="how" className="space-y-8 pt-4">
          <div className="text-center space-y-2">
            <h2 id="how" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Up and running in three steps
            </h2>
            <p className="text-muted-foreground text-sm max-w-lg mx-auto">
              Everything you need to organize your team without weeks of configuration.
            </p>
          </div>

          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="bg-card rounded-2xl border border-border/70 p-6 shadow-xs flex flex-col justify-between gap-4 transition-all hover:border-primary/40 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <JiraSpotIcon icon={s.icon} color={s.color} />
                  <span className="text-xs font-mono font-bold text-muted-foreground">
                    0{i + 1}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-base text-foreground">{s.title}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Plan Comparison Table */}
        {query.data && (
          <section id="compare" aria-labelledby="compare-title" className="scroll-mt-8 space-y-6 pt-4">
            <div className="text-center space-y-2">
              <h2 id="compare-title" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Compare plans
              </h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Detailed breakdown of features, permissions and workspace limits.
              </p>
            </div>

            <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-xs p-4 sm:p-6">
              <PlanComparison plans={query.data.plans} />
            </div>

            <p className="text-muted-foreground text-xs text-center max-w-2xl mx-auto">
              Need custom volume, enterprise SSO, or dedicated hosting? Contact our team. Prices are per person
              per month, billed annually. Billing is currently in preview, so no card is required.
            </p>
          </section>
        )}

        {/* Frequently Asked Questions */}
        <section aria-labelledby="faq" className="mx-auto max-w-3xl space-y-6 pt-4">
          <div className="text-center space-y-2">
            <h2 id="faq" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Frequently asked questions
            </h2>
            <p className="text-muted-foreground text-sm">
              Answers to common questions about trials, plans, and workspace privacy.
            </p>
          </div>

          <div className="space-y-3">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="bg-card group rounded-xl border border-border/70 px-5 py-4 transition-colors hover:border-border open:border-primary/40 open:bg-card/90"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-sm text-foreground">
                  <span>{f.q}</span>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Bottom Call to Action Card */}
        <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/10 via-primary/5 to-card p-8 sm:p-12 text-center shadow-xs">
          <div className="mx-auto max-w-xl space-y-4">
            <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Layers className="size-6" aria-hidden />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Ready when your team is
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
              Create your workspace in under a minute. Zero credit card required, 14-day full Business trial.
            </p>
            <div className="pt-2">
              <Button size="lg" className="h-11 rounded-xl px-8 font-medium shadow-sm" asChild>
                <Link href="/signup">
                  Start free trial <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
