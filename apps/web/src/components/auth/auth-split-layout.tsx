'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { KanbanSquare, Layers, ShieldCheck, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SplitVariant = 'signin' | 'workspaces' | 'platform';

interface Slide {
  headline: string;
  lead: string;
}

/** Words on the dark brand panel. Several slides per screen rotate under the dots. */
const SLIDES: Record<SplitVariant, Slide[]> = {
  signin: [
    {
      headline: 'One workspace to keep your whole team moving',
      lead: 'Spaces, daily check-ins, people and a simple CRM, all behind your own company address.',
    },
    {
      headline: 'See who is in and what needs you',
      lead: 'Check in, follow the board and pick up exactly where your team left off.',
    },
    {
      headline: 'Your data stays yours',
      lead: 'Every company is isolated from every other, from the database up.',
    },
  ],
  workspaces: [
    {
      headline: 'Every company has its own address',
      lead: 'Enter yours to sign in. It looks like yourcompany.example.com.',
    },
    {
      headline: 'Not sure of it?',
      lead: 'Ask a workspace admin, or check the invite email you were sent.',
    },
  ],
  platform: [
    {
      headline: 'Platform administration',
      lead: 'For the people who run Crew Deck itself: workspaces, plans and sign-up rules.',
    },
    {
      headline: 'Every action is recorded',
      lead: 'Workspace accounts do not work on this page.',
    },
  ],
};

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg shadow-xs',
        className,
      )}
    >
      <Layers className="size-4" aria-hidden />
    </span>
  );
}

function BrandPanel({ variant }: { variant: SplitVariant }) {
  const slides = SLIDES[variant];
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => setI(0), [variant]);
  useEffect(() => {
    if (reduce || slides.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [reduce, slides.length]);

  const Icon = variant === 'platform' ? ShieldCheck : variant === 'workspaces' ? Users : KanbanSquare;
  const slide = slides[i] ?? slides[0]!;

  return (
    <div className="relative hidden overflow-hidden rounded-[1.75rem] bg-[oklch(0.16_0.02_262)] text-white lg:flex lg:flex-col lg:items-center lg:justify-center">
      {/* soft brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_0%,oklch(0.5_0.21_258/0.55),transparent_70%)]"
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-1/2 size-[28rem] -translate-x-1/2 rounded-full bg-[oklch(0.5_0.21_258/0.18)] blur-3xl"
        animate={reduce ? undefined : { opacity: [0.5, 1, 0.5], scale: [1, 1.08, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative z-10 flex max-w-sm flex-col items-center px-8 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          className="mb-10 flex size-20 items-center justify-center rounded-[1.4rem] border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/40 backdrop-blur"
        >
          <span className="bg-primary flex size-12 items-center justify-center rounded-lg text-white">
            <Icon className="size-6" aria-hidden />
          </span>
        </motion.div>

        <div className="min-h-[9.5rem]" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${variant}-${i}`}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">{slide.headline}</h2>
              <p className="mt-3 text-sm leading-relaxed text-white/55">{slide.lead}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center gap-2" role="tablist" aria-label="Highlights">
          {slides.map((_, n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={`Highlight ${n + 1}`}
              onClick={() => setI(n)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                n === i ? 'w-5 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/50',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Sign-in style screens: a framed two-pane card. Dark brand panel on the left, a clean white form
 * pane on the right with the logo, an optional link top-right and small links along the bottom.
 */
export function AuthSplitLayout({
  variant,
  top,
  children,
}: {
  variant: SplitVariant;
  top?: { text: string; label: string; href: string };
  children: ReactNode;
}) {
  return (
    <div className="bg-[oklch(0.9_0.01_85)] dark:bg-[oklch(0.13_0.01_262)] min-h-svh p-3 sm:p-5">
      <div className="bg-[oklch(0.13_0.015_262)] mx-auto grid min-h-[calc(100svh-1.5rem)] max-w-[1400px] grid-cols-1 gap-2 rounded-[2rem] p-2 sm:min-h-[calc(100svh-2.5rem)] lg:grid-cols-2 dark:bg-[oklch(0.1_0.01_262)]">
        <BrandPanel variant={variant} />

        <div className="bg-background text-foreground flex flex-col rounded-[1.75rem] px-6 py-5 sm:px-10 sm:py-7">
          <header className="flex items-center justify-between">
            <Link href="/" aria-label="Crew Deck home" className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-sm font-semibold tracking-tight">Crew Deck</span>
            </Link>
            {top && (
              <span className="text-xs">
                {top.text}{' '}
                <Link href={top.href} className="font-medium underline underline-offset-4">
                  {top.label}
                </Link>
              </span>
            )}
          </header>

          <main id="main" className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[26rem]">
              {children}
            </div>
          </main>

          <footer className="text-muted-foreground flex items-center justify-between text-xs">
            <span>&copy; {new Date().getFullYear()} Crew Deck</span>
            <span className="flex items-center gap-5">
              <Link href="/pricing" className="hover:text-foreground">
                Pricing
              </Link>
              <Link href="/workspaces" className="hover:text-foreground">
                Workspaces
              </Link>
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Heading block for the form pane: bold title with a grey line under it. */
export function SplitHeading({
  title,
  lead,
  icon,
}: {
  title: ReactNode;
  lead?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col items-center gap-1.5 text-center">
      {icon && <div className="mb-2">{icon}</div>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {lead && <p className="text-muted-foreground text-sm leading-relaxed">{lead}</p>}
    </div>
  );
}
