import { writeAudit } from '../audit/service.js';
import { withTenant, type Db } from '../db/client.js';

/**
 * Moves workspaces whose trial has ended to the Free plan and records it in each workspace's log.
 * Safe to run on every instance: the update only matches a workspace still on trial, so each one is
 * moved (and audited) exactly once. (Limits already treat an ended trial as Free, so this just makes
 * the stored plan match.)
 */
export async function expireTrials(db: Db): Promise<string[]> {
  const candidates = await db.global.organizations.find(
    { onTrial: true, trialEndsAt: { $ne: null, $lte: new Date() } },
    { projection: { id: 1 } },
  );
  const moved: string[] = [];
  for (const { id } of candidates) {
    const changed = await db.global.organizations.updateOne(
      { id, onTrial: true },
      { planKey: 'free', onTrial: false },
    );
    if (changed === 0) continue;
    moved.push(id);
    await withTenant(db, id, (t) =>
      writeAudit(t, {
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
  return moved;
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
