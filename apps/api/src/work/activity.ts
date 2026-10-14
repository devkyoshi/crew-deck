import type { TenantDb } from '../db/client.js';
import { liveTouch } from '../lib/live.js';
import type { ActivityKind } from '../db/types.js';
import type { presentItem } from './service.js';

/**
 * The item's history: one append-only event per change, shown on the item's Activity tab. Values are
 * snapshots for display (a status name, a person's id and name), so later renames do not rewrite history.
 */

type Presented = ReturnType<typeof presentItem>;

export interface Change {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

const excerpt = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Comparable snapshot of each tracked field. `key` decides whether it changed, `value` is stored. */
const FIELDS: Record<string, (i: Presented) => { key: string; value: unknown }> = {
  title: (i) => ({ key: i.title, value: i.title }),
  description: (i) => ({ key: i.description, value: i.description ? excerpt(i.description) : null }),
  type: (i) => ({ key: i.type, value: i.type }),
  status: (i) => ({ key: i.status.id, value: { id: i.status.id, name: i.status.name, category: i.status.category } }),
  priority: (i) => ({ key: i.priority, value: i.priority }),
  assignee: (i) => ({
    key: i.assignee?.id ?? '',
    value: i.assignee ? { id: i.assignee.id, name: i.assignee.name ?? i.assignee.email } : null,
  }),
  parent: (i) => ({ key: i.parent?.id ?? '', value: i.parent ? { id: i.parent.id, key: i.parent.key, title: i.parent.title } : null }),
  estimate: (i) => ({ key: String(i.estimate), value: i.estimate }),
  dueDate: (i) => ({ key: String(i.dueDate), value: i.dueDate }),
  labels: (i) => {
    const names = i.labels.map((l) => l.name);
    return { key: names.join('\u0000'), value: names };
  },
};

/** Field-by-field differences between two views of the same item. */
export function itemChanges(before: Presented, after: Presented): Change[] {
  const out: Change[] = [];
  for (const [field, snap] of Object.entries(FIELDS)) {
    const a = snap(before);
    const b = snap(after);
    if (a.key !== b.key) out.push({ field, oldValue: a.value, newValue: b.value });
  }
  return out;
}

export interface ActivityInput {
  item: { id: string; spaceId: string };
  actorId: string;
  kind: ActivityKind;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function recordActivity(t: TenantDb, events: ActivityInput | ActivityInput[]) {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;
  const createdAt = new Date();
  for (const e of list) liveTouch({ orgId: t.orgId, spaceId: e.item.spaceId, kind: e.kind, itemId: e.item.id });
  await t.activityEvents.insert(
    list.map((e) => ({
      itemId: e.item.id,
      spaceId: e.item.spaceId,
      actorId: e.actorId,
      kind: e.kind,
      field: e.field ?? null,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      createdAt,
    })),
  );
}

/** One `updated` event per changed field. */
export function recordChanges(
  t: TenantDb,
  item: { id: string; spaceId: string },
  actorId: string,
  changes: Change[],
  opts: { statusAsMove?: boolean } = {},
) {
  const kindOf = (field: string): ActivityKind =>
    opts.statusAsMove && field === 'status' ? 'moved' : 'updated';
  return recordActivity(
    t,
    changes.map((c) => ({ item, actorId, kind: kindOf(c.field), ...c })),
  );
}

/** People who follow an item. Adding someone twice is harmless. */
export async function addWatchers(t: TenantDb, itemId: string, userIds: (string | null | undefined)[]) {
  const unique = [...new Set(userIds.filter((u): u is string => !!u))];
  // Upserts, not insert-and-ignore: a duplicate-key error would abort the surrounding transaction.
  for (const userId of unique) await t.watchers.upsert({ itemId, userId }, { itemId, userId });
}
