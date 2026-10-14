import { pathToFileURL } from 'node:url';
import { createDb } from './client.js';
import { ensureIndexes } from './indexes.js';
import { ensurePlans } from './reference.js';

/** MongoDB has no schema migrations: this creates the collections' indexes (idempotent). */
export async function migrate(uri: string, dbName: string) {
  const { db, close } = await createDb(uri, dbName);
  try {
    await ensureIndexes(db.handle);
    await ensurePlans(db);
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await migrate(uri, process.env.MONGODB_DB ?? 'crewdeck');
  console.log('indexes and plans ensured');
}
