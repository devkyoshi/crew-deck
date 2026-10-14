import { sql } from 'drizzle-orm';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { createDb } from './client.js';

/**
 * Creates or updates a platform admin (the people who run the whole product, not one workspace).
 * Usage: PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD=... pnpm db:platform-admin
 * Runs on the admin connection. The password is read from the environment and never printed.
 */
const url = process.env.DATABASE_ADMIN_URL;
const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!url) throw new Error('DATABASE_ADMIN_URL is required');
if (!email || !password)
  throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required');
if (password.length < MIN_PASSWORD_LENGTH) {
  throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`);
}
const { db, close } = createDb(url);
try {
  const passwordHash = await hashPassword(password);
  await db.execute(
    sql`insert into platform_admins (email, name, password_hash) values (${email}, ${process.env.PLATFORM_ADMIN_NAME ?? null}, ${passwordHash})
        on conflict (email) do update set password_hash = excluded.password_hash`,
  );
  console.log(`platform admin ready: ${email}`);
} finally {
  await close();
}
