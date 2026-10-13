/** "5 minutes ago", "3 days ago", or a date for older values. */
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'Never';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });

export const daysUntil = (iso: string, now = Date.now()) =>
  Math.ceil((new Date(iso).getTime() - now) / 86_400_000);

/** Offset of `tz` from UTC at `instant`, in minutes (east is positive). */
function tzOffsetMinutes(instant: Date, tz: string): number {
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

/** The instant at which the wall clock in `tz` reads `date` `HH:MM` (same maths as the API). */
export function zonedTimeToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = naive - tzOffsetMinutes(new Date(naive), tz) * 60_000;
  guess = naive - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  return new Date(guess);
}

/** HH:MM of `iso` in `tz`, for time inputs. */
export const timeInZone = (iso: string | null, tz: string) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso))
    : '';

export const addDaysStr = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const formatHours = (h: number | null) =>
  h === null ? '—' : `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
