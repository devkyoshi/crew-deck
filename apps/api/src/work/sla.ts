import {
  DEFAULT_SLA,
  isSlaPolicy,
  type Priority,
  type SlaPolicy,
} from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { addDays, isoWeekday, isValidTimezone, localDate, zonedTimeToUtc } from '../lib/time.js';

export interface WorkCalendar {
  tz: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
}

const FALLBACK: WorkCalendar = { tz: 'UTC', workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '17:30' };

/** The workspace's working week, which business-hours targets count against. */
export async function workCalendar(t: TenantDb): Promise<WorkCalendar> {
  const s = await t.tenantSettings.findOne({});
  if (!s) return FALLBACK;
  return {
    tz: isValidTimezone(s.timezone) ? s.timezone : 'UTC',
    workDays: s.workDays?.length ? s.workDays : FALLBACK.workDays,
    workStart: s.workStart || FALLBACK.workStart,
    workEnd: s.workEnd || FALLBACK.workEnd,
  };
}

/** A service space's targets, or the defaults until someone sets their own. */
export async function loadSlaPolicy(t: TenantDb, spaceId: string): Promise<SlaPolicy> {
  const board = await t.boards.findOne({ spaceId });
  const stored = (board?.settings as { sla?: unknown } | undefined)?.sla;
  return isSlaPolicy(stored) ? stored : DEFAULT_SLA;
}

/**
 * `from` plus `minutes` of working time: only the hours between workStart and workEnd on working days
 * count. Falls back to the plain clock if the calendar has no working time at all.
 */
export function addWorkingMinutes(from: Date, minutes: number, cal: WorkCalendar): Date {
  let remaining = minutes;
  let cursor = from;
  let date = localDate(cursor, cal.tz);
  for (let i = 0; i < 800; i++) {
    if (cal.workDays.includes(isoWeekday(date))) {
      const start = zonedTimeToUtc(date, cal.workStart, cal.tz);
      const end = zonedTimeToUtc(date, cal.workEnd, cal.tz);
      const from0 = Math.max(cursor.getTime(), start.getTime());
      if (from0 < end.getTime()) {
        const available = (end.getTime() - from0) / 60_000;
        if (remaining <= available) return new Date(from0 + remaining * 60_000);
        remaining -= available;
      }
    }
    date = addDays(date, 1);
    cursor = zonedTimeToUtc(date, '00:00', cal.tz);
  }
  return new Date(from.getTime() + minutes * 60_000);
}

/** When a new ticket's response and resolve targets fall due. */
export function slaDueDates(policy: SlaPolicy, priority: Priority, from: Date, cal: WorkCalendar) {
  const target = policy.targets[priority];
  const add = (m: number) =>
    policy.businessHours ? addWorkingMinutes(from, m, cal) : new Date(from.getTime() + m * 60_000);
  return { response: add(target.responseMinutes), resolve: add(target.resolveMinutes) };
}

/**
 * Notes that the team has answered a ticket: the first time anyone but the person who raised it
 * comments, assigns, or moves it. Stops the response clock; later calls change nothing.
 */
export async function markFirstResponse(
  t: TenantDb,
  item: { id: string; type: string; reporterId: string; firstResponseAt?: Date | null },
  actorId: string,
  now = new Date(),
) {
  if (item.type !== 'ticket' || item.firstResponseAt || actorId === item.reporterId) return;
  await t.workItems.updateOne({ id: item.id, firstResponseAt: null }, { firstResponseAt: now });
}
