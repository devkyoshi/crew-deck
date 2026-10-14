import { writeAudit } from '../audit/service.js';
import { withTenantTx, type Db, type TenantDb } from '../db/client.js';
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

/** Times are stored as HH:MM; this keeps old HH:MM:SS values readable. */
export const hhmm = (t: string) => t.slice(0, 5);

/** The workspace's settings, or the defaults when nobody has changed them yet. */
export async function loadSettings(tx: TenantDb, _orgId?: string): Promise<WorkSettings> {
  const row = await tx.tenantSettings.findOne({});
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
  const rows = await db.global.organizations.find({}, { projection: { id: 1 } });
  return rows.map((r) => r.id);
}

/**
 * Closes forgotten check-outs for one workspace. A check-in is closed once the auto-close time has
 * passed on its day in the person's own timezone; the checkout is stamped at that time (or at the
 * check-in itself when someone checked in after it). Returns how many were closed.
 */
export async function autoCloseOrg(db: Db, orgId: string, now = new Date()): Promise<number> {
  return withTenantTx(db, orgId, async (tx) => {
    const settings = await loadSettings(tx, orgId);
    const open = await tx.workDays.find({ checkinAt: { $ne: null }, checkoutAt: null });
    const people = await tx.users(open.map((o) => o.userId));

    let closed = 0;
    for (const row of open) {
      const person = people.get(row.userId);
      if (!person) continue;
      const closeAt = zonedTimeToUtc(
        row.date,
        settings.autoCloseTime,
        zoneFor(person.timezone, settings),
      );
      if (now < closeAt) continue;
      const stamp = row.checkinAt! > closeAt ? row.checkinAt! : closeAt;
      const updated = await tx.workDays.updateOne(
        // Guard against a person checking out at the same moment.
        { id: row.id, checkoutAt: null },
        { checkoutAt: stamp, autoClosed: true, source: 'auto', updatedAt: now },
      );
      if (updated) {
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
