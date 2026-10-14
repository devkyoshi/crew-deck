import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/service.js';
import { withTenant, type Db } from '../db/client.js';

/**
 * Moves workspaces whose trial has ended to the Free plan and records it in each workspace's log.
 * Safe to run on every instance: only rows that actually change are returned, so each is audited once.
 * (Limits already treat an ended trial as Free, so this just makes the stored plan match.)
 */
export async function expireTrials(db: Db): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`select id from platform_expire_trials()`);
  for (const { id } of rows) {
    await withTenant(db, id, (tx) =>
      writeAudit(tx, {
        orgId: id,
        actorId: null,
        action: 'plan.trial_ended',
        targetType: 'settings',
        targetId: id,
        before: { plan: 'business', trial: true },
        after: { plan: 'free', trial: false },
      }),
    );
  }
  return rows.map((r) => r.id);
}

export function startTrialExpiry(db: Db, log: { info(m: string): void; error(m: string): void }) {
  const run = () =>
    expireTrials(db)
      .then((ids) => ids.length && log.info(`trial ended for ${ids.length} workspace(s)`))
      .catch((e: Error) => log.error(`trial expiry failed: ${e.message}`));
  void run();
  const timer = setInterval(run, 60 * 60 * 1000);
  return { close: async () => clearInterval(timer) };
}
