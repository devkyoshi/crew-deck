'use client';

import { useState } from 'react';
import { CheckCircle2, LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TonePill } from '@/components/shared/pastel';
import { CHECKIN_LOCATIONS, LOCATIONS } from '@/lib/locations';
import { formatHours } from '@/lib/format';
import type { CheckinLocation, TodayState } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCheckinActions } from './use-today';

/** The check-in / check-out form. Used in the top-bar popover and on the My day page. */
export function CheckinPanel({ today, onDone }: { today: TodayState; onDone?: () => void }) {
  const { checkIn, checkOut } = useCheckinActions();
  const [location, setLocation] = useState<CheckinLocation>('remote');
  const [siteId, setSiteId] = useState<string>('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const day = today.workDay;
  const hasSites = today.sites.length > 0;

  if (today.status === 'checked_out' && day) {
    const loc = LOCATIONS[day.locationType ?? 'remote'];
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> You are done for today
        </div>
        <dl className="text-muted-foreground grid grid-cols-2 gap-1.5">
          <dt>Location</dt>
          <dd className="text-foreground text-right">
            {loc.label}
            {day.siteName ? ` · ${day.siteName}` : ''}
          </dd>
          <dt>In</dt>
          <dd className="text-foreground text-right">{day.checkinLocal}</dd>
          <dt>Out</dt>
          <dd className="text-foreground text-right">
            {day.checkoutLocal}
            {day.autoClosed && <span className="text-muted-foreground"> (automatic)</span>}
          </dd>
          <dt>Total</dt>
          <dd className="text-foreground text-right">{formatHours(day.hours)}</dd>
        </dl>
        <p className="text-muted-foreground text-xs">
          Need to change a time? Open My day and use Correct.
        </p>
      </div>
    );
  }

  if (today.status === 'checked_in' && day) {
    const loc = LOCATIONS[day.locationType ?? 'remote'];
    const required = today.settings.requireNote;
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = note.trim();
          if (required && !(text || day.note)) {
            setNoteError('Add a short note about what you did.');
            return;
          }
          setNoteError(null);
          checkOut.mutate({ note: text || undefined }, { onSuccess: () => onDone?.() });
        }}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <TonePill tone={loc.tone} icon={loc.icon}>
            {loc.label}
          </TonePill>
          {day.siteName && <span className="text-muted-foreground">{day.siteName}</span>}
          <span className="text-muted-foreground ml-auto">since {day.checkinLocal}</span>
        </div>
        {day.date !== today.date && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            This check-in is from {day.date} and was never closed.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="co-note">What did you work on?{required ? '' : ' (optional)'}</Label>
          <Textarea
            id="co-note"
            rows={3}
            maxLength={500}
            value={note}
            placeholder={day.note ?? 'A line or two is plenty'}
            aria-invalid={!!noteError}
            aria-describedby={noteError ? 'co-note-error' : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
          {noteError && (
            <p id="co-note-error" role="alert" className="text-destructive text-xs">
              {noteError}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={checkOut.isPending}>
          <LogOut /> {checkOut.isPending ? 'Checking out…' : 'Check out'}
        </Button>
      </form>
    );
  }

  const banner =
    today.status === 'leave'
      ? 'You are marked on leave today.'
      : today.status === 'holiday'
        ? `Today is a holiday: ${today.holiday}.`
        : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        checkIn.mutate(
          {
            locationType: location,
            siteId: location === 'onsite' && hasSites ? siteId || undefined : undefined,
            note: note.trim() || undefined,
          },
          { onSuccess: () => onDone?.() },
        );
      }}
    >
      {banner && (
        <p className="bg-muted rounded-lg p-2 text-xs">
          {banner} You can still check in if you are working.
        </p>
      )}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Where are you working?</legend>
        <div className="grid grid-cols-3 gap-2">
          {CHECKIN_LOCATIONS.map((l) => {
            const meta = LOCATIONS[l];
            const on = location === l;
            return (
              <button
                key={l}
                type="button"
                aria-pressed={on}
                onClick={() => setLocation(l)}
                className={cn(
                  'hover:bg-accent flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                  on && 'border-primary bg-accent text-accent-foreground ring-primary/30 ring-2',
                )}
              >
                <meta.icon className="size-5" aria-hidden />
                {meta.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      {location === 'onsite' && hasSites && (
        <div className="space-y-1.5">
          <Label htmlFor="ci-site">Site</Label>
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger id="ci-site" className="w-full" aria-label="Site">
              <SelectValue placeholder="Choose a site" />
            </SelectTrigger>
            <SelectContent>
              {today.sites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="ci-note">Note (optional)</Label>
        <Textarea
          id="ci-note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={checkIn.isPending || (location === 'onsite' && hasSites && !siteId)}
      >
        <LogIn /> {checkIn.isPending ? 'Checking in…' : 'Check in'}
      </Button>
    </form>
  );
}
