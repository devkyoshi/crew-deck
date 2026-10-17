'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, type HistoryRow, type Location, type WorkDayEdit } from '@/lib/api';
import { shortDate, timeInZone, zonedTimeToUtc } from '@/lib/format';
import { LOCATIONS } from '@/lib/locations';

type Target = { userId: string; name: string | null; email: string; timezone: string };

/**
 * Corrects a day (or adds a missing one). A reason is always required; every change is kept in the
 * day's history and in the audit log.
 */
export function CorrectionDialog({
  open,
  onOpenChange,
  day,
  person,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The day to correct, or null to add a missing day. */
  day: HistoryRow | null;
  person: Target;
  /** The person's current local date, to cap the date picker. */
  today: string;
}) {
  const qc = useQueryClient();
  const tz = person.timezone;
  const [date, setDate] = useState('');
  const [location, setLocation] = useState<Location>('remote');
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(day?.date ?? '');
    setLocation((day?.locationType ?? 'remote') as Location);
    setCheckin(timeInZone(day?.checkinAt ?? null, tz) || '09:00');
    setCheckout(timeInZone(day?.checkoutAt ?? null, tz));
    setNote(day?.note ?? '');
    setReason('');
    setErrors({});
  }, [open, day, tz]);

  const edits = useQuery({
    queryKey: ['work-day-edits', day?.id],
    queryFn: () => api<{ items: WorkDayEdit[] }>(`/work-days/${day!.id}/edits`),
    enabled: open && !!day,
  });

  async function save() {
    const e: Record<string, string> = {};
    if (!day && !date) e.date = 'Choose a date';
    if (reason.trim().length < 3) e.reason = 'Say why you are changing this';
    if (!checkin) e.checkinAt = 'Enter a check-in time';
    setErrors(e);
    if (Object.keys(e).length) return;

    const d = day?.date ?? date;
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (!day || checkin !== timeInZone(day.checkinAt, tz))
      body.checkinAt = zonedTimeToUtc(d, checkin, tz).toISOString();
    if (!day || checkout !== timeInZone(day.checkoutAt, tz))
      body.checkoutAt = checkout ? zonedTimeToUtc(d, checkout, tz).toISOString() : null;
    if (!day || location !== (day.locationType ?? 'remote')) body.locationType = location;
    if (!day || note !== (day.note ?? '')) body.note = note.trim() || null;
    if (!day) {
      body.date = d;
      body.userId = person.userId;
      body.checkinAt = zonedTimeToUtc(d, checkin, tz).toISOString();
    }

    setSaving(true);
    try {
      if (day) await api(`/work-days/${day.id}`, { method: 'PATCH', body });
      else await api('/work-days', { body });
      toast.success(day ? 'Day corrected' : 'Day added');
      for (const k of ['history', 'me-week', 'me-today', 'team', 'work-day-edits'])
        qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : 'Could not save the correction');
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) => errors[k] && <p className="text-destructive text-xs">{errors[k]}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{day ? `Correct ${shortDate(day.date)}` : 'Add a missing day'}</DialogTitle>
          <DialogDescription>
            {person.name ?? person.email} · times are in {tz}. Changes are kept in the day&apos;s
            history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!day && (
            <div className="space-y-1.5">
              <Label htmlFor="cd-date">Date</Label>
              <Input
                id="cd-date"
                type="date"
                max={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={!!errors.date}
              />
              {err('date')}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cd-loc">Location</Label>
            <Select value={location} onValueChange={(v) => setLocation(v as Location)}>
              <SelectTrigger id="cd-loc" className="w-full" aria-label="Location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['onsite', 'remote', 'offsite', 'leave'] as const).map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCATIONS[l].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cd-in">Check-in</Label>
              <Input
                id="cd-in"
                type="time"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value)}
                aria-invalid={!!errors.checkinAt}
              />
              {err('checkinAt')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cd-out">Check-out</Label>
              <Input
                id="cd-out"
                type="time"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                aria-invalid={!!errors.checkoutAt}
              />
              {err('checkoutAt')}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-note">Note</Label>
            <Textarea
              id="cd-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-reason">Reason for the change</Label>
            <Textarea
              id="cd-reason"
              rows={2}
              maxLength={300}
              placeholder="For example: forgot to check out"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={!!errors.reason}
            />
            {err('reason')}
          </div>

          {day && edits.data && edits.data.items.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">History</div>
              <ul className="text-muted-foreground max-h-32 space-y-1.5 overflow-y-auto text-xs">
                {edits.data.items.map((h) => (
                  <li key={h.id} className="bg-muted rounded-lg px-2.5 py-1.5">
                    <span className="text-foreground font-medium">
                      {h.editorName ?? h.editorEmail}
                    </span>
                    : {h.reason}{' '}
                    <span>
                      (
                      {new Date(h.editedAt).toLocaleString('en', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      )
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? 'Saving…' : day ? 'Save correction' : 'Add day'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
