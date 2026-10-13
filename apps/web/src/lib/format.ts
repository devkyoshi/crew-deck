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
