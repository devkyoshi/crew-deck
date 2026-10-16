import type { TenantDb } from '../db/client.js';
import type { StatusCategory, WorkItemDoc } from '../db/types.js';
import { addDays, localDate, zonedTimeToUtc } from '../lib/time.js';

/**
 * Flow reports computed from what is already recorded: each item's creation time, the status changes in
 * its activity history, and when it was resolved. Nothing extra is stored, so every report works for
 * the whole history of a space. The categories are those the statuses had when the change was made.
 */

export interface Move {
  at: number;
  from: StatusCategory;
  to: StatusCategory;
}

/** An item with the moves between status categories, oldest first. */
export interface Tracked {
  id: string;
  key: string;
  title: string;
  type: WorkItemDoc['type'];
  createdAt: number;
  resolvedAt: number | null;
  /** Category now (the last move's `to`, or the starting category when it never moved). */
  current: StatusCategory;
  start: StatusCategory;
  moves: Move[];
}

const CATEGORIES = new Set<string>(['todo', 'in_progress', 'done']);
const categoryOf = (v: unknown): StatusCategory | null => {
  const c = (v as { category?: string } | null)?.category;
  return c && CATEGORIES.has(c) ? (c as StatusCategory) : null;
};

/** Cards of the space (not epics) with their status history. */
export async function trackItems(t: TenantDb, spaceId: string, spaceKey: string): Promise<Tracked[]> {
  const items = await t.workItems.find(
    { spaceId, deletedAt: null, type: { $ne: 'epic' } },
    { projection: { id: 1, number: 1, title: 1, type: 1, statusId: 1, createdAt: 1, resolvedAt: 1 } },
  );
  if (!items.length) return [];
  const [statuses, events] = await Promise.all([
    t.spaceStatuses.find({ spaceId }),
    t.activityEvents.find(
      { spaceId, field: 'status', itemId: { $in: items.map((i) => i.id) } },
      { sort: { createdAt: 1, id: 1 }, projection: { itemId: 1, oldValue: 1, newValue: 1, createdAt: 1 } },
    ),
  ]);
  const categoryById = new Map(statuses.map((s) => [s.id, s.category]));
  const byItem = new Map<string, Move[]>();
  for (const e of events) {
    const from = categoryOf(e.oldValue);
    const to = categoryOf(e.newValue);
    if (!from || !to) continue;
    const list = byItem.get(e.itemId) ?? [];
    list.push({ at: e.createdAt.getTime(), from, to });
    byItem.set(e.itemId, list);
  }
  return items.map((i) => {
    const moves = byItem.get(i.id) ?? [];
    const now = categoryById.get(i.statusId) ?? 'todo';
    return {
      id: i.id,
      key: `${spaceKey}-${i.number}`,
      title: i.title,
      type: i.type,
      createdAt: i.createdAt.getTime(),
      resolvedAt: i.resolvedAt ? i.resolvedAt.getTime() : null,
      current: moves.length ? moves[moves.length - 1]!.to : now,
      start: moves.length ? moves[0]!.from : now,
      moves,
    };
  });
}

/** The category an item was in at `at`, or null before it existed. */
export function categoryAt(item: Tracked, at: number): StatusCategory | null {
  if (item.createdAt > at) return null;
  let cat = item.start;
  for (const m of item.moves) {
    if (m.at > at) break;
    cat = m.to;
  }
  return cat;
}

/** The last `days` calendar dates ending today in the workspace's timezone, oldest first. */
export function lastDays(now: Date, tz: string, days: number) {
  const today = localDate(now, tz);
  return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
}

/** The instant a local date ends (the start of the next one). */
export const endOfDay = (date: string, tz: string) => zonedTimeToUtc(addDays(date, 1), '00:00', tz).getTime();
const startOfDay = (date: string, tz: string) => zonedTimeToUtc(date, '00:00', tz).getTime();

/** How many cards sat in each category at the end of each day (the cumulative flow diagram). */
export function cumulativeFlow(items: Tracked[], dates: string[], tz: string, now = Date.now()) {
  return dates.map((date) => {
    const at = Math.min(endOfDay(date, tz) - 1, now);
    const counts: Record<StatusCategory, number> = { todo: 0, in_progress: 0, done: 0 };
    for (const item of items) {
      const c = categoryAt(item, at);
      if (c) counts[c]++;
    }
    return { date, ...counts };
  });
}

/** Cards created and resolved on each day, with the open count that follows from them. */
export function createdVsResolved(items: Tracked[], dates: string[], tz: string) {
  const before = startOfDay(dates[0]!, tz);
  let open = items.filter((i) => i.createdAt < before && (i.resolvedAt === null || i.resolvedAt >= before)).length;
  return dates.map((date) => {
    const from = startOfDay(date, tz);
    const to = endOfDay(date, tz);
    const created = items.filter((i) => i.createdAt >= from && i.createdAt < to).length;
    const resolved = items.filter((i) => i.resolvedAt !== null && i.resolvedAt >= from && i.resolvedAt < to).length;
    open += created - resolved;
    return { date, created, resolved, open };
  });
}

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 10) / 10;

export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Cycle time: from the first time a card entered In progress (its creation if it never did) to when it
 * was resolved. Lead time runs from creation. Only cards resolved inside the window are counted.
 */
export function cycleTimes(items: Tracked[], from: number, to: number) {
  const done = items
    .filter((i) => i.resolvedAt !== null && i.resolvedAt >= from && i.resolvedAt < to && i.current === 'done')
    .sort((a, b) => a.resolvedAt! - b.resolvedAt!);
  const points = done.map((i) => {
    const started = i.moves.find((m) => m.to === 'in_progress')?.at ?? i.createdAt;
    return {
      id: i.id,
      key: i.key,
      title: i.title,
      type: i.type,
      resolvedAt: new Date(i.resolvedAt!).toISOString(),
      days: round(Math.max(0, i.resolvedAt! - started) / DAY),
      leadDays: round(Math.max(0, i.resolvedAt! - i.createdAt) / DAY),
    };
  });
  // Rolling average over the last five resolved cards.
  const withAverage = points.map((p, i) => {
    const window = points.slice(Math.max(0, i - 4), i + 1);
    return { ...p, rolling: round(window.reduce((s, x) => s + x.days, 0) / window.length) };
  });
  const sorted = points.map((p) => p.days).sort((a, b) => a - b);
  return {
    points: withAverage,
    summary: {
      count: points.length,
      average: points.length ? round(sorted.reduce((s, x) => s + x, 0) / points.length) : null,
      p50: percentile(sorted, 50),
      p85: percentile(sorted, 85),
      p95: percentile(sorted, 95),
    },
  };
}
