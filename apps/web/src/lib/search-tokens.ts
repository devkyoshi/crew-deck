/** Helpers for editing a search query's `key:value` filters (used by the search page's chips). */

/** Adds or removes one filter token, such as `has:file`, in the query text. */
export function toggleToken(q: string, token: string) {
  const parts = q.split(/\s+/).filter(Boolean);
  return (parts.includes(token) ? parts.filter((p) => p !== token) : [...parts, token]).join(' ');
}

/** Replaces any filter with this key (for example a date) with a new value, or removes it. */
export function setToken(q: string, key: string, value: string | null) {
  const parts = q.split(/\s+/).filter((p) => p && !p.toLowerCase().startsWith(`${key}:`));
  if (value) parts.push(`${key}:${value}`);
  return parts.join(' ');
}
