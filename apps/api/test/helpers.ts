import { createDb } from '../src/db/client.js';
import { organizations } from '../src/db/schema.js';

export function appDb() {
  return createDb(process.env.DATABASE_URL!);
}

export function adminDb() {
  return createDb(process.env.DATABASE_ADMIN_URL!);
}

/** Looks up demo tenant ids on the admin connection (bypasses RLS). */
export async function tenantIds() {
  const admin = adminDb();
  try {
    const rows = await admin.db.select().from(organizations);
    const id = (slug: string) => rows.find((r) => r.slug === slug)!.id;
    return { acme: id('acme'), globex: id('globex') };
  } finally {
    await admin.close();
  }
}
