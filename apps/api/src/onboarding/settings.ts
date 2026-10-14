import type { Db } from '../db/client.js';
import type { PlatformSettingsDoc } from '../db/types.js';

/** The single platform settings document, created with defaults the first time it is read. */
export async function getPlatformSettings(db: Db): Promise<PlatformSettingsDoc> {
  await db.global.platformSettings.upsert(
    { id: 'singleton' },
    {},
    { blockFreeEmailDomains: false, signupsEnabled: true, trialDays: 14, updatedAt: new Date() },
  );
  return (await db.global.platformSettings.findOne({ id: 'singleton' }))!;
}
