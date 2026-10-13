import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  adminDb,
  caller,
  ensureUser,
  makeApp,
  signInAs,
  tenantIds,
  uniqueEmail,
  type CapturedInvite,
} from './helpers.js';
import { auditLogs, invitations } from '../src/db/schema.js';
import { createBrevoSender } from '../src/email/sender.js';
import { inviteEmail } from '../src/email/templates.js';

const sent: CapturedInvite[] = [];
const t = makeApp({ enqueue: (j) => void sent.push(j) });
const call = caller(t.app);
let ids: Awaited<ReturnType<typeof tenantIds>>;
let ownerC: string, adminC: string, memberC: string, globexC: string;

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

beforeAll(async () => {
  ids = await tenantIds();
  const owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('iown'), role: 'owner' });
  const admin = await ensureUser({ orgId: ids.acme, email: uniqueEmail('iadm'), role: 'admin' });
  const member = await ensureUser({ orgId: ids.acme, email: uniqueEmail('imem'), role: 'member' });
  const gOwner = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('igo', 'globex.test'),
    role: 'owner',
  });
  ownerC = await signInAs(t.app, 'acme', owner);
  adminC = await signInAs(t.app, 'acme', admin);
  memberC = await signInAs(t.app, 'acme', member);
  globexC = await signInAs(t.app, 'globex', gOwner);
  await t.app.ready();
});
afterAll(() => t.close());

const invite = (cookie: string | undefined, emails: string[], orgRole?: string, slug = 'acme') =>
  call({ method: 'POST', url: '/invitations', slug, cookie, payload: { emails, orgRole } });

async function dbInvite(id: string) {
  const a = adminDb();
  try {
    return (await a.db.select().from(invitations).where(eq(invitations.id, id)))[0]!;
  } finally {
    await a.close();
  }
}

describe('POST /invitations', () => {
  it('invites several people at once, shows links when email is disabled, queues one mail each', async () => {
    sent.length = 0;
    const a = uniqueEmail('new'),
      b = uniqueEmail('new');
    const res = await invite(adminC, [a, b.toUpperCase(), a]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.emailDelivery).toBe(false);
    expect(body.results).toHaveLength(2); // duplicates collapsed, case normalised
    expect(body.results.every((r: { status: string }) => r.status === 'invited')).toBe(true);
    expect(
      body.results.every((r: { link: string }) => r.link.includes('/accept-invite?token=')),
    ).toBe(true);
    expect(sent.map((s) => s.to).sort()).toEqual([a, b].sort());
    expect(sent[0]).toMatchObject({ orgId: ids.acme, orgName: 'Acme Inc' });
  });

  it('reports per-email outcomes: existing member, already invited, wrong domain', async () => {
    const fresh = uniqueEmail('dup');
    await invite(adminC, [fresh]);
    const memberEmail = uniqueEmail('exist');
    await ensureUser({ orgId: ids.acme, email: memberEmail, role: 'member' });
    const res = (await invite(adminC, [fresh, memberEmail, 'someone@gmail.com'])).json();
    const by = Object.fromEntries(
      res.results.map((r: { email: string; status: string }) => [r.email, r.status]),
    );
    expect(by[fresh]).toBe('already_invited');
    expect(by[memberEmail]).toBe('already_member');
    expect(by['someone@gmail.com']).toBe('invalid_domain');
  });

  it('flags deactivated members instead of re-inviting them', async () => {
    const email = uniqueEmail('gone');
    const u = await ensureUser({ orgId: ids.acme, email, role: 'member' });
    await call({
      method: 'POST',
      url: `/members/${u.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    const res = (await invite(adminC, [email])).json();
    expect(res.results[0].status).toBe('deactivated_member');
  });

  it('denies members, anonymous callers, and admins inviting owners', async () => {
    expect((await invite(memberC, [uniqueEmail('x')])).statusCode).toBe(403);
    expect((await invite(undefined, [uniqueEmail('x')])).statusCode).toBe(401);
    expect((await invite(adminC, [uniqueEmail('x')], 'owner')).statusCode).toBe(403);
    expect((await invite(ownerC, [uniqueEmail('x')], 'owner')).statusCode).toBe(200);
  });

  it('validates input', async () => {
    expect((await invite(adminC, [])).statusCode).toBe(400);
    expect((await invite(adminC, ['not-an-email'])).statusCode).toBe(400);
    expect(
      (
        await invite(
          adminC,
          Array.from({ length: 51 }, (_, i) => `u${i}@acme.test`),
        )
      ).statusCode,
    ).toBe(400);
  });

  it('records an audit entry per invitation', async () => {
    const email = uniqueEmail('aud');
    const id = (await invite(adminC, [email])).json().results[0].invitationId;
    const a = adminDb();
    try {
      const rows = await a.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.targetId, id), eq(auditLogs.action, 'invitation.created')));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.after).toMatchObject({ email, orgRole: 'member' });
    } finally {
      await a.close();
    }
  });

  it('does not store the raw token', async () => {
    const res = (await invite(adminC, [uniqueEmail('hash')])).json().results[0];
    const row = await dbInvite(res.invitationId);
    expect(row.tokenHash).not.toContain(tokenOf(res.link));
    expect(row.tokenHash).toHaveLength(64);
  });
});

describe('GET /invitations', () => {
  it('lists pending invites with status, and filters', async () => {
    const email = uniqueEmail('list');
    await invite(adminC, [email]);
    const pending = (
      await call({ method: 'GET', url: `/invitations?q=${email}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]).toMatchObject({ email, status: 'pending', orgRole: 'member' });
    const revoked = (
      await call({
        method: 'GET',
        url: `/invitations?status=revoked&q=${email}`,
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(revoked.items).toHaveLength(0);
  });

  it('is admin-only and tenant-scoped', async () => {
    expect(
      (await call({ method: 'GET', url: '/invitations', slug: 'acme', cookie: memberC }))
        .statusCode,
    ).toBe(403);
    const email = uniqueEmail('scope');
    await invite(adminC, [email]);
    const other = (
      await call({
        method: 'GET',
        url: `/invitations?status=all&q=${email}`,
        slug: 'globex',
        cookie: globexC,
      })
    ).json();
    expect(other.items).toHaveLength(0);
  });
});

describe('resend and revoke', () => {
  it('resend issues a new link, invalidates the old one, extends expiry, and queues mail', async () => {
    sent.length = 0;
    const first = (await invite(adminC, [uniqueEmail('rs')])).json().results[0];
    const oldToken = tokenOf(first.link);
    const a = adminDb();
    // make it nearly expired
    await a.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() + 1000) })
      .where(eq(invitations.id, first.invitationId));
    await a.close();

    const res = await call({
      method: 'POST',
      url: `/invitations/${first.invitationId}/resend`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(res.statusCode).toBe(200);
    const newToken = tokenOf(res.json().link);
    expect(newToken).not.toBe(oldToken);
    expect(sent.at(-1)!.to).toBe(first.email);
    const row = await dbInvite(first.invitationId);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

    const accept = (token: string) =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/invite/accept',
        headers: { host: 'acme.localhost:3000' },
        payload: { token, name: 'N', password: 'a-long-enough-password' },
      });
    expect((await accept(oldToken)).statusCode).toBe(400);
    expect((await accept(newToken)).statusCode).toBe(200);
  });

  it('resend works on expired invites, but not on accepted or revoked ones', async () => {
    const exp = (await invite(adminC, [uniqueEmail('ex')])).json().results[0];
    const a = adminDb();
    await a.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, exp.invitationId));
    await a.close();
    const list = (
      await call({
        method: 'GET',
        url: `/invitations?status=expired&q=${exp.email}`,
        slug: 'acme',
        cookie: adminC,
      })
    ).json();
    expect(list.items).toHaveLength(1);
    expect(
      (
        await call({
          method: 'POST',
          url: `/invitations/${exp.invitationId}/resend`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(200);

    const rev = (await invite(adminC, [uniqueEmail('rv')])).json().results[0];
    await call({
      method: 'DELETE',
      url: `/invitations/${rev.invitationId}`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(
      (
        await call({
          method: 'POST',
          url: `/invitations/${rev.invitationId}/resend`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('revoke blocks acceptance and is idempotent; accepted invites cannot be revoked', async () => {
    const r = (await invite(adminC, [uniqueEmail('rev')])).json().results[0];
    const del = await call({
      method: 'DELETE',
      url: `/invitations/${r.invitationId}`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(del.statusCode).toBe(200);
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/invitations/${r.invitationId}`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(200);
    const accept = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/accept',
      headers: { host: 'acme.localhost:3000' },
      payload: { token: tokenOf(r.link), name: 'N', password: 'a-long-enough-password' },
    });
    expect(accept.statusCode).toBe(400);

    const ok = (await invite(adminC, [uniqueEmail('acc')])).json().results[0];
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/accept',
      headers: { host: 'acme.localhost:3000' },
      payload: { token: tokenOf(ok.link), name: 'N', password: 'a-long-enough-password' },
    });
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/invitations/${ok.invitationId}`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('is denied to members and invisible to other tenants', async () => {
    const r = (await invite(adminC, [uniqueEmail('perm')])).json().results[0];
    const id = r.invitationId;
    expect(
      (
        await call({
          method: 'POST',
          url: `/invitations/${id}/resend`,
          slug: 'acme',
          cookie: memberC,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'DELETE', url: `/invitations/${id}`, slug: 'acme', cookie: memberC }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          url: `/invitations/${id}/resend`,
          slug: 'globex',
          cookie: globexC,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'DELETE', url: `/invitations/${id}`, slug: 'globex', cookie: globexC }))
        .statusCode,
    ).toBe(404);
    expect((await dbInvite(id)).revokedAt).toBeNull();
  });
});

describe('accepting an invite', () => {
  it('creates the member, writes an audit entry, and shows up in the list', async () => {
    const email = uniqueEmail('join');
    const r = (await invite(adminC, [email], 'admin')).json().results[0];
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/accept',
      headers: { host: 'acme.localhost:3000' },
      payload: { token: tokenOf(r.link), name: 'Joiner', password: 'a-long-enough-password' },
    });
    expect(res.statusCode).toBe(200);
    const list = (
      await call({ method: 'GET', url: `/members?q=${email}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(list.items[0]).toMatchObject({
      email,
      orgRole: 'admin',
      status: 'active',
      name: 'Joiner',
    });
    const a = adminDb();
    try {
      const rows = await a.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.targetId, r.invitationId), eq(auditLogs.action, 'invitation.accepted')),
        );
      expect(rows).toHaveLength(1);
    } finally {
      await a.close();
    }
  });
});

describe('Brevo sender', () => {
  it('posts to the Brevo transactional endpoint with the api key and never leaks it on failure', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = createBrevoSender({
      apiKey: 'secret-key',
      fromAddress: 'hi@acme.test',
      fromName: 'Acme',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{}', { status: 201 });
      }) as typeof fetch,
    });
    const mail = inviteEmail({
      orgName: 'Acme <b>',
      inviterName: 'Alice',
      link: 'http://acme.localhost:3000/accept-invite?token=t',
      expiresInDays: 7,
    });
    await ok.send({ to: 'bob@acme.test', ...mail });
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('secret-key');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      sender: { email: 'hi@acme.test', name: 'Acme' },
      to: [{ email: 'bob@acme.test' }],
    });
    expect(body.htmlContent).toContain('accept-invite?token=t');
    expect(body.htmlContent).not.toContain('<b>'); // org name is HTML-escaped

    const bad = createBrevoSender({
      apiKey: 'secret-key',
      fromAddress: 'a@b.c',
      fromName: 'x',
      fetchImpl: (async () => new Response('nope', { status: 401 })) as typeof fetch,
    });
    await expect(bad.send({ to: 'a@b.c', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      /status 401/,
    );
    await expect(bad.send({ to: 'a@b.c', subject: 's', html: 'h', text: 't' })).rejects.not.toThrow(
      /secret-key/,
    );
  });
});
