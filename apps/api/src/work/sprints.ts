import type { Db, TenantDb } from '../db/client.js';
import type { SprintDoc, WorkItemDoc } from '../db/types.js';
import { localDate } from '../lib/time.js';

/**
 * Scrum sprints. Items join and leave sprints; every join and leave is written to
 * `sprintItemsHistory`, which is what the sprint report and the burndown's scope changes read.
 * Points are the estimates of the sprint's stories, tasks and bugs (subtasks are never counted, so
 * nothing is counted twice).
 */

export const SPRINT_ITEM_TYPES = ['story', 'task', 'bug'] as const;

export const points = (items: Pick<WorkItemDoc, 'estimate'>[]) =>
  items.reduce((sum, i) => sum + Number(i.estimate ?? 0), 0);

/** Moves items into a sprint (or out to the backlog with null), recording the history. */
export async function setItemsSprint(
  t: TenantDb,
  items: Pick<WorkItemDoc, 'id' | 'sprintId' | 'estimate'>[],
  sprintId: string | null,
  now = new Date(),
) {
  for (const item of items) {
    if (item.sprintId === sprintId) continue;
    if (item.sprintId) {
      await t.sprintItemsHistory.updateMany(
        { sprintId: item.sprintId, itemId: item.id, removedAt: null },
        { removedAt: now },
      );
    }
    if (sprintId) {
      await t.sprintItemsHistory.insert({
        sprintId,
        itemId: item.id,
        addedAt: now,
        removedAt: null,
        estimateAtAdd: item.estimate === null ? null : Number(item.estimate),
      });
    }
    await t.workItems.updateOne({ id: item.id }, { sprintId, updatedAt: now });
  }
}

/** The day's remaining and total points for an active sprint, written once per day (latest run wins). */
export async function snapshotSprint(t: TenantDb, sprint: SprintDoc, date: string) {
  const items = await t.workItems.find(
    { sprintId: sprint.id, deletedAt: null, type: { $in: [...SPRINT_ITEM_TYPES] } },
    { projection: { estimate: 1, resolvedAt: 1 } },
  );
  const total = points(items);
  const remaining = points(items.filter((i) => !i.resolvedAt));
  await t.sprintSnapshots.upsert(
    { sprintId: sprint.id, date },
    { totalPoints: total, remainingPoints: remaining, items: items.length, open: items.filter((i) => !i.resolvedAt).length } as never,
  );
  return { total, remaining };
}

/**
 * Records today's numbers for every active sprint, in each workspace's own timezone. Runs hourly; the
 * snapshot for a date is overwritten until the date ends there, so the last run of the day is kept.
 */
export async function snapshotActiveSprints(db: Db, now = new Date()) {
  const active = await db.global.all.sprints.find({ state: 'active' });
  let n = 0;
  for (const sprint of active) {
    const t = db.tenant(sprint.orgId);
    const settings = await t.tenantSettings.findOne({});
    await snapshotSprint(t, sprint, localDate(now, settings?.timezone ?? 'UTC'));
    n++;
  }
  return n;
}

export function startSprintSnapshots(db: Db, log: { error(m: string): void }) {
  const run = () => snapshotActiveSprints(db).catch((e: Error) => log.error(`sprint snapshots failed: ${e.message}`));
  void run();
  const timer = setInterval(run, 60 * 60_000);
  return { close: async () => clearInterval(timer) };
}

/** Each day from start to end (inclusive), as YYYY-MM-DD. */
export function daysBetween(start: string, end: string) {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
