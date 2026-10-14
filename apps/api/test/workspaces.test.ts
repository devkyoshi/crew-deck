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
