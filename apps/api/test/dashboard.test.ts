import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

beforeAll(async () => {
  const ids = await tenantIds();
  for (const name of ['a', 'b'] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`dash-${name}`), role: 'member' });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('dash-owner'), role: 'owner' });
  c.owner = await signInAs(t.app, 'acme', u.owner);
});

describe('dashboard layout', () => {
  it('starts with a default, is saved per person, and can be reset', async () => {
    const first = (await send('GET', '/me/dashboard', c.a!)).json();
    expect(first).toMatchObject({ custom: false, gadgets: [{ type: 'assigned' }] });

    const space = (
      await send('POST', '/spaces', c.owner!, {
        key: `D${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        name: 'Dash',
        visibility: 'private',
        members: [{ type: 'user', id: u.a!.id, role: 'member' }],
      })
    ).json();
    const saved = await send('PUT', '/me/dashboard', c.a!, {
      gadgets: [{ type: 'assigned' }, { type: 'sprint', spaceId: space.id }, { type: 'versions', spaceId: space.id }],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().gadgets).toHaveLength(3);
    expect(saved.json().gadgets[1]).toMatchObject({ type: 'sprint', spaceId: space.id, filterId: null });

    expect((await send('GET', '/me/dashboard', c.a!)).json().gadgets).toHaveLength(3);
    // Somebody else still has the default.
    expect((await send('GET', '/me/dashboard', c.b!)).json()).toMatchObject({ custom: false });

    expect((await send('DELETE', '/me/dashboard', c.a!)).json()).toMatchObject({ custom: false });
    expect((await send('GET', '/me/dashboard', c.a!)).json().custom).toBe(false);
  });

  it('checks the tiles: a space or filter where one is needed, spaces the person can open, at most twelve', async () => {
    const space = (await send('POST', '/spaces', c.owner!, { key: `E${Math.random().toString(36).slice(2, 6).toUpperCase()}`, name: 'Private', visibility: 'private' })).json();
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: [{ type: 'sprint' }] })).statusCode).toBe(422);
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: [{ type: 'filter' }] })).statusCode).toBe(422);
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: [{ type: 'flow', spaceId: space.id }] })).statusCode).toBe(422);
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: [{ id: 'x', type: 'assigned' }, { id: 'x', type: 'assigned' }] })).statusCode).toBe(422);
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: Array.from({ length: 13 }, () => ({ type: 'assigned' })) })).statusCode).toBe(400);
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: [{ type: 'bogus' }] })).statusCode).toBe(400);
    expect((await send('PUT', '/me/dashboard', c.b!, { gadgets: [{ type: 'assigned' }] })).statusCode).toBe(200);
  });
});
