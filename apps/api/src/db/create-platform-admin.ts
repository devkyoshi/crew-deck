import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { createDb } from './client.js';
import { ensureIndexes } from './indexes.js';

/**
 * Creates or updates a platform admin (the people who run the whole product, not one workspace).
 * Usage: PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD=... pnpm db:platform-admin
 * The password is read from the environment and never printed.
 */
const uri = process.env.MONGODB_URI;
const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!uri) throw new Error('MONGODB_URI is required');
if (!email || !password)
  throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required');
if (password.length < MIN_PASSWORD_LENGTH) {
  throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters`);
}
const { db, close } = await createDb(uri, process.env.MONGODB_DB ?? 'crewdeck');
try {
  await ensureIndexes(db.handle);
  const passwordHash = await hashPassword(password);
  const existing = await db.global.platformAdmins.findOne({ email });
  if (existing) {
    await db.global.platformAdmins.updateOne({ id: existing.id }, { passwordHash });
  } else {
    await db.global.platformAdmins.insert({
      email,
      name: process.env.PLATFORM_ADMIN_NAME ?? null,
      passwordHash,
    });
  }
  console.log(`platform admin ready: ${email}`);
} finally {
  await close();
}
