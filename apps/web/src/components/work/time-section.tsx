'use client';

import { useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { formatDuration, parseDuration, useWorklogMutations, useWorklogs } from '@/lib/time-api';
import type { WorkItem } from '@/lib/work';
import { toastError } from '@/lib/work-api';
import { UserAvatar } from './work-bits';

const when = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const todayLocal = () => new Date().toLocaleDateString('en-CA');

/** A duration the person types ("1h 30m"); shows a plain error until it can be read. */
function DurationInput({
  id,
  label,
  value,
  onCommit,
  disabled,
  placeholder = 'For example 2h 30m',
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (minutes: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : formatDuration(value));
  const [error, setError] = useState('');
  const [seen, setSeen] = useState(value);
  // Follow changes made elsewhere (logging time changes what is left).
  if (seen !== value) {
    setSeen(value);
    setText(value === null ? '' : formatDuration(value));
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground block text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        className="h-8"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        aria-invalid={!!error}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        onBlur={() => {
          const t = text.trim();
          if (!t) return value === null ? undefined : onCommit(null);
          const m = parseDuration(t);
          if (m === null || m > 60_000) {
            setError('Use hours and minutes, like 1h 30m');
            return;
          }
          if (m !== value) onCommit(m);
          setText(formatDuration(m));
        }}
      />
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Estimates, time spent and the log of work on one item. */
export function TimeSection({
  item,
  canEdit,
  onSave,
}: {
  item: WorkItem;
  canEdit: boolean;
  onSave: (patch: { originalMinutes?: number | null; remainingMinutes?: number | null }) => void;
}) {
  const logs = useWorklogs(item.id);
  const m = useWorklogMutations(item.id);
  const time = item.time ?? { original: null, remaining: null, spent: 0 };
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(todayLocal());
  const [error, setError] = useState('');
  const canLog = logs.data?.permissions.add ?? false;
  const planned = time.original ?? (time.remaining !== null ? time.spent + time.remaining : null);
  const pct = planned ? Math.min(100, (time.spent / planned) * 100) : 0;

  if (!canEdit && !canLog && time.original === null && time.spent === 0) return null;

  return (
    <section aria-label="Time tracking" className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-semibold">Time tracking</h2>
      </div>
      {(planned !== null || time.spent > 0) && (
        <div className="space-y-1">
          <Progress value={pct} aria-label="Time spent against the plan" className="h-1.5" />
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatDuration(time.spent)} logged
            {time.remaining !== null && ` · ${formatDuration(time.remaining)} remaining`}
            {time.original !== null && ` · ${formatDuration(time.original)} planned`}
            {planned !== null && time.spent > planned && (
              <span className="ml-1 font-medium text-warning-soft-foreground ">
                {' '}
                · over the plan
              </span>
            )}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <DurationInput
          id="f-original"
          label="Planned"
          value={time.original}
          disabled={!canEdit}
          onCommit={(v) =>
            onSave({
              originalMinutes: v,
              ...(v !== null && time.spent === 0 ? { remainingMinutes: v } : {}),
            })
          }
        />
        <DurationInput
          id="f-remaining"
          label="Remaining"
          value={time.remaining}
          disabled={!canEdit}
          onCommit={(v) => onSave({ remainingMinutes: v })}
        />
      </div>

      {canLog && (
        <form
          className="space-y-2 rounded-lg border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const mins = parseDuration(minutes);
            if (mins === null || mins < 1 || mins > 1440) {
              setError('Enter the time worked, like 45m or 1h 30m (up to 24h)');
              return;
            }
            setError('');
            m.add.mutate(
              { minutes: mins, date: day, note: note.trim() },
              {
                onSuccess: () => {
                  setMinutes('');
                  setNote('');
                  toast.success(`Logged ${formatDuration(mins)}`);
                },
                onError: (err) => toastError(err, 'Could not log the time'),
              },
            );
          }}
        >
          <div className="flex gap-2">
            <Input
              aria-label="Time worked"
              className="h-8 w-28"
              placeholder="1h 30m"
              value={minutes}
              aria-invalid={!!error}
              onChange={(e) => {
                setMinutes(e.target.value);
                setError('');
              }}
            />
            <Input
              aria-label="Day worked"
              type="date"
              className="h-8"
              max={todayLocal()}
              value={day}
              onChange={(e) => setDay(e.target.value || todayLocal())}
            />
          </div>
          <Input
            aria-label="What was done"
            className="h-8"
            maxLength={500}
            placeholder="What did you do? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <Button type="submit" size="sm" disabled={!minutes.trim() || m.add.isPending}>
            Log time
          </Button>
        </form>
      )}

      {logs.data && logs.data.items.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm" aria-label="Time logged">
          {logs.data.items.map((w) => (
            <li key={w.id} className="group flex items-start gap-2 px-2 py-1.5">
              <UserAvatar person={w.user} size={20} />
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium tabular-nums">{formatDuration(w.minutes)}</span>{' '}
                  <span className="text-muted-foreground text-xs">
                    {w.user ? (w.user.name ?? w.user.email) : 'Someone'} · {when(w.date)}
                  </span>
                </p>
                {w.note && <p className="text-muted-foreground text-xs break-words">{w.note}</p>}
              </div>
              {w.permissions.delete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={`Remove ${formatDuration(w.minutes)} logged ${when(w.date)}`}
                  onClick={() =>
                    m.remove.mutate(w.id, {
                      onError: (err) => toastError(err, 'Could not remove it'),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
