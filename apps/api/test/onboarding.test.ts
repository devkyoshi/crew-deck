import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPlatformSettings } from '../src/onboarding/settings.js';
import { hashPassword } from '../src/auth/password.js';
import { sha256 } from '../src/lib/crypto.js';
import {
  adminDb,
  caller,
  createInvitation,
  createOrg,
  ensureUser,
  hostFor,
  makeApp,
  PASSWORD,
  sessionCookie,
  signInAs,
  uniqueEmail,
} from './helpers.js';

type Mail = { to: string; subject: string; html: string; text: string };
const mails: Mail[] = [];
const t = makeApp({ sendMail: (m) => void mails.push(m) });
const call = caller(t.app);
const j = (res: { body: string }) => JSON.parse(res.body);

const APEX = 'localhost:3000';
const bare = (opts: {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object;
  cookie?: string;
}) =>
  t.app.inject({
    method: opts.method,
    url: `/api/v1${opts.url}`,
    headers: { host: APEX },
    cookies: opts.cookie ? { cd_platform: opts.cookie } : {},
    payload: opts.payload,
  });

const slug = (p = 'co') => `${p}-${randomUUID().slice(0, 8)}`;
const lastMailTo = (to: string) => [...mails].reverse().find((m) => m.to === to);

async function requestSignup(email: string, company = 'Test Company', s = slug()) {
  const res = await bare({ method: 'POST', url: '/signup', payload: { email, company, slug: s } });
  return { res, slug: s };
}
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;

async function signUpAndVerify(
  email: string,
  opts: { company?: string; slug?: string; password?: string | null; name?: string } = {},
) {
  const { res, slug: s } = await requestSignup(email, opts.company, opts.slug);
  expect(res.statusCode, res.body).toBe(200);
  const token = tokenFrom(j(res).devLink);
  const payload: Record<string, unknown> = { token, name: opts.name ?? 'Founder Person' };
  if (opts.password !== null) payload.password = opts.password ?? 'a-good-password-123';
  const verified = await bare({ method: 'POST', url: '/signup/verify', payload });
  return { verified, token, slug: s };
}

/** Follows the one-time ticket the way the browser does and returns the tenant session cookie. */
async function followTicket(url: string) {
  const u = new URL(url);
  const res = await t.app.inject({
    method: 'GET',
    url: `${u.pathname}${u.search}`,
    headers: { host: u.host },
  });
  return { res, cookie: sessionCookie(res) };
}

let adminEmail: string;
let platformCookie: string;

async function platformAdmin(email = `root-${randomUUID().slice(0, 6)}@crewdeck.test`) {
  const db = adminDb();
  try {
    await db.db.global.platformAdmins.insert({
      email,
      name: 'Root',
      passwordHash: await hashPassword(PASSWORD),
    });
  } finally {
    await db.close();
  }
  const res = await bare({
    method: 'POST',
    url: '/platform/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { email, cookie: res.cookies.find((c) => c.name === 'cd_platform')!.value };
}

async function setPlatformSettings(block: boolean, signups = true, trialDays = 14) {
  const db = adminDb();
  try {
    await getPlatformSettings(db.db);
    await db.db.global.platformSettings.updateOne(
      { id: 'singleton' },
      { blockFreeEmailDomains: block, signupsEnabled: signups, trialDays, updatedAt: new Date() },
    );
  } finally {
    await db.close();
  }
}

beforeAll(async () => {
  const a = await platformAdmin();
  adminEmail = a.email;
  platformCookie = a.cookie;
});
afterAll(async () => {
  await setPlatformSettings(false);
  await t.close();
});

describe('public pages: plans, config and address checks', () => {
  it('lists the public plans (not Enterprise) with prices and trial length', async () => {
    const res = j(await bare({ method: 'GET', url: '/public/plans' }));
    expect(res.plans.map((p: { key: string }) => p.key)).toEqual(['free', 'team', 'business']);
    expect(res.plans[1]).toMatchObject({ priceCents: 600 });
    expect(res.plans[0].limits.seats).toBe(5);
    expect(res.trialDays).toBe(14);
  });

  it('checks workspace addresses', async () => {
    const check = async (s: string) =>
      j(await bare({ method: 'GET', url: `/signup/check?slug=${s}` }));
    expect((await check(slug('free'))).available).toBe(true);
    expect(await check('acme')).toMatchObject({ available: false });
    expect((await check('acme')).reason).toContain('taken');
    expect((await check('www')).reason).toContain('reserved');
    expect((await check('platform')).available).toBe(false);
    for (const bad of ['ab', 'Has Space', '-start', 'end-', 'dou--ble', 'a'.repeat(31)]) {
      expect((await check(encodeURIComponent(bad))).available, bad).toBe(false);
    }
  });

  it('sign-up endpoints exist only on the apex address, not on a workspace', async () => {
    const res = await call({ method: 'GET', url: '/signup/check?slug=hello-there', slug: 'acme' });
    expect(res.statusCode).toBe(404);
  });
});

describe('self-serve sign-up', () => {
  it('emails a verification link and creates nothing until it is opened', async () => {
    const email = uniqueEmail('founder', 'newco.test');
    const s = slug('nothing-yet');
    const { res } = await requestSignup(email, 'Newco', s);
    expect(res.statusCode).toBe(200);
    const mail = lastMailTo(email)!;
    expect(mail.subject).toContain('Newco');
    expect(mail.text).toContain('/signup/verify?token=');
    // Nothing exists yet.
    expect(j(await bare({ method: 'GET', url: `/signup/check?slug=${s}` })).available).toBe(true);
    const db = adminDb();
    try {
      expect(await db.db.global.organizations.find({ slug: s })).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it('rejects reserved, taken and malformed input with field errors', async () => {
    const email = uniqueEmail('f', 'bad.test');
    expect(j((await requestSignup(email, 'X Corp', 'www')).res).fields.slug).toContain('reserved');
    expect(j((await requestSignup(email, 'X Corp', 'acme')).res).fields.slug).toContain('taken');
    expect((await requestSignup(email, 'X Corp', 'No Good')).res.statusCode).toBe(400);
    expect((await requestSignup('not-an-email', 'X Corp', slug())).res.statusCode).toBe(400);
    expect((await requestSignup(email, 'X', slug())).res.statusCode).toBe(400);
  });

  it('a link can be asked for at most three times an hour per email', async () => {
    const email = uniqueEmail('spam', 'rate.test');
    for (let i = 0; i < 3; i++) expect((await requestSignup(email)).res.statusCode).toBe(200);
    expect((await requestSignup(email)).res.statusCode).toBe(429);
  });

  it('opening the link creates the workspace with the person as owner, on a 14-day Business trial', async () => {
    const email = uniqueEmail('owner', 'brand-new.test');
    const { verified, slug: s } = await signUpAndVerify(email, {
      company: 'Brand New',
      name: 'Nora Owner',
    });
    expect(verified.statusCode, verified.body).toBe(200);
    const out = j(verified);
    expect(out.slug).toBe(s);
    expect(out.url).toContain(`${s}.localhost`);

    const { cookie } = await followTicket(out.url);
    expect(cookie).toBeTruthy();
    const me = j(await call({ method: 'GET', url: '/me', slug: s, cookie }));
    expect(me.orgRole).toBe('owner');
    expect(me.user.email).toBe(email);
    expect(me.org).toMatchObject({ name: 'Brand New', domainRestricted: true });
    expect(me.plan).toMatchObject({ key: 'business', onTrial: true });
    const days = (new Date(me.plan.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    // The owner can sign in with the password they chose.
    const login = await call({
      method: 'POST',
      url: '/auth/login',
      slug: s,
      payload: { email, password: 'a-good-password-123' },
    });
    expect(login.statusCode).toBe(200);

    const db = adminDb();
    try {
      const org = await db.db.global.organizations.findOne({ slug: s });
      expect(org).toMatchObject({
        createdVia: 'signup',
        planKey: 'business',
        onTrial: true,
        domain: 'brand-new.test',
      });
      expect(await db.db.global.all.tenantSettings.find({ orgId: org!.id })).toHaveLength(1);
      const logs = await db.db.global.all.auditLogs.find({ orgId: org!.id });
      expect(logs.map((l) => l.action)).toContain('workspace.created');
    } finally {
      await db.close();
    }
  });

  it('a link works once, and an expired link does not work', async () => {
    const email = uniqueEmail('once', 'once.test');
    const { verified, token } = await signUpAndVerify(email);
    expect(verified.statusCode).toBe(200);
    const again = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token, name: 'Again', password: 'a-good-password-123' },
    });
    expect(again.statusCode).toBe(400);
    expect(j(again).code).toBe('invalid_signup_link');

    const { res } = await requestSignup(uniqueEmail('late', 'late.test'));
    const expired = tokenFrom(j(res).devLink);
    const db = adminDb();
    try {
      await db.db.global.signupRequests.updateOne(
        { tokenHash: sha256(expired) },
        { expiresAt: new Date(Date.now() - 60_000) },
      );
    } finally {
      await db.close();
    }
    const late = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token: expired, name: 'Late', password: 'a-good-password-123' },
    });
    expect(j(late).code).toBe('invalid_signup_link');
    expect(
      (await bare({ method: 'POST', url: '/signup/preview', payload: { token: expired } }))
        .statusCode,
    ).toBe(400);
  });

  it('a new person must choose a strong enough password; the preview says whether they already have an account', async () => {
    const email = uniqueEmail('pw', 'pw.test');
    const { res } = await requestSignup(email);
    const token = tokenFrom(j(res).devLink);
    expect(
      j(await bare({ method: 'POST', url: '/signup/preview', payload: { token } })).hasAccount,
    ).toBe(false);
    const none = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token, name: 'No Pw' },
    });
    expect(j(none).fields.password).toBeTruthy();
    const short = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token, name: 'No Pw', password: 'short' },
    });
    expect(short.statusCode).toBe(400);
    // The failed attempts did not burn the link.
    const ok = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token, name: 'Has Pw', password: 'a-good-password-123' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('someone who already has an account keeps their password, and joins the new workspace as owner', async () => {
    const other = await createOrg('existing');
    const email = uniqueEmail('both', 'both.test');
    await ensureUser({ orgId: other.org.id, email, role: 'member' });
    const { res } = await requestSignup(email, 'Second Co');
    const token = tokenFrom(j(res).devLink);
    expect(
      j(await bare({ method: 'POST', url: '/signup/preview', payload: { token } })).hasAccount,
    ).toBe(true);
    const s = j(res).devLink && new URL(j(res).devLink);
    void s;
    const verified = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token, name: 'Both', password: 'a-different-password-9' },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    const newSlug = j(verified).slug;
    // Their original password still works; the one typed on the form was ignored.
    const ok = await call({
      method: 'POST',
      url: '/auth/login',
      slug: newSlug,
      payload: { email, password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    const ignored = await call({
      method: 'POST',
      url: '/auth/login',
      slug: newSlug,
      payload: { email, password: 'a-different-password-9' },
    });
    expect(ignored.statusCode).toBe(401);
  });

  it('free mailbox providers are allowed by default and cannot lock invitations to their domain', async () => {
    const email = uniqueEmail('solo', 'gmail.com');
    const { verified, slug: s } = await signUpAndVerify(email, { company: 'Solo Shop' });
    expect(verified.statusCode, verified.body).toBe(200);
    const { cookie } = await followTicket(j(verified).url);
    const me = j(await call({ method: 'GET', url: '/me', slug: s, cookie }));
    expect(me.org.domainRestricted).toBe(false);
    // Invitations to other domains are fine.
    const inv = await call({
      method: 'POST',
      url: '/invitations',
      slug: s,
      cookie,
      payload: { emails: [uniqueEmail('friend', 'example.org')] },
    });
    expect(j(inv).results[0].status).toBe('invited');
  });

  it('the platform can block free mailbox providers, and close sign-ups', async () => {
    try {
      await setPlatformSettings(true);
      const blocked = await requestSignup(uniqueEmail('solo', 'gmail.com'));
      expect(blocked.res.statusCode).toBe(400);
      expect(j(blocked.res).fields.email).toContain('work email');
      expect((await requestSignup(uniqueEmail('corp', 'realcorp.test'))).res.statusCode).toBe(200);
      await setPlatformSettings(false, false);
      const closed = await requestSignup(uniqueEmail('corp', 'realcorp.test'));
      expect(closed.res.statusCode).toBe(403);
      expect(j(closed.res).code).toBe('signups_closed');
    } finally {
      await setPlatformSettings(false);
    }
  });

  it('if the address is taken while the link waits, the link is kept and the person is told', async () => {
    const email = uniqueEmail('race', 'race.test');
    const { res, slug: s } = await requestSignup(email, 'Race Co');
    const token = tokenFrom(j(res).devLink);
    const db = adminDb();
    try {
      await db.db.global.organizations.insert({ name: 'Squatter', slug: s, domain: 'squat.test' });
    } finally {
      await db.close();
    }
    const verified = await bare({
      method: 'POST',
      url: '/signup/verify',
      payload: { token, name: 'Race', password: 'a-good-password-123' },
    });
    expect(verified.statusCode).toBe(409);
    expect(j(verified).code).toBe('slug_taken');
    const check = adminDb();
    try {
      const row = await check.db.global.signupRequests.findOne({ tokenHash: sha256(token) });
      expect(row!.usedAt).toBeNull();
    } finally {
      await check.close();
    }
  });

  it('a new workspace is isolated from every other workspace', async () => {
    const mine = await signUpAndVerify(uniqueEmail('iso', 'isolated.test'), {
      company: 'Isolated',
    });
    const { cookie } = await followTicket(j(mine.verified).url);
    // It sees only itself.
    const members = j(await call({ method: 'GET', url: '/members', slug: mine.slug, cookie }));
    expect(members.total).toBe(1);
    expect(j(await call({ method: 'GET', url: '/spaces', slug: mine.slug, cookie })).total).toBe(0);
    // Its session means nothing on another workspace.
    expect((await call({ method: 'GET', url: '/me', slug: 'acme', cookie })).statusCode).toBe(401);
    // And acme's data is not in the new workspace's search.
    expect(
      j(await call({ method: 'GET', url: '/members?q=acme', slug: mine.slug, cookie })).total,
    ).toBe(0);
  });
});

describe('platform console', () => {
  it('requires a platform sign-in, lives on the apex only, and rejects bad credentials', async () => {
    expect((await bare({ method: 'GET', url: '/platform/tenants' })).statusCode).toBe(401);
    expect((await bare({ method: 'GET', url: '/platform/me', cookie: 'nope' })).statusCode).toBe(
      401,
    );
    const tenantHost = await call({
      method: 'GET',
      url: '/platform/tenants',
      slug: 'acme',
      cookie: platformCookie,
    });
    expect(tenantHost.statusCode).toBe(404);
    const bad = await bare({
      method: 'POST',
      url: '/platform/auth/login',
      payload: { email: adminEmail, password: 'wrong-password-1' },
    });
    expect(bad.statusCode).toBe(401);
    expect(
      (await bare({ method: 'GET', url: '/platform/me', cookie: platformCookie })).statusCode,
    ).toBe(200);
  });

  it('a workspace owner, even of the biggest workspace, cannot use the console', async () => {
    const o = await createOrg('pnotadmin');
    const cookie = await signInAs(t.app, o.slug, o.owner);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/platform/tenants',
      headers: { host: APEX },
      cookies: { cd_session: cookie, cd_platform: cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists and searches workspaces with usage figures', async () => {
    const o = await createOrg('findme');
    const res = j(
      await bare({ method: 'GET', url: `/platform/tenants?q=${o.slug}`, cookie: platformCookie }),
    );
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({
      slug: o.slug,
      status: 'active',
      memberCount: 1,
      planKey: null,
    });
    const detail = j(
      await bare({ method: 'GET', url: `/platform/tenants/${o.org.id}`, cookie: platformCookie }),
    );
    expect(detail.usage.seats).toBe(1);
    expect(detail.effective.name).toBe('Internal');
  });

  it('creates a workspace for a customer: the owner is invited by email and sets their own password', async () => {
    const s = slug('made');
    const ownerEmail = uniqueEmail('boss', 'madeco.test');
    const res = await bare({
      method: 'POST',
      url: '/platform/tenants',
      cookie: platformCookie,
      payload: { name: 'Made Co', slug: s, ownerEmail, plan: 'team' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const link = new URL(j(res).inviteLink);
    expect(lastMailTo(ownerEmail)!.text).toContain('accept-invite?token=');
    const token = link.searchParams.get('token')!;
    const accept = await call({
      method: 'POST',
      url: '/auth/invite/accept',
      slug: s,
      payload: { token, name: 'The Boss', password: 'a-good-password-123' },
    });
    expect(accept.statusCode, accept.body).toBe(200);
    const cookie = sessionCookie(accept)!;
    const me = j(await call({ method: 'GET', url: '/me', slug: s, cookie }));
    expect(me).toMatchObject({ orgRole: 'owner', plan: { key: 'team', onTrial: false } });
    // Bad plan, reserved and duplicate addresses are refused.
    expect(
      (
        await bare({
          method: 'POST',
          url: '/platform/tenants',
          cookie: platformCookie,
          payload: { name: 'Made Co', slug: s, ownerEmail, plan: 'team' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await bare({
          method: 'POST',
          url: '/platform/tenants',
          cookie: platformCookie,
          payload: { name: 'Nope', slug: 'admin', ownerEmail, plan: 'team' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await bare({
          method: 'POST',
          url: '/platform/tenants',
          cookie: platformCookie,
          payload: { name: 'Nope', slug: slug(), ownerEmail, plan: 'gold' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('a suspended workspace cannot sign in, existing sessions stop, invitations stop, and unsuspending restores everything', async () => {
    const o = await createOrg('susp');
    const cookie = await signInAs(t.app, o.slug, o.owner);
    const invitee = await createInvitation({ orgId: o.org.id });
    expect((await call({ method: 'GET', url: '/me', slug: o.slug, cookie })).statusCode).toBe(200);

    const sus = await bare({
      method: 'POST',
      url: `/platform/tenants/${o.org.id}/suspend`,
      cookie: platformCookie,
      payload: { reason: 'Unpaid invoice' },
    });
    expect(sus.statusCode).toBe(200);

    // Sign-in is refused with a clear reason.
    const login = await call({
      method: 'POST',
      url: '/auth/login',
      slug: o.slug,
      payload: { email: o.owner.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    expect(j(login).code).toBe('workspace_suspended');
    expect(
      (
        await call({
          method: 'POST',
          url: '/auth/dev-login',
          slug: o.slug,
          payload: { email: o.owner.email },
        })
      ).statusCode,
    ).toBe(403);
    // A session that was already open stops working on the next request.
    const live = await call({ method: 'GET', url: '/me', slug: o.slug, cookie });
    expect(live.statusCode).toBe(403);
    expect(j(live).code).toBe('workspace_suspended');
    expect((await call({ method: 'GET', url: '/members', slug: o.slug, cookie })).statusCode).toBe(
      403,
    );
    // Invitations cannot be opened or accepted.
    const accept = await call({
      method: 'POST',
      url: '/auth/invite/accept',
      slug: o.slug,
      payload: { token: invitee.token, name: 'Late', password: 'a-good-password-123' },
    });
    expect(accept.statusCode).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          url: '/auth/invite/preview',
          slug: o.slug,
          payload: { token: invitee.token },
        })
      ).statusCode,
    ).toBe(403);
    // The sign-in page can say why.
    const prov = j(await call({ method: 'GET', url: '/auth/providers', slug: o.slug }));
    expect(prov.tenant.suspended).toBe(true);
    // It shows as suspended in the console, and its data is untouched.
    const row = j(
      await bare({ method: 'GET', url: `/platform/tenants?q=${o.slug}`, cookie: platformCookie }),
    ).items[0];
    expect(row).toMatchObject({ status: 'suspended', suspendedReason: 'Unpaid invoice' });
    // Other workspaces are not affected.
    const other = await createOrg('unaffected');
    const otherCookie = await signInAs(t.app, other.slug, other.owner);
    expect(
      (await call({ method: 'GET', url: '/me', slug: other.slug, cookie: otherCookie })).statusCode,
    ).toBe(200);

    expect(
      (
        await bare({
          method: 'POST',
          url: `/platform/tenants/${o.org.id}/unsuspend`,
          cookie: platformCookie,
        })
      ).statusCode,
    ).toBe(200);
    expect((await call({ method: 'GET', url: '/me', slug: o.slug, cookie })).statusCode).toBe(200);
    expect(
      (
        await call({
          method: 'POST',
          url: '/auth/login',
          slug: o.slug,
          payload: { email: o.owner.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);

    // Both actions are in the workspace's own log and in the platform log.
    const db = adminDb();
    try {
      const logs = await db.db.global.all.auditLogs.find({ orgId: o.org.id });
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining(['platform.workspace_suspended', 'platform.workspace_unsuspended']),
      );
    } finally {
      await db.close();
    }
    const history = j(
      await bare({ method: 'GET', url: `/platform/tenants/${o.org.id}`, cookie: platformCookie }),
    ).history;
    expect(history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['platform.workspace_suspended']),
    );
  });

  it('suspended workspaces disappear from the workspace switcher', async () => {
    const o = await createOrg('switcher');
    const cookie = await signInAs(t.app, o.slug, o.owner);
    await bare({
      method: 'POST',
      url: `/platform/tenants/${o.org.id}/suspend`,
      cookie: platformCookie,
      payload: {},
    });
    const other = await createOrg('switcher2');
    const db = adminDb();
    try {
      // Same person in a second, healthy workspace.
      await db.db.tenant(other.org.id).memberships.insert({ userId: o.owner.id, orgRole: 'member' });
    } finally {
      await db.close();
    }
    const otherCookie = await signInAs(t.app, other.slug, o.owner);
    const me = j(await call({ method: 'GET', url: '/me', slug: other.slug, cookie: otherCookie }));
    expect(me.orgs.map((x: { slug: string }) => x.slug)).not.toContain(o.slug);
    void cookie;
  });

  it('changes a workspace plan, starts and ends trials, and sets custom limits', async () => {
    const o = await createOrg('planchg');
    const cookie = await signInAs(t.app, o.slug, o.owner);
    const patch = (payload: object) =>
      bare({
        method: 'PATCH',
        url: `/platform/tenants/${o.org.id}`,
        cookie: platformCookie,
        payload,
      });
    const invite = (n: number) =>
      call({
        method: 'POST',
        url: '/invitations',
        slug: o.slug,
        cookie,
        payload: { emails: Array.from({ length: n }, () => uniqueEmail('i', o.org.domain)) },
      });

    expect(j(await patch({ planKey: 'free' }))).toMatchObject({ planKey: 'free', onTrial: false });
    expect((await invite(5)).statusCode).toBe(402);
    expect(j(await patch({ limitOverrides: { seats: 12 } })).limitOverrides).toEqual({ seats: 12 });
    expect((await invite(8)).statusCode).toBe(200);
    const trial = j(await patch({ planKey: 'business', trialDays: 30 }));
    expect(trial).toMatchObject({ planKey: 'business', onTrial: true });
    expect(j(await call({ method: 'GET', url: '/plan', slug: o.slug, cookie })).plan).toMatchObject(
      { key: 'business', onTrial: true },
    );
    expect((await patch({ planKey: 'gold' })).statusCode).toBe(400);
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ planKey: null })).statusCode).toBe(200);
  });

  it('impersonation opens the workspace as its owner, read-only, and is audited in both logs', async () => {
    const o = await createOrg('imp');
    const res = await bare({
      method: 'POST',
      url: `/platform/tenants/${o.org.id}/impersonate`,
      cookie: platformCookie,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { cookie } = await followTicket(j(res).url);
    expect(cookie).toBeTruthy();
    const me = j(await call({ method: 'GET', url: '/me', slug: o.slug, cookie }));
    expect(me).toMatchObject({
      impersonatedBy: adminEmail,
      user: { email: o.owner.email },
      orgRole: 'owner',
    });
    // Reading works; changing anything does not.
    expect((await call({ method: 'GET', url: '/members', slug: o.slug, cookie })).statusCode).toBe(
      200,
    );
    for (const [method, url, payload] of [
      ['POST', '/spaces', { key: 'NOPE', name: 'Nope' }],
      ['PATCH', `/members/${o.owner.id}`, { name: 'Changed' }],
      ['POST', '/invitations', { emails: ['x@' + o.org.domain] }],
      ['POST', '/crm/companies', { name: 'Nope' }],
    ] as const) {
      const r = await call({ method, url, slug: o.slug, cookie, payload });
      expect(r.statusCode, url).toBe(403);
      expect(j(r).code).toBe('impersonation_read_only');
    }
    const db = adminDb();
    try {
      const logs = await db.db.global.all.auditLogs.find({ orgId: o.org.id });
      const started = logs.find((l) => l.action === 'platform.impersonation_started');
      expect(started?.after).toMatchObject({ platformAdmin: adminEmail, readOnly: true });
      expect(started?.actorId).toBeNull();
      const u = await db.db.global.users.get(o.owner.id);
      expect(u!.name).not.toBe('Changed');
    } finally {
      await db.close();
    }
    const platformLog = j(
      await bare({ method: 'GET', url: '/platform/audit', cookie: platformCookie }),
    ).items;
    expect(
      platformLog.some(
        (e: { action: string; orgId: string }) =>
          e.action === 'platform.impersonation_started' && e.orgId === o.org.id,
      ),
    ).toBe(true);
  });

  it('the ticket for an impersonated session works once and only for that workspace', async () => {
    const o = await createOrg('imp2');
    const other = await createOrg('imp3');
    const url = j(
      await bare({
        method: 'POST',
        url: `/platform/tenants/${o.org.id}/impersonate`,
        cookie: platformCookie,
      }),
    ).url as string;
    const u = new URL(url);
    const wrongHost = await t.app.inject({
      method: 'GET',
      url: `${u.pathname}${u.search}`,
      headers: { host: hostFor(other.slug) },
    });
    expect(sessionCookie(wrongHost)).toBeUndefined();
    // The ticket was consumed by the wrong-host attempt, so it cannot be replayed on the right host.
    const replay = await t.app.inject({
      method: 'GET',
      url: `${u.pathname}${u.search}`,
      headers: { host: u.host },
    });
    expect(sessionCookie(replay)).toBeUndefined();
  });

  it('an unsuspended-only rule: a suspended workspace cannot be impersonated', async () => {
    const o = await createOrg('imp4');
    await bare({
      method: 'POST',
      url: `/platform/tenants/${o.org.id}/suspend`,
      cookie: platformCookie,
      payload: {},
    });
    expect(
      (
        await bare({
          method: 'POST',
          url: `/platform/tenants/${o.org.id}/impersonate`,
          cookie: platformCookie,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('platform settings are saved and audited', async () => {
    try {
      const put = await bare({
        method: 'PUT',
        url: '/platform/settings',
        cookie: platformCookie,
        payload: { blockFreeEmailDomains: true, signupsEnabled: true, trialDays: 21 },
      });
      expect(put.statusCode).toBe(200);
      expect(
        j(await bare({ method: 'GET', url: '/platform/settings', cookie: platformCookie })),
      ).toEqual({ blockFreeEmailDomains: true, signupsEnabled: true, trialDays: 21 });
      expect(j(await bare({ method: 'GET', url: '/signup/config' })).blockFreeEmail).toBe(true);
      expect(
        (
          await bare({
            method: 'PUT',
            url: '/platform/settings',
            cookie: platformCookie,
            payload: { blockFreeEmailDomains: false, signupsEnabled: true, trialDays: 365 },
          })
        ).statusCode,
      ).toBe(400);
      // New sign-ups pick up the trial length.
      await setPlatformSettings(false, true, 21);
      const { verified } = await signUpAndVerify(uniqueEmail('trial21', 'trial21.test'));
      const { cookie } = await followTicket(j(verified).url);
      const me = j(await call({ method: 'GET', url: '/me', slug: j(verified).slug, cookie }));
      const days = (new Date(me.plan.trialEndsAt).getTime() - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(21);
    } finally {
      await setPlatformSettings(false);
    }
  });

  it('signing out ends the platform session', async () => {
    const a = await platformAdmin();
    expect((await bare({ method: 'GET', url: '/platform/me', cookie: a.cookie })).statusCode).toBe(
      200,
    );
    await bare({ method: 'POST', url: '/platform/auth/logout', cookie: a.cookie });
    expect((await bare({ method: 'GET', url: '/platform/me', cookie: a.cookie })).statusCode).toBe(
      401,
    );
  });
});

describe('sign-up name', () => {
  it('keeps the name given at sign-up and returns it on the verify page', async () => {
    const email = uniqueEmail('named', 'named.test');
    const res = await bare({
      method: 'POST',
      url: '/signup',
      payload: { email, company: 'Named Co', slug: slug(), name: 'Sam Founder' },
    });
    expect(res.statusCode).toBe(200);
    const token = tokenFrom(j(res).devLink);
    const preview = j(await bare({ method: 'POST', url: '/signup/preview', payload: { token } }));
    expect(preview).toMatchObject({ name: 'Sam Founder', company: 'Named Co' });
    // The name is optional.
    const anon = await requestSignup(uniqueEmail('anon', 'named.test'));
    const p2 = j(
      await bare({
        method: 'POST',
        url: '/signup/preview',
        payload: { token: tokenFrom(j(anon.res).devLink) },
      }),
    );
    expect(p2.name).toBeNull();
  });
});
