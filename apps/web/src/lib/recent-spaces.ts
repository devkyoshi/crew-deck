'use client';

import { useSyncExternalStore } from 'react';

export interface RecentSpace {
  key: string;
  name: string;
  icon: string;
}

const STORAGE_KEY = 'recent-spaces';
const EVENT = 'recent-spaces-changed';
const MAX = 5;
const EMPTY: RecentSpace[] = [];

// useSyncExternalStore needs a stable snapshot, so cache by raw string.
let cachedRaw: string | null = null;
let cached: RecentSpace[] = EMPTY;

function read(): RecentSpace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    const parsed = raw ? (JSON.parse(raw) as RecentSpace[]) : EMPTY;
    cached = Array.isArray(parsed) ? parsed.slice(0, MAX) : EMPTY;
    return cached;
  } catch {
    return EMPTY;
  }
}

/** Remembers a visited space (per browser). Recent spaces are a convenience, not stored on the server. */
export function pushRecentSpace(space: RecentSpace) {
  try {
    const next = [space, ...read().filter((s) => s.key !== space.key)].slice(0, MAX);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable */
  }
}

export function forgetRecentSpace(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(read().filter((s) => s.key !== key)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable */
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useRecentSpaces(): RecentSpace[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
