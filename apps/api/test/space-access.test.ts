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
let owner: U, admin: U, alice: U, bob: U, carol: U, dave: U, globexOwner: U;
let ownerC: string,
  adminC: string,
  aliceC: string,
  bobC: string,
  carolC: string,
  daveC: string,
  globexC: string;

let seq = 0;
const key = () =>
  `A${(Date.now() % 100000).toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`.slice(
    0,
    10,
  );

async function mk(cookie: string, extra: Record<string, unknown> = {}) {
  const k = key();
  const res = await call({
    method: 'POST',
    url: '/spaces',
    slug: 'acme',
    cookie,
    payload: { key: k, name: `Space ${k}`, ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; key: string };
}
const members = async (spaceId: string, cookie: string, qs = '') =>
  (
    await call({
      method: 'GET',
      url: `/spaces/${spaceId}/members?pageSize=100${qs}`,
      slug: 'acme',
      cookie,
    })
  ).json();
const add = (spaceId: string, cookie: string, list: object[], slug = 'acme') =>
  call({
    method: 'POST',
    url: `/spaces/${spaceId}/members`,
    slug,
    cookie,
    payload: { members: list },
  });
const rowFor = async (spaceId: string, principalId: string, cookie = aliceC) =>
  (await members(spaceId, cookie)).items.find(
    (m: { principalId: string }) => m.principalId === principalId,
  );

async function mkGroup(userIds: string[]) {
  const g = (
    await call({
      method: 'POST',
      url: '/groups',
      slug: 'acme',
      cookie: adminC,
      payload: { name: `G ${key()}` },
    })
  ).json();
  await call({
    method: 'PUT',
    url: `/groups/${g.id}/members`,
    slug: 'acme',
    cookie: adminC,
    payload: { userIds },
  });
  return g as { id: string; name: string };
}

async function audit(action: string, targetId: string) {
  const a = adminDb();
  try {
    return await a.db.global.all.auditLogs.find({ action, targetId });
  } finally {
    await a.close();
  }
}

beforeAll(async () => {
  ids = await tenantIds();
  owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xown'), role: 'owner' });
  admin = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xadm'), role: 'admin' });
  alice = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xali'), role: 'member' });
  bob = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xbob'), role: 'member' });
  carol = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xcar'), role: 'member' });
  dave = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xdav'), role: 'member' });
  globexOwner = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('xglo', 'globex.test'),
    role: 'owner',
  });
  ownerC = await signInAs(t.app, 'acme', owner);
  adminC = await signInAs(t.app, 'acme', admin);
  aliceC = await signInAs(t.app, 'acme', alice);
  bobC = await signInAs(t.app, 'acme', bob);
  carolC = await signInAs(t.app, 'acme', carol);
  daveC = await signInAs(t.app, 'acme', dave);
  globexC = await signInAs(t.app, 'globex', globexOwner);
  await t.app.ready();
});
afterAll(() => t.close());

describe('listing members', () => {
  it('shows users and groups with roles, member counts, effective and inherited roles', async () => {
    const g = await mkGroup([bob.id, carol.id]);
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [
        { type: 'user', id: bob.id, role: 'viewer' }, // direct viewer, group admin below
        { type: 'group', id: g.id, role: 'admin' },
      ],
    });
    const list = await members(s.id, aliceC);
    expect(list.total).toBe(3);
    const bobRow = list.items.find((m: { principalId: string }) => m.principalId === bob.id);
    expect(bobRow).toMatchObject({
      role: 'viewer',
      inheritedRole: 'admin',
      effectiveRole: 'admin',
    });
    const groupRow = list.items.find((m: { type: string }) => m.type === 'group');
    expect(groupRow).toMatchObject({ name: g.name, role: 'admin', memberCount: 2 });
    // Users come before groups; creator is an admin.
    expect(list.items.at(-1).type).toBe('group');
    expect(list.items.find((m: { principalId: string }) => m.principalId === alice.id).role).toBe(
      'admin',
    );
  });

  it('searches, paginates and hides private spaces from outsiders', async () => {
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [
        { type: 'user', id: bob.id, role: 'member' },
        { type: 'user', id: carol.id, role: 'member' },
      ],
    });
    expect(
      (await members(s.id, aliceC, `&q=${bob.email}`)).items.map(
        (m: { principalId: string }) => m.principalId,
      ),
    ).toEqual([bob.id]);
    expect((await members(s.id, aliceC, '&q=%25')).total).toBe(0);
    const page = (
      await call({
        method: 'GET',
        url: `/spaces/${s.id}/members?pageSize=2&page=2`,
        slug: 'acme',
        cookie: aliceC,
      })
    ).json();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(
      (await call({ method: 'GET', url: `/spaces/${s.id}/members`, slug: 'acme', cookie: daveC }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'GET',
          url: `/spaces/${s.id}/members`,
          slug: 'globex',
          cookie: globexC,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('flags deactivated people', async () => {
    const gone = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xgone'), role: 'member' });
    const s = await mk(aliceC, { members: [{ type: 'user', id: gone.id, role: 'member' }] });
    await call({
      method: 'POST',
      url: `/members/${gone.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect((await rowFor(s.id, gone.id)).deactivated).toBe(true);
  });
});

describe('adding members', () => {
  it('adds people and groups, reports duplicates, and audits each addition', async () => {
    const g = await mkGroup([dave.id]);
    const s = await mk(aliceC, { visibility: 'private' });
    const res = await add(s.id, aliceC, [
      { type: 'user', id: bob.id, role: 'member' },
      { type: 'group', id: g.id, role: 'viewer' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['added', 'added']);
    expect(
      (await add(s.id, aliceC, [{ type: 'user', id: bob.id, role: 'admin' }])).json().results[0]
        .status,
    ).toBe('already_member');
    expect((await rowFor(s.id, bob.id)).role).toBe('member'); // unchanged by the duplicate
    expect(await audit('space.member_added', s.id)).toHaveLength(3); // creator + 2

    // Group members now have access through the group.
    expect(
      (await call({ method: 'GET', url: `/spaces/${s.id}`, slug: 'acme', cookie: daveC })).json()
        .myRole,
    ).toBe('viewer');
  });

  it('validates people and groups, and denies non-admins', async () => {
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [{ type: 'user', id: bob.id, role: 'member' }],
    });
    expect(
      (await add(s.id, aliceC, [{ type: 'user', id: globexOwner.id, role: 'member' }])).statusCode,
    ).toBe(400);
    const theirGroup = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'globex',
        cookie: globexC,
        payload: { name: `G ${key()}` },
      })
    ).json();
    expect(
      (await add(s.id, aliceC, [{ type: 'group', id: theirGroup.id, role: 'member' }])).statusCode,
    ).toBe(400);
    expect((await add(s.id, aliceC, [])).statusCode).toBe(400);
    expect(
      (await add(s.id, bobC, [{ type: 'user', id: carol.id, role: 'member' }])).statusCode,
    ).toBe(403);
    expect(
      (await add(s.id, daveC, [{ type: 'user', id: carol.id, role: 'member' }])).statusCode,
    ).toBe(404);
    expect(
      (await add(s.id, globexC, [{ type: 'user', id: globexOwner.id, role: 'member' }], 'globex'))
        .statusCode,
    ).toBe(404);
  });

  it('blocks changes while the space is archived', async () => {
    const s = await mk(aliceC);
    await call({ method: 'POST', url: `/spaces/${s.id}/archive`, slug: 'acme', cookie: aliceC });
    const res = await add(s.id, aliceC, [{ type: 'user', id: bob.id, role: 'member' }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('archived');
  });
});

describe('changing roles and removing, with last-admin protection', () => {
  it('changes a role and records before and after', async () => {
    const s = await mk(aliceC, { members: [{ type: 'user', id: bob.id, role: 'viewer' }] });
    const row = await rowFor(s.id, bob.id);
    const res = await call({
      method: 'PATCH',
      url: `/spaces/${s.id}/members/${row.id}`,
      slug: 'acme',
      cookie: aliceC,
      payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(200);
    expect((await rowFor(s.id, bob.id)).role).toBe('member');
    const [entry] = await audit('space.member_role_changed', s.id);
    expect(entry!.before).toMatchObject({ role: 'viewer' });
    expect(entry!.after).toMatchObject({ role: 'member' });
  });

  it('never lets the last admin be demoted or removed', async () => {
    const s = await mk(aliceC, { members: [{ type: 'user', id: bob.id, role: 'member' }] });
    const mine = await rowFor(s.id, alice.id);
    const demote = await call({
      method: 'PATCH',
      url: `/spaces/${s.id}/members/${mine.id}`,
      slug: 'acme',
      cookie: aliceC,
      payload: { role: 'member' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().code).toBe('last_admin');
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s.id}/members/${mine.id}`,
          slug: 'acme',
          cookie: aliceC,
        })
      ).statusCode,
    ).toBe(409);
    // Even workspace admins cannot orphan a space.
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s.id}/members/${mine.id}`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(409);
    expect((await rowFor(s.id, alice.id)).role).toBe('admin');

    // After promoting someone else, the original admin can step down.
    const bobRow = await rowFor(s.id, bob.id);
    await call({
      method: 'PATCH',
      url: `/spaces/${s.id}/members/${bobRow.id}`,
      slug: 'acme',
      cookie: aliceC,
      payload: { role: 'admin' },
    });
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/spaces/${s.id}/members/${mine.id}`,
          slug: 'acme',
          cookie: aliceC,
          payload: { role: 'member' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('counts a group admin only while the group has an active person', async () => {
    const g = await mkGroup([bob.id]);
    const s = await mk(aliceC, { members: [{ type: 'group', id: g.id, role: 'admin' }] });
    const mine = await rowFor(s.id, alice.id);
    // The group (with Bob in it) is a second admin, so Alice can step down.
    const stepDown = await call({
      method: 'PATCH',
      url: `/spaces/${s.id}/members/${mine.id}`,
      slug: 'acme',
      cookie: aliceC,
      payload: { role: 'member' },
    });
    expect(stepDown.statusCode).toBe(200);

    // Now the group is the only admin source: it cannot be removed while Alice is just a member...
    const groupRow = await rowFor(s.id, g.id, bobC);
    const removeGroup = await call({
      method: 'DELETE',
      url: `/spaces/${s.id}/members/${groupRow.id}`,
      slug: 'acme',
      cookie: adminC,
    });
    expect(removeGroup.statusCode).toBe(409);

    // ...and an empty group does not count as an admin at all.
    const emptyG = await mkGroup([]);
    const s2 = await mk(aliceC, { members: [{ type: 'group', id: emptyG.id, role: 'admin' }] });
    const mine2 = await rowFor(s2.id, alice.id);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/spaces/${s2.id}/members/${mine2.id}`,
          slug: 'acme',
          cookie: aliceC,
          payload: { role: 'member' },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('does not count a deactivated admin', async () => {
    const other = await ensureUser({ orgId: ids.acme, email: uniqueEmail('xoth'), role: 'member' });
    const s = await mk(aliceC, { members: [{ type: 'user', id: other.id, role: 'admin' }] });
    const mine = await rowFor(s.id, alice.id);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/spaces/${s.id}/members/${mine.id}`,
          slug: 'acme',
          cookie: aliceC,
          payload: { role: 'member' },
        })
      ).statusCode,
    ).toBe(200);
    // Alice is now just a member and cannot demote the remaining admin; an org admin tries once that admin is deactivated.
    await call({
      method: 'POST',
      url: `/members/${other.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    const otherRow = await rowFor(s.id, other.id, adminC);
    const res = await call({
      method: 'PATCH',
      url: `/spaces/${s.id}/members/${otherRow.id}`,
      slug: 'acme',
      cookie: adminC,
      payload: { role: 'member' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('removes people, and loses access when the group that gave it is removed', async () => {
    const g = await mkGroup([carol.id]);
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [
        { type: 'group', id: g.id, role: 'member' },
        { type: 'user', id: bob.id, role: 'member' },
      ],
    });
    expect(
      (await call({ method: 'GET', url: `/spaces/${s.id}`, slug: 'acme', cookie: carolC }))
        .statusCode,
    ).toBe(200);
    const groupRow = await rowFor(s.id, g.id);
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s.id}/members/${groupRow.id}`,
          slug: 'acme',
          cookie: aliceC,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'GET', url: `/spaces/${s.id}`, slug: 'acme', cookie: carolC }))
        .statusCode,
    ).toBe(404);
    const bobRow = await rowFor(s.id, bob.id);
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s.id}/members/${bobRow.id}`,
          slug: 'acme',
          cookie: aliceC,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'GET', url: `/spaces/${s.id}`, slug: 'acme', cookie: bobC }))
        .statusCode,
    ).toBe(404);
    expect(await audit('space.member_removed', s.id)).toHaveLength(2);
  });

  it('cannot touch rows of another space or another tenant', async () => {
    const s1 = await mk(aliceC, { members: [{ type: 'user', id: bob.id, role: 'member' }] });
    const s2 = await mk(aliceC, { members: [{ type: 'user', id: bob.id, role: 'member' }] });
    const rowInS1 = await rowFor(s1.id, bob.id);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/spaces/${s2.id}/members/${rowInS1.id}`,
          slug: 'acme',
          cookie: aliceC,
          payload: { role: 'viewer' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s2.id}/members/${rowInS1.id}`,
          slug: 'acme',
          cookie: aliceC,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s1.id}/members/${rowInS1.id}`,
          slug: 'globex',
          cookie: globexC,
        })
      ).statusCode,
    ).toBe(404);
    expect((await rowFor(s1.id, bob.id)).role).toBe('member');
  });
});

describe('access requests', () => {
  const request = (spaceKey: string, cookie: string, message?: string) =>
    call({
      method: 'POST',
      url: `/spaces/${spaceKey}/access-requests`,
      slug: 'acme',
      cookie,
      payload: message ? { message } : {},
    });
  const inbox = async (cookie: string, qs = '') =>
    (
      await call({ method: 'GET', url: `/access-requests?pageSize=100${qs}`, slug: 'acme', cookie })
    ).json();
  const pendingFor = async (email: string, cookie = ownerC, spaceKey?: string) =>
    (await inbox(cookie)).items.find(
      (r: { requesterEmail: string; spaceKey: string }) =>
        r.requesterEmail === email && (!spaceKey || r.spaceKey === spaceKey),
    );

  it('answers identically whether or not the space exists, so keys cannot be probed', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    const open = await mk(aliceC, { visibility: 'open' });
    const a = await request(priv.key, daveC, 'please');
    const b = await request('NOSUCHKEY', daveC);
    const c = await request(open.key, daveC);
    const d = await request(priv.key, aliceC); // already a member
    for (const r of [a, b, c, d]) expect(r.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(c.json()).toEqual(a.json());
    expect(d.json()).toEqual(a.json());

    const db = adminDb();
    try {
      const rows = await db.db.global.all.spaceAccessRequests.find({ userId: dave.id });
      // Only the genuine request exists.
      expect(rows.filter((r) => r.spaceId === priv.id)).toHaveLength(1);
      expect(rows.some((r) => r.spaceId === open.id)).toBe(false);
      expect(
        await db.db.global.all.spaceAccessRequests.find({ userId: alice.id }),
      ).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it('ignores org admins, archived spaces and duplicate pending requests', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    await request(priv.key, adminC);
    await request(priv.key, bobC);
    await request(priv.key, bobC);
    await request(priv.key.toLowerCase(), bobC);
    const db = adminDb();
    try {
      const rows = await db.db.global.all.spaceAccessRequests.find({ spaceId: priv.id });
      expect(rows.map((r) => r.userId)).toEqual([bob.id]);
    } finally {
      await db.close();
    }
    const archived = await mk(aliceC, { visibility: 'private' });
    await call({
      method: 'POST',
      url: `/spaces/${archived.id}/archive`,
      slug: 'acme',
      cookie: aliceC,
    });
    await request(archived.key, carolC);
    const db2 = adminDb();
    try {
      expect(
        await db2.db.global.all.spaceAccessRequests.find({ spaceId: archived.id }),
      ).toHaveLength(0);
    } finally {
      await db2.close();
    }
  });

  it('requires a session and enforces the tenant', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    expect(
      (
        await call({
          method: 'POST',
          url: `/spaces/${priv.key}/access-requests`,
          slug: 'acme',
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    // From another workspace the key simply does not exist: same generic answer, no request.
    const res = await call({
      method: 'POST',
      url: `/spaces/${priv.key}/access-requests`,
      slug: 'globex',
      cookie: globexC,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const db = adminDb();
    try {
      expect(
        await db.db.global.all.spaceAccessRequests.find({ spaceId: priv.id }),
      ).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it('shows requests only to admins of that space and to workspace admins', async () => {
    const mine = await mk(aliceC, { visibility: 'private' });
    const theirs = await mk(bobC, { visibility: 'private' });
    const requester = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('xreq'),
      role: 'member',
    });
    const rc = await signInAs(t.app, 'acme', requester);
    await request(mine.key, rc, 'let me in');

    const asAlice = await pendingFor(requester.email, aliceC, mine.key);
    expect(asAlice).toMatchObject({ spaceKey: mine.key, message: 'let me in', status: 'pending' });
    expect(await pendingFor(requester.email, bobC, mine.key)).toBeUndefined(); // admin of a different space
    expect(await pendingFor(requester.email, carolC, mine.key)).toBeUndefined(); // ordinary member
    expect(await pendingFor(requester.email, adminC, mine.key)).toBeTruthy();
    expect(await pendingFor(requester.email, ownerC, mine.key)).toBeTruthy();
    expect(theirs.id).toBeTruthy();

    // Other workspaces never see it.
    expect(
      (await call({ method: 'GET', url: '/access-requests', slug: 'globex', cookie: globexC }))
        .json()
        .items.some((r: { requesterEmail: string }) => r.requesterEmail === requester.email),
    ).toBe(false);
  });

  it("shows requesters only the key they asked for, never the space's name", async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    await request(priv.key, daveC);
    const mine = (
      await call({
        method: 'GET',
        url: '/access-requests?mine=true&status=all',
        slug: 'acme',
        cookie: daveC,
      })
    ).json();
    const row = mine.items.find((r: { spaceKey: string }) => r.spaceKey === priv.key);
    expect(row).toMatchObject({
      status: 'pending',
      spaceName: null,
      spaceId: null,
      spaceIcon: null,
    });
  });

  it('approves with a chosen role: access is immediate, and both actions are audited', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    const person = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('xapp'),
      role: 'member',
    });
    const pc = await signInAs(t.app, 'acme', person);
    expect(
      (await call({ method: 'GET', url: `/spaces/${priv.id}`, slug: 'acme', cookie: pc }))
        .statusCode,
    ).toBe(404);
    await request(priv.key, pc);
    const req = await pendingFor(person.email, aliceC, priv.key);
    const res = await call({
      method: 'POST',
      url: `/access-requests/${req.id}/approve`,
      slug: 'acme',
      cookie: aliceC,
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);

    expect(
      (await call({ method: 'GET', url: `/spaces/${priv.id}`, slug: 'acme', cookie: pc })).json()
        .myRole,
    ).toBe('viewer');
    expect(await audit('space.access_approved', priv.id)).toHaveLength(1);
    expect(await audit('space.member_added', priv.id)).toHaveLength(2); // creator + approved person
    // Handled requests cannot be handled twice, and leave the inbox.
    expect(
      (
        await call({
          method: 'POST',
          url: `/access-requests/${req.id}/approve`,
          slug: 'acme',
          cookie: aliceC,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect(await pendingFor(person.email, aliceC, priv.key)).toBeUndefined();
    const done = await inbox(aliceC, '&status=approved');
    expect(done.items.find((r: { id: string }) => r.id === req.id)).toMatchObject({
      grantedRole: 'viewer',
      decidedByName: expect.any(String),
    });
  });

  it('declining grants nothing and the person may ask again', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    await request(priv.key, daveC);
    const req = await pendingFor(dave.email, aliceC, priv.key);
    expect(
      (
        await call({
          method: 'POST',
          url: `/access-requests/${req.id}/decline`,
          slug: 'acme',
          cookie: aliceC,
          payload: { reason: 'not now' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'GET', url: `/spaces/${priv.id}`, slug: 'acme', cookie: daveC }))
        .statusCode,
    ).toBe(404);
    const [entry] = await audit('space.access_declined', priv.id);
    expect(entry!.after).toMatchObject({ reason: 'not now' });
    await request(priv.key, daveC);
    expect(await pendingFor(dave.email, aliceC, priv.key)).toBeTruthy();
  });

  it('lets requesters cancel their own pending request, and nobody else', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    await request(priv.key, daveC);
    const req = await pendingFor(dave.email, aliceC, priv.key);
    expect(
      (
        await call({
          method: 'POST',
          url: `/access-requests/${req.id}/cancel`,
          slug: 'acme',
          cookie: bobC,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'POST',
          url: `/access-requests/${req.id}/cancel`,
          slug: 'acme',
          cookie: daveC,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call({
          method: 'POST',
          url: `/access-requests/${req.id}/cancel`,
          slug: 'acme',
          cookie: daveC,
        })
      ).statusCode,
    ).toBe(409);
    expect(await pendingFor(dave.email, aliceC, priv.key)).toBeUndefined();
  });

  it('denies decisions to space members, outsiders and other workspaces', async () => {
    const priv = await mk(aliceC, {
      visibility: 'private',
      members: [{ type: 'user', id: bob.id, role: 'member' }],
    });
    await request(priv.key, daveC);
    const req = await pendingFor(dave.email, aliceC, priv.key);
    const approve = (cookie: string, slug = 'acme') =>
      call({
        method: 'POST',
        url: `/access-requests/${req.id}/approve`,
        slug,
        cookie,
        payload: {},
      });
    expect((await approve(bobC)).statusCode).toBe(403); // space member
    expect((await approve(carolC)).statusCode).toBe(404); // outsider learns nothing
    expect((await approve(daveC)).statusCode).toBe(404); // the requester cannot approve themselves
    expect((await approve(globexC, 'globex')).statusCode).toBe(404);
    expect(
      (
        await call({
          method: 'POST',
          url: `/access-requests/${req.id}/decline`,
          slug: 'acme',
          cookie: bobC,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'GET', url: `/spaces/${priv.id}`, slug: 'acme', cookie: daveC }))
        .statusCode,
    ).toBe(404);
    expect((await approve(adminC)).statusCode).toBe(200);
  });

  it('refuses to approve a person who is no longer active', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    const leaver = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('xleave'),
      role: 'member',
    });
    const lc = await signInAs(t.app, 'acme', leaver);
    await request(priv.key, lc);
    const req = await pendingFor(leaver.email, aliceC, priv.key);
    await call({
      method: 'POST',
      url: `/members/${leaver.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    const res = await call({
      method: 'POST',
      url: `/access-requests/${req.id}/approve`,
      slug: 'acme',
      cookie: aliceC,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('requester_inactive');
  });

  it('works for group-based access too: approve, then it follows the person', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    await request(priv.key, carolC);
    const req = await pendingFor(carol.email, aliceC, priv.key);
    await call({
      method: 'POST',
      url: `/access-requests/${req.id}/approve`,
      slug: 'acme',
      cookie: aliceC,
      payload: { role: 'member' },
    });
    const g = await mkGroup([carol.id]);
    await add(priv.id, aliceC, [{ type: 'group', id: g.id, role: 'admin' }]);
    const row = await rowFor(priv.id, carol.id);
    expect(row).toMatchObject({ role: 'member', inheritedRole: 'admin', effectiveRole: 'admin' });
  });
});

describe('per-space audit log', () => {
  it('records membership and request activity for the space, visible to its admins only', async () => {
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [{ type: 'user', id: bob.id, role: 'member' }],
    });
    const res = (
      await call({ method: 'GET', url: `/spaces/${s.id}/audit-logs`, slug: 'acme', cookie: aliceC })
    ).json();
    const actions = res.items.map((i: { action: string }) => i.action);
    expect(actions).toContain('space.created');
    expect(actions).toContain('space.member_added');
    expect(res.items.every((i: { targetId: string }) => i.targetId === s.id)).toBe(true);

    expect(
      (await call({ method: 'GET', url: `/spaces/${s.id}/audit-logs`, slug: 'acme', cookie: bobC }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'GET',
          url: `/spaces/${s.id}/audit-logs`,
          slug: 'acme',
          cookie: daveC,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'GET',
          url: `/spaces/${s.id}/audit-logs`,
          slug: 'acme',
          cookie: adminC,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call({
          method: 'GET',
          url: `/spaces/${s.id}/audit-logs`,
          slug: 'globex',
          cookie: globexC,
        })
      ).statusCode,
    ).toBe(404);

    const filtered = (
      await call({
        method: 'GET',
        url: `/spaces/${s.id}/audit-logs?action=space.created`,
        slug: 'acme',
        cookie: aliceC,
      })
    ).json();
    expect(filtered.items.map((i: { action: string }) => i.action)).toEqual(['space.created']);
  });
});

describe('integrity (unique index)', () => {
  it('allows one pending request per person per space', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    const db = adminDb();
    try {
      const requests = db.db.global.forOrg(ids.acme).spaceAccessRequests;
      await requests.insert({ spaceId: priv.id, userId: dave.id });
      await expect(requests.insert({ spaceId: priv.id, userId: dave.id })).rejects.toMatchObject({
        code: 11000,
      });
      // A decided request does not block a new pending one.
      await requests.updateMany({ spaceId: priv.id }, { status: 'declined' });
      await requests.insert({ spaceId: priv.id, userId: dave.id });
      expect(await db.db.global.all.spaceMembers.find({ spaceId: priv.id })).toHaveLength(1);
    } finally {
      await db.close();
    }
  });
});
