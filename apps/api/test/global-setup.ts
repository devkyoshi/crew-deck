import { MongoClient } from 'mongodb';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

/**
 * Recreates the test databases from scratch: indexes, plans, then the dev workspaces and logins. With
 * several workers there is one copy per worker (`<db>_w1`, `<db>_w2`, ...), seeded side by side.
 */
export default async function setup() {
  const uri = process.env.MONGODB_URI;
  const base = process.env.MONGODB_DB;
  if (!uri || !base) throw new Error('MONGODB_URI and MONGODB_DB are required for tests');
  if (!base.endsWith('_test')) throw new Error(`Refusing to reset a non-test database: ${base}`);

  const copies = Number(process.env.TEST_WORKERS ?? 1);
  const names = copies > 1 ? Array.from({ length: copies }, (_, i) => `${base}_w${i + 1}`) : [base];

  // Start every run from empty databases so results never depend on earlier runs.
  const client = new MongoClient(uri);
  try {
    for (const name of [base, ...names]) await client.db(name).dropDatabase();
  } finally {
    await client.close();
  }
  await Promise.all(
    names.map(async (name) => {
      await migrate(uri, name);
      await seed(uri, name);
    }),
  );
}
