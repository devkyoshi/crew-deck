import { fileURLToPath } from 'node:url';
import { hashPassword } from '../auth/password.js';
import { sha256 } from '../lib/crypto.js';
import { createDb } from './client.js';
import { sql } from 'drizzle-orm';
import { invitations, memberships, organizations, users } from './schema.js';

/** Dev-only fixtures. Skipped when NODE_ENV=production. */
export const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password-123';
export const DEV_INVITE_TOKEN = 'dev-invite-acme-token-0001';

export const DEMO_TENANTS = [
  {
    name: 'Acme Inc',
    slug: 'acme',
    domain: 'acme.test',
    ownerEmail: 'owner@acme.test',
    ownerName: 'Alice Acme',
  },
  {
    name: 'Globex Corp',
    slug: 'globex',
    domain: 'globex.test',
    ownerEmail: 'owner@globex.test',
    ownerName: 'Gary Globex',
  },
];

const DEV_PEOPLE: { handle: string; name: string; title: string; role: 'admin' | 'member' }[] = [
  { handle: 'admin', name: 'Ada Admin', title: 'Operations', role: 'admin' },
  { handle: 'member', name: 'Mia Member', title: 'Engineer', role: 'member' },
  { handle: 'member2', name: 'Max Member', title: 'Designer', role: 'member' },
];

/** Idempotent. Must run on the admin (owner) connection, since it writes across tenants. */
export async function seed(adminUrl: string) {
  const { db, close } = createDb(adminUrl);
  const dev = process.env.NODE_ENV !== 'production';
  const passwordHash = dev ? await hashPassword(DEV_PASSWORD) : null;
  try {
    for (const t of DEMO_TENANTS) {
      const [org] = await db
        .insert(organizations)
        .values({ name: t.name, slug: t.slug, domain: t.domain })
        .onConflictDoUpdate({ target: organizations.slug, set: { name: t.name } })
        .returning();
      const [user] = await db
        .insert(users)
        .values({ email: t.ownerEmail, name: t.ownerName, status: 'active', passwordHash })
        .onConflictDoUpdate({
          target: users.email,
          set: { name: t.ownerName, ...(passwordHash ? { passwordHash } : {}) },
        })
        .returning();
      await db
        .insert(memberships)
        .values({ orgId: org!.id, userId: user!.id, orgRole: 'owner' })
        .onConflictDoNothing();
      // A few extra people so the demo workspace is not empty (development only).
      if (dev) {
        for (const p of DEV_PEOPLE) {
          const email = `${p.handle}@${t.domain}`;
          const [person] = await db
            .insert(users)
            .values({ email, name: p.name, jobTitle: p.title, status: 'active', passwordHash })
            .onConflictDoUpdate({ target: users.email, set: { name: p.name, passwordHash } })
            .returning();
          await db
            .insert(memberships)
            .values({ orgId: org!.id, userId: person!.id, orgRole: p.role })
            .onConflictDoNothing();
        }
      }
      if (dev && t.slug === 'acme') {
        await db
          .insert(invitations)
          .values({
            orgId: org!.id,
            email: 'newbie@acme.test',
            orgRole: 'member',
            tokenHash: sha256(DEV_INVITE_TOKEN),
            expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            invitedBy: user!.id,
          })
          .onConflictDoNothing();
      }
      console.log(`seeded ${t.slug}`);
    }
    // A platform admin for the console at /platform (development only; production uses create-platform-admin).
    if (dev) {
      await db.execute(
        sql`insert into platform_admins (email, name, password_hash) values ('platform@crewdeck.test', 'Platform Admin', ${passwordHash}) on conflict (email) do update set password_hash = excluded.password_hash`,
      );
      // The demo workspace shows the Business plan so every feature is visible.
      await db.execute(
        sql`update organizations set plan_key = 'business' where slug = 'acme' and plan_key is null`,
      );
      console.log('seeded platform admin');
    }
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  await seed(url);
}
