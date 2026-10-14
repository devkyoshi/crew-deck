import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminDb,
  caller,
  ensureUser,
  makeApp,
  signInAs,
  tenantIds,
  uniqueEmail,
} from './helpers.js';

const t = makeApp();
const call = caller(t.app);
let ids: Awaited<ReturnType<typeof tenantIds>>;
type U = Awaited<ReturnType<typeof ensureUser>>;
let admin: U, member: U, other: U, globexUser: U;
let adminC: string, memberC: string, globexC: string;

const name = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

async function makeGroup(cookie = adminC, slug = 'acme', n = name('Team')) {
  const res = await call({ method: 'POST', url: '/groups', slug, cookie, payload: { name: n } });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; name: string };
}

async function auditFor(action: string, targetId: string) {
  const a = adminDb();
  try {
    return await a.db.global.all.auditLogs.find({ action, targetId });
  } finally {
    await a.close();
  }
}

beforeAll(async () => {
  ids = await tenantIds();
  admin = await ensureUser({ orgId: ids.acme, email: uniqueEmail('gadm'), role: 'admin' });
  member = await ensureUser({ orgId: ids.acme, email: uniqueEmail('gmem'), role: 'member' });
  other = await ensureUser({ orgId: ids.acme, email: uniqueEmail('goth'), role: 'member' });
  globexUser = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('gglob', 'globex.test'),
    role: 'owner',
  });
  adminC = await signInAs(t.app, 'acme', admin);
  memberC = await signInAs(t.app, 'acme', member);
  globexC = await signInAs(t.app, 'globex', globexUser);
  await t.app.ready();
});
afterAll(() => t.close());

describe('POST /groups', () => {
  it('lets an admin create a group and records an audit entry', async () => {
    const g = await makeGroup();
    expect(await auditFor('group.created', g.id)).toHaveLength(1);
    const detail = (
      await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(detail).toMatchObject({ name: g.name, members: [] });
  });

  it('denies members and anonymous callers', async () => {
    expect(
      (
        await call({
          method: 'POST',
          url: '/groups',
          slug: 'acme',
          cookie: memberC,
          payload: { name: name('X') },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'POST', url: '/groups', slug: 'acme', payload: { name: name('X') } }))
        .statusCode,
    ).toBe(401);
  });

  it('rejects duplicate names ignoring case, per workspace only', async () => {
    const g = await makeGroup();
    const dup = await call({
      method: 'POST',
      url: '/groups',
      slug: 'acme',
      cookie: adminC,
      payload: { name: g.name.toUpperCase() },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: 'name_taken', fields: { name: expect.any(String) } });
    // The same name is fine in another workspace.
    const elsewhere = await call({
      method: 'POST',
      url: '/groups',
      slug: 'globex',
      cookie: globexC,
      payload: { name: g.name },
    });
    expect(elsewhere.statusCode).toBe(200);
  });

  it('validates the name', async () => {
    for (const bad of ['', '   ', 'x'.repeat(61)]) {
      expect(
        (
          await call({
            method: 'POST',
            url: '/groups',
            slug: 'acme',
            cookie: adminC,
            payload: { name: bad },
          })
        ).statusCode,
      ).toBe(400);
    }
  });
});

describe('GET /groups', () => {
  it('lists groups with counts, search and pagination, to any member', async () => {
    const tag = name('srch');
    const g = await makeGroup(adminC, 'acme', `${tag}-alpha`);
    await makeGroup(adminC, 'acme', `${tag}-beta`);
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [member.id, other.id] },
    });

    const res = (
      await call({ method: 'GET', url: `/groups?q=${tag}`, slug: 'acme', cookie: memberC })
    ).json();
    expect(res.total).toBe(2);
    expect(res.items.map((i: { name: string }) => i.name)).toEqual([`${tag}-alpha`, `${tag}-beta`]);
    expect(res.items[0]).toMatchObject({ memberCount: 2 });
    expect(res.items[0].members).toHaveLength(2);

    const page = (
      await call({
        method: 'GET',
        url: `/groups?q=${tag}&pageSize=1&page=2`,
        slug: 'acme',
        cookie: memberC,
      })
    ).json();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it('treats search wildcards literally and only returns this workspace (picker data)', async () => {
    const mine = await makeGroup(adminC, 'acme', name('mineonly'));
    expect(
      (await call({ method: 'GET', url: '/groups?q=%25', slug: 'acme', cookie: adminC })).json()
        .total,
    ).toBe(0);
    const theirs = (
      await call({ method: 'GET', url: '/groups?pageSize=100', slug: 'globex', cookie: globexC })
    ).json();
    expect(theirs.items.some((g: { id: string }) => g.id === mine.id)).toBe(false);
  });
});

describe('GET /groups/:id', () => {
  it('is readable by members, and 404 across tenants', async () => {
    const g = await makeGroup();
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: memberC }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'globex', cookie: globexC }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'GET', url: '/groups/not-a-uuid', slug: 'acme', cookie: adminC }))
        .statusCode,
    ).toBe(400);
  });
});

describe('PATCH /groups/:id', () => {
  it('renames and re-describes, with audit; blocks duplicates', async () => {
    const a = await makeGroup();
    const b = await makeGroup();
    const res = await call({
      method: 'PATCH',
      url: `/groups/${a.id}`,
      slug: 'acme',
      cookie: adminC,
      payload: { name: name('Renamed'), description: 'Does things' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBe('Does things');
    expect(await auditFor('group.updated', a.id)).toHaveLength(1);
    const clash = await call({
      method: 'PATCH',
      url: `/groups/${a.id}`,
      slug: 'acme',
      cookie: adminC,
      payload: { name: b.name.toLowerCase() },
    });
    expect(clash.statusCode).toBe(409);
    // Keeping its own name (different case) is fine.
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/groups/${b.id}`,
          slug: 'acme',
          cookie: adminC,
          payload: { name: b.name.toUpperCase() },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('denies members, rejects empty bodies, and cannot cross tenants', async () => {
    const g = await makeGroup();
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/groups/${g.id}`,
          slug: 'acme',
          cookie: memberC,
          payload: { name: 'Hack' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/groups/${g.id}`,
          slug: 'acme',
          cookie: adminC,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/groups/${g.id}`,
          slug: 'globex',
          cookie: globexC,
          payload: { name: 'Hack' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC })).json()
        .name,
    ).toBe(g.name);
  });
});

describe('PUT /groups/:id/members', () => {
  it('replaces the member list, reporting added and removed in the audit log', async () => {
    const g = await makeGroup();
    const first = await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [member.id, other.id] },
    });
    expect(first.statusCode).toBe(200);
    expect(
      first
        .json()
        .members.map((m: { id: string }) => m.id)
        .sort(),
    ).toEqual([member.id, other.id].sort());

    const second = await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [other.id, admin.id, admin.id] },
    });
    expect(
      second
        .json()
        .members.map((m: { id: string }) => m.id)
        .sort(),
    ).toEqual([other.id, admin.id].sort());
    const entries = await auditFor('group.members_changed', g.id);
    expect(entries).toHaveLength(2);
    expect(entries.at(-1)!.after).toMatchObject({ added: [admin.id], removed: [member.id] });

    // No change, no audit noise.
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [other.id, admin.id] },
    });
    expect(await auditFor('group.members_changed', g.id)).toHaveLength(2);

    // Emptying works.
    expect(
      (
        await call({
          method: 'PUT',
          url: `/groups/${g.id}/members`,
          slug: 'acme',
          cookie: adminC,
          payload: { userIds: [] },
        })
      ).json().members,
    ).toEqual([]);
  });

  it('shows the groups on the member profile', async () => {
    const g = await makeGroup();
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [member.id] },
    });
    const profile = (
      await call({ method: 'GET', url: `/members/${member.id}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(profile.groups).toContainEqual({ id: g.id, name: g.name });
  });

  it('rejects people from other workspaces, unknown ids and deactivated people', async () => {
    const g = await makeGroup();
    const url = `/groups/${g.id}/members`;
    const foreign = await call({
      method: 'PUT',
      url,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [globexUser.id] },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().code).toBe('invalid_members');
    expect(
      (
        await call({
          method: 'PUT',
          url,
          slug: 'acme',
          cookie: adminC,
          payload: { userIds: ['00000000-0000-4000-8000-000000000000'] },
        })
      ).statusCode,
    ).toBe(400);

    const gone = await ensureUser({ orgId: ids.acme, email: uniqueEmail('ggone'), role: 'member' });
    await call({
      method: 'POST',
      url: `/members/${gone.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(
      (
        await call({
          method: 'PUT',
          url,
          slug: 'acme',
          cookie: adminC,
          payload: { userIds: [gone.id] },
        })
      ).statusCode,
    ).toBe(400);
    expect((await call({ method: 'GET', url, slug: 'acme', cookie: adminC })).statusCode).toBe(404); // no GET on this path
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC })).json()
        .members,
    ).toEqual([]);
  });

  it('keeps deactivated members in the group, visible to admins only', async () => {
    const g = await makeGroup();
    const p = await ensureUser({ orgId: ids.acme, email: uniqueEmail('gkeep'), role: 'member' });
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [p.id] },
    });
    await call({
      method: 'POST',
      url: `/members/${p.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    const asAdmin = (
      await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(asAdmin.members).toHaveLength(1);
    expect(asAdmin.members[0].status).toBe('deactivated');
    const asMember = (
      await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: memberC })
    ).json();
    expect(asMember.members).toHaveLength(0);
    // Reactivating restores them.
    await call({
      method: 'POST',
      url: `/members/${p.id}/reactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: memberC })).json()
        .members,
    ).toHaveLength(1);
  });

  it('denies members and other tenants', async () => {
    const g = await makeGroup();
    const url = `/groups/${g.id}/members`;
    expect(
      (
        await call({
          method: 'PUT',
          url,
          slug: 'acme',
          cookie: memberC,
          payload: { userIds: [member.id] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'PUT',
          url,
          slug: 'globex',
          cookie: globexC,
          payload: { userIds: [globexUser.id] },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('DELETE /groups/:id', () => {
  it('deletes the group and its memberships, with audit', async () => {
    const g = await makeGroup();
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [member.id] },
    });
    expect(
      (await call({ method: 'DELETE', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC }))
        .statusCode,
    ).toBe(404);
    const a = adminDb();
    try {
      expect(await a.db.global.all.groupMembers.find({ groupId: g.id })).toHaveLength(0);
    } finally {
      await a.close();
    }
    const [entry] = await auditFor('group.deleted', g.id);
    expect(entry!.before).toMatchObject({ name: g.name, memberCount: 1 });
  });

  it('denies members and other tenants without deleting anything', async () => {
    const g = await makeGroup();
    expect(
      (await call({ method: 'DELETE', url: `/groups/${g.id}`, slug: 'acme', cookie: memberC }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'DELETE', url: `/groups/${g.id}`, slug: 'globex', cookie: globexC }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'GET', url: `/groups/${g.id}`, slug: 'acme', cookie: adminC }))
        .statusCode,
    ).toBe(200);
  });
});

describe('inviting into groups', () => {
  const accept = (token: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite/accept',
      headers: { host: 'acme.localhost:3000' },
      payload: { token, name: 'Gina', password: 'a-long-enough-password' },
    });

  it('places the person in the chosen groups when they accept', async () => {
    const g1 = await makeGroup();
    const g2 = await makeGroup();
    const email = uniqueEmail('ginv');
    const res = (
      await call({
        method: 'POST',
        url: '/invitations',
        slug: 'acme',
        cookie: adminC,
        payload: { emails: [email], groupIds: [g1.id, g2.id] },
      })
    ).json();
    const token = new URL(res.results[0].link).searchParams.get('token')!;
    const acc = await accept(token);
    expect(acc.statusCode).toBe(200);
    const who = (
      await call({ method: 'GET', url: `/members?q=${email}`, slug: 'acme', cookie: adminC })
    ).json().items[0];
    const profile = (
      await call({ method: 'GET', url: `/members/${who.id}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(profile.groups.map((g: { id: string }) => g.id).sort()).toEqual([g1.id, g2.id].sort());
    const [entry] = await auditFor('invitation.accepted', res.results[0].invitationId);
    expect((entry!.after as { groupIds: string[] }).groupIds.sort()).toEqual([g1.id, g2.id].sort());
  });

  it('skips groups that were deleted before the invite was accepted', async () => {
    const keep = await makeGroup();
    const gone = await makeGroup();
    const email = uniqueEmail('gdel');
    const res = (
      await call({
        method: 'POST',
        url: '/invitations',
        slug: 'acme',
        cookie: adminC,
        payload: { emails: [email], groupIds: [keep.id, gone.id] },
      })
    ).json();
    await call({ method: 'DELETE', url: `/groups/${gone.id}`, slug: 'acme', cookie: adminC });
    const acc = await accept(new URL(res.results[0].link).searchParams.get('token')!);
    expect(acc.statusCode).toBe(200);
    const who = (
      await call({ method: 'GET', url: `/members?q=${email}`, slug: 'acme', cookie: adminC })
    ).json().items[0];
    const profile = (
      await call({ method: 'GET', url: `/members/${who.id}`, slug: 'acme', cookie: adminC })
    ).json();
    expect(profile.groups.map((g: { id: string }) => g.id)).toEqual([keep.id]);
  });

  it('rejects groups from another workspace', async () => {
    const theirs = await makeGroup(globexC, 'globex');
    const res = await call({
      method: 'POST',
      url: '/invitations',
      slug: 'acme',
      cookie: adminC,
      payload: { emails: [uniqueEmail('gx')], groupIds: [theirs.id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_groups');
  });
});

describe('integrity (application-enforced; MongoDB has no foreign keys)', () => {
  it('refuses a group membership that crosses tenants', async () => {
    const g = await makeGroup();
    // A user who only belongs to the other workspace cannot be added to an acme group.
    const res = await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [globexUser.id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_members');
    const a = adminDb();
    try {
      expect(await a.db.global.all.groupMembers.find({ groupId: g.id })).toHaveLength(0);
      expect((await a.db.global.all.groups.get(g.id))!.orgId).toBe(ids.acme);
    } finally {
      await a.close();
    }
  });
});
