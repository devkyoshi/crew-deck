import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_COLLECTIONS } from '../src/db/client.js';
import { appDb, tenantIds } from './helpers.js';

/**
 * Tenant isolation without row-level security. MongoDB has no RLS, so isolation is enforced by the
 * repository layer: a TenantDb adds the tenant to every filter and stamps it on every insert.
 */
const conn = appDb();
const db = conn.db;
let ids: Awaited<ReturnType<typeof tenantIds>>;

beforeAll(async () => {
  ids = await tenantIds();
});
afterAll(() => conn.close());

describe('tenant isolation (repositories)', () => {
  it('shows tenant A only its own rows, in every tenant collection', async () => {
    for (const orgId of [ids.acme, ids.globex]) {
      const t = db.tenant(orgId);
      for (const name of TENANT_COLLECTIONS) {
        const rows = (await t[name].find({})) as { orgId: string }[];
        expect(
          rows.every((r) => r.orgId === orgId),
          `${name} leaked a row from another tenant`,
        ).toBe(true);
      }
    }
  });

  it('returns people and workspaces for the current tenant only', async () => {
    const t = db.tenant(ids.acme);
    const org = await t.organization();
    expect(org?.slug).toBe('acme');
    const members = await t.memberships.find({});
    const people = await t.users(members.map((m) => m.userId));
    const emails = [...people.values()].map((u) => u.email);
    expect(emails).toContain('owner@acme.test');
    expect(emails).not.toContain('owner@globex.test');
  });

  it('refuses to resolve a user who is not a member of the workspace', async () => {
    const other = await db.global.users.findOne({ email: 'owner@globex.test' });
    const people = await db.tenant(ids.acme).users([other!.id]);
    expect(people.size).toBe(0);
    expect(await db.tenant(ids.acme).updateUser(other!.id, { name: 'hacked' })).toBe(0);
    expect((await db.global.users.get(other!.id))!.name).not.toBe('hacked');
  });

  it('blocks tenant A from reading tenant B rows even with an explicit filter', async () => {
    const t = db.tenant(ids.acme);
    expect(await t.memberships.find({ orgId: ids.globex })).toHaveLength(0);
    expect(await t.memberships.count({ orgId: ids.globex })).toBe(0);
    expect(await t.spaces.findOne({ orgId: ids.globex })).toBeNull();
  });

  it('blocks tenant A from updating or deleting tenant B rows', async () => {
    const t = db.tenant(ids.acme);
    expect(await t.memberships.updateMany({ orgId: ids.globex }, { orgRole: 'member' })).toBe(0);
    expect(await t.memberships.deleteMany({ orgId: ids.globex })).toBe(0);
    // Guessing another tenant's document id does not work either.
    const theirs = await db.tenant(ids.globex).memberships.findOne({});
    expect(await t.memberships.get(theirs!.id)).toBeNull();
    expect(await t.memberships.deleteOne({ id: theirs!.id })).toBe(0);
    expect(await db.tenant(ids.globex).memberships.get(theirs!.id)).not.toBeNull();
  });

  it('rejects inserting a row for another tenant', async () => {
    const t = db.tenant(ids.acme);
    await expect(t.groups.insert({ orgId: ids.globex, name: 'sneaky' })).rejects.toThrow(
      /different tenant/,
    );
  });

  it('stamps the tenant on every insert', async () => {
    const t = db.tenant(ids.acme);
    const g = await t.groups.insert({ name: `iso-${Date.now()}` });
    expect(g.orgId).toBe(ids.acme);
    await t.groups.deleteOne({ id: g.id });
  });

  it('rejects a malformed tenant id', () => {
    expect(() => db.tenant('not-a-uuid; drop table users')).toThrow(/invalid org id/);
  });

  it('only lets a tenant change its own branding, never its plan or status', async () => {
    const t = db.tenant(ids.acme);
    const before = (await t.organization())!;
    // status and planKey are not branding fields, so they are dropped.
    await t.updateBranding({ name: before.name, status: 'suspended', planKey: 'free' } as never);
    const after = (await t.organization())!;
    expect(after.status).toBe('active');
    expect(after.planKey).toBe(before.planKey);
  });

  it('is append-only for the audit log and work-day corrections', async () => {
    const t = db.tenant(ids.acme);
    await expect(t.auditLogs.updateMany({}, { action: 'tampered' })).rejects.toThrow(/append-only/);
    await expect(t.auditLogs.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(t.workDayEdits.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('only the explicit global scope crosses tenants', async () => {
    const all = await db.global.all.memberships.find({});
    const orgs = new Set(all.map((m) => m.orgId));
    expect(orgs.has(ids.acme) && orgs.has(ids.globex)).toBe(true);
    await expect(db.global.all.memberships.deleteMany({})).rejects.toThrow(/unfiltered/);
  });
});
