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
} from './helpers.js';
import { auditLogs, spaceMembers, spaceStars, spaces } from '../src/db/schema.js';

const t = makeApp();
const call = caller(t.app);
let ids: Awaited<ReturnType<typeof tenantIds>>;
type U = Awaited<ReturnType<typeof ensureUser>>;
let owner: U, admin: U, alice: U, bob: U, carol: U, globexOwner: U;
let ownerC: string, adminC: string, aliceC: string, bobC: string, carolC: string, globexC: string;

let seq = 0;
const key = () =>
  `K${(Date.now() % 100000).toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`.slice(
    0,
    10,
  );

type Created = { id: string; key: string; name: string };
async function mk(
  cookie: string,
  extra: Record<string, unknown> = {},
  slug = 'acme',
): Promise<Created> {
  const k = key();
  const res = await call({
    method: 'POST',
    url: '/spaces',
    slug,
    cookie,
    payload: { key: k, name: `Space ${k}`, ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const get = (id: string, cookie?: string, slug = 'acme') =>
  call({ method: 'GET', url: `/spaces/${id}`, slug, cookie });
const patch = (id: string, cookie: string, payload: object, slug = 'acme') =>
  call({ method: 'PATCH', url: `/spaces/${id}`, slug, cookie, payload });

async function auditFor(action: string, targetId: string) {
  const a = adminDb();
  try {
    return await a.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId)));
  } finally {
    await a.close();
  }
}

beforeAll(async () => {
  ids = await tenantIds();
  owner = await ensureUser({ orgId: ids.acme, email: uniqueEmail('sown'), role: 'owner' });
  admin = await ensureUser({ orgId: ids.acme, email: uniqueEmail('sadm'), role: 'admin' });
  alice = await ensureUser({ orgId: ids.acme, email: uniqueEmail('sali'), role: 'member' });
  bob = await ensureUser({ orgId: ids.acme, email: uniqueEmail('sbob'), role: 'member' });
  carol = await ensureUser({ orgId: ids.acme, email: uniqueEmail('scar'), role: 'member' });
  globexOwner = await ensureUser({
    orgId: ids.globex,
    email: uniqueEmail('sglo', 'globex.test'),
    role: 'owner',
  });
  ownerC = await signInAs(t.app, 'acme', owner);
  adminC = await signInAs(t.app, 'acme', admin);
  aliceC = await signInAs(t.app, 'acme', alice);
  bobC = await signInAs(t.app, 'acme', bob);
  carolC = await signInAs(t.app, 'acme', carol);
  globexC = await signInAs(t.app, 'globex', globexOwner);
  await t.app.ready();
});
afterAll(() => t.close());

describe('creating spaces', () => {
  it('lets any member create a space and makes the creator its admin', async () => {
    const s = await mk(aliceC, { description: 'Hello', icon: 'rocket', visibility: 'private' });
    const d = (await get(s.id, aliceC)).json();
    expect(d).toMatchObject({
      key: s.key,
      visibility: 'private',
      status: 'active',
      icon: 'rocket',
      myRole: 'admin',
      ownerId: alice.id,
    });
    expect(d.members).toContainEqual(
      expect.objectContaining({ type: 'user', id: alice.id, role: 'admin' }),
    );
    expect(d.permissions).toEqual({ edit: true, manageMembers: true, delete: false });
    expect(await auditFor('space.created', s.id)).toHaveLength(1);
  });

  it('denies anonymous callers and validates input', async () => {
    expect(
      (
        await call({
          method: 'POST',
          url: '/spaces',
          slug: 'acme',
          payload: { key: 'AB', name: 'x' },
        })
      ).statusCode,
    ).toBe(401);
    for (const bad of [
      { key: 'A', name: 'x' },
      { key: '1AB', name: 'x' },
      { key: 'ABCDEFGHIJK', name: 'x' },
      { key: 'A B', name: 'x' },
      { key: 'AB-C', name: 'x' },
      { key: 'new', name: 'x' }, // reserved: it is the create page's URL
      { key: 'ABC', name: '' },
      { key: 'ABC', name: 'x', icon: 'not-an-icon' },
      { key: 'ABC', name: 'x', visibility: 'secret' },
    ]) {
      const res = await call({
        method: 'POST',
        url: '/spaces',
        slug: 'acme',
        cookie: aliceC,
        payload: bad,
      });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('upper-cases keys and keeps them unique per workspace', async () => {
    const k = key();
    const first = await call({
      method: 'POST',
      url: '/spaces',
      slug: 'acme',
      cookie: aliceC,
      payload: { key: k.toLowerCase(), name: 'One' },
    });
    expect(first.json().key).toBe(k);
    const dup = await call({
      method: 'POST',
      url: '/spaces',
      slug: 'acme',
      cookie: bobC,
      payload: { key: k, name: 'Two' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: 'key_taken', fields: { key: expect.any(String) } });
    // Another workspace may use the same key.
    const other = await call({
      method: 'POST',
      url: '/spaces',
      slug: 'globex',
      cookie: globexC,
      payload: { key: k, name: 'Three' },
    });
    expect(other.statusCode).toBe(200);
  });

  it('adds chosen users and groups with their roles, and forces the creator to admin', async () => {
    const g = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'acme',
        cookie: adminC,
        payload: { name: `Crew ${key()}` },
      })
    ).json();
    const s = await mk(aliceC, {
      members: [
        { type: 'user', id: bob.id, role: 'viewer' },
        { type: 'group', id: g.id, role: 'member' },
        { type: 'user', id: alice.id, role: 'viewer' }, // tries to demote themselves
      ],
    });
    const d = (await get(s.id, aliceC)).json();
    expect(d.memberCount).toBe(3);
    expect(d.myRole).toBe('admin');
    const roles = Object.fromEntries(
      d.members.map((m: { id: string; role: string }) => [m.id, m.role]),
    );
    expect(roles).toMatchObject({ [bob.id]: 'viewer', [g.id]: 'member', [alice.id]: 'admin' });
  });

  it('rejects people, deactivated people and groups from outside the workspace', async () => {
    const body = (members: unknown[]) => ({ key: key(), name: 'Bad', members });
    const send = (members: unknown[]) =>
      call({
        method: 'POST',
        url: '/spaces',
        slug: 'acme',
        cookie: aliceC,
        payload: body(members),
      });
    expect((await send([{ type: 'user', id: globexOwner.id, role: 'member' }])).statusCode).toBe(
      400,
    );
    const theirGroup = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'globex',
        cookie: globexC,
        payload: { name: `G ${key()}` },
      })
    ).json();
    expect((await send([{ type: 'group', id: theirGroup.id, role: 'member' }])).statusCode).toBe(
      400,
    );
    const gone = await ensureUser({ orgId: ids.acme, email: uniqueEmail('sgone'), role: 'member' });
    await call({
      method: 'POST',
      url: `/members/${gone.id}/deactivate`,
      slug: 'acme',
      cookie: adminC,
    });
    expect((await send([{ type: 'user', id: gone.id, role: 'member' }])).statusCode).toBe(400);
  });
});

describe('visibility', () => {
  it('hides private spaces from non-members (list, detail, key lookup), shows open ones', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    const open = await mk(aliceC, { visibility: 'open' });

    expect((await get(priv.id, bobC)).statusCode).toBe(404);
    expect((await get(priv.key, bobC)).statusCode).toBe(404);
    expect((await get(open.id, bobC)).statusCode).toBe(200);

    const list = (
      await call({ method: 'GET', url: '/spaces?pageSize=100', slug: 'acme', cookie: bobC })
    ).json();
    const seen = list.items.map((i: { id: string }) => i.id);
    expect(seen).toContain(open.id);
    expect(seen).not.toContain(priv.id);
    // No hint of the hidden space leaks through search or counts.
    const search = (
      await call({ method: 'GET', url: `/spaces?q=${priv.key}`, slug: 'acme', cookie: bobC })
    ).json();
    expect(search.total).toBe(0);
  });

  it('shows private spaces to direct members, group members, org admins and owners', async () => {
    const g = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'acme',
        cookie: adminC,
        payload: { name: `Vis ${key()}` },
      })
    ).json();
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [carol.id] },
    });
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [
        { type: 'user', id: bob.id, role: 'viewer' },
        { type: 'group', id: g.id, role: 'member' },
      ],
    });
    for (const c of [aliceC, bobC, carolC, adminC, ownerC])
      expect((await get(s.id, c)).statusCode).toBe(200);
    const stranger = await ensureUser({
      orgId: ids.acme,
      email: uniqueEmail('sstr'),
      role: 'member',
    });
    expect((await get(s.id, await signInAs(t.app, 'acme', stranger))).statusCode).toBe(404);
  });

  it('computes the highest role from direct and group membership', async () => {
    const g = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'acme',
        cookie: adminC,
        payload: { name: `Role ${key()}` },
      })
    ).json();
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [bob.id, carol.id] },
    });
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [
        { type: 'user', id: bob.id, role: 'viewer' }, // direct viewer ...
        { type: 'group', id: g.id, role: 'admin' }, // ... but admin through the group
        { type: 'user', id: carol.id, role: 'member' }, // direct member, group admin wins
      ],
    });
    expect((await get(s.id, bobC)).json().myRole).toBe('admin');
    expect((await get(s.id, carolC)).json().myRole).toBe('admin');
    // Group-derived admin can edit.
    expect((await patch(s.id, bobC, { name: 'By group admin' })).statusCode).toBe(200);

    // Direct viewer + group member => member (highest), not viewer.
    const s2 = await mk(aliceC, {
      visibility: 'private',
      members: [
        { type: 'user', id: bob.id, role: 'viewer' },
        { type: 'group', id: g.id, role: 'member' },
      ],
    });
    expect((await get(s2.id, bobC)).json().myRole).toBe('member');
  });

  it('stops a user seeing a private space once they lose the group that gave access', async () => {
    const g = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'acme',
        cookie: adminC,
        payload: { name: `Lose ${key()}` },
      })
    ).json();
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [carol.id] },
    });
    const s = await mk(aliceC, {
      visibility: 'private',
      members: [{ type: 'group', id: g.id, role: 'member' }],
    });
    expect((await get(s.id, carolC)).statusCode).toBe(200);
    await call({
      method: 'PUT',
      url: `/groups/${g.id}/members`,
      slug: 'acme',
      cookie: adminC,
      payload: { userIds: [] },
    });
    expect((await get(s.id, carolC)).statusCode).toBe(404);
  });
});

describe('listing and filters', () => {
  it('filters by visibility, status, mine and search, and paginates', async () => {
    const tag = `T${key()}`;
    const a = await mk(aliceC, { name: `${tag} alpha`, visibility: 'open' });
    const b = await mk(aliceC, { name: `${tag} beta`, visibility: 'private' });
    const c = await mk(bobC, { name: `${tag} gamma`, visibility: 'open' });
    await call({ method: 'POST', url: `/spaces/${c.id}/archive`, slug: 'acme', cookie: bobC });

    const list = async (qs: string, cookie = aliceC) =>
      (
        await call({
          method: 'GET',
          url: `/spaces?q=${encodeURIComponent(tag)}&${qs}`,
          slug: 'acme',
          cookie,
        })
      ).json();
    expect((await list('')).items.map((i: { id: string }) => i.id).sort()).toEqual(
      [a.id, b.id].sort(),
    ); // archived hidden by default
    expect((await list('visibility=private')).items.map((i: { id: string }) => i.id)).toEqual([
      b.id,
    ]);
    expect(
      (await list('visibility=open&status=all')).items.map((i: { id: string }) => i.id).sort(),
    ).toEqual([a.id, c.id].sort());
    expect((await list('status=archived')).items.map((i: { id: string }) => i.id)).toEqual([c.id]);
    expect((await list('mine=true')).items.map((i: { id: string }) => i.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(
      (await list('mine=true&status=all', bobC)).items.map((i: { id: string }) => i.id),
    ).toEqual([c.id]);

    const page = await list('status=all&pageSize=2&page=2');
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(
      (await call({ method: 'GET', url: '/spaces?q=%25', slug: 'acme', cookie: aliceC })).json()
        .total,
    ).toBe(0);
  });

  it('looks a space up by key', async () => {
    const s = await mk(aliceC);
    const res = (
      await call({
        method: 'GET',
        url: `/spaces?key=${s.key.toLowerCase()}`,
        slug: 'acme',
        cookie: aliceC,
      })
    ).json();
    expect(res.items.map((i: { id: string }) => i.id)).toEqual([s.id]);
  });

  it('never lists another workspace’s spaces', async () => {
    const mine = await mk(aliceC);
    const theirs = (
      await call({
        method: 'GET',
        url: '/spaces?pageSize=100&status=all',
        slug: 'globex',
        cookie: globexC,
      })
    ).json();
    expect(theirs.items.some((i: { id: string }) => i.id === mine.id)).toBe(false);
  });
});

describe('editing', () => {
  it('lets space admins and org admins edit; denies members, viewers and outsiders', async () => {
    const s = await mk(aliceC, {
      members: [
        { type: 'user', id: bob.id, role: 'member' },
        { type: 'user', id: carol.id, role: 'viewer' },
      ],
    });
    const ok = await patch(s.id, aliceC, {
      name: 'Renamed',
      description: 'New desc',
      icon: 'code',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Renamed', description: 'New desc', icon: 'code' });
    expect(await auditFor('space.updated', s.id)).toHaveLength(1);

    expect((await patch(s.id, bobC, { name: 'Nope' })).statusCode).toBe(403); // space member
    expect((await patch(s.id, carolC, { name: 'Nope' })).statusCode).toBe(403); // space viewer
    const stranger = await signInAs(
      t.app,
      'acme',
      await ensureUser({ orgId: ids.acme, email: uniqueEmail('sst2'), role: 'member' }),
    );
    expect((await patch(s.id, stranger, { name: 'Nope' })).statusCode).toBe(403); // org member on an open space
    expect((await patch(s.id, adminC, { name: 'By org admin' })).statusCode).toBe(200);
    expect((await patch(s.id, ownerC, { name: 'By owner' })).statusCode).toBe(200);
  });

  it('records visibility changes and applies them to who can see the space', async () => {
    const s = await mk(aliceC, { visibility: 'open' });
    expect((await get(s.id, bobC)).statusCode).toBe(200);
    const res = await patch(s.id, aliceC, { visibility: 'private' });
    expect(res.json().visibility).toBe('private');
    expect((await get(s.id, bobC)).statusCode).toBe(404);
    const [entry] = await auditFor('space.updated', s.id);
    expect(entry!.before).toMatchObject({ visibility: 'open' });
    expect(entry!.after).toMatchObject({ visibility: 'private' });
  });

  it('never changes the key, and validates input', async () => {
    const s = await mk(aliceC);
    expect((await patch(s.id, aliceC, { key: 'NEWKEY' })).statusCode).toBe(400);
    expect((await patch(s.id, aliceC, {})).statusCode).toBe(400);
    expect((await patch(s.id, aliceC, { name: '' })).statusCode).toBe(400);
    expect((await patch(s.id, aliceC, { icon: 'nope' })).statusCode).toBe(400);
    expect((await get(s.id, aliceC)).json().key).toBe(s.key);
  });

  it('cannot reach spaces in another workspace', async () => {
    const s = await mk(aliceC);
    expect((await patch(s.id, globexC, { name: 'Hack' }, 'globex')).statusCode).toBe(404);
    expect((await get(s.id, globexC, 'globex')).statusCode).toBe(404);
    expect((await get(s.id, aliceC)).json().name).toBe(s.name);
  });
});

describe('archive and restore', () => {
  it('archives and restores, blocks edits while archived, and is idempotent', async () => {
    const s = await mk(aliceC);
    const arch = await call({
      method: 'POST',
      url: `/spaces/${s.id}/archive`,
      slug: 'acme',
      cookie: aliceC,
    });
    expect(arch.json().status).toBe('archived');
    expect(
      (await call({ method: 'POST', url: `/spaces/${s.id}/archive`, slug: 'acme', cookie: aliceC }))
        .statusCode,
    ).toBe(200);
    expect(await auditFor('space.archived', s.id)).toHaveLength(1); // second call added nothing

    const blocked = await patch(s.id, aliceC, { name: 'While archived' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('archived');

    const back = await call({
      method: 'POST',
      url: `/spaces/${s.id}/restore`,
      slug: 'acme',
      cookie: aliceC,
    });
    expect(back.json().status).toBe('active');
    expect((await patch(s.id, aliceC, { name: 'After restore' })).statusCode).toBe(200);
    expect(await auditFor('space.restored', s.id)).toHaveLength(1);
  });

  it('is limited to space admins and org admins, and invisible across tenants', async () => {
    const s = await mk(aliceC, { members: [{ type: 'user', id: bob.id, role: 'member' }] });
    expect(
      (await call({ method: 'POST', url: `/spaces/${s.id}/archive`, slug: 'acme', cookie: bobC }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          url: `/spaces/${s.id}/archive`,
          slug: 'globex',
          cookie: globexC,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'POST', url: `/spaces/${s.id}/archive`, slug: 'acme', cookie: adminC }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call({ method: 'POST', url: `/spaces/${s.id}/restore`, slug: 'acme', cookie: bobC }))
        .statusCode,
    ).toBe(403);
  });

  it('still shows archived spaces to people with access', async () => {
    const s = await mk(aliceC);
    await call({ method: 'POST', url: `/spaces/${s.id}/archive`, slug: 'acme', cookie: aliceC });
    expect((await get(s.id, aliceC)).json().status).toBe('archived');
  });
});

describe('deleting', () => {
  it('is org-admin only and requires typing the key', async () => {
    const s = await mk(aliceC);
    const del = (cookie: string, confirm?: string) =>
      call({
        method: 'DELETE',
        url: `/spaces/${s.id}${confirm ? `?confirm=${confirm}` : ''}`,
        slug: 'acme',
        cookie,
      });
    expect((await del(aliceC, s.key)).statusCode).toBe(403); // space admin is not enough
    const noConfirm = await del(adminC);
    expect(noConfirm.statusCode).toBe(400);
    expect(noConfirm.json().code).toBe('confirmation_required');
    expect((await del(adminC, 'WRONG')).statusCode).toBe(400);
    expect((await get(s.id, aliceC)).statusCode).toBe(200); // nothing happened

    expect((await del(adminC, s.key.toLowerCase())).statusCode).toBe(200);
    expect((await get(s.id, aliceC)).statusCode).toBe(404);
    expect((await get(s.id, adminC)).statusCode).toBe(404);
    expect(await auditFor('space.deleted', s.id)).toHaveLength(1);
  });

  it('never lets a deleted space’s key be reused, and removes it from lists and stars', async () => {
    const s = await mk(aliceC);
    await call({
      method: 'POST',
      url: `/spaces/${s.id}/star`,
      slug: 'acme',
      cookie: aliceC,
      payload: {},
    });
    await call({
      method: 'DELETE',
      url: `/spaces/${s.id}?confirm=${s.key}`,
      slug: 'acme',
      cookie: ownerC,
    });

    const reuse = await call({
      method: 'POST',
      url: '/spaces',
      slug: 'acme',
      cookie: bobC,
      payload: { key: s.key, name: 'Sneaky' },
    });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().code).toBe('key_taken');

    for (const c of [aliceC, adminC]) {
      const list = (
        await call({
          method: 'GET',
          url: '/spaces?pageSize=100&status=all',
          slug: 'acme',
          cookie: c,
        })
      ).json();
      expect(list.items.some((i: { id: string }) => i.id === s.id)).toBe(false);
    }
    const a = adminDb();
    try {
      expect(await a.db.select().from(spaceStars).where(eq(spaceStars.spaceId, s.id))).toHaveLength(
        0,
      );
      expect(
        (await a.db.select().from(spaces).where(eq(spaces.id, s.id)))[0]!.deletedAt,
      ).not.toBeNull();
    } finally {
      await a.close();
    }
  });

  it('cannot delete another workspace’s space', async () => {
    const s = await mk(aliceC);
    expect(
      (
        await call({
          method: 'DELETE',
          url: `/spaces/${s.id}?confirm=${s.key}`,
          slug: 'globex',
          cookie: globexC,
        })
      ).statusCode,
    ).toBe(404);
    expect((await get(s.id, aliceC)).statusCode).toBe(200);
  });
});

describe('starring', () => {
  it('stars and unstars per user, with toggle, and filters the list', async () => {
    const s = await mk(aliceC);
    const star = (cookie: string, body: object = {}) =>
      call({ method: 'POST', url: `/spaces/${s.id}/star`, slug: 'acme', cookie, payload: body });
    expect((await star(aliceC)).json()).toEqual({ starred: true }); // toggle on
    expect((await get(s.id, aliceC)).json().starred).toBe(true);
    expect((await get(s.id, bobC)).json().starred).toBe(false); // personal
    const starred = (
      await call({
        method: 'GET',
        url: '/spaces?starred=true&pageSize=100',
        slug: 'acme',
        cookie: aliceC,
      })
    ).json();
    expect(starred.items.map((i: { id: string }) => i.id)).toContain(s.id);
    expect((await star(aliceC, { starred: true })).json()).toEqual({ starred: true }); // idempotent
    expect((await star(aliceC)).json()).toEqual({ starred: false }); // toggle off
    expect(
      (
        await call({
          method: 'GET',
          url: '/spaces?starred=true&pageSize=100',
          slug: 'acme',
          cookie: aliceC,
        })
      )
        .json()
        .items.some((i: { id: string }) => i.id === s.id),
    ).toBe(false);
  });

  it('cannot star a space the caller cannot see, or one in another workspace', async () => {
    const priv = await mk(aliceC, { visibility: 'private' });
    expect(
      (
        await call({
          method: 'POST',
          url: `/spaces/${priv.id}/star`,
          slug: 'acme',
          cookie: bobC,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'POST',
          url: `/spaces/${priv.id}/star`,
          slug: 'globex',
          cookie: globexC,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('database guarantees', () => {
  it('rejects members that cross tenants and duplicate keys, even for deleted spaces', async () => {
    const s = await mk(aliceC);
    const a = adminDb();
    try {
      await expect(
        a.db.insert(spaceMembers).values({
          spaceId: s.id,
          orgId: ids.globex,
          principalType: 'user',
          principalId: globexOwner.id,
          spaceRole: 'member',
        }),
      ).rejects.toThrow();
      await expect(
        a.db.insert(spaces).values({ orgId: ids.acme, key: s.key, name: 'dupe' }),
      ).rejects.toThrow();
      await expect(
        a.db.insert(spaces).values({ orgId: ids.acme, key: 'bad key', name: 'x' }),
      ).rejects.toThrow();
    } finally {
      await a.close();
    }
  });
});
