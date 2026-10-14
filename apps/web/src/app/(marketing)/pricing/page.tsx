'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronDown, MailCheck, Rocket, UsersRound } from 'lucide-react';
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

const STEPS = [
  {
    icon: Rocket,
    title: 'Sign up in a minute',
    text: 'Tell us your name, company and work email. No card needed.',
  },
  {
    icon: MailCheck,
    title: 'Confirm your email',
    text: 'Open the link we send. Your workspace is created right then.',
  },
  {
    icon: UsersRound,
    title: 'Invite your team',
    text: 'Add people, make spaces, start checking in. You are on a free trial of everything.',
  },
];

const FAQ = [
  {
    q: 'What happens when the trial ends?',
    a: 'Your workspace moves to the Free plan automatically. Nothing is deleted: anything above the Free limits stays readable, you just cannot add more until you move to a bigger plan.',
  },
  {
    q: 'Do I need a credit card to start?',
    a: 'No. Billing is not switched on yet, so nothing is charged on any plan.',
  },
  {
    q: 'Can I use a personal email address?',
    a: 'Yes. A company email is best, because it lets you restrict invitations to your own domain, but it is not required.',
  },
  {
    q: 'Is my company’s data kept separate?',
    a: 'Yes. Every company has its own address and its data is isolated from every other company at the database level.',
  },
  {
    q: 'Can I change plan later?',
    a: 'Yes. A platform administrator can move your workspace between plans at any time, and the plan page shows what you use against your limits.',
  },
];

export default function PricingPage() {
  const query = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => api<{ trialDays: number; plans: PlanInfo[] }>('/public/plans'),
  });
  const trial = query.data?.trialDays ?? 14;

  return (
    <div>
      <section className="relative isolate overflow-hidden">
        <Image
          src="/auth/desk-topdown.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-20 object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/90 via-slate-950/75 to-slate-950/40"
        />
        <div className="mx-auto max-w-6xl px-5 py-16 text-white sm:py-24">
          <div className="max-w-2xl space-y-5">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Simple plans for every team
            </h1>
            <p className="text-lg text-slate-100">
              Start with a {trial}-day trial of everything in Business. When it ends you move to
              Free automatically, and nothing is ever deleted.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">
                  Start free trial <ArrowRight />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                asChild
              >
                <a href="#compare">Compare plans</a>
              </Button>
            </div>
            <p className="text-sm text-slate-300">No card needed. Set up in about a minute.</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-5 pt-12">
        {query.isPending && (
          <Skeleton role="status" aria-label="Loading plans" className="h-72 w-full rounded-2xl" />
        )}
        {query.isError && (
          <p role="alert" className="text-destructive text-center">
            Could not load the plans. Refresh to try again.
          </p>
        )}

        {query.data && (
          <ul className="grid gap-5 md:grid-cols-3">
            {query.data.plans.map((p) => (
              <li
                key={p.key}
                className={cn(
                  'bg-card relative flex flex-col gap-4 rounded-2xl border p-6 shadow-sm',
                  p.key === 'team' && 'border-primary ring-primary/20 shadow-lg ring-4',
                )}
              >
                {p.key === 'team' && (
                  <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-0.5 text-xs font-semibold">
                    Most popular
                  </span>
                )}
                <div>
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <p className="text-muted-foreground text-sm">{BLURB[p.key]?.line}</p>
                </div>
                <p>
                  <span className="text-4xl font-semibold tracking-tight">
                    {formatPrice(p.priceCents)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {p.priceCents ? ' per person / month' : ' forever'}
                  </span>
                </p>
                <ul className="flex-1 space-y-2 text-sm">
                  {(BLURB[p.key]?.points ?? []).map((pt) => (
                    <li key={pt} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> {pt}
                    </li>
                  ))}
                  <li className="text-muted-foreground pl-6">
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
        )}

        <section aria-labelledby="how" className="space-y-6">
          <h2 id="how" className="text-center text-2xl font-semibold tracking-tight">
            Up and running in three steps
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bg-card flex gap-4 rounded-2xl border p-5">
                <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold">
                    <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                    {s.title}
                  </p>
                  <p className="text-muted-foreground text-sm">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {query.data && (
          <section id="compare" aria-labelledby="compare-title" className="scroll-mt-6 space-y-3">
            <h2 id="compare-title" className="text-2xl font-semibold tracking-tight">
              Compare plans
            </h2>
            <PlanComparison plans={query.data.plans} />
            <p className="text-muted-foreground text-sm">
              Need more people, custom limits or help moving over? Enterprise is tailored to you.
              Contact us. Prices are per person per month, billed annually. Billing is not switched
              on yet, so nothing is charged.
            </p>
          </section>
        )}

        <section aria-labelledby="faq" className="mx-auto max-w-3xl space-y-4">
          <h2 id="faq" className="text-center text-2xl font-semibold tracking-tight">
            Questions
          </h2>
          <div className="space-y-2">
            {FAQ.map((f) => (
              <details key={f.q} className="bg-card group rounded-xl border px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <ChevronDown
                    className="size-4 shrink-0 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <p className="text-muted-foreground mt-2 text-sm">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="bg-primary text-primary-foreground rounded-3xl px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready when your team is
          </h2>
          <p className="text-primary-foreground/90 mx-auto mt-2 max-w-xl">
            Create your workspace in a minute and invite people when you are ready.
          </p>
          <Button size="lg" variant="secondary" className="mt-6" asChild>
            <Link href="/signup">
              Start free trial <ArrowRight />
            </Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
