import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  PASSWORD,
  createInvitation,
  ensureUser,
  fakeGoogle,
  hostFor,
  makeApp,
  sessionCookie,
  setUserStatus,
  tenantIds,
} from './helpers.js';

const google = fakeGoogle();
const t = makeApp({ google: google.client });
const { app } = t;
let ids: Awaited<ReturnType<typeof tenantIds>>;

const post = (
  url: string,
  slug: string | null,
  payload: object,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { ...(slug ? { host: hostFor(slug) } : {}), ...extra },
    payload,
  });

const get = (url: string, slug: string | null, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: `/api/v1${url}`,
    headers: slug ? { host: hostFor(slug) } : {},
    cookies: cookie ? { cd_session: cookie } : {},
  });

async function login(slug: string, email: string, password = PASSWORD) {
  const res = await post('/auth/login', slug, { email, password });
  return { res, cookie: sessionCookie(res) };
}

beforeAll(async () => {
  ids = await tenantIds();
  await ensureUser({ orgId: ids.acme, email: 'member@acme.test', role: 'member' });
  await app.ready();
});
afterAll(() => t.close());

describe('password login and sessions', () => {
  it('signs in, serves /me, and signs out', async () => {
    const { res, cookie } = await login('acme', 'member@acme.test');
    expect(res.statusCode).toBe(200);
    expect(cookie).toBeTruthy();
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await get('/me', 'acme', cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: 'member@acme.test' },
      org: { slug: 'acme' },
      orgRole: 'member',
      permissions: [],
    });

    const out = await post('/auth/logout', 'acme', {}, {});
    expect(out.statusCode).toBe(200);
    // The server-side session must be destroyed, not just the cookie.
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { host: hostFor('acme') },
      cookies: { cd_session: cookie! },
    });
    expect((await get('/me', 'acme', cookie)).statusCode).toBe(401);
  });

  it('gives owners the admin permissions', async () => {
    const { cookie } = await login(
      'acme',
      'owner@acme.test',
      process.env.SEED_PASSWORD ?? 'dev-password-123',
    );
    const me = await get('/me', 'acme', cookie);
    expect(me.json().permissions).toContain('member.invite');
  });

  it('rejects a wrong password and an unknown user with the same response', async () => {
    const bad = await login('acme', 'member@acme.test', 'wrong-password-xx');
    const unknown = await login('acme', 'nobody@acme.test');
    expect(bad.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    expect(bad.res.json()).toEqual(unknown.res.json());
    expect(bad.cookie).toBeUndefined();
  });

  it('requires a session for /me', async () => {
    expect((await get('/me', 'acme')).statusCode).toBe(401);
    expect((await get('/me', 'acme', 'garbage')).statusCode).toBe(401);
  });

  it('blocks a deactivated user from signing in, and kills their existing session', async () => {
    const user = await ensureUser({ orgId: ids.acme, email: 'leaver@acme.test' });
    const { cookie } = await login('acme', 'leaver@acme.test');
    expect((await get('/me', 'acme', cookie)).statusCode).toBe(200);

    await setUserStatus(user.id, 'deactivated');
    expect((await get('/me', 'acme', cookie)).statusCode).toBe(401);
    const again = await login('acme', 'leaver@acme.test');
    expect(again.res.statusCode).toBe(403);
    expect(again.res.json().code).toBe('account_inactive');
  });

  it('rate limits repeated attempts for the same email', async () => {
    const limited = makeApp({ rateLimit: 10 });
    await limited.app.ready();
    const email = `ratelimit-${randomUUID().slice(0, 6)}@acme.test`;
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { host: hostFor('acme') },
        payload: { email, password: 'nope-nope-nope' },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[11]).toBe(429);
    // A different email is not locked out by someone else's failures.
    const other = await limited.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host: hostFor('acme') },
      payload: { email: 'member@acme.test', password: PASSWORD },
    });
    expect(other.statusCode).toBe(200);
    await limited.close();
  });

  it('dev-login signs in an existing member (non-production only)', async () => {
    const res = await post('/auth/dev-login', 'acme', { email: 'member@acme.test' });
    expect(res.statusCode).toBe(200);
    expect(sessionCookie(res)).toBeTruthy();
    expect((await post('/auth/dev-login', 'acme', { email: 'nobody@acme.test' })).statusCode).toBe(
      401,
    );
  });
});

describe('tenant isolation in auth', () => {
  it('rejects requests with no resolvable tenant', async () => {
    const res = await post('/auth/login', null, { email: 'member@acme.test', password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('tenant_required');
    expect((await get('/me', 'doesnotexist')).statusCode).toBe(404);
  });

  it('does not accept an acme session on the globex host', async () => {
    const { cookie } = await login('acme', 'member@acme.test');
    expect((await get('/me', 'acme', cookie)).statusCode).toBe(200);
    expect((await get('/me', 'globex', cookie)).statusCode).toBe(401);
  });

  it('does not let an acme member sign in to globex', async () => {
    const { res } = await login('globex', 'member@acme.test');
    expect(res.statusCode).toBe(401);
  });

  it('lists only the tenants the user belongs to for the switcher', async () => {
    const { cookie } = await login('acme', 'member@acme.test');
    const me = (await get('/me', 'acme', cookie)).json();
    expect(me.orgs.map((o: { slug: string }) => o.slug)).toEqual(['acme']);
  });

  it('blocks cross-origin state-changing requests', async () => {
    const res = await post(
      '/auth/login',
      'acme',
      { email: 'member@acme.test', password: PASSWORD },
      { origin: 'https://evil.example' },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('bad_origin');
  });
});

describe('profile', () => {
  it('updates own profile and validates input', async () => {
    const { cookie } = await login('acme', 'member@acme.test');
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { host: hostFor('acme') },
      cookies: { cd_session: cookie! },
      payload: { name: 'Mia Member', jobTitle: 'QA', timezone: 'Asia/Colombo' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({
      name: 'Mia Member',
      jobTitle: 'QA',
      timezone: 'Asia/Colombo',
    });

    const badTz = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { host: hostFor('acme') },
      cookies: { cd_session: cookie! },
      payload: { timezone: 'Mars/Base' },
    });
    expect(badTz.statusCode).toBe(400);

    // Role and status are not editable through /me.
    const sneaky = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { host: hostFor('acme') },
      cookies: { cd_session: cookie! },
      payload: { orgRole: 'owner' },
    });
    expect(sneaky.statusCode).toBe(400);
  });
});

describe('invitations', () => {
  const accept = (slug: string, token: string, extra: object = {}) =>
    post('/auth/invite/accept', slug, {
      token,
      name: 'New Person',
      password: 'a-long-enough-password',
      timezone: 'UTC',
      ...extra,
    });

  it('previews and accepts a valid invitation, then signs the person in', async () => {
    const inv = await createInvitation({ orgId: ids.acme, role: 'admin' });
    const preview = await post('/auth/invite/preview', null, { token: inv.token });
    expect(preview.json()).toMatchObject({ email: inv.email, orgSlug: 'acme' });

    const res = await accept('acme', inv.token);
    expect(res.statusCode).toBe(200);
    const cookie = sessionCookie(res);
    const me = (await get('/me', 'acme', cookie)).json();
    expect(me).toMatchObject({ user: { email: inv.email, name: 'New Person' }, orgRole: 'admin' });

    // They can sign in again with the password they chose.
    expect((await login('acme', inv.email, 'a-long-enough-password')).res.statusCode).toBe(200);
  });

  it('cannot be used twice', async () => {
    const inv = await createInvitation({ orgId: ids.acme });
    expect((await accept('acme', inv.token)).statusCode).toBe(200);
    const again = await accept('acme', inv.token);
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('invalid_invitation');
  });

  it('rejects expired, revoked and unknown tokens identically', async () => {
    const expired = await createInvitation({ orgId: ids.acme, expiresInMs: -1000 });
    const revoked = await createInvitation({ orgId: ids.acme, revoked: true });
    for (const token of [expired.token, revoked.token, 'totally-unknown-token']) {
      const res = await accept('acme', token);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_invitation');
    }
  });

  it('is bound to its own tenant', async () => {
    const inv = await createInvitation({ orgId: ids.acme });
    const res = await accept('globex', inv.token);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an email outside the workspace domain', async () => {
    const inv = await createInvitation({
      orgId: ids.acme,
      email: `outsider-${randomUUID().slice(0, 6)}@gmail.com`,
    });
    const res = await accept('acme', inv.token);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('domain_not_allowed');
  });

  it('enforces the password policy', async () => {
    const inv = await createInvitation({ orgId: ids.acme });
    const res = await accept('acme', inv.token, { password: 'short' });
    expect(res.statusCode).toBe(400);
  });
});

describe('google sso', () => {
  async function runSso(profile: Partial<typeof google.state.profile> & { email: string }) {
    google.state.profile = { emailVerified: true, name: 'G User', ...profile };
    google.state.fail = false;
    const start = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sso/google?tenant=acme',
      headers: { host: 'localhost:3000' },
    });
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/sso/google/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000' },
    });
    return { cb, state, location: new URL(cb.headers.location as string) };
  }

  it('signs in an existing member via a one-time ticket', async () => {
    const { cb, location } = await runSso({ email: 'member@acme.test' });
    expect(cb.statusCode).toBe(302);
    expect(location.pathname).toBe('/api/v1/auth/sso/complete');
    const ticket = location.searchParams.get('ticket')!;

    const complete = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/sso/complete?ticket=${ticket}`,
      headers: { host: hostFor('acme') },
    });
    expect(complete.statusCode).toBe(302);
    const cookie = sessionCookie(complete);
    expect((await get('/me', 'acme', cookie)).statusCode).toBe(200);

    // A ticket works once, and only on its own tenant.
    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/sso/complete?ticket=${ticket}`,
      headers: { host: hostFor('acme') },
    });
    expect(sessionCookie(replay)).toBeUndefined();
  });

  it('rejects an email on another domain', async () => {
    const { location } = await runSso({ email: 'someone@gmail.com' });
    expect(location.searchParams.get('error')).toBe('domain_not_allowed');
  });

  it('rejects an unverified email', async () => {
    const { location } = await runSso({ email: 'member@acme.test', emailVerified: false });
    expect(location.searchParams.get('error')).toBe('email_not_verified');
  });

  it('rejects a domain user who has not been invited', async () => {
    const { location } = await runSso({ email: `stranger-${randomUUID().slice(0, 6)}@acme.test` });
    expect(location.searchParams.get('error')).toBe('not_invited');
  });

  it('accepts a pending invitation on first Google sign-in', async () => {
    const inv = await createInvitation({ orgId: ids.acme, role: 'member' });
    const { location } = await runSso({ email: inv.email });
    expect(location.pathname).toBe('/api/v1/auth/sso/complete');
  });

  it('rejects a deactivated user', async () => {
    const user = await ensureUser({ orgId: ids.acme, email: 'gone-sso@acme.test' });
    await setUserStatus(user.id, 'deactivated');
    const { location } = await runSso({ email: 'gone-sso@acme.test' });
    expect(location.searchParams.get('error')).toBe('account_inactive');
  });

  it('rejects a replayed or unknown state', async () => {
    const { state } = await runSso({ email: 'member@acme.test' });
    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/sso/google/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000' },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().code).toBe('invalid_state');
  });

  it('is reported as unavailable when not configured', async () => {
    const other = makeApp({ google: null });
    await other.app.ready();
    const res = await other.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sso/google?tenant=acme',
      headers: { host: 'localhost:3000' },
    });
    expect(res.statusCode).toBe(501);
    await other.close();
  });
});

describe('providers', () => {
  it('describes the sign-in options for a tenant host', async () => {
    const res = await get('/auth/providers', 'acme');
    expect(res.json()).toMatchObject({ tenant: { slug: 'acme' }, password: true, google: true });
  });
});
