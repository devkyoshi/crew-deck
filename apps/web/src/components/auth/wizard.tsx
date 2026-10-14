import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Saved<T> {
  data: T;
  reached: number;
}

/**
 * A guided, one-question-at-a-time flow. The current step lives in the URL (?step=company), so the
 * browser's Back and Forward buttons move between steps and a refresh stays where you were. Answers
 * and how far you have got are kept for the tab in sessionStorage (optional). You can never jump
 * ahead of the furthest step you completed.
 */
export function useWizard<T extends object>({
  steps,
  storageKey,
  initial,
}: {
  steps: readonly string[];
  /** Omit to keep progress in memory only (for steps that hold one-time secrets). */
  storageKey?: string;
  initial: T;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [state, setState] = useState<Saved<T> | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    let saved: Saved<T> | null = null;
    if (storageKey) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) saved = JSON.parse(raw) as Saved<T>;
      } catch {
        /* storage unavailable: start fresh */
      }
    }
    setState(saved ?? { data: initial, reached: 0 });
  }, [storageKey]);

  const [optimisticStep, setOptimisticStep] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticStep(null);
  }, [params]);

  const activeStepId = optimisticStep ?? params.get('step') ?? steps[0]!;
  const requested = steps.indexOf(activeStepId);
  const index = Math.max(0, requested);
  const reached = state?.reached ?? 0;

  const hrefFor = useCallback(
    (id: string) => {
      const p = new URLSearchParams(params.toString());
      p.set('step', id);
      return `${pathname}?${p.toString()}`;
    },
    [params, pathname],
  );

  const persist = useCallback(
    (next: Saved<T>) => {
      setState(next);
      if (!storageKey) return;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable: progress is kept in memory only */
      }
    },
    [storageKey],
  );

  // Typing a step into the address bar cannot skip questions.
  useEffect(() => {
    if (state && index > state.reached) router.replace(hrefFor(steps[state.reached]!));
  }, [state, index, router, hrefFor, steps]);

  // After each step change, move focus to the heading so screen readers announce the new question.
  const current = state && index <= state.reached ? steps[index] : null;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [current]);

  return {
    ready: state !== null && index <= state.reached,
    step: steps[index]!,
    index,
    reached,
    data: (state?.data ?? initial) as T,
    headingRef,
    /** Save answers without moving. */
    set(patch: Partial<T>) {
      if (state) persist({ ...state, data: { ...state.data, ...patch } });
    },
    /** Save answers and go to the next step. */
    next(patch?: Partial<T>) {
      if (!state) return;
      const to = Math.min(steps.length - 1, index + 1);
      const targetStep = steps[to]!;
      setOptimisticStep(targetStep);
      persist({ data: { ...state.data, ...patch }, reached: Math.max(state.reached, to) });
      router.push(hrefFor(targetStep));
    },
    /** Save answers and jump to any step (used when one step is skipped). */
    jumpTo(id: string, patch?: Partial<T>) {
      if (!state) return;
      const to = steps.indexOf(id);
      setOptimisticStep(id);
      persist({ data: { ...state.data, ...patch }, reached: Math.max(state.reached, to) });
      router.push(hrefFor(id));
    },
    /** Go to a step you have already reached. */
    go(id: string) {
      if (steps.indexOf(id) <= reached) {
        setOptimisticStep(id);
        router.push(hrefFor(id));
      }
    },
    back() {
      if (index > 0) {
        const targetStep = steps[index - 1]!;
        setOptimisticStep(targetStep);
        router.replace(hrefFor(targetStep));
      }
    },
    reset() {
      if (storageKey) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
      setOptimisticStep(steps[0]!);
      setState({ data: initial, reached: 0 });
      router.replace(hrefFor(steps[0]!));
    },
  };
}

export interface WizardStepItem {
  id: string;
  label: string;
  title?: string;
  description?: string;
}

/**
 * Stepper for multi-step flows. Supports Reference 3 vertical aesthetic with connected steps,
 * checkmarks for completed, dotted active circle for current, numbers for upcoming,
 * and support links, as well as responsive mobile progress bar.
 */
export function WizardProgress({
  steps,
  index,
  reached,
  onGo,
  orientation = 'responsive',
}: {
  steps: WizardStepItem[];
  index: number;
  reached: number;
  onGo: (id: string) => void;
  orientation?: 'horizontal' | 'vertical' | 'responsive';
}) {
  return (
    <nav aria-label="Progress" className="w-full">
      {/* Mobile top progress bar (shown on small screens if responsive, or when horizontal) */}
      <div
        className={cn(
          orientation === 'responsive'
            ? 'md:hidden mb-6 space-y-3'
            : orientation === 'horizontal'
              ? 'mb-6 space-y-3'
              : 'hidden',
        )}
      >
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-medium tracking-wide" aria-live="polite">
            Step {index + 1} of {steps.length}: {steps[index]?.label}
          </p>
          <span className="text-[11px] font-semibold text-primary">
            {Math.round(((index + 1) / steps.length) * 100)}% complete
          </span>
        </div>
        <ol className="flex items-center gap-2">
          {steps.map((s, i) => {
            const done = i < index || (i <= reached && i !== index);
            const active = i === index;
            const inner = (
              <>
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-all',
                    active && 'bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20',
                    done && 'bg-primary/15 text-primary',
                    !active && !done && 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-3" aria-hidden="true" /> : i + 1}
                </span>
                <span className="sr-only sm:not-sr-only text-xs font-medium">{s.label}</span>
              </>
            );
            return (
              <li key={s.id} className="flex-1" aria-current={active ? 'step' : undefined}>
                <div
                  className={cn(
                    'mb-2 h-1.5 rounded-full transition-all duration-300',
                    i <= Math.max(index, reached) ? 'bg-primary' : 'bg-muted',
                    !active && i > index && 'opacity-60',
                  )}
                  aria-hidden="true"
                />
                {done ? (
                  <button
                    type="button"
                    onClick={() => onGo(s.id)}
                    className="text-primary flex items-center gap-1.5 text-xs font-medium hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                  >
                    {inner}
                  </button>
                ) : (
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-xs',
                      active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Desktop / Vertical Stepper (Reference Image 3) */}
      <div
        className={cn(
          orientation === 'responsive'
            ? 'hidden md:block'
            : orientation === 'vertical'
              ? 'block'
              : 'hidden',
        )}
      >
        <p
          className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-8"
          aria-live="polite"
        >
          Step {index + 1} of {steps.length}: {steps[index]?.label}
        </p>

        <ol className="relative space-y-7">
          {steps.map((s, i) => {
            const done = i < index || (i <= reached && i !== index);
            const active = i === index;
            const isLast = i === steps.length - 1;

            return (
              <li
                key={s.id}
                className="relative flex items-start gap-4"
                aria-current={active ? 'step' : undefined}
              >
                {/* Vertical connecting line */}
                {!isLast && (
                  <div
                    className={cn(
                      'absolute left-3.5 top-8 -bottom-7 w-0.5 -translate-x-1/2 transition-colors',
                      i < index ? 'bg-primary' : 'bg-border',
                    )}
                    aria-hidden="true"
                  />
                )}

                {/* Step indicator and content */}
                {done ? (
                  <button
                    type="button"
                    onClick={() => onGo(s.id)}
                    className="group flex items-start gap-3.5 text-left w-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl p-1 -m-1 transition-colors hover:bg-muted/40"
                  >
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/25 transition-transform group-hover:scale-105">
                      <Check className="size-4 stroke-[2.5]" aria-hidden="true" />
                    </span>
                    <div className="flex flex-col min-w-0 pt-0.5">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {s.title ?? s.label}
                      </span>
                      <span className="sr-only">{s.label}</span>
                      {s.description && (
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {s.description}
                        </span>
                      )}
                    </div>
                  </button>
                ) : active ? (
                  <div className="flex items-start gap-3.5 text-left w-full p-1 -m-1">
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-primary bg-primary/5">
                      <span className="size-2 rounded-full bg-primary" />
                    </span>
                    <div className="flex flex-col min-w-0 pt-0.5">
                      <span className="text-sm font-semibold text-foreground">
                        {s.title ?? s.label}
                      </span>
                      <span className="sr-only">{s.label}</span>
                      {s.description && (
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {s.description}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3.5 text-left w-full p-1 -m-1 opacity-60">
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-muted-foreground text-xs font-semibold">
                      {i + 1}
                    </span>
                    <div className="flex flex-col min-w-0 pt-0.5">
                      <span className="text-sm font-medium text-muted-foreground">
                        {s.title ?? s.label}
                      </span>
                      <span className="sr-only">{s.label}</span>
                      {s.description && (
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {s.description}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Reference Image 3 bottom support link */}
        <div className="pt-6 mt-8 border-t border-border/50 text-xs text-muted-foreground">
          Need help?{' '}
          <Link
            href="/pricing"
            className="font-semibold text-foreground underline underline-offset-4 hover:text-primary transition-colors"
          >
            Contact support
          </Link>
        </div>
      </div>
    </nav>
  );
}

