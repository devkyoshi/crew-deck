import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction scoped to one tenant. Sets `app.current_org` (transaction-local)
 * so Postgres RLS policies filter on it. Every tenant-data access must go through this.
 * Repositories should still filter by org_id explicitly (defence in depth).
 */
export async function withTenant<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(orgId)) throw new Error('withTenant: invalid org id');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
    return fn(tx);
  });
}
