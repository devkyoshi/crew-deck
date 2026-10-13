import postgres from 'postgres';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

/** Recreates the test database and mirrors the role privileges the init script gives the dev one. */
async function ensureTestDatabase(adminUrl: string) {
  const target = new URL(adminUrl);
  const dbName = target.pathname.slice(1);
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';

  const root = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    // Start every run from an empty database so results never depend on earlier runs.
    await root.unsafe(`drop database if exists "${dbName}" with (force)`);
    await root.unsafe(`create database "${dbName}"`);
  } finally {
    await root.end();
  }

  const appRole = new URL(process.env.DATABASE_URL!).username;
  const owner = decodeURIComponent(target.username);
  const db = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(`
      GRANT USAGE ON SCHEMA public TO ${appRole};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${appRole};
    `);
  } finally {
    await db.end();
  }
}

export default async function setup() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL and DATABASE_ADMIN_URL are required for tests');
  }
  await ensureTestDatabase(url);
  await migrate(url, 'up');
  await seed(url);
}
