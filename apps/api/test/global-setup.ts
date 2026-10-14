import { MongoClient } from 'mongodb';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

/** Recreates the test database from scratch: indexes, plans, then the dev workspaces and logins. */
export default async function setup() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri || !dbName) throw new Error('MONGODB_URI and MONGODB_DB are required for tests');
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset a non-test database: ${dbName}`);

  // Start every run from an empty database so results never depend on earlier runs.
  const client = new MongoClient(uri);
  try {
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
  }
  await migrate(uri, dbName);
  await seed(uri, dbName);
}
