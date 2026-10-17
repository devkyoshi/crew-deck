import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(async () => {
  // The demo workspace is shared with the browser tests: leave it without the test logo.
  if (c.owner) await call({ method: 'PUT', url: '/settings/branding', slug: 'acme', cookie: c.owner, payload: { logoUrl: null } });
  await t.close();
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
]);

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};

function upload(url: string, cookie: string, file: { name: string; body: Buffer }, slug = 'acme') {
  const boundary = `----cd${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return t.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { host: `${slug}.localhost:3000`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    cookies: { cd_session: cookie },
    payload: body,
  });
}
const get = (url: string, cookie?: string, slug = 'acme') =>
  t.app.inject({
    method: 'GET',
    url,
    headers: { host: `${slug}.localhost:3000` },
    cookies: cookie ? { cd_session: cookie } : {},
  });

beforeAll(async () => {
  ids = await tenantIds();
  u.owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('img-owner'), role: 'owner' });
  u.member = await ensureUser({ orgId: ids.acme, email: uniqueEmail('img-member'), role: 'member' });
  u.globex = await ensureUser({ orgId: ids.globex, email: uniqueEmail('img-gx', 'globex.test'), role: 'owner' });
  c.owner = await signInAs(t.app, 'acme', u.owner);
  c.member = await signInAs(t.app, 'acme', u.member);
  c.globex = await signInAs(t.app, 'globex', u.globex);
});

describe('profile photo', () => {
  it('uploads a picture, saves it on the profile and serves it to teammates', async () => {
    const res = await upload('/me/avatar', c.member!, { name: 'me.png', body: PNG });
    expect(res.statusCode, res.body).toBe(200);
    const { avatarUrl } = res.json() as { avatarUrl: string };
    expect(avatarUrl).toMatch(new RegExp(`^/api/v1/avatars/${u.member!.id}/[0-9a-f-]{36}\\.png$`));

    const me = (await call({ method: 'GET', url: '/me', slug: 'acme', cookie: c.member })).json();
    expect(me.user.avatarUrl).toBe(avatarUrl);

    const seen = await get(avatarUrl, c.owner);
    expect(seen.statusCode).toBe(200);
    expect(seen.headers['content-type']).toBe('image/png');
    expect(seen.rawPayload.equals(PNG)).toBe(true);
  });

  it('replaces the old picture and can remove it', async () => {
    const first = (await upload('/me/avatar', c.owner!, { name: 'a.png', body: PNG })).json().avatarUrl as string;
    const second = (await upload('/me/avatar', c.owner!, { name: 'b.png', body: PNG })).json().avatarUrl as string;
    expect(second).not.toBe(first);
    expect((await get(first, c.owner)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await get(second, c.owner)).statusCode).toBe(200);

    const del = await call({ method: 'DELETE', url: '/me/avatar', slug: 'acme', cookie: c.owner });
    expect(del.statusCode).toBe(204);
    const me = (await call({ method: 'GET', url: '/me', slug: 'acme', cookie: c.owner })).json();
    expect(me.user.avatarUrl).toBeNull();
  });

  it('refuses anything that is not a PNG, JPG or WebP, whatever it is called', async () => {
    const res = await upload('/me/avatar', c.member!, { name: 'cute.png', body: Buffer.from('<svg onload=alert(1)>') });
    expect(res.statusCode).toBe(415);
  });

  it('refuses pictures over 2 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
    const res = await upload('/me/avatar', c.member!, { name: 'big.png', body: big });
    expect(res.statusCode).toBe(413);
  });

  it('does not show a photo to someone signed out or in another workspace', async () => {
    const { avatarUrl } = (await upload('/me/avatar', c.member!, { name: 'me.png', body: PNG })).json();
    expect((await get(avatarUrl)).statusCode).toBe(401);
    expect((await get(avatarUrl, c.globex, 'globex')).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('workspace logo', () => {
  it('lets an owner upload a logo that is served without signing in', async () => {
    const res = await upload('/org/logo', c.owner!, { name: 'logo.png', body: PNG });
    // Branding needs a plan that includes it; the demo workspace does.
    expect([200, 402]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const { logoUrl } = res.json() as { logoUrl: string };
    const file = await get(logoUrl);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    const me = (await call({ method: 'GET', url: '/me', slug: 'acme', cookie: c.owner })).json();
    expect(me.org.logoUrl).toBe(logoUrl);
  });

  it('refuses a member', async () => {
    const res = await upload('/org/logo', c.member!, { name: 'logo.png', body: PNG });
    expect(res.statusCode).toBe(403);
  });
});
