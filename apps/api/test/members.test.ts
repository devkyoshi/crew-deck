import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminDb,
  createOrg,
  caller,
  ensureUser,
  hostFor,
  makeApp,
  signInAs,
  tenantIds,
  uniqueEmail,
  PASSWORD,
} from './helpers.js';

const t = makeApp();
const call = caller(t.app);
let ids: Awaited<ReturnType<typeof tenantIds>>;

type U = Awaited<ReturnType<typeof ensureUser>>;
let owner: U, admin: U, member: U, globexOwner: U;
let ownerC: string, adminC: string, memberC: string, globexC: string;

async function auditFor(orgId: string, action: string, targetId: string) {
  const a = adminDb();
  try {
    return await a.db.global.all.auditLogs.find({ orgId, action, targetId });
  } finally {
    await a.close();
  }
}

beforeAll(async () => {
  ids = await tenantIds();
  // Dedicated actors so mutations in these tests cannot disturb the shared seed users.
  owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('own'), role: 'owner' });
  admin = await ensureUser({ orgId: ids.acme, email: uniqueEmail('adm'), role: 'admin' });
  member = await ensureUser({ orgId: ids.acme, email: uniqueEmail('mem'), role: 'member' });
  globexOwner = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('gown', 'globex.test'),
    role: 'owner',
  });
  ownerC = await signInAs(t.app, 'acme', owner);
  adminC = await signInAs(t.app, 'acme', admin);
  memberC = await signInAs(t.app, 'acme', member);
  globexC = await signInAs(t.app, 'globex', globexOwner);
  await t.app.ready();
});
afterAll(() => t.close());

describe('GET /members', () => {
  it('requires a session', async () => {
    expect((await call({ method: 'GET', url: '/members', slug: 'acme' })).statusCode).toBe(401);
  });

  it('lists members with search, role filter, sorting and pagination', async () => {
    const all = (
      await call({ method: 'GET', url: '/members?pageSize=100', slug: 'acme', cookie: adminC })
    ).json();
    expect(all.total).toBeGreaterThanOrEqual(4);
    expect(all.items[0]).toMatchObject({ email: expect.any(String), orgRole: expect.any(String) });

    const byEmail = (
      await call({ method: 'GET', url: `/members?q=${member.email}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(byEmail.items.map((i: { email: string }) => i.email)).toEqual([member.email]);

    const owners = (
      await call({
        method: 'GET',
        url: '/members?role=owner&pageSize=100',
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(owners.items.every((i: { orgRole: string }) => i.orgRole === 'owner')).toBe(true);

    const page1 = (
      await call({
        method: 'GET',
        url: '/members?pageSize=2&page=1&sort=email',
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    const page2 = (
      await call({
        method: 'GET',
        url: '/members?pageSize=2&page=2&sort=email',
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
    expect(page1.total).toBe(page2.total);

    const desc = (
      await call({
        method: 'GET',
        url: '/members?sort=email&dir=desc&pageSize=100',
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    const emails = desc.items.map((i: { email: string }) => i.email.toLowerCase());
    expect(emails).toEqual([...emails].sort().reverse());
  });

  it('treats LIKE wildcards in search literally', async () => {
    const res = (
      await call({ method: 'GET', url: '/members?q=%25', slug: 'acme', cookie: adminC })
    ).json();
    expect(res.total).toBe(0);
  });

  it('shows ordinary members only active people and hides last-login times', async () => {
    const res = (
      await call({ method: 'GET', url: '/members?pageSize=100', slug: 'acme', cookie: memberC })
    ).json();
    expect(res.items.every((i: { status: string }) => i.status === 'active')).toBe(true);
    expect(res.items.every((i: { lastLoginAt: unknown }) => i.lastLoginAt === null)).toBe(true);
  });

  it('only returns the current tenant', async () => {
    const res = (
      await call({ method: 'GET', url: '/members?pageSize=100', slug: 'globex', cookie: globexC })
    ).json();
    const ids2 = res.items.map((i: { id: string }) => i.id);
    expect(ids2).not.toContain(member.id);
    expect(ids2).not.toContain(admin.id);
    expect(ids2).not.toContain(owner.id);
    expect(res.items.some((i: { email: string }) => i.email === globexOwner.email)).toBe(true);
  });

  it('validates query parameters', async () => {
    const res = await call({
      method: 'GET',
      url: '/members?pageSize=1000',
      slug: 'acme',
      cookie: adminC,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_error');
  });
});

describe('GET /members/:id', () => {
  it('returns a member, and 404 across tenants', async () => {
    const ok = await call({
      method: 'GET',
      url: `/members/${member.id}`,
      slug: 'acme',
      cookie: memberC,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ email: member.email, orgRole: 'member' });
    // Tenant B asking for tenant A's member.
    const cross = await call({
      method: 'GET',
      url: `/members/${member.id}`,
      slug: 'globex',
      cookie: globexC,
    });
    expect(cross.statusCode).toBe(404);
  });
});

describe('PATCH /members/:id', () => {
  it('lets an admin change a member role, and writes an audit entry', async () => {
    const target = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('role'),
      role: 'member',
    });
    const res = await call({
      method: 'PATCH',
      url: `/members/${target.id}`,
      slug: 'acme',
      cookie: adminC,
      payload: { orgRole: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgRole).toBe('admin');
    const rows = await auditFor(ids.acme, 'member.role_changed', target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: admin.id,
      before: { orgRole: 'member' },
      after: { orgRole: 'admin' },
    });
  });

  it('denies members changing roles, including their own', async () => {
    const own = await call({
      method: 'PATCH',
      url: `/members/${member.id}`,
      slug: 'acme',
      cookie: memberC,
      payload: { orgRole: 'admin' },
    });
    expect(own.statusCode).toBe(403);
    const other = await call({
      method: 'PATCH',
      url: `/members/${admin.id}`,
      slug: 'acme',
      cookie: memberC,
      payload: { orgRole: 'member' },
    });
    expect(other.statusCode).toBe(403);
  });

  it('denies admins touching owners or creating owners; allows owners', async () => {
    const target = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('prom'),
      role: 'member',
    });
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/members/${owner.id}`,
          slug: 'acme',
          cookie: adminC,
          payload: { orgRole: 'member' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/members/${target.id}`,
          slug: 'acme',
          cookie: adminC,
          payload: { orgRole: 'owner' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/members/${owner.id}`,
          slug: 'acme',
          cookie: adminC,
          payload: { name: 'Hacked' },
        })
      ).statusCode,
    ).toBe(403);
    const ok = await call({
      method: 'PATCH',
      url: `/members/${target.id}`,
      slug: 'acme',
      cookie: ownerC,
      payload: { orgRole: 'owner' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('edits profile fields: admins for others, anyone for themselves', async () => {
    const adminEdit = await call({
      method: 'PATCH',
      url: `/members/${member.id}`,
      slug: 'acme',
      cookie: adminC,
      payload: { jobTitle: 'QA Lead', name: 'Mia M' },
    });
    expect(adminEdit.statusCode).toBe(200);
    expect(adminEdit.json()).toMatchObject({ jobTitle: 'QA Lead', name: 'Mia M' });
    const self = await call({
      method: 'PATCH',
      url: `/members/${member.id}`,
      slug: 'acme',
      cookie: memberC,
      payload: { jobTitle: 'Tester' },
    });
    expect(self.statusCode).toBe(200);
    const other = await call({
      method: 'PATCH',
      url: `/members/${admin.id}`,
      slug: 'acme',
      cookie: memberC,
      payload: { jobTitle: 'Nope' },
    });
    expect(other.statusCode).toBe(403);
  });

  it('rejects empty bodies, unknown fields and bad timezones', async () => {
    const url = `/members/${member.id}`;
    expect(
      (await call({ method: 'PATCH', url, slug: 'acme', cookie: adminC, payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'PATCH',
          url,
          slug: 'acme',
          cookie: adminC,
          payload: { email: 'x@y.z' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'PATCH',
          url,
          slug: 'acme',
          cookie: adminC,
          payload: { timezone: 'Mars/Base' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('protects the last owner of a workspace', async () => {
    const solo = await createOrg('solo');
    const soloC = await signInAs(t.app, solo.slug, solo.owner);
    // The only owner cannot demote themselves...
    const demote = await call({
      method: 'PATCH',
      url: `/members/${solo.owner.id}`,
      slug: solo.slug,
      cookie: soloC,
      payload: { orgRole: 'admin' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().code).toBe('last_owner');
    // ...but once a second owner exists, they can.
    const second = await ensureUser({
      orgId: solo.org.id,
      email: `two@${solo.slug}.test`,
      role: 'member',
    });
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/members/${second.id}`,
          slug: solo.slug,
          cookie: soloC,
          payload: { orgRole: 'owner' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/members/${solo.owner.id}`,
          slug: solo.slug,
          cookie: soloC,
          payload: { orgRole: 'admin' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('cannot reach members of another tenant', async () => {
    const res = await call({
      method: 'PATCH',
      url: `/members/${member.id}`,
      slug: 'globex',
      cookie: globexC,
      payload: { orgRole: 'admin' },
    });
    expect(res.statusCode).toBe(404);
    const check = await call({
      method: 'GET',
      url: `/members/${member.id}`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(check.json().orgRole).toBe('member');
  });
});

describe('deactivate and reactivate', () => {
  it('lets an admin deactivate a member, blocks their login and session, then reactivates', async () => {
    const target = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('leave'),
      role: 'member',
    });
    const targetC = await signInAs(t.app, 'acme', target);
    expect(
      (await call({ method: 'GET', url: '/me', slug: 'acme', cookie: targetC })).statusCode,
    ).toBe(200);

    const res = await call({
      method: 'POST',
      url: `/members/${target.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('deactivated');

    // Existing session dies immediately; new logins are refused.
    expect(
      (await call({ method: 'GET', url: '/me', slug: 'acme', cookie: targetC })).statusCode,
    ).toBe(401);
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host: hostFor('acme') },
      payload: { email: target.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().code).toBe('account_inactive');

    expect(await auditFor(ids.acme, 'member.deactivated', target.id)).toHaveLength(1);

    const back = await call({
      method: 'POST',
      url: `/members/${target.id}/reactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(back.json().status).toBe('active');
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { host: hostFor('acme') },
          payload: { email: target.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
    expect(await auditFor(ids.acme, 'member.reactivated', target.id)).toHaveLength(1);
  });

  it('is scoped to one workspace: the person can still sign in elsewhere', async () => {
    const email = uniqueEmail('both');
    const a = await ensureUser({ orgId: ids.acme, email, role: 'member' });
    await ensureUser({ orgId: ids.globex, email, role: 'member' });
    await call({
      method: 'POST',
      url: `/members/${a.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    const acme = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host: hostFor('acme') },
      payload: { email, password: PASSWORD },
    });
    const globex = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host: hostFor('globex') },
      payload: { email, password: PASSWORD },
    });
    expect(acme.statusCode).toBe(403);
    expect(globex.statusCode).toBe(200);
  });

  it('denies members, and denies deactivating yourself', async () => {
    expect(
      (
        await call({
          method: 'POST',
          url: `/members/${admin.id}/deactivate`,
          slug: 'acme',
          cookie: memberC,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          url: `/members/${member.id}/reactivate`,
          slug: 'acme',
          cookie: memberC,
        })
      ).statusCode,
    ).toBe(403);
    const self = await call({
      method: 'POST',
      url: `/members/${admin.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(self.statusCode).toBe(400);
    expect(self.json().code).toBe('cannot_deactivate_self');
  });

  it('denies admins deactivating owners, and lets an owner deactivate another owner', async () => {
    expect(
      (
        await call({
          method: 'POST',
          url: `/members/${owner.id}/deactivate`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(403);
    const seeded = await ensureUser({
      orgId: ids.globex,
      email: 'owner@globex.test',
      role: 'owner',
    });
    const seededC = await signInAs(t.app, 'globex', seeded);
    const off = await call({
      method: 'POST',
      url: `/members/${globexOwner.id}/deactivate`,
      slug: 'globex',
      cookie: seededC,
    });
    expect(off.statusCode).toBe(200);
    const on = await call({
      method: 'POST',
      url: `/members/${globexOwner.id}/reactivate`,
      slug: 'globex',
      cookie: seededC,
    });
    expect(on.json().status).toBe('active');
  });

  it('cannot deactivate a member of another tenant', async () => {
    const res = await call({
      method: 'POST',
      url: `/members/${member.id}/deactivate`,
      slug: 'globex',
      cookie: globexC,
    });
    expect(res.statusCode).toBe(404);
  });
});
