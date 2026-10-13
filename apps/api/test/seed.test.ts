import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { memberships } from '../src/db/schema.js';
import { adminDb, tenantIds } from './helpers.js';

describe('seed data', () => {
  it('gives each demo tenant exactly one owner', async () => {
    const ids = await tenantIds();
    const admin = adminDb();
    try {
      for (const orgId of [ids.acme, ids.globex]) {
        const rows = await admin.db.select().from(memberships).where(eq(memberships.orgId, orgId));
        expect(rows.filter((r) => r.orgRole === 'owner')).toHaveLength(1);
      }
    } finally {
      await admin.close();
    }
  });
});
