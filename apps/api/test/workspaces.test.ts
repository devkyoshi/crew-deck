import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { WORK_TYPES, WORKSPACE_TEMPLATES } from '@crew-deck/shared';
import { PASSWORD, caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

const apex = { host: 'localhost:3000' };
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;

/** Signs up through the public wizard endpoints and returns the new workspace's slug. */
async function signUp(opts: { workType?: string; usage?: string[] }) {
  const id = randomUUID().slice(0, 8);
  const email = `founder-${id}@wiz${id}.test`;
  const slug = `wiz-${id}`;
  const req = await t.app.inject({
    method: 'POST',
    url: '/api/v1/signup',
    headers: apex,
    payload: { email, company: `Wizard ${id}`, slug, name: 'Founder', ...opts },
  });
  expect(req.statusCode, req.body).toBe(200);
  const token = tokenFrom(req.json().devLink);
  const verified = await t.app.inject({
    method: 'POST',
    url: '/api/v1/signup/verify',
    headers: apex,
    payload: { token, name: 'Founder', password: PASSWORD },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return { slug, email, org: await t.db.global.organizations.findOne({ slug }) };
}

describe('work types and templates', () => {
  it('lists every work type and the usage options for the sign-up wizard', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/public/workspace-templates',
      headers: apex,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workTypes.map((w: { type: string }) => w.type)).toEqual([...WORK_TYPES]);
    expect(body.usage.some((u: { status: string }) => u.status === 'planned')).toBe(true);
    for (const w of body.workTypes) expect(w.suggestedUsage.length).toBeGreaterThan(0);
  });

  it('stores the chosen type and usage at sign-up and turns on the matching modules', async () => {
    const { org } = await signUp({ workType: 'sales', usage: ['track_leads', 'manage_tasks'] });
    expect(org).toMatchObject({ workType: 'sales', usage: ['track_leads', 'manage_tasks'] });
    const settings = await t.db.tenant(org!.id).tenantSettings.findOne({});
    expect(settings?.enabledModules).toEqual(expect.arrayContaining(['members', 'spaces', 'checkin', 'crm']));
  });

  it('a workspace without CRM usage does not get the CRM module', async () => {
    const { org } = await signUp({ workType: 'construction', usage: ['site_work', 'attendance'] });
    const settings = await t.db.tenant(org!.id).tenantSettings.findOne({});
    expect(settings?.enabledModules).not.toContain('crm');
    expect(settings?.enabledModules).toContain('checkin');
  });

  it('new spaces start with the columns of the workspace type', async () => {
    for (const type of ['construction', 'marketing', 'software'] as const) {
      const { slug, email } = await signUp({ workType: type });
      const cookie = await signInAs(
        t.app,
        slug,
        (await t.db.global.users.findOne({ email }))!,
      );
      const space = (
        await call({ method: 'POST', url: '/spaces', slug, cookie, payload: { key: 'T1', name: 'First' } })
      ).json();
      const statuses = (
        await call({ method: 'GET', url: `/spaces/${space.id}/statuses`, slug, cookie })
      ).json().items;
      expect(statuses.map((s: { name: string }) => s.name)).toEqual(
        WORKSPACE_TEMPLATES[type].statuses.map((s) => s.name),
      );
    }
  });

  it('a workspace with no chosen type falls back to the standard columns', async () => {
    const o = await createOrg('notype');
    const cookie = await signInAs(t.app, o.slug, o.owner);
    const space = (
      await call({ method: 'POST', url: '/spaces', slug: o.slug, cookie, payload: { key: 'T2', name: 'Plain' } })
    ).json();
    const statuses = (
      await call({ method: 'GET', url: `/spaces/${space.id}/statuses`, slug: o.slug, cookie })
    ).json().items;
    expect(statuses.map((s: { name: string }) => s.name)).toEqual([
      'To Do',
      'In Progress',
      'In Review',
      'Done',
    ]);
  });

  it('rejects an unknown work type or usage key', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/signup',
      headers: apex,
      payload: { email: uniqueEmail('x', 'bad.test'), company: 'Bad Co', slug: `bad-${randomUUID().slice(0, 6)}`, workType: 'astrology' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('a person with several workspaces', () => {
  it('creates another workspace as its owner and lists both', async () => {
    const first = await createOrg('multi');
    const cookie = await signInAs(t.app, first.slug, first.owner);
    const slug = `second-${randomUUID().slice(0, 6)}`;
    const created = await call({
      method: 'POST',
      url: '/workspaces',
      slug: first.slug,
      cookie,
      payload: { company: 'Second Co', slug, workType: 'construction', usage: ['site_work'] },
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().url).toContain(`${slug}.localhost`);
    expect(created.json().url).toContain('/api/v1/auth/sso/complete?ticket=');

    const org = await t.db.global.organizations.findOne({ slug });
    expect(org).toMatchObject({ workType: 'construction', name: 'Second Co' });
    const owner = (await t.db.tenant(org!.id).memberships.find({})).map((m) => m.orgRole);
    expect(owner).toEqual(['owner']);

    const list = (await call({ method: 'GET', url: '/workspaces', slug: first.slug, cookie })).json();
    expect(list.items.map((w: { slug: string }) => w.slug).sort()).toEqual([first.slug, slug].sort());
    expect(list.items.find((w: { slug: string }) => w.slug === first.slug).current).toBe(true);
    expect(list.canCreate).toBe(true);

    // The new workspace shows up in the original workspace's switcher too.
    const me = (await call({ method: 'GET', url: '/me', slug: first.slug, cookie })).json();
    expect(me.orgs.map((w: { slug: string }) => w.slug)).toContain(slug);
  });

  it('rejects a taken or malformed address and needs a session', async () => {
    const first = await createOrg('multi2');
    const cookie = await signInAs(t.app, first.slug, first.owner);
    const taken = await call({
      method: 'POST',
      url: '/workspaces',
      slug: first.slug,
      cookie,
      payload: { company: 'Dup', slug: first.slug, workType: 'other' },
    });
    expect(taken.statusCode).toBe(409);
    const bad = await call({
      method: 'POST',
      url: '/workspaces',
      slug: first.slug,
      cookie,
      payload: { company: 'Bad', slug: 'x', workType: 'other' },
    });
    expect(bad.statusCode).toBe(400);
    const anon = await call({
      method: 'POST',
      url: '/workspaces',
      slug: first.slug,
      payload: { company: 'Anon', slug: `anon-${randomUUID().slice(0, 6)}`, workType: 'other' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('checks address availability for a signed-in person', async () => {
    const first = await createOrg('multi3');
    const cookie = await signInAs(t.app, first.slug, first.owner);
    const check = (slug: string) =>
      call({ method: 'GET', url: `/workspaces/check?slug=${slug}`, slug: first.slug, cookie });
    expect((await check(first.slug)).json()).toMatchObject({ available: false });
    expect((await check(`free-${randomUUID().slice(0, 6)}`)).json()).toMatchObject({ available: true });
  });
});

describe('changing what the workspace is for', () => {
  it('lets an owner change the type and usage, adding modules but never removing them', async () => {
    const o = await createOrg('purpose');
    const cookie = await signInAs(t.app, o.slug, o.owner);
    const before = (await call({ method: 'GET', url: '/settings/workspace', slug: o.slug, cookie })).json();
    expect(before.workType).toBeNull();
    const res = await call({
      method: 'PUT',
      url: '/settings/workspace',
      slug: o.slug,
      cookie,
      payload: { workType: 'sales', usage: ['track_leads'] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().modules).toEqual(expect.arrayContaining(['crm', 'checkin']));
    const again = await call({
      method: 'PUT',
      url: '/settings/workspace',
      slug: o.slug,
      cookie,
      payload: { workType: 'construction', usage: ['site_work'] },
    });
    // CRM stays on: switching purpose never switches modules off.
    expect(again.json().modules).toContain('crm');
    const me = (await call({ method: 'GET', url: '/me', slug: o.slug, cookie })).json();
    expect(me.org).toMatchObject({ workType: 'construction', usage: ['site_work'] });
    expect(me.org.modules).toContain('crm');
    const log = await t.db.tenant(o.org.id).auditLogs.find({ action: 'settings.workspace_updated' });
    expect(log).toHaveLength(2);
  });

  it('is for admins only', async () => {
    const o = await createOrg('purpose2');
    const member = await ensureUser({ orgId: o.org.id, email: uniqueEmail('m', o.org.domain), role: 'member' });
    const cookie = await signInAs(t.app, o.slug, member);
    const res = await call({
      method: 'PUT',
      url: '/settings/workspace',
      slug: o.slug,
      cookie,
      payload: { workType: 'sales', usage: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('starter content', () => {
  it('a new workspace of a known kind starts with its first space, columns and labels', async () => {
    const { slug, email, org } = await signUp({ workType: 'construction' });
    const cookie = await signInAs(t.app, slug, (await t.db.global.users.findOne({ email }))!);
    const spaces = (await call({ method: 'GET', url: '/spaces', slug, cookie })).json().items;
    expect(spaces.map((s: { key: string }) => s.key)).toEqual(['JOBS']);
    expect(spaces[0]).toMatchObject({ name: 'Jobs', myRole: 'admin', visibility: 'open' });
    const statuses = (await call({ method: 'GET', url: '/spaces/JOBS/statuses', slug, cookie })).json().items;
    expect(statuses.map((s: { name: string }) => s.name)).toEqual(
      WORKSPACE_TEMPLATES.construction.statuses.map((s) => s.name),
    );
    const labels = (await call({ method: 'GET', url: '/spaces/JOBS/labels', slug, cookie })).json().items;
    expect(labels.map((l: { name: string }) => l.name).sort()).toEqual(
      WORKSPACE_TEMPLATES.construction.starter.labels.map((l) => l.name).sort(),
    );
    // Items can be created straight away, and the key carries on from the starter space's counter.
    const item = await call({
      method: 'POST',
      url: '/spaces/JOBS/items',
      slug,
      cookie,
      payload: { type: 'task', title: 'Pour the slab' },
    });
    expect(item.statusCode, item.body).toBe(200);
    expect(item.json().key).toBe('JOBS-1');
    const log = await t.db.tenant(org!.id).auditLogs.find({ action: 'space.created' });
    expect(log).toHaveLength(1);
  });

  it('a workspace with no kind chosen starts empty', async () => {
    const { slug, email } = await signUp({});
    const cookie = await signInAs(t.app, slug, (await t.db.global.users.findOne({ email }))!);
    expect((await call({ method: 'GET', url: '/spaces', slug, cookie })).json().total).toBe(0);
  });

  it('a workspace created by the platform starts empty, since its owner has not joined yet', async () => {
    const { provisionWorkspace } = await import('../src/onboarding/provision.js');
    const s = `plat-${randomUUID().slice(0, 6)}`;
    const out = await provisionWorkspace(t.db, {
      name: 'Platform Co',
      slug: s,
      domain: 'plat.test',
      ownerEmail: `owner@${s}.test`,
      plan: 'team',
      trialDays: 0,
      domainRestricted: true,
      via: 'platform',
      ownerMode: 'invite',
      createdBy: 'platform@crewdeck.test',
      workType: 'construction',
    });
    expect(await t.db.tenant(out.orgId).spaces.count({})).toBe(0);
  });
});

describe('one sign-in across workspaces', () => {
  async function twoWorkspaces() {
    const a = await createOrg('switch-a');
    const b = await createOrg('switch-b');
    await t.db.tenant(b.org.id).memberships.insert({ userId: a.owner.id, orgRole: 'member' });
    return { a, b, cookie: await signInAs(t.app, a.slug, a.owner) };
  }

  it('opens another workspace the person belongs to without signing in again', async () => {
    const { a, b, cookie } = await twoWorkspaces();
    const res = await call({ method: 'POST', url: `/workspaces/${b.slug}/open`, slug: a.slug, cookie });
    expect(res.statusCode, res.body).toBe(200);
    const url = new URL(res.json().url);
    expect(url.host).toBe(`${b.slug}.localhost:3000`);
    // Following the link on the target address sets that workspace's session.
    const done = await t.app.inject({
      method: 'GET',
      url: `${url.pathname}${url.search}`,
      headers: { host: url.host },
    });
    expect(done.statusCode).toBe(302);
    const sid = done.cookies.find((c) => c.name === 'cd_session')?.value;
    expect(sid).toBeTruthy();
    const me = (await call({ method: 'GET', url: '/me', slug: b.slug, cookie: sid })).json();
    expect(me).toMatchObject({ orgRole: 'member', org: { slug: b.slug } });
    // The ticket works once.
    const again = await t.app.inject({ method: 'GET', url: `${url.pathname}${url.search}`, headers: { host: url.host } });
    expect(again.headers.location).toContain('sso_failed');
  });

  it('looks like nothing is there for workspaces you do not belong to, or were removed from', async () => {
    const { a, b, cookie } = await twoWorkspaces();
    const stranger = await createOrg('switch-c');
    for (const target of [stranger.slug, 'no-such-workspace']) {
      const res = await call({ method: 'POST', url: `/workspaces/${target}/open`, slug: a.slug, cookie });
      expect(res.statusCode, target).toBe(404);
    }
    await t.db.tenant(b.org.id).memberships.updateOne({ userId: a.owner.id }, { status: 'deactivated' });
    const res = await call({ method: 'POST', url: `/workspaces/${b.slug}/open`, slug: a.slug, cookie });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a suspended workspace and an impersonated session', async () => {
    const { a, b, cookie } = await twoWorkspaces();
    await t.db.global.organizations.updateOne({ id: b.org.id }, { status: 'suspended' });
    const suspended = await call({ method: 'POST', url: `/workspaces/${b.slug}/open`, slug: a.slug, cookie });
    expect(suspended.statusCode).toBe(403);
    expect(suspended.json().code).toBe('workspace_suspended');

    const { SessionStore } = await import('../src/auth/sessions.js');
    const { createRedis } = await import('../src/lib/redis.js');
    const redis = createRedis(t.config.REDIS_URL);
    try {
      const sessions = new SessionStore(redis, 600);
      const sid = await sessions.create(a.org.id, a.owner.id, { impersonatedBy: 'platform@crewdeck.test' });
      const res = await call({ method: 'POST', url: `/workspaces/${b.slug}/open`, slug: a.slug, cookie: sid });
      expect(res.statusCode).toBe(403);
    } finally {
      redis.disconnect();
    }
  });
});
