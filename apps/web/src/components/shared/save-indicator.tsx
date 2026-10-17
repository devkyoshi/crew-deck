'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CircleDot, Loader2 } from 'lucide-react';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

/** Tracks a form's save lifecycle. `saved` falls back to `idle` after a short moment. */
export function useSaveState() {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const markDirty = useCallback(() => setState((s) => (s === 'saving' ? s : 'dirty')), []);
  const markSaving = useCallback(() => {
    clearTimeout(timer.current);
    setState('saving');
  }, []);
  const markSaved = useCallback(() => {
    setState('saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2500);
  }, []);
  const markFailed = useCallback(() => setState('dirty'), []);
  return { state, markDirty, markSaving, markSaved, markFailed };
}

const COPY: Record<Exclude<SaveState, 'idle'>, { text: string; icon: React.ReactNode; tone: string }> = {
  dirty: {
    text: 'Unsaved changes',
    icon: <CircleDot className="size-3.5" aria-hidden />,
    tone: 'text-warning-soft-foreground',
  },
  saving: {
    text: 'Saving…',
    icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
    tone: 'text-muted-foreground',
  },
  saved: {
    text: 'Saved',
    icon: <Check className="size-3.5" aria-hidden />,
    tone: 'text-success-soft-foreground',
  },
};

/** Small status pill that tells people whether their edits are safe. */
export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <div className="min-h-5" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {state !== 'idle' && (
          <motion.span
            key={state}
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${COPY[state].tone}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {COPY[state].icon}
            {COPY[state].text}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
