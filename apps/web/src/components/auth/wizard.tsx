'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

  const requested = steps.indexOf(params.get('step') ?? steps[0]!);
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
      persist({ data: { ...state.data, ...patch }, reached: Math.max(state.reached, to) });
      router.push(hrefFor(steps[to]!));
    },
    /** Save answers and jump to any step (used when one step is skipped). */
    jumpTo(id: string, patch?: Partial<T>) {
      if (!state) return;
      const to = steps.indexOf(id);
      persist({ data: { ...state.data, ...patch }, reached: Math.max(state.reached, to) });
      router.push(hrefFor(id));
    },
    /** Go to a step you have already reached. */
    go(id: string) {
      if (steps.indexOf(id) <= reached) router.push(hrefFor(id));
    },
    back() {
      if (index > 0) router.replace(hrefFor(steps[index - 1]!));
    },
    reset() {
      if (storageKey) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
      setState({ data: initial, reached: 0 });
      router.replace(hrefFor(steps[0]!));
    },
  };
}

/** "Step 2 of 4" with a bar. Steps you have completed are buttons that take you back to them. */
export function WizardProgress({
  steps,
  index,
  reached,
  onGo,
}: {
  steps: { id: string; label: string }[];
  index: number;
  reached: number;
  onGo: (id: string) => void;
}) {
  return (
    <nav aria-label="Progress" className="mb-6 space-y-3">
      <p className="text-muted-foreground text-xs font-medium" aria-live="polite">
        Step {index + 1} of {steps.length}: {steps[index]?.label}
      </p>
      <ol className="flex gap-2">
        {steps.map((s, i) => {
          const done = i < index || (i <= reached && i !== index);
          const active = i === index;
          const inner = (
            <>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  active && 'bg-primary text-primary-foreground',
                  done && 'bg-primary/15 text-primary',
                  !active && !done && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              <span className="sr-only sm:not-sr-only">{s.label}</span>
            </>
          );
          return (
            <li key={s.id} className="flex-1" aria-current={active ? 'step' : undefined}>
              <div
                className={cn(
                  'mb-2 h-1 rounded-full',
                  i <= Math.max(index, reached) ? 'bg-primary' : 'bg-border',
                  !active && i > index && 'opacity-50',
                )}
                aria-hidden
              />
              {done ? (
                <button
                  type="button"
                  onClick={() => onGo(s.id)}
                  className="text-primary flex items-center gap-1.5 text-xs font-medium hover:underline"
                >
                  {inner}
                </button>
              ) : (
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    active ? 'font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
