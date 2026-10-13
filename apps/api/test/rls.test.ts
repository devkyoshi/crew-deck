import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { withTenant } from '../src/db/client.js';
import { memberships, organizations, users } from '../src/db/schema.js';
import { appDb, tenantIds } from './helpers.js';

const app = appDb();
let ids: Awaited<ReturnType<typeof tenantIds>>;

beforeAll(async () => {
  ids = await tenantIds();
});
afterAll(() => app.close());

describe('row-level security (direct database)', () => {
  it('connects as a role that cannot bypass RLS', async () => {
    const rows = await app.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('returns nothing when no tenant context is set', async () => {
    expect(await app.db.select().from(organizations)).toHaveLength(0);
    expect(await app.db.select().from(memberships)).toHaveLength(0);
    expect(await app.db.select().from(users)).toHaveLength(0);
  });

  it('shows tenant A only its own rows', async () => {
    await withTenant(app.db, ids.acme, async (tx) => {
      const orgs = await tx.select().from(organizations);
      const members = await tx.select().from(memberships);
      const people = await tx.select().from(users);
      expect(orgs.map((o) => o.slug)).toEqual(['acme']);
      expect(members.every((m) => m.orgId === ids.acme)).toBe(true);
      expect(people.map((u) => u.email)).toEqual(['owner@acme.test']);
    });
  });

  it('blocks tenant A from reading tenant B rows even with an explicit filter', async () => {
    await withTenant(app.db, ids.acme, async (tx) => {
      expect(
        await tx.select().from(memberships).where(eq(memberships.orgId, ids.globex)),
      ).toHaveLength(0);
      expect(
        await tx.select().from(organizations).where(eq(organizations.id, ids.globex)),
      ).toHaveLength(0);
    });
  });

  it('blocks tenant A from updating or deleting tenant B rows', async () => {
    await withTenant(app.db, ids.acme, async (tx) => {
      const upd = await tx
        .update(organizations)
        .set({ name: 'hacked' })
        .where(eq(organizations.id, ids.globex))
        .returning();
      const del = await tx.delete(memberships).where(eq(memberships.orgId, ids.globex)).returning();
      expect(upd).toHaveLength(0);
      expect(del).toHaveLength(0);
    });
    await withTenant(app.db, ids.globex, async (tx) => {
      const [org] = await tx.select().from(organizations);
      expect(org!.name).toBe('Globex Corp');
      expect(await tx.select().from(memberships)).toHaveLength(1);
    });
  });

  it('rejects inserting a row for another tenant', async () => {
    const [globexOwner] = await withTenant(app.db, ids.globex, (tx) =>
      tx.select().from(memberships),
    );
    await expect(
      withTenant(app.db, ids.acme, (tx) =>
        tx
          .insert(memberships)
          .values({ orgId: ids.globex, userId: globexOwner!.userId, orgRole: 'admin' }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a malformed tenant id', async () => {
    await expect(withTenant(app.db, 'not-a-uuid; drop table users', async () => 1)).rejects.toThrow(
      /invalid org id/,
    );
  });
});
