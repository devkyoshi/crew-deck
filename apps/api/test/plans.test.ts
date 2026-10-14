import { afterAll, describe, expect, it } from 'vitest';
import {
  adminDb,
  caller,
  createOrg,
  ensureUser,
  makeApp,
  signInAs,
  uniqueEmail,
} from './helpers.js';
import { expireTrials } from '../src/plans/jobs.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

const j = (res: { body: string }) => JSON.parse(res.body);

type Org = Awaited<ReturnType<typeof workspace>>;

/** A fresh workspace on the given plan (null = internal, no limits). */
async function workspace(
  plan: string | null,
  extra: Partial<{
    onTrial: boolean;
    trialEndsAt: Date;
    overrides: object;
    domainRestricted: boolean;
  }> = {},
) {
  const { org, slug, owner } = await createOrg(`pl${plan ?? 'int'}`);
  const db = adminDb();
  try {
    await db.db.global.organizations.updateOne(
      { id: org.id },
      {
        planKey: plan,
        onTrial: extra.onTrial ?? false,
        trialEndsAt: extra.trialEndsAt ?? null,
        limitOverrides: (extra.overrides ?? {}) as Record<string, number>,
        domainRestricted: extra.domainRestricted ?? true,
      },
    );
  } finally {
    await db.close();
  }
  const cookie = await signInAs(t.app, slug, owner);
  return { org, slug, owner, cookie };
}

const get = (o: Org, url: string) => call({ method: 'GET', url, slug: o.slug, cookie: o.cookie });
const post = (o: Org, url: string, payload: object = {}) =>
  call({ method: 'POST', url, slug: o.slug, cookie: o.cookie, payload });
const put = (o: Org, url: string, payload: object) =>
  call({ method: 'PUT', url, slug: o.slug, cookie: o.cookie, payload });

const invite = (o: Org, n: number, domain = o.org.domain) =>
  post(o, '/invitations', { emails: Array.from({ length: n }, () => uniqueEmail('inv', domain)) });

describe('seats', () => {
  it('Free allows 5 people, counting the owner and invitations that are still waiting', async () => {
    const o = await workspace('free');
    expect((await invite(o, 4)).statusCode).toBe(200); // owner + 4 = 5
    const over = await invite(o, 1);
    expect(over.statusCode).toBe(402);
    expect(j(over)).toMatchObject({ code: 'plan_limit', fields: { limit: 'seats', plan: 'free' } });
    expect(j(over).message).toContain('Free plan allows up to 5 people');
  });

  it('a request that would pass the limit is refused whole, not half-sent', async () => {
    const o = await workspace('free');
    expect((await invite(o, 6)).statusCode).toBe(402);
    expect(j(await get(o, '/invitations')).total).toBe(0);
  });

  it('Team allows 50, Business and internal workspaces have no seat limit', async () => {
    const team = await workspace('team');
    expect((await invite(team, 10)).statusCode).toBe(200);
    const biz = await workspace('business');
    expect((await invite(biz, 12)).statusCode).toBe(200);
    const internal = await workspace(null);
    expect((await invite(internal, 12)).statusCode).toBe(200);
  });

  it('a platform override raises a limit above the plan', async () => {
    const o = await workspace('free', { overrides: { seats: 8 } });
    expect((await invite(o, 7)).statusCode).toBe(200);
    expect((await invite(o, 1)).statusCode).toBe(402);
  });

  it('an override of null lifts the limit', async () => {
    const o = await workspace('free', { overrides: { seats: null } });
    expect((await invite(o, 9)).statusCode).toBe(200);
  });
});

describe('spaces, sites, pipelines and CRM records', () => {
  it('Free allows 3 spaces; deleting one frees a place', async () => {
    const o = await workspace('free');
    const ids: string[] = [];
    for (const key of ['AAA', 'BBB', 'CCC']) {
      const res = await post(o, '/spaces', { key, name: `Space ${key}` });
      expect(res.statusCode).toBe(200);
      ids.push(j(res).id);
    }
    const over = await post(o, '/spaces', { key: 'DDD', name: 'Space DDD' });
    expect(over.statusCode).toBe(402);
    expect(j(over).fields.limit).toBe('spaces');
    await post(o, `/spaces/${ids[0]}/archive`);
    const removed = await call({
      method: 'DELETE',
      url: `/spaces/${ids[0]}?confirm=AAA`,
      slug: o.slug,
      cookie: o.cookie,
    });
    expect(removed.statusCode, removed.body).toBeLessThan(300);
    expect((await post(o, '/spaces', { key: 'EEE', name: 'Space EEE' })).statusCode).toBe(200);
  });

  it('Free allows one site, Team allows more', async () => {
    const free = await workspace('free');
    expect((await post(free, '/sites', { name: 'HQ' })).statusCode).toBe(200);
    const over = await post(free, '/sites', { name: 'Second' });
    expect(over.statusCode).toBe(402);
    const team = await workspace('team');
    expect((await post(team, '/sites', { name: 'HQ' })).statusCode).toBe(200);
    expect((await post(team, '/sites', { name: 'Second' })).statusCode).toBe(200);
  });

  it('CRM record limit blocks creating more (including a conversion that would pass it) but keeps existing data', async () => {
    const o = await workspace('free', { overrides: { crm_records: 3 } });
    expect((await post(o, '/crm/companies', { name: 'One' })).statusCode).toBe(200);
    expect((await post(o, '/crm/companies', { name: 'Two' })).statusCode).toBe(200);
    const lead = j(await post(o, '/crm/leads', { name: 'Lead' })); // third record
    const tooMany = await post(o, `/crm/leads/${lead.id}/convert`, {
      company: { mode: 'new', name: 'Three' },
      contact: { mode: 'new', name: 'Lead' },
      deal: { title: 'Deal' },
    });
    expect(tooMany.statusCode).toBe(402);
    expect(j(tooMany).fields.limit).toBe('crm_records');
    expect(j(await get(o, `/crm/leads/${lead.id}`)).convertedAt).toBeNull();
    expect((await post(o, '/crm/contacts', { name: 'Four' })).statusCode).toBe(402);
    expect((await post(o, '/crm/deals', { title: 'Five' })).statusCode).toBe(402);
    // Reading, editing and deleting still work at the limit.
    expect((await get(o, '/crm/companies')).statusCode).toBe(200);
    const listed = j(await get(o, '/crm/companies')).items[0];
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/crm/companies/${listed.id}`,
          slug: o.slug,
          cookie: o.cookie,
          payload: { industry: 'x' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('pipelines: Free has one, Team three', async () => {
    const free = await workspace('free');
    await get(free, '/crm/pipelines'); // creates the default
    expect((await post(free, '/crm/pipelines', { name: 'Second' })).statusCode).toBe(402);
    const team = await workspace('team');
    expect((await post(team, '/crm/pipelines', { name: 'Two' })).statusCode).toBe(200);
    expect((await post(team, '/crm/pipelines', { name: 'Three' })).statusCode).toBe(200);
    expect((await post(team, '/crm/pipelines', { name: 'Four' })).statusCode).toBe(402);
  });
});

describe('locked features', () => {
  it('CSV import and export need Team or above', async () => {
    const free = await workspace('free');
    const csv = { csv: 'Name\nA', mapping: { name: 'Name' } };
    const imp = await post(free, '/crm/import/leads', csv);
    expect(imp.statusCode).toBe(402);
    expect(j(imp)).toMatchObject({ code: 'feature_locked', fields: { feature: 'crm_io' } });
    expect((await get(free, '/crm/export/leads')).statusCode).toBe(402);
    const team = await workspace('team');
    expect((await post(team, '/crm/import/leads', csv)).statusCode).toBe(200);
    expect((await get(team, '/crm/export/leads')).statusCode).toBe(200);
  });

  it('attendance export needs Team or above', async () => {
    const free = await workspace('free');
    const res = await get(free, '/work-days/export');
    expect(res.statusCode).toBe(402);
    expect(j(res).fields.feature).toBe('attendance_export');
    expect((await get(await workspace('team'), '/work-days/export')).statusCode).toBe(200);
  });

  it('the per-space audit log is a Business feature', async () => {
    for (const [plan, status] of [
      ['free', 402],
      ['team', 402],
      ['business', 200],
    ] as const) {
      const o = await workspace(plan);
      const space = j(await post(o, '/spaces', { key: 'AUD', name: 'Audited' }));
      expect((await get(o, `/spaces/${space.id}/audit-logs`)).statusCode, plan).toBe(status);
    }
  });

  it('the org audit log only shows as far back as the plan allows, and keeps the rest', async () => {
    const free = await workspace('free');
    const biz = await workspace('business');
    const db = adminDb();
    try {
      for (const o of [free, biz]) {
        await db.db.global.forOrg(o.org.id).auditLogs.insert({
          actorId: o.owner.id,
          action: 'test.old_entry',
          targetType: 'settings',
          targetId: o.org.id,
          createdAt: new Date(Date.now() - 40 * 86_400_000),
        } as never);
      }
    } finally {
      await db.close();
    }
    const seen = async (o: Org) =>
      j(await get(o, '/audit-logs?pageSize=100')).items.map((e: { action: string }) => e.action);
    expect(await seen(free)).not.toContain('test.old_entry');
    expect(await seen(biz)).toContain('test.old_entry');
    // Asking for an earlier start date does not get around it.
    const asked = j(await get(free, '/audit-logs?from=2020-01-01&pageSize=100')).items.map(
      (e: { action: string }) => e.action,
    );
    expect(asked).not.toContain('test.old_entry');
    // The row is still stored.
    const check = adminDb();
    try {
      const rows = await check.db.global.all.auditLogs.find({ action: 'test.old_entry' });
      expect(rows.length).toBeGreaterThanOrEqual(2);
    } finally {
      await check.close();
    }
  });

  it('branding: rename needs Team, logo and colour need Business, and colours must stay readable', async () => {
    const free = await workspace('free');
    expect(j(await put(free, '/settings/branding', { name: 'Renamed Co' })).fields.feature).toBe(
      'branding_name',
    );
    const team = await workspace('team');
    expect((await put(team, '/settings/branding', { name: 'Renamed Co' })).statusCode).toBe(200);
    expect(
      j(await put(team, '/settings/branding', { accentColor: '#2f5bff' })).fields.feature,
    ).toBe('branding_full');
    const biz = await workspace('business');
    const ok = await put(biz, '/settings/branding', {
      logoUrl: 'https://example.com/logo.png',
      accentColor: '#1d4ed8',
    });
    expect(ok.statusCode).toBe(200);
    expect(j(ok)).toMatchObject({
      logoUrl: 'https://example.com/logo.png',
      accentColor: '#1d4ed8',
    });
    expect(j(await get(biz, '/me')).org).toMatchObject({ accentColor: '#1d4ed8' });
    expect((await put(biz, '/settings/branding', { accentColor: '#f5f5a0' })).statusCode).toBe(400);
    expect(
      (await put(biz, '/settings/branding', { logoUrl: 'http://example.com/logo.png' })).statusCode,
    ).toBe(400);
    expect(
      (await put(biz, '/settings/branding', { logoUrl: 'javascript:alert(1)' })).statusCode,
    ).toBe(400);
  });

  it('only admins change branding', async () => {
    const o = await workspace('business');
    const member = await ensureUser({
      orgId: o.org.id,
      email: uniqueEmail('m', o.org.domain),
      role: 'member',
    });
    const cookie = await signInAs(t.app, o.slug, member);
    const res = await call({
      method: 'PUT',
      url: '/settings/branding',
      slug: o.slug,
      cookie,
      payload: { name: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a workspace cannot change its own plan, status or limits, or reach platform data, through its scope', async () => {
    const o = await workspace('free');
    const app = (await import('./helpers.js')).appDb();
    try {
      const tenant = app.db.tenant(o.org.id);
      // Branding is the only thing a tenant may write on its organization; everything else is dropped.
      await tenant.updateBranding({
        planKey: 'business',
        status: 'active',
        limitOverrides: {},
      } as never);
      const org = (await tenant.organization())!;
      expect(org.planKey).toBe('free');
      // Platform collections are not reachable from a tenant scope at all.
      for (const name of ['platformAdmins', 'signupRequests', 'platformSettings', 'platformAudit']) {
        expect((tenant as unknown as Record<string, unknown>)[name]).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
});

describe('domain lock', () => {
  it('Free accepts invitations for any email domain; Team locks to the company domain', async () => {
    const free = await workspace('free');
    const res = await post(free, '/invitations', { emails: [uniqueEmail('x', 'gmail.com')] });
    expect(res.statusCode).toBe(200);
    expect(j(res).results[0].status).toBe('invited');
    const team = await workspace('team');
    const locked = await post(team, '/invitations', { emails: [uniqueEmail('x', 'gmail.com')] });
    expect(j(locked).results[0].status).toBe('invalid_domain');
    const open = await workspace('team', { domainRestricted: false });
    expect(
      j(await post(open, '/invitations', { emails: [uniqueEmail('x', 'gmail.com')] })).results[0]
        .status,
    ).toBe('invited');
  });

  it('turning the lock on needs a plan that includes it', async () => {
    const free = await workspace('free');
    expect(
      j(await put(free, '/settings/branding', { domainRestricted: true })).fields.feature,
    ).toBe('domain_lock');
    const team = await workspace('team', { domainRestricted: false });
    expect((await put(team, '/settings/branding', { domainRestricted: true })).statusCode).toBe(
      200,
    );
  });
});

describe('trials', () => {
  it('a running trial has the Business plan; the plan endpoint shows the countdown', async () => {
    const o = await workspace('business', {
      onTrial: true,
      trialEndsAt: new Date(Date.now() + 5 * 86_400_000),
    });
    const plan = j(await get(o, '/plan'));
    expect(plan.plan).toMatchObject({ key: 'business', onTrial: true });
    expect(plan.plan.features).toContain('space_audit');
    expect(plan.usage.seats).toBe(1);
    expect(plan.usage.work_items).toBe(0);
    expect(plan.plans.map((p: { key: string }) => p.key)).toEqual(['free', 'team', 'business']);
    expect((await invite(o, 8)).statusCode).toBe(200);
  });

  it('an ended trial counts as Free at once, even before the daily job runs', async () => {
    const o = await workspace('business', {
      onTrial: true,
      trialEndsAt: new Date(Date.now() - 1000),
    });
    const plan = j(await get(o, '/plan'));
    expect(plan.plan).toMatchObject({ key: 'free', onTrial: false });
    expect((await invite(o, 5)).statusCode).toBe(402);
    expect((await get(o, '/crm/export/leads')).statusCode).toBe(402);
  });

  it('the job stores the downgrade once, keeps all data, and audits it', async () => {
    const o = await workspace('business', {
      onTrial: true,
      trialEndsAt: new Date(Date.now() - 1000),
    });
    await post(o, '/crm/companies', { name: 'Kept Co' });
    const first = await expireTrials(t.db);
    expect(first).toContain(o.org.id);
    expect(await expireTrials(t.db)).not.toContain(o.org.id);
    const db = adminDb();
    try {
      const row = await db.db.global.organizations.findOne({ id: o.org.id });
      expect(row).toMatchObject({ planKey: 'free', onTrial: false });
      const logs = await db.db.global.all.auditLogs.find({ orgId: o.org.id });
      expect(logs.filter((l) => l.action === 'plan.trial_ended')).toHaveLength(1);
    } finally {
      await db.close();
    }
    expect(j(await get(o, '/crm/companies')).total).toBe(1);
  });

  it('only admins see usage; members see what the plan includes', async () => {
    const o = await workspace('team');
    const member = await ensureUser({
      orgId: o.org.id,
      email: uniqueEmail('m', o.org.domain),
      role: 'member',
    });
    const cookie = await signInAs(t.app, o.slug, member);
    const res = j(await call({ method: 'GET', url: '/plan', slug: o.slug, cookie }));
    expect(res.usage).toBeNull();
    expect(res.plan.key).toBe('team');
  });

  it('plans are isolated per workspace: one workspace hitting its limit does not affect another', async () => {
    const a = await workspace('free');
    const b = await workspace('free');
    expect((await invite(a, 4)).statusCode).toBe(200);
    expect((await invite(b, 4)).statusCode).toBe(200);
    expect((await invite(a, 1)).statusCode).toBe(402);
  });
});
