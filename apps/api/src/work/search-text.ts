import type { Db as MongoDb } from 'mongodb';
import { docToText } from './doc.js';

/**
 * Descriptions are stored as rich text JSON, which a text index cannot read. Each item keeps a plain
 * `searchText` (its description as text) next to the title; both feed the `search` text index.
 */
export const searchTextOf = (description: unknown) => docToText(description).slice(0, 5000);

/** Fills `searchText` on items written before it existed (runs with `ensureIndexes`). */
export async function backfillSearchText(handle: MongoDb) {
  const coll = handle.collection('work_items');
  const cursor = coll.find({ searchText: { $exists: false } }, { projection: { _id: 1, description: 1 } });
  let batch: { updateOne: { filter: object; update: object } }[] = [];
  for await (const doc of cursor) {
    batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { searchText: searchTextOf(doc.description) } } } });
    if (batch.length >= 500) {
      await coll.bulkWrite(batch);
      batch = [];
    }
  }
  if (batch.length) await coll.bulkWrite(batch);
}
