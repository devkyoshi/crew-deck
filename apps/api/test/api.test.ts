import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { withTenant } from '../src/db/client.js';
import { memberships } from '../src/db/schema.js';
import { forbidden } from '../src/lib/errors.js';
import { appDb, tenantIds } from './helpers.js';

const appConn = appDb();
const app = buildApp({ db: appConn.db, logLevel: 'silent' });
let ids: Awaited<ReturnType<typeof tenantIds>>;

// Test-only tenant-scoped routes. They stand in for real modules until Phase 1+,
// and show the pattern each module's cross-tenant test must follow.
app.get(
  '/api/v1/_test/memberships/:id',
  { schema: { params: z.object({ id: z.string().uuid() }) } },
  async (req, reply) => {
    const orgId = req.headers['x-org-id'] as string;
    const [row] = await withTenant(appConn.db, orgId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.id, req.params.id)),
    );
    if (!row) return reply.status(404).send({ code: 'not_found', message: 'Not found' });
    return row;
  },
);
app.get('/api/v1/_test/boom', async () => {
  throw forbidden();
});

beforeAll(async () => {
  ids = await tenantIds();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await appConn.close();
});

describe('health and errors', () => {
  it('GET /api/v1/health returns ok with db connectivity', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true });
  });

  it('returns the standard error shape for unknown routes, validation and AppError', async () => {
    const nf = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toMatchObject({ code: 'not_found' });

    const bad = await app.inject({ method: 'GET', url: '/api/v1/_test/memberships/not-a-uuid' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      code: 'validation_error',
      fields: { id: expect.any(String) },
    });

    const boom = await app.inject({ method: 'GET', url: '/api/v1/_test/boom' });
    expect(boom.statusCode).toBe(403);
    expect(boom.json()).toMatchObject({ code: 'forbidden', message: expect.any(String) });
  });
});

describe('cross-tenant access through the API', () => {
  it('tenant A can read its own membership but tenant B cannot', async () => {
    const own = await withTenant(appConn.db, ids.acme, (tx) => tx.select().from(memberships));
    const target = own[0]!;

    const asA = await app.inject({
      method: 'GET',
      url: `/api/v1/_test/memberships/${target.id}`,
      headers: { 'x-org-id': ids.acme },
    });
    expect(asA.statusCode).toBe(200);

    const asB = await app.inject({
      method: 'GET',
      url: `/api/v1/_test/memberships/${target.id}`,
      headers: { 'x-org-id': ids.globex },
    });
    expect(asB.statusCode).toBe(404);
  });
});
