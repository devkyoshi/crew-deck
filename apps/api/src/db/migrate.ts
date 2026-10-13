import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Versioned, reversible SQL migrations: NNNN_name.up.sql / NNNN_name.down.sql. */
export async function migrate(url: string, direction: 'up' | 'down', steps = 1) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set(
      (await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string),
    );
    const all = readdirSync(dir)
      .filter((f) => f.endsWith('.up.sql'))
      .map((f) => f.replace('.up.sql', ''))
      .sort();

    if (direction === 'up') {
      for (const name of all.filter((n) => !applied.has(n))) {
        await sql.begin(async (tx) => {
          await tx.unsafe(readFileSync(join(dir, `${name}.up.sql`), 'utf8'));
          await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
        });
        console.log(`applied ${name}`);
      }
    } else {
      const toRevert = all
        .filter((n) => applied.has(n))
        .reverse()
        .slice(0, steps);
      for (const name of toRevert) {
        await sql.begin(async (tx) => {
          await tx.unsafe(readFileSync(join(dir, `${name}.down.sql`), 'utf8'));
          await tx`DELETE FROM schema_migrations WHERE name = ${name}`;
        });
        console.log(`reverted ${name}`);
      }
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  await migrate(url, direction);
}
