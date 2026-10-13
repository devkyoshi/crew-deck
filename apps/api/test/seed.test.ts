import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { memberships, users } from '../src/db/schema.js';
import { adminDb, tenantIds } from './helpers.js';

describe('seed data', () => {
  it('gives each demo tenant its seeded owner', async () => {
    const ids = await tenantIds();
    const admin = adminDb();
    try {
      for (const [orgId, email] of [
        [ids.acme, 'owner@acme.test'],
        [ids.globex, 'owner@globex.test'],
      ] as const) {
        const rows = await admin.db
          .select({ email: users.email, role: memberships.orgRole })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.orgId, orgId));
        expect(rows.find((r) => r.email === email)?.role).toBe('owner');
      }
    } finally {
      await admin.close();
    }
  });
});
