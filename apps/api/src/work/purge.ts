import type { TenantDb } from '../db/client.js';
import type { StorageDriver } from '../storage/index.js';

/**
 * Deleted items give their files back. The attachment records go inside the transaction (so the
 * workspace's storage count drops with the delete); the bytes follow once it has committed.
 */
export async function dropAttachments(t: TenantDb, itemIds: string[]): Promise<string[]> {
  if (!itemIds.length) return [];
  const rows = await t.attachments.find({ itemId: { $in: itemIds } }, { projection: { id: 1, storageKey: 1 } });
  if (!rows.length) return [];
  await t.attachments.deleteMany({ id: { $in: rows.map((r) => r.id) } });
  return rows.map((r) => r.storageKey);
}

/** Removes the bytes of dropped attachments. A failure is logged, not raised: the records are already gone. */
export async function deleteStoredFiles(
  storage: StorageDriver | undefined,
  keys: string[],
  log: { warn: (o: object, m: string) => void },
) {
  if (!storage) return;
  for (const key of keys) {
    await storage.delete(key).catch((err: unknown) => log.warn({ err, key }, 'could not remove a stored file'));
  }
}
