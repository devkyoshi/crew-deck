import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES } from '../src/app.js';
import { makeApp } from './helpers.js';

/**
 * A safety net for new routes: every API route must run an authentication pre-handler (which is where
 * sessions are checked and permissions start), unless it is on this short list of routes that are
 * public by design.
 */
const PUBLIC = [
  /^\/api\/v1\/health/,
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/signup/,
  /^\/api\/v1\/invitations\/[^/]+$/, // reading an invitation by its token before signing up
  /^\/api\/v1\/invitations\/accept/,
  /^\/api\/v1\/plans\/public/,
  /^\/api\/v1\/public\//,
  /^\/api\/v1\/files\/:id$/, // signed, short-lived file links (the signature is the permission)
  /^\/api\/v1\/platform\/auth\/(login|logout)$/, // the platform console's own sign-in and sign-out
  /^\/api\/v1\/hooks\/:token$/, // incoming webhooks: the secret in the address is the credential
];

const t = makeApp();
afterAll(() => t.close());
beforeAll(() => t.app.ready());

describe('every route is protected', () => {
  it('runs a pre-handler on each route except the public ones', () => {
    const api = ROUTES.filter((r) => r.url.startsWith('/api/v1/'));
    expect(api.length).toBeGreaterThan(100);
    const open = api
      .filter((r) => !r.hasPreHandler && !PUBLIC.some((p) => p.test(r.url)))
      .map((r) => `${[r.method].flat().join(',')} ${r.url}`);
    expect(open).toEqual([]);
  });
});
