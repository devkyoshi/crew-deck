const KEY = 'cd:recent-workspaces';

export interface RecentWorkspace {
  slug: string;
  name: string;
}

/** Workspaces this browser signed in to lately, newest first. Storage may be unavailable, so never throw. */
export function readRecentWorkspaces(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentWorkspace[]) : [];
    return list
      .filter((w) => w && typeof w.slug === 'string' && typeof w.name === 'string')
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function rememberWorkspace(w: RecentWorkspace) {
  try {
    const next = [w, ...readRecentWorkspaces().filter((x) => x.slug !== w.slug)].slice(0, 5);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}
