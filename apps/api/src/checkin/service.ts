import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/service.js';
import { withTenant, type Db, type Tx } from '../db/client.js';
import { tenantSettings, users, workDays } from '../db/schema.js';
import { isValidTimezone, zonedTimeToUtc } from '../lib/time.js';

export type WorkSettings = {
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  autoCloseTime: string;
  requireNote: boolean;
  checkinEnabled: boolean;
  crmEnabled: boolean;
};

export const DEFAULT_SETTINGS: WorkSettings = {
  timezone: 'UTC',
  workDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '17:30',
  autoCloseTime: '20:00',
  requireNote: false,
  checkinEnabled: true,
  crmEnabled: true,
};

/** Postgres returns time columns as HH:MM:SS; the API speaks HH:MM. */
export const hhmm = (t: string) => t.slice(0, 5);

/** The workspace's settings, or the defaults when nobody has changed them yet. */
export async function loadSettings(tx: Tx, orgId: string): Promise<WorkSettings> {
  const [row] = await tx.select().from(tenantSettings).where(eq(tenantSettings.orgId, orgId));
  if (!row) return DEFAULT_SETTINGS;
  return {
    timezone: row.timezone,
    workDays: [...row.workDays].sort((a, b) => a - b),
    workStart: hhmm(row.workStart),
    workEnd: hhmm(row.workEnd),
    autoCloseTime: hhmm(row.autoCloseTime),
    requireNote: row.requireNote,
    checkinEnabled: row.enabledModules.includes('checkin'),
    crmEnabled: row.enabledModules.includes('crm'),
  };
}

/** A person's timezone, falling back to the workspace's if theirs is not valid. */
export const zoneFor = (userTz: string | null | undefined, settings: WorkSettings) =>
  userTz && isValidTimezone(userTz) ? userTz : settings.timezone;

/** Workspaces that exist (the job runs outside any tenant). Ids only. */
export async function listOrgIds(db: Db): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`select id from auth_list_org_ids()`);
  return rows.map((r) => r.id);
}

/**
 * Closes forgotten check-outs for one workspace. A check-in is closed once the auto-close time has
 * passed on its day in the person's own timezone; the checkout is stamped at that time (or at the
 * check-in itself when someone checked in after it). Returns how many were closed.
 */
export async function autoCloseOrg(db: Db, orgId: string, now = new Date()): Promise<number> {
  return withTenant(db, orgId, async (tx) => {
    const settings = await loadSettings(tx, orgId);
    const open = await tx
      .select({
        id: workDays.id,
        userId: workDays.userId,
        date: workDays.date,
        checkinAt: workDays.checkinAt,
        timezone: users.timezone,
      })
      .from(workDays)
      .innerJoin(users, eq(users.id, workDays.userId))
      .where(
        and(eq(workDays.orgId, orgId), isNotNull(workDays.checkinAt), isNull(workDays.checkoutAt)),
      );

    let closed = 0;
    for (const row of open) {
      const closeAt = zonedTimeToUtc(
        row.date,
        settings.autoCloseTime,
        zoneFor(row.timezone, settings),
      );
      if (now < closeAt) continue;
      const stamp = row.checkinAt! > closeAt ? row.checkinAt! : closeAt;
      const updated = await tx
        .update(workDays)
        .set({ checkoutAt: stamp, autoClosed: true, source: 'auto', updatedAt: now })
        // Guard against a person checking out at the same moment.
        .where(and(eq(workDays.id, row.id), eq(workDays.orgId, orgId), isNull(workDays.checkoutAt)))
        .returning({ id: workDays.id });
      if (updated.length) {
        closed++;
        await writeAudit(tx, {
          orgId,
          actorId: null,
          action: 'workday.auto_closed',
          targetType: 'work_day',
          targetId: row.id,
          after: { userId: row.userId, date: row.date, checkoutAt: stamp.toISOString() },
        });
      }
    }
    return closed;
  });
}
