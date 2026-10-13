'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, LogIn, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CheckinPanel } from './checkin-panel';
import { useToday } from './use-today';

/** Top-bar control: shows Check in / Checked in 09:12 / Checked out, and opens the form. */
export function CheckinControl() {
  const [open, setOpen] = useState(false);
  const today = useToday();

  if (today.isPending)
    return (
      <Skeleton
        role="status"
        className="h-9 w-28 rounded-xl"
        aria-label="Loading check-in status"
      />
    );
  if (today.isError || !today.data.enabled) return null;
  const t = today.data;

  const label =
    t.status === 'checked_in'
      ? `Checked in ${t.workDay?.checkinLocal ?? ''}`
      : t.status === 'checked_out'
        ? `Checked out ${t.workDay?.checkoutLocal ?? ''}`
        : t.status === 'leave'
          ? 'On leave'
          : t.status === 'holiday'
            ? 'Holiday'
            : 'Check in';
  const Icon =
    t.status === 'checked_in'
      ? Clock
      : t.status === 'checked_out'
        ? CheckCircle2
        : t.status === 'leave'
          ? Plane
          : LogIn;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={t.status === 'not_in' ? 'default' : 'outline'}
          aria-label={`${label}. Open check-in`}
          className="relative"
        >
          {t.status === 'checked_in' && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-900"
              aria-hidden
            />
          )}
          <Icon />
          <span className={cn('hidden sm:inline')}>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <CheckinPanel today={t} onDone={() => setOpen(false)} />
        <div className="mt-3 border-t pt-2 text-center">
          <Link
            href="/my-day"
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => setOpen(false)}
          >
            Open My day
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
