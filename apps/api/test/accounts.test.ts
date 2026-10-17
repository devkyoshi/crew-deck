import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Presence } from '../src/messaging/presence.js';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail, PASSWORD } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
const presence = new Presence(t.redis);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};

const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

beforeAll(async () => {
  ids = await tenantIds();
  u.owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('ac-owner'), role: 'owner' });
  u.member = await ensureUser({ orgId: ids.acme, email: uniqueEmail('ac-member'), role: 'member' });
  c.owner = await signInAs(t.app, 'acme', u.owner);
  c.member = await signInAs(t.app, 'acme', u.member);
});

describe('presence you choose yourself', () => {
  it('Away and Do not disturb override the connection, and Available hands control back', async () => {
    const org = ids.acme;
    const me = u.member!.id;
    await presence.beat(org, me, 'conn-ac', 'active');
    expect(await presence.stateOf(org, me)).toBe('online');

    const away = await send('PUT', '/me/presence', c.member!, { mode: 'away' });
    expect(away.statusCode, away.body).toBe(200);
    expect(await presence.stateOf(org, me)).toBe('away');

    const dnd = await send('PUT', '/me/presence', c.member!, { mode: 'dnd', minutes: 30 });
    expect(dnd.json().state).toBe('dnd');
    expect(await presence.stateOf(org, me)).toBe('dnd');
    // Choosing Do not disturb dropped the manual Away.
    await send('PUT', '/me/dnd', c.member!, { minutes: null });
    expect(await presence.stateOf(org, me)).toBe('online');

    await send('PUT', '/me/presence', c.member!, { mode: 'away' });
    await send('PUT', '/me/presence', c.member!, { mode: 'auto' });
    expect(await presence.stateOf(org, me)).toBe('online');

    // Nobody connected: the dot stays offline whatever was chosen.
    await presence.drop(org, me, 'conn-ac');
    await send('PUT', '/me/presence', c.member!, { mode: 'away' });
    expect(await presence.stateOf(org, me)).toBe('offline');
    await send('PUT', '/me/presence', c.member!, { mode: 'auto' });
  });
});

describe('adding people with a temporary password', () => {
  const email = uniqueEmail('ac-new');
  let tempPassword = '';
  let memberId = '';

  it('creates the account, shows the password once, and only admins may do it', async () => {
    const denied = await send('POST', '/invitations', c.member!, { emails: [uniqueEmail('x')], mode: 'password' });
    expect(denied.statusCode).toBe(403);

    const res = await send('POST', '/invitations', c.owner!, { emails: [email], mode: 'password' });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json().results[0] as Json;
    expect(r).toMatchObject({ email, status: 'created' });
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);
    tempPassword = r.temporaryPassword;

    // Not listed as an invitation: the account already exists.
    const again = await send('POST', '/invitations', c.owner!, { emails: [email], mode: 'password' });
    expect(again.json().results[0].status).toBe('already_member');
  });

  it('lets them sign in with it, but flags that they must choose their own', async () => {
    const cookie = await signInAs(t.app, 'acme', { id: '', email }, tempPassword);
    const me = (await send('GET', '/me', cookie)).json();
    expect(me.user.mustChangePassword).toBe(true);
    memberId = me.user.id;
    c.newbie = cookie;
  });

  it('changes the password: needs the current one, rejects short or unchanged ones, clears the flag', async () => {
    const wrong = await send('POST', '/me/password', c.newbie!, { current: 'nope-nope-nope', next: 'A-new-long-password-1' });
    expect(wrong.statusCode).toBe(422);
    const short = await send('POST', '/me/password', c.newbie!, { current: tempPassword, next: 'short' });
    expect(short.statusCode).toBe(400);
    const same = await send('POST', '/me/password', c.newbie!, { current: tempPassword, next: tempPassword });
    expect(same.statusCode).toBe(422);

    const ok = await send('POST', '/me/password', c.newbie!, { current: tempPassword, next: 'A-new-long-password-1' });
    expect(ok.statusCode, ok.body).toBe(200);
    const me = (await send('GET', '/me', c.newbie!)).json();
    expect(me.user.mustChangePassword).toBe(false);

    // The temporary password no longer works; the new one does.
    const old = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host: 'acme.localhost:3000' },
      payload: { email, password: tempPassword },
    });
    expect(old.statusCode).toBe(401);
    expect(await signInAs(t.app, 'acme', { id: memberId, email }, 'A-new-long-password-1')).toBeTruthy();
  });

  it('cannot reset a password once the person has signed in', async () => {
    const res = await send('POST', `/members/${memberId}/reset-password`, c.owner!);
    expect(res.statusCode).toBe(409);
  });

  it('gives a not-yet-signed-in member a fresh temporary password', async () => {
    const e2 = uniqueEmail('ac-reset');
    const made = (await send('POST', '/invitations', c.owner!, { emails: [e2], mode: 'password' })).json().results[0] as Json;
    const list = (await send('GET', `/members?q=${encodeURIComponent(e2)}`, c.owner!)).json();
    const id = (list.items ?? list.members)[0].id as string;
    const reset = await send('POST', `/members/${id}/reset-password`, c.owner!);
    expect(reset.statusCode, reset.body).toBe(200);
    const fresh = reset.json().temporaryPassword as string;
    expect(fresh).not.toBe(made.temporaryPassword);
    expect(await signInAs(t.app, 'acme', { id, email: e2 }, fresh)).toBeTruthy();
  });
});

describe('invitation links', () => {
  it('link mode returns the link and sends nothing', async () => {
    const e = uniqueEmail('ac-link');
    const res = await send('POST', '/invitations', c.owner!, { emails: [e], mode: 'link' });
    const r = res.json().results[0] as Json;
    expect(r.status).toBe('invited');
    expect(r.link).toMatch(/\/accept-invite\?token=/);
    expect(res.json().emailDelivery).toBe(false);
  });
});

describe('signing out elsewhere', () => {
  it('ends the other sessions of the same person and keeps this one', async () => {
    const other = await signInAs(t.app, 'acme', u.member!);
    expect((await send('GET', '/me', other)).statusCode).toBe(200);
    const res = await send('POST', '/me/sessions/sign-out-others', c.member!);
    expect(res.json().ended).toBeGreaterThanOrEqual(1);
    expect((await send('GET', '/me', other)).statusCode).toBe(401);
    expect((await send('GET', '/me', c.member!)).statusCode).toBe(200);
  });

  it('a password change ends other sessions too', async () => {
    const e = uniqueEmail('ac-sess');
    const made = (await send('POST', '/invitations', c.owner!, { emails: [e], mode: 'password' })).json().results[0] as Json;
    const a = await signInAs(t.app, 'acme', { id: '', email: e }, made.temporaryPassword);
    const b = await signInAs(t.app, 'acme', { id: '', email: e }, made.temporaryPassword);
    const ok = await send('POST', '/me/password', a, { current: made.temporaryPassword, next: 'Another-long-pass-9' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await send('GET', '/me', b)).statusCode).toBe(401);
    expect((await send('GET', '/me', a)).statusCode).toBe(200);
  });
});

void PASSWORD;
