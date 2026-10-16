/**
 * Quiet hours: a daily window in the person's own timezone during which desktop alerts and emails stay
 * silent (badges and the inbox still update). The window may cross midnight, like 22:00 to 07:00.
 */
export interface QuietHours {
  enabled: boolean;
  /** HH:MM, 24-hour. */
  start: string;
  end: string;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const isValidTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Minutes since local midnight in `tz` at `now` (falls back to UTC for an unknown zone). */
function localMinutes(now: Date, tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  }
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n('hour') * 60 + n('minute');
}

export function inQuietHours(quiet: QuietHours | undefined | null, tz: string, now = new Date()) {
  if (!quiet?.enabled) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  const at = localMinutes(now, tz);
  return start < end ? at >= start && at < end : at >= start || at < end;
}
