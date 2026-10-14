'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Label + control + hint/error. Wires id, aria-invalid and aria-describedby into the single child
 * control, shows the error with a slide-in, and shakes the control whenever a new error appears
 * (or `shakeKey` changes, which forms bump on a failed submit).
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  shakeKey,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  shakeKey?: number;
  className?: string;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  const [shake, setShake] = React.useState(false);

  React.useEffect(() => {
    if (!error) return;
    setShake(true);
    const t = setTimeout(() => setShake(false), 450);
    return () => clearTimeout(t);
  }, [error, shakeKey]);

  const describedBy = error ? errorId : hint ? hintId : undefined;
  const control = React.cloneElement(children, {
    id: htmlFor,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  });

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      <div className={cn(shake && 'animate-shake')}>{control}</div>
      {error ? (
        <p
          id={errorId}
          className="animate-slide-down text-destructive flex items-center gap-1 text-xs"
        >
          <AlertCircle className="size-3 shrink-0" aria-hidden /> {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-muted-foreground text-xs">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
