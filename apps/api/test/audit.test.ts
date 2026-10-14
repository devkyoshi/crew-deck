import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail, appDb } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
let ids: Awaited<ReturnType<typeof tenantIds>>;
let adminC: string, memberC: string, globexC: string;
let admin: Awaited<ReturnType<typeof ensureUser>>;

beforeAll(async () => {
  ids = await tenantIds();
  admin = await ensureUser({ orgId: ids.acme, email: uniqueEmail('aadm'), role: 'admin' });
  const member = await ensureUser({ orgId: ids.acme, email: uniqueEmail('amem'), role: 'member' });
  const g = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('ag', 'globex.test'),
    role: 'owner',
  });
  adminC = await signInAs(t.app, 'acme', admin);
  memberC = await signInAs(t.app, 'acme', member);
  globexC = await signInAs(t.app, 'globex', g);
  await t.app.ready();
});
afterAll(() => t.close());

describe('GET /audit-logs', () => {
  it('is admin-only', async () => {
    expect(
      (await call({ method: 'GET', url: '/audit-logs', slug: 'acme', cookie: memberC })).statusCode,
    ).toBe(403);
    expect((await call({ method: 'GET', url: '/audit-logs', slug: 'acme' })).statusCode).toBe(401);
  });

  it('returns actions with the actor, newest first, with filters', async () => {
    const target = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('atgt'),
      role: 'member',
    });
    await call({
      method: 'PATCH',
      url: `/members/${target.id}`,
      slug: 'acme',
      cookie: adminC,
      payload: { orgRole: 'admin' },
    });
    const res = (
      await call({
        method: 'GET',
        url: `/audit-logs?target=${target.id}`,
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      action: 'member.role_changed',
      actorId: admin.id,
      actorEmail: admin.email,
      targetType: 'member',
    });

    const byActor = (
      await call({
        method: 'GET',
        url: `/audit-logs?actor=${admin.id}&action=member.role_changed`,
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(byActor.items.every((i: { actorId: string }) => i.actorId === admin.id)).toBe(true);

    const future = (
      await call({
        method: 'GET',
        url: '/audit-logs?from=2999-01-01',
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(future.items).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    const sameDay = (
      await call({
        method: 'GET',
        url: `/audit-logs?from=${today}&to=${today}&target=${target.id}`,
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(sameDay.items).toHaveLength(1);

    const times = (
      await call({ method: 'GET', url: '/audit-logs?pageSize=100', slug: 'acme', cookie: adminC })
    )
      .json()
      .items.map((i: { createdAt: string }) => i.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("never shows another tenant's entries", async () => {
    const mine = (
      await call({ method: 'GET', url: '/audit-logs?pageSize=100', slug: 'acme', cookie: adminC })
    ).json();
    const theirs = (
      await call({
        method: 'GET',
        url: '/audit-logs?pageSize=100',
        slug: 'globex',
        cookie: globexC,
      })
    ).json();
    const mineIds = new Set(mine.items.map((i: { id: string }) => i.id));
    expect(theirs.items.some((i: { id: string }) => mineIds.has(i.id))).toBe(false);
  });
});

describe('audit log protections', () => {
  it('is append-only through the tenant scope', async () => {
    const app = appDb();
    try {
      const tenant = app.db.tenant(ids.acme);
      await expect(tenant.auditLogs.updateMany({}, { action: 'tampered' })).rejects.toThrow();
      await expect(tenant.auditLogs.deleteMany({})).rejects.toThrow();
    } finally {
      await app.close();
    }
  });

  it('is hidden across tenants, even with an explicit filter', async () => {
    const app = appDb();
    try {
      const rows = await app.db.tenant(ids.globex).auditLogs.find({ orgId: ids.acme });
      expect(rows).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
