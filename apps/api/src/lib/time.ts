/**
 * Calendar maths in a named timezone. A "day" for check-in is always the person's own local date, so
 * everything here goes through Intl rather than UTC arithmetic.
 */

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of `instant` as seen in `tz`. */
export function localDate(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Offset of `tz` from UTC at `instant`, in minutes (east is positive). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant at which the wall clock in `tz` reads `dateStr` `HH:MM`. Handles DST changes. */
export function zonedTimeToUtc(dateStr: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes settle on the right offset even when the guess lands on the other side of a DST change.
  let guess = naive - tzOffsetMinutes(new Date(naive), tz) * 60_000;
  guess = naive - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  return new Date(guess);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday to Sunday dates of the week containing `dateStr`. */
export function weekOf(dateStr: string): string[] {
  const monday = addDays(dateStr, -(isoWeekday(dateStr) - 1));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isRealDate = (s: string) => DATE_RE.test(s) && addDays(s, 0) === s;
