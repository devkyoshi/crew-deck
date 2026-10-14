'use client';

import Link from 'next/link';
import { Children, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/auth/auth-split-layout';
import { cn } from '@/lib/utils';

export interface ShellStep {
  id: string;
  label: string;
  hint: string;
  code?: string;
}

/** Large, calm text fields used on every setup screen. */
export const bigInput = 'h-10 rounded-md bg-background px-3 shadow-none';

function Stepper({
  steps,
  current,
  reached,
  onGo,
}: {
  steps: ShellStep[];
  current: number;
  reached: number;
  onGo: (id: string) => void;
}) {
  return (
    <nav aria-label="Progress">
      <p className="text-muted-foreground text-xs font-medium tracking-wide mb-6" aria-live="polite">
        Step {current + 1} of {steps.length}: {steps[current]?.code ?? steps[current]?.label}
      </p>
      <ol>
        {steps.map((s, i) => {
          const done = i < current || (i <= reached && i !== current);
          const active = i === current;
          const last = i === steps.length - 1;
          const circle = (
            <span
              className={cn(
                'relative flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors duration-300',
                done || active ? 'bg-muted text-foreground' : 'bg-muted/60 text-muted-foreground',
              )}
            >
              {done ? (
                <Check className="size-3" aria-hidden />
              ) : active ? (
                <motion.span
                  aria-hidden
                  className="size-3 rounded-full border-[1.5px] border-dotted border-foreground"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                />
              ) : (
                i + 1
              )}
            </span>
          );
          const text = (
            <span className="min-w-0 pb-7 text-left">
              <span
                className={cn(
                  'block text-sm leading-6 transition-colors',
                  active || done ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
              <span className="text-muted-foreground block text-xs leading-5">{s.hint}</span>
            </span>
          );
          return (
            <li
              key={s.id}
              aria-current={active ? 'step' : undefined}
              className="relative flex gap-3"
            >
              {!last && (
                <span aria-hidden className="bg-border absolute top-7 bottom-1 left-3 w-px">
                  <motion.span
                    className="bg-foreground/60 block w-full origin-top"
                    initial={false}
                    animate={{ height: done ? '100%' : '0%' }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  />
                </span>
              )}
              {done ? (
                <button
                  type="button"
                  onClick={() => onGo(s.id)}
                  className="flex gap-3 rounded-md text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {circle}
                  {text}
                  {s.code && <span className="sr-only">{s.code}</span>}
                </button>
              ) : (
                <>
                  {circle}
                  {text}
                  {s.code && <span className="sr-only">{s.code}</span>}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Full-screen setup canvas: no top bar, no card. A vertical stepper on the left, and the current
 * question sitting directly on the page on the right. `current` and `reachedId` are step ids.
 */
export function WizardShell({
  steps,
  current,
  reachedId,
  onGo,
  children,
  aside,
}: {
  steps: ShellStep[];
  current: string;
  reachedId?: string;
  onGo: (id: string) => void;
  children: ReactNode;
  /** Optional decoration on the right edge (large screens only). */
  aside?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const ci = Math.max(0, steps.findIndex((s) => s.id === current));
  const ri = Math.max(ci, steps.findIndex((s) => s.id === reachedId));
  const prev = useRef(ci);
  const dir = ci >= prev.current ? 1 : -1;
  prev.current = ci;

  return (
    <div className="bg-background text-foreground min-h-svh">
      <div className="mx-auto grid min-h-svh max-w-6xl grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-16 xl:grid-cols-[18rem_minmax(0,1fr)_14rem]">
        {/* Mobile: just a row of progress dots */}
        <div className="flex items-center justify-between px-6 pt-6 lg:hidden">
          <Link href="/" aria-label="Crew Deck home">
            <BrandMark />
          </Link>
          <span className="text-muted-foreground text-xs">
            {ci + 1} / {steps.length}
          </span>
        </div>

        <aside className="hidden lg:flex lg:flex-col lg:justify-center lg:py-16 lg:pl-6">
          <Link href="/" aria-label="Crew Deck home" className="mb-12 inline-flex w-fit items-center gap-2.5">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight">Crew Deck</span>
          </Link>
          <Stepper steps={steps} current={ci} reached={ri} onGo={onGo} />
          <div className="border-border/70 text-muted-foreground mt-2 border-t pt-5 text-sm">
            Need help?{' '}
            <a
              href="mailto:support@crewdeck.app"
              className="text-foreground underline underline-offset-4"
            >
              Contact support
            </a>
          </div>
        </aside>

        <main id="main" className="flex items-center px-6 py-10 lg:px-0 lg:py-16">
          <div className="w-full max-w-md">
            {children}
          </div>
        </main>

        {aside && <div className="hidden xl:flex xl:items-center">{aside}</div>}
      </div>
    </div>
  );
}

/** Bold title with a grey line under it, and an optional illustration above (the invite-code look). */
export function StepHero({
  headingRef,
  title,
  lead,
  art,
}: {
  headingRef: React.Ref<HTMLHeadingElement>;
  title: ReactNode;
  lead?: ReactNode;
  art?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col items-start gap-3">
      {art && <div className="-ml-1">{art}</div>}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-[1.75rem] leading-tight font-semibold tracking-tight outline-none"
      >
        {title}
      </h1>
      {lead && <p className="text-muted-foreground text-[15px] leading-relaxed">{lead}</p>}
    </div>
  );
}

/** Fields that appear one after another. Wrap each child in nothing; children are staggered. */
export function FieldStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-5', className)}>
      {Children.toArray(children).map((c, i) => (
        <div key={i}>{c}</div>
      ))}
    </div>
  );
}

/** A labelled group of related fields, set apart by a caption and a hairline. */
export function FieldGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('border-border/70 space-y-4 border-t pt-5 first:border-t-0 first:pt-0', className)}>
      <legend className="text-muted-foreground float-left mb-3 w-full text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

/** Back on the left, the main action on the right. */
export function StepFooter({
  onBack,
  next,
  loading,
  disabled,
  icon,
  left,
  className,
}: {
  onBack?: () => void;
  next: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  left?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mt-9 flex items-center justify-between gap-3', className)}>
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      ) : (
        (left ?? <span />)
      )}
      <Button
        type="submit"
        loading={loading}
        disabled={disabled}
        
      >
        {next} {!loading && (icon ?? <ArrowRight />)}
      </Button>
    </div>
  );
}

/** Blank full-screen placeholder while a setup flow loads. */
export function SetupLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="bg-background flex min-h-svh items-center justify-center"
    >
      <motion.span
        aria-hidden
        className="size-5 rounded-full border-2 border-dotted border-foreground/60"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

/** A single message on an empty screen (expired link, sign-ups closed). No chrome, no card. */
export function SetupMessage({
  art,
  title,
  children,
  actions,
}: {
  art?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main id="main" className="bg-background text-foreground flex min-h-svh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        {art}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children && <div className="text-muted-foreground text-[15px] leading-relaxed">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </main>
  );
}
