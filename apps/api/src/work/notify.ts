import { randomUUID } from 'node:crypto';
import { isDuplicateKey, type Db, type TenantDb } from '../db/client.js';
import type { NotificationDoc, NotificationType, SpaceDoc, WorkItemDoc } from '../db/types.js';
import { addDays, isValidTimezone, localDate, zonedTimeToUtc } from '../lib/time.js';
import type { Change } from './activity.js';
import { canOpenSpace } from './service.js';

/**
 * Work notifications (brief section 7). Routes collect events while they change data and hand them
 * to `deliver` only after their transaction has committed, so a rolled-back change never notifies.
 * Delivery re-checks that each recipient can still open the space, never notifies the person who
 * made the change, and follows each person's channel preferences. Emails are not sent one by one:
 * they collect in a per-person batch that is sent about five minutes after the first one.
 */

export type NotifyEvent =
  | { type: 'assigned'; orgId: string; actorId: string; itemId: string; userId: string }
  | { type: 'mentioned'; orgId: string; actorId: string; itemId: string; userIds: string[]; excerpt?: string }
  | { type: 'commented'; orgId: string; actorId: string; itemId: string; excerpt: string; skip: string[] }
  | { type: 'status_changed'; orgId: string; actorId: string; itemId: string; from: string; to: string }
  | { type: 'ticket_received'; orgId: string; actorId: string; itemId: string };

export const NOTIFICATION_TYPES: NotificationType[] = [
  'assigned',
  'mentioned',
  'commented',
  'status_changed',
  'due_soon',
  'ticket_received',
  'sla_due_soon',
  'sla_breached',
  'sprint_started',
  'sprint_completed',
  'dm',
  'mention',
  'thread_reply',
  'channel_message',
  'added_to_channel',
];

/** What each event type does when the person has not chosen. */
export const DEFAULT_PREFS: Record<NotificationType, { inApp: boolean; email: boolean }> = {
  assigned: { inApp: true, email: true },
  mentioned: { inApp: true, email: true },
  commented: { inApp: true, email: true },
  status_changed: { inApp: true, email: false },
  due_soon: { inApp: true, email: true },
  ticket_received: { inApp: true, email: true },
  sla_due_soon: { inApp: true, email: false },
  sla_breached: { inApp: true, email: true },
  sprint_started: { inApp: true, email: false },
  sprint_completed: { inApp: true, email: false },
  // Messaging: only direct messages and mentions are emailed (after the email delay, if still unseen).
  dm: { inApp: true, email: true },
  mention: { inApp: true, email: true },
  thread_reply: { inApp: true, email: false },
  channel_message: { inApp: true, email: false },
  added_to_channel: { inApp: true, email: false },
};

export const EMAIL_BATCH_MINUTES = 5;

/** Whether this person wants one daily email instead of quick batches. */
export async function digestOf(t: TenantDb, userId: string) {
  return (await t.notificationPrefs.findOne({ userId }))?.digest === true;
}

/** When the daily digest goes out: 08:00 on the person's next morning (today if it is still before). */
export const DIGEST_HOUR = '08:00';
export function nextDigestTime(now: Date, tz: string) {
  const today = localDate(now, tz);
  const at = zonedTimeToUtc(today, DIGEST_HOUR, tz);
  return at.getTime() > now.getTime() ? at : zonedTimeToUtc(addDays(today, 1), DIGEST_HOUR, tz);
}

export async function preferencesOf(t: TenantDb, userId: string) {
  const row = await t.notificationPrefs.findOne({ userId });
  const out = { ...DEFAULT_PREFS };
  for (const type of NOTIFICATION_TYPES) {
    const p = row?.settings?.[type];
    if (p) out[type] = { inApp: p.inApp !== false, email: p.email === true };
  }
  return out;
}

/** Status and assignee changes found by comparing an item before and after a change. */
export function eventsFromChanges(
  orgId: string,
  actorId: string,
  itemId: string,
  changes: Change[],
): NotifyEvent[] {
  const out: NotifyEvent[] = [];
  for (const c of changes) {
    if (c.field === 'assignee' && c.newValue) {
      out.push({ type: 'assigned', orgId, actorId, itemId, userId: (c.newValue as { id: string }).id });
    }
    if (c.field === 'status') {
      out.push({
        type: 'status_changed',
        orgId,
        actorId,
        itemId,
        from: (c.oldValue as { name: string }).name,
        to: (c.newValue as { name: string }).name,
      });
    }
  }
  return out;
}

interface Delivery {
  userId: string;
  type: NotificationType;
  data: Record<string, unknown>;
}

/** Who hears about one event, before access and preference checks. */
async function recipients(t: TenantDb, e: NotifyEvent, item: WorkItemDoc): Promise<Delivery[]> {
  switch (e.type) {
    case 'assigned':
      return [{ userId: e.userId, type: 'assigned', data: {} }];
    case 'mentioned':
      return e.userIds.map((userId) => ({ userId, type: 'mentioned', data: { excerpt: e.excerpt ?? null } }));
    case 'commented': {
      const watchers = await t.watchers.find({ itemId: item.id }, { projection: { userId: 1 } });
      return watchers
        .filter((w) => !e.skip.includes(w.userId))
        .map((w) => ({ userId: w.userId, type: 'commented', data: { excerpt: e.excerpt } }));
    }
    case 'ticket_received': {
      // The people who run the desk: its space admins and owner, plus whoever it was assigned to.
      const admins = await t.spaceMembers.find({ spaceId: item.spaceId, principalType: 'user', spaceRole: 'admin' });
      const space = await t.spaces.findOne({ id: item.spaceId });
      const ids = [...admins.map((a) => a.principalId), space?.ownerId, item.assigneeId].filter((x): x is string => !!x);
      return [...new Set(ids)].map((userId) => ({ userId, type: 'ticket_received' as const, data: {} }));
    }
    case 'status_changed':
      return [...new Set([item.reporterId, item.assigneeId].filter((x): x is string => !!x))].map((userId) => ({
        userId,
        type: 'status_changed',
        data: { from: e.from, to: e.to },
      }));
  }
}

/** Writes in-app rows and queues emails for a set of events (call after the change has committed). */
export async function deliver(db: Db, events: NotifyEvent[]) {
  const byOrg = new Map<string, NotifyEvent[]>();
  for (const e of events) byOrg.set(e.orgId, [...(byOrg.get(e.orgId) ?? []), e]);
  for (const [orgId, list] of byOrg) {
    const t = db.tenant(orgId);
    for (const e of list) {
      const item = await t.workItems.findOne({ id: e.itemId, deletedAt: null });
      if (!item) continue;
      const space = await t.spaces.findOne({ id: item.spaceId, deletedAt: null });
      if (!space) continue;
      const seen = new Set<string>();
      for (const d of await recipients(t, e, item)) {
        if (d.userId === e.actorId || seen.has(d.userId)) continue;
        seen.add(d.userId);
        await notifyOne(t, space, item, { ...d, actorId: e.actorId });
      }
    }
  }
}

/** One notification to one person, if they can still open the space and want it. */
export async function notifyOne(
  t: TenantDb,
  space: Pick<SpaceDoc, 'id' | 'key' | 'visibility'>,
  item: Pick<WorkItemDoc, 'id' | 'number' | 'title'> | null,
  d: Delivery & { actorId: string | null; dedupeKey?: string },
) {
  if (!(await canOpenSpace(t, space as never, d.userId))) return null;
  const prefs = (await preferencesOf(t, d.userId))[d.type];
  if (!prefs.inApp && !prefs.email) return null;
  const doc: Partial<NotificationDoc> = {
    userId: d.userId,
    type: d.type,
    itemId: item?.id ?? null,
    spaceId: space.id,
    actorId: d.actorId,
    data: {
      ...d.data,
      spaceKey: space.key,
      ...(item ? { key: `${space.key}-${item.number}`, title: item.title } : {}),
    },
    // An in-app row is kept either way (it backs the email), but only shown when in-app is on.
    hidden: !prefs.inApp,
    readAt: null,
    dedupeKey: d.dedupeKey ?? null,
    createdAt: new Date(),
  };
  let created: NotificationDoc;
  if (d.dedupeKey) {
    // Scheduled reminders run again and again; the key keeps them to one per person and day.
    const existing = await t.notifications.findOne({ userId: d.userId, dedupeKey: d.dedupeKey });
    if (existing) return null;
    try {
      created = await t.notifications.insert(doc);
    } catch (e) {
      if (isDuplicateKey(e)) return null;
      throw e;
    }
  } else {
    created = await t.notifications.insert(doc);
  }
  if (prefs.email) await queueEmail(t, d.userId, created.id);
  return created;
}

/** Adds a notification to the person's open email batch (or starts one, due in a few minutes). */
export async function queueEmail(t: TenantDb, userId: string, notificationId: string) {
  const now = new Date();
  let dueAt = new Date(now.getTime() + EMAIL_BATCH_MINUTES * 60_000);
  if (await digestOf(t, userId)) {
    const tz = (await t.users([userId])).get(userId)?.timezone ?? 'UTC';
    dueAt = nextDigestTime(now, isValidTimezone(tz) ? tz : 'UTC');
  }
  await t.emailBatches.updateOne(
    { userId, sentAt: null },
    {
      $addToSet: { notificationIds: notificationId },
      $setOnInsert: { id: randomUUID(), dueAt, createdAt: now },
    } as never,
    { upsert: true },
  );
}

/** Runs `deliver` without letting a notification problem fail the change that caused it. */
export async function deliverSafely(db: Db, events: NotifyEvent[], log: { error: (o: unknown, m?: string) => void }) {
  if (events.length === 0) return;
  try {
    await deliver(db, events);
  } catch (e) {
    log.error(e, 'notification delivery failed');
  }
}
