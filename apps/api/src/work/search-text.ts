import type { Db as MongoDb } from 'mongodb';
import type { TenantDb } from '../db/client.js';
import { docToText } from './doc.js';

/**
 * Descriptions are stored as rich text JSON, which a text index cannot read. Each item keeps a plain
 * `searchText` (its description as text) next to the title; both feed the `search` text index.
 */
const SEARCH_TEXT_MAX = 8000;
export const searchTextOf = (description: unknown) => docToText(description).slice(0, SEARCH_TEXT_MAX);

/**
 * Rebuilds an item's `searchText` from its description, its live comments and its attachment names,
 * so a search finds the item by what was said or attached. Call after any of those change.
 */
export async function refreshSearchText(t: TenantDb, itemId: string) {
  const item = await t.workItems.findOne({ id: itemId }, { projection: { description: 1 } });
  if (!item) return;
  const [comments, files] = await Promise.all([
    t.comments.find({ itemId, deletedAt: null }, { sort: { createdAt: 1 }, projection: { body: 1 } }),
    t.attachments.find({ itemId }, { projection: { name: 1 } }),
  ]);
  const parts = [docToText(item.description), ...comments.map((c) => docToText(c.body)), ...files.map((f) => f.name)];
  await t.workItems.updateOne(
    { id: itemId },
    { searchText: parts.filter(Boolean).join('\n').slice(0, SEARCH_TEXT_MAX), searchVersion: SEARCH_TEXT_VERSION },
  );
}

/** Bump when `searchText` gains new sources, so `backfillSearchText` rebuilds older items once. */
export const SEARCH_TEXT_VERSION = 2;

/** Fills or rebuilds `searchText` on items written before it existed or before it took comments (runs with `ensureIndexes`). */
export async function backfillSearchText(handle: MongoDb) {
  const coll = handle.collection('work_items');
  const cursor = coll.find({ searchVersion: { $ne: SEARCH_TEXT_VERSION } }, { projection: { _id: 1, id: 1, description: 1 } });
  for await (const doc of cursor) {
    const [comments, files] = await Promise.all([
      handle.collection('comments').find({ itemId: doc.id, deletedAt: null }, { projection: { body: 1 } }).sort({ createdAt: 1 }).toArray(),
      handle.collection('attachments').find({ itemId: doc.id }, { projection: { name: 1 } }).toArray(),
    ]);
    const parts = [docToText(doc.description), ...comments.map((c) => docToText(c.body)), ...files.map((f) => String(f.name ?? ''))];
    await coll.updateOne(
      { _id: doc._id },
      { $set: { searchText: parts.filter(Boolean).join('\n').slice(0, SEARCH_TEXT_MAX), searchVersion: SEARCH_TEXT_VERSION } },
    );
  }
}
