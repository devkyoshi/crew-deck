import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';
import { memberships, organizations, users } from './schema.js';

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

/** Idempotent. Must run on the admin (owner) connection, since it writes across tenants. */
export async function seed(adminUrl: string) {
  const { db, close } = createDb(adminUrl);
  try {
    for (const t of DEMO_TENANTS) {
      const [org] = await db
        .insert(organizations)
        .values({ name: t.name, slug: t.slug, domain: t.domain })
        .onConflictDoUpdate({ target: organizations.slug, set: { name: t.name } })
        .returning();
      const [user] = await db
        .insert(users)
        .values({ email: t.ownerEmail, name: t.ownerName, status: 'active' })
        .onConflictDoUpdate({ target: users.email, set: { name: t.ownerName } })
        .returning();
      await db
        .insert(memberships)
        .values({ orgId: org!.id, userId: user!.id, orgRole: 'owner' })
        .onConflictDoNothing();
      console.log(`seeded ${t.slug}`);
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
