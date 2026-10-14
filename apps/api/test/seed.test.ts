import { beforeAll, describe, expect, it } from 'vitest';
import { DEV_PASSWORD, DEV_WORKSPACES, MULTI_USER, seed } from '../src/db/seed.js';
import { adminDb, caller, makeApp, sessionCookie, tenantIds } from './helpers.js';

const t = makeApp();
const call = caller(t.app);

// Other suites reset some seeded users' passwords for their own purposes; seeding again restores them
// (the seed is idempotent), so this suite checks the fixtures as a fresh database would have them.
beforeAll(async () => {
  await seed(process.env.MONGODB_URI!, process.env.MONGODB_DB!);
});

describe('seed data', () => {
  it('gives each demo tenant its seeded owner', async () => {
    const ids = await tenantIds();
    const admin = adminDb();
    try {
      for (const [orgId, email] of [
        [ids.acme, 'owner@acme.test'],
        [ids.globex, 'owner@globex.test'],
      ] as const) {
        const members = await admin.db.tenant(orgId).memberships.find({});
        const people = await admin.db.tenant(orgId).users(members.map((m) => m.userId));
        const owner = members.find((m) => people.get(m.userId)?.email === email);
        expect(owner?.orgRole).toBe('owner');
      }
    } finally {
      await admin.close();
    }
  });

  it('seeds workspaces of several kinds with their template settings', async () => {
    const admin = adminDb();
    try {
      const orgs = await admin.db.global.organizations.find({});
      const by = Object.fromEntries(orgs.map((o) => [o.slug, o]));
      expect(by.acme?.workType).toBe('software');
      expect(by.globex?.workType).toBe('sales');
      expect(by.buildwell?.workType).toBe('construction');
      expect(by.brightly?.workType).toBe('marketing');
      expect(by.suspended?.status).toBe('suspended');
      const buildwell = await admin.db.tenant(by.buildwell!.id).tenantSettings.findOne({});
      expect(buildwell?.enabledModules).toEqual(expect.arrayContaining(['members', 'spaces', 'checkin']));
      const globex = await admin.db.tenant(by.globex!.id).tenantSettings.findOne({});
      expect(globex?.enabledModules).toContain('crm');
    } finally {
      await admin.close();
    }
  });

  it('lets every dev login sign in with the dev password, with the role it is named after', async () => {
    const logins: { slug: string; email: string; role: string; active: boolean }[] = [];
    for (const w of DEV_WORKSPACES) {
      logins.push({ slug: w.slug, email: w.ownerEmail, role: 'owner', active: !w.suspended });
      for (const p of w.people) {
        logins.push({
          slug: w.slug,
          email: `${p.handle}@${w.domain}`,
          role: p.role,
          active: !p.deactivated && !w.suspended,
        });
      }
    }
    for (const l of logins) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { host: `${l.slug}.localhost:3000` },
        payload: { email: l.email, password: DEV_PASSWORD },
      });
      if (!l.active) {
        expect(res.statusCode, `${l.email} should not be able to sign in`).toBeGreaterThanOrEqual(400);
        continue;
      }
      expect(res.statusCode, `${l.email}: ${res.body}`).toBe(200);
      const me = (await call({ method: 'GET', url: '/me', slug: l.slug, cookie: sessionCookie(res) })).json();
      expect(me.orgRole, l.email).toBe(l.role);
    }
  });

  it('puts the multi-workspace user in several workspaces', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host: 'acme.localhost:3000' },
      payload: { email: MULTI_USER.email, password: DEV_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const me = (await call({ method: 'GET', url: '/me', slug: 'acme', cookie: sessionCookie(res) })).json();
    expect(me.orgs.map((o: { slug: string }) => o.slug).sort()).toEqual(
      MULTI_USER.memberships.map((m) => m.slug).sort(),
    );
  });
});
