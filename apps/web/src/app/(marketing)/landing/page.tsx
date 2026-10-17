'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  FolderKanban,
  LayoutGrid,
  Link2,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  JiraSpotIcon,
  JiraTeamCheckinIllustration,
} from '@/components/illustrations/jira-illustrations';
import { cn } from '@/lib/utils';

/** Fades and lifts into view once as it scrolls on screen. */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

type Tone = 'blue' | 'orange' | 'pink' | 'green';
const TONE: Record<Tone, { head: string; dot: string; count: string }> = {
  blue: {
    head: 'bg-info-soft text-info-soft-foreground ',
    dot: 'bg-info',
    count: 'bg-info-soft text-info-soft-foreground ',
  },
  orange: {
    head: 'bg-orange-soft text-orange-soft-foreground ',
    dot: 'bg-orange',
    count: 'bg-orange-soft text-orange-soft-foreground ',
  },
  pink: {
    head: 'bg-violet-soft text-violet-soft-foreground ',
    dot: 'bg-violet',
    count: 'bg-violet-soft text-violet-soft-foreground ',
  },
  green: {
    head: 'bg-success-soft text-success-soft-foreground ',
    dot: 'bg-success',
    count: 'bg-success-soft text-success-soft-foreground ',
  },
};

const PRIORITY = {
  High: 'bg-danger-soft text-danger-soft-foreground ',
  Medium: 'bg-orange-soft text-orange-soft-foreground ',
  Low: 'bg-info-soft text-info-soft-foreground ',
} as const;

interface Ticket {
  id: string;
  title: string;
  due: string;
  done: number;
  total: number;
  priority: keyof typeof PRIORITY;
  people: string[];
  links: number;
  comments: number;
}

const COLUMNS: { name: string; tone: Tone; count: number; tickets: Ticket[] }[] = [
  {
    name: 'To Do',
    tone: 'blue',
    count: 3,
    tickets: [
      { id: 'CRW-112', title: 'SAML single sign-on', due: 'Oct 28', done: 1, total: 5, priority: 'High', people: ['AY', 'NK'], links: 2, comments: 4 },
      { id: 'CRW-114', title: 'Custom webhook triggers', due: 'Nov 02', done: 0, total: 3, priority: 'Low', people: ['TL'], links: 1, comments: 0 },
    ],
  },
  {
    name: 'In Progress',
    tone: 'orange',
    count: 2,
    tickets: [
      { id: 'CRW-106', title: 'Auth and setup redesign', due: 'Oct 21', done: 3, total: 4, priority: 'Medium', people: ['AY', 'SC'], links: 3, comments: 9 },
      { id: 'CRW-107', title: 'Live workspace address check', due: 'Oct 24', done: 2, total: 6, priority: 'Medium', people: ['NK'], links: 1, comments: 2 },
    ],
  },
  {
    name: 'In Review',
    tone: 'pink',
    count: 1,
    tickets: [
      { id: 'CRW-103', title: 'Audit log export to CSV', due: 'Oct 18', done: 5, total: 5, priority: 'High', people: ['TL', 'MK'], links: 2, comments: 6 },
    ],
  },
  {
    name: 'Completed',
    tone: 'green',
    count: 14,
    tickets: [
      { id: 'CRW-098', title: 'Daily team attendance board', due: 'Oct 10', done: 4, total: 4, priority: 'Low', people: ['SC'], links: 0, comments: 3 },
      { id: 'CRW-099', title: 'Multi-tenant data isolation', due: 'Oct 08', done: 8, total: 8, priority: 'High', people: ['AY', 'TL'], links: 4, comments: 11 },
    ],
  },
];

const AVATAR = [
  'bg-info-soft text-info-soft-foreground',
  'bg-warning-soft text-warning-soft-foreground',
  'bg-success-soft text-success-soft-foreground',
  'bg-violet-soft text-violet-soft-foreground',
];

function Avatars({ people }: { people: string[] }) {
  return (
    <div className="flex -space-x-1.5">
      {people.map((p, i) => (
        <span
          key={p}
          className={cn(
            'ring-card flex size-5 items-center justify-center rounded-full text-xs font-bold ring-2',
            AVATAR[(p.charCodeAt(0) + i) % AVATAR.length],
          )}
        >
          {p}
        </span>
      ))}
    </div>
  );
}

function TicketCard({ t, finished }: { t: Ticket; finished: boolean }) {
  const pct = Math.round((t.done / t.total) * 100);
  return (
    <div className="border-border/70 bg-card rounded-lg border p-3 shadow-xs transition-shadow hover:shadow-md">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span className="bg-muted rounded-md px-1.5 py-0.5 font-medium">Due {t.due}</span>
        <span className="font-mono">{t.id}</span>
      </div>
      <p className="text-foreground mt-2 text-label leading-snug font-semibold">{t.title}</p>
      <div className="mt-2.5">
        <div className="text-muted-foreground mb-1 flex justify-between text-xs">
          <span>Milestone</span>
          <span>
            {t.done}/{t.total}
          </span>
        </div>
        <div className="bg-muted h-1 overflow-hidden rounded-full">
          <div
            className={cn('h-full rounded-full', finished ? 'bg-success' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatars people={t.people} />
          <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', PRIORITY[t.priority])}>
            {t.priority}
          </span>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="flex items-center gap-0.5">
            <Link2 className="size-3" aria-hidden /> {t.links}
          </span>
          <span className="flex items-center gap-0.5">
            <MessageSquare className="size-3" aria-hidden /> {t.comments}
          </span>
        </div>
      </div>
    </div>
  );
}

function Board() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map((c, ci) => (
        <motion.div
          key={c.name}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: ci * 0.06, duration: 0.35 }}
          className="space-y-2.5"
        >
          <div
            className={cn(
              'flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold',
              TONE[c.tone].head,
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn('size-1.5 rounded-full', TONE[c.tone].dot)} />
              {c.name}
              <span className={cn('rounded-full px-1.5 py-px text-xs', TONE[c.tone].count)}>
                {c.count}
              </span>
            </span>
            <Plus className="size-3.5 opacity-60" aria-hidden />
          </div>
          {c.tickets.map((t) => (
            <TicketCard key={t.id} t={t} finished={c.tone === 'green'} />
          ))}
        </motion.div>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'board', label: 'Agile Board', icon: FolderKanban },
  { id: 'checkin', label: 'Team Check-ins', icon: UserCheck },
  { id: 'crm', label: 'Client Pipeline', icon: Users },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Showcase() {
  const [tab, setTab] = useState<TabId>('board');
  return (
    <div className="border-border/70 bg-card rounded-lg border p-4 shadow-xl shadow-slate-900/5 sm:p-6 dark:shadow-none">
      <div className="border-border/60 mb-5 flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg text-sm font-bold">
            AE
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Acme Engineering</h3>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success-soft-foreground ">
                Active sprint
              </span>
            </div>
            <p className="text-muted-foreground text-xs">acme.crewdeck.app</p>
          </div>
        </div>
        <div role="tablist" aria-label="Product views" className="bg-muted/70 inline-flex rounded-lg p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                tab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab === id && (
                <motion.span
                  layoutId="showcase-tab"
                  className="bg-card absolute inset-0 rounded-lg shadow-xs"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <Icon className="relative size-3.5" aria-hidden />
              <span className="relative hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'board' && (
            <div className="space-y-4">
              <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
                <div className="relative">
                  <Search className="absolute top-2 left-2.5 size-3" aria-hidden />
                  <div className="border-border/70 bg-muted/30 flex h-7 w-44 items-center rounded-lg border pl-7 sm:w-64">
                    Search tasks…
                  </div>
                </div>
                <span className="hidden sm:inline">Sprint goal: ship the new sign-up flow · 8 days left</span>
              </div>
              <Board />
            </div>
          )}
          {tab === 'checkin' && (
            <JiraTeamCheckinIllustration className="border-0 bg-transparent shadow-none" />
          )}
          {tab === 'crm' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                ['Leads', '24 active', '8 new this week', ''],
                ['Deals in flight', '$148,000', '+18% vs last month', 'text-success-soft-foreground'],
                ['Win rate', '68%', 'Across 32 closed deals', ''],
              ].map(([k, v, s, c]) => (
                <div key={k} className="bg-muted/40 border-border/50 rounded-lg border p-4">
                  <span className="text-muted-foreground text-xs font-semibold uppercase">{k}</span>
                  <p className="mt-1 text-2xl font-bold">{v}</p>
                  <p className={cn('text-muted-foreground mt-0.5 text-xs', c && `${c} font-medium`)}>{s}</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Flat layered art behind the hero board: solid blue and amber slabs, offset. */
function HeroSlabs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 -bottom-6 -z-10">
      <div className="absolute inset-x-4 top-8 bottom-0 rotate-[-1.2deg] rounded-[2rem] bg-primary/90 sm:inset-x-10" />
      <div className="absolute inset-x-8 top-2 bottom-4 rotate-[1.4deg] rounded-[2rem] bg-warning sm:inset-x-16" />
    </div>
  );
}

const FEATURES = [
  { icon: LayoutGrid, color: 'blue', title: 'Spaces & boards', body: 'Give engineering, design and marketing their own space, each with a Kanban board and clear statuses.' },
  { icon: UserCheck, color: 'emerald', title: 'Daily check-ins', body: 'Skip the stand-up call. See who is in the office, remote or focused, updated in real time.' },
  { icon: Users, color: 'purple', title: 'Built-in CRM', body: 'Keep leads, deals and meetings next to the product work that delivers them.' },
  { icon: ShieldCheck, color: 'amber', title: 'Isolated by design', body: 'Your own company address, data isolation between companies, and an audit log you can export.' },
] as const;

const STEPS = [
  { t: 'Name your workspace', d: 'Pick your company address. We check it is free and reserve it as you type.' },
  { t: 'Confirm with one click', d: 'We email you a link. Open it, choose a password, and you are the workspace owner.' },
  { t: 'Invite your crew', d: 'Send invites or share a link. Teammates land right in their spaces.' },
];

export default function LandingPage() {
  return (
    <div className="space-y-24 overflow-hidden sm:space-y-32">
      {/* Hero */}
      <section className="relative px-5 pt-14 text-center sm:pt-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,oklch(0.5_0.21_258/0.12),transparent_70%)]"
        />
        <div className="mx-auto max-w-4xl space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold"
          >
            <Sparkles className="size-3.5" aria-hidden /> Spaces, check-ins, CRM and boards in one place
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl leading-[1.08] font-extrabold tracking-tight sm:text-6xl lg:text-7xl"
          >
            Where great teams plan,
            <br />
            <span className="from-primary bg-linear-to-r to-info bg-clip-text text-transparent">
              track and ship together.
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground mx-auto max-w-2xl text-base leading-relaxed sm:text-xl"
          >
            One fast workspace for agile boards, daily check-ins and your customer pipeline. Simple to
            set up, simple to price.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex flex-wrap items-center justify-center gap-3 pt-2"
          >
            <Button size="lg" className="h-12 rounded-lg px-7 text-sm font-semibold shadow-md" asChild>
              <Link href="/signup">
                Start free trial <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 rounded-lg px-7 text-sm font-semibold" asChild>
              <Link href="/pricing">View pricing</Link>
            </Button>
          </motion.div>
          <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-2 text-xs font-medium">
            {['14-day Business trial', 'No credit card needed', 'Your own company address'].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-success-soft-foreground" aria-hidden /> {t}
              </span>
            ))}
          </div>
        </div>

        <Reveal className="relative mx-auto mt-16 max-w-6xl text-left">
          <HeroSlabs />
          <Showcase />
        </Reveal>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl space-y-12 px-5">
        <Reveal className="space-y-3 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything your company needs. Nothing it doesn’t.
          </h2>
          <p className="text-muted-foreground mx-auto max-w-2xl">
            No endless configuration or cluttered toolbars. Every screen is calm, clear and quick.
          </p>
        </Reveal>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06}>
              <div className="bg-card border-border/70 hover:border-primary/40 h-full space-y-4 rounded-lg border p-6 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md">
                <JiraSpotIcon icon={f.icon} color={f.color} />
                <div>
                  <h3 className="text-base font-bold">{f.title}</h3>
                  <p className="text-muted-foreground mt-1.5 text-label leading-relaxed">{f.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Setup */}
      <section className="mx-auto max-w-5xl px-5">
        <Reveal className="bg-muted/40 border-border/70 rounded-lg border p-8 sm:p-12">
          <div className="mx-auto mb-10 max-w-2xl space-y-3 text-center">
            <span className="text-primary text-xs font-semibold tracking-wider uppercase">Simple setup</span>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From zero to working in under a minute
            </h2>
            <p className="text-muted-foreground text-sm">
              A short guided flow, one question at a time. No forms to wade through.
            </p>
          </div>
          <ol className="grid gap-5 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.t} className="bg-card border-border/70 space-y-3 rounded-lg border p-6 shadow-xs">
                <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-full text-xs font-bold">
                  {i + 1}
                </span>
                <h3 className="text-sm font-bold">{s.t}</h3>
                <p className="text-muted-foreground text-label leading-relaxed">{s.d}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5">
        <Reveal className="relative overflow-hidden rounded-lg bg-primary px-8 py-14 text-center text-primary-foreground sm:px-14 sm:py-20">
          <div aria-hidden className="absolute -top-16 -right-10 size-64 rounded-full bg-warning/90" />
          <div aria-hidden className="absolute -bottom-24 -left-10 size-72 rounded-full bg-white/10" />
          <div className="relative mx-auto max-w-2xl space-y-5">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
              Elevate how your team builds.
            </h2>
            <p className="mx-auto max-w-xl text-sm text-primary-foreground/80 sm:text-base">
              Join teams moving from bloated enterprise software to something focused and light.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button size="lg" variant="secondary" className="h-12 rounded-lg px-8 font-semibold" asChild>
                <Link href="/signup">
                  Start free trial <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="h-12 rounded-lg px-7 font-semibold text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
                asChild
              >
                <Link href="/workspaces">Find my workspace</Link>
              </Button>
            </div>
            <p className="pt-1 text-xs text-primary-foreground/70">
              No credit card required · Free plan available
            </p>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
