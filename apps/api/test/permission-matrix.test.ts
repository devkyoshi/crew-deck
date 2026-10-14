import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

/**
 * Brief section 5, one test per row, exercised through the real routes for every column:
 * owner, org admin, org member, space admin, space member, space viewer.
 * Space roles belong to people whose org role is "member".
 */
const t = makeApp();
const call = caller(t.app);

const ACTORS = [
  'owner',
  'orgAdmin',
  'orgMember',
  'spaceAdmin',
  'spaceMember',
  'spaceViewer',
] as const;
type ActorName = (typeof ACTORS)[number];
type Verdict = Record<ActorName, boolean>;

let cookies: Record<ActorName, string>;
let users: Record<ActorName, { id: string; email: string }>;
let privateSpace: { id: string; key: string };
let hiddenSpace: { id: string; key: string }; // private, none of the three space roles belong to it
let openSpace: { id: string; key: string };
let ids: Awaited<ReturnType<typeof tenantIds>>;

const ok = (status: number) => status === 200;

/** Runs `fn` as each actor and returns who succeeded. */
async function run(fn: (actor: ActorName, cookie: string) => Promise<number>) {
  const out = {} as Verdict;
  for (const a of ACTORS) out[a] = ok(await fn(a, cookies[a]));
  return out;
}

const only = (...allowed: ActorName[]): Verdict =>
  Object.fromEntries(ACTORS.map((a) => [a, allowed.includes(a)])) as Verdict;

const status = async (p: ReturnType<typeof call>) => (await p).statusCode;

async function freshMember(role: 'member' | 'admin' | 'owner' = 'member') {
  return ensureUser({ orgId: ids.acme, email: uniqueEmail('mx'), role });
}

beforeAll(async () => {
  ids = await tenantIds();
  const mk = async (name: ActorName, role: 'owner' | 'admin' | 'member') =>
    [
      name,
      await ensureUser({ orgId: ids.acme, email: uniqueEmail(`mtx-${name.toLowerCase()}`), role }),
    ] as const;
  const made = await Promise.all([
    mk('owner', 'owner'),
    mk('orgAdmin', 'admin'),
    mk('orgMember', 'member'),
    mk('spaceAdmin', 'member'),
    mk('spaceMember', 'member'),
    mk('spaceViewer', 'member'),
  ]);
  users = Object.fromEntries(made) as unknown as typeof users;
  cookies = Object.fromEntries(
    await Promise.all(made.map(async ([n, u]) => [n, await signInAs(t.app, 'acme', u)])),
  ) as typeof cookies;

  const create = async (visibility: 'open' | 'private', members: object[]) => {
    const res = await call({
      method: 'POST',
      url: '/spaces',
      slug: 'acme',
      cookie: cookies.owner,
      payload: {
        key: `M${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        name: 'Matrix',
        visibility,
        members,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const roleRows = [
    { type: 'user', id: users.spaceAdmin.id, role: 'admin' },
    { type: 'user', id: users.spaceMember.id, role: 'member' },
    { type: 'user', id: users.spaceViewer.id, role: 'viewer' },
  ];
  privateSpace = await create('private', roleRows);
  openSpace = await create('open', roleRows);
  hiddenSpace = await create('private', []);
  await t.app.ready();
});
afterAll(() => t.close());

describe('Section 5 matrix: org-level actions', () => {
  it('Invite members: owner and org admin only', async () => {
    expect(
      await run((_, c) =>
        status(
          call({
            method: 'POST',
            url: '/invitations',
            slug: 'acme',
            cookie: c,
            payload: { emails: [uniqueEmail('inv')] },
          }),
        ),
      ),
    ).toEqual(only('owner', 'orgAdmin'));
  });

  it('Deactivate members: owner and org admin only', async () => {
    const verdict = {} as Verdict;
    for (const a of ACTORS) {
      const target = await freshMember();
      verdict[a] = ok(
        await status(
          call({
            method: 'POST',
            url: `/members/${target.id}/deactivate`,
            slug: 'acme',
            cookie: cookies[a],
          }),
        ),
      );
    }
    expect(verdict).toEqual(only('owner', 'orgAdmin'));
  });

  it('Change org roles: owner and org admin, but admins cannot touch owners', async () => {
    const verdict = {} as Verdict;
    for (const a of ACTORS) {
      const target = await freshMember();
      verdict[a] = ok(
        await status(
          call({
            method: 'PATCH',
            url: `/members/${target.id}`,
            slug: 'acme',
            cookie: cookies[a],
            payload: { orgRole: 'admin' },
          }),
        ),
      );
    }
    expect(verdict).toEqual(only('owner', 'orgAdmin'));

    // "Yes (not owners)": an org admin cannot change an owner, an owner can.
    const ownerTarget = await freshMember('owner');
    const asAdmin = await status(
      call({
        method: 'PATCH',
        url: `/members/${ownerTarget.id}`,
        slug: 'acme',
        cookie: cookies.orgAdmin,
        payload: { orgRole: 'member' },
      }),
    );
    expect(asAdmin).toBe(403);
    const asOwner = await status(
      call({
        method: 'PATCH',
        url: `/members/${ownerTarget.id}`,
        slug: 'acme',
        cookie: cookies.owner,
        payload: { orgRole: 'member' },
      }),
    );
    expect(asOwner).toBe(200);
  });

  it('Create / edit groups: owner and org admin only', async () => {
    const create = await run((a, c) =>
      status(
        call({
          method: 'POST',
          url: '/groups',
          slug: 'acme',
          cookie: c,
          payload: { name: `Matrix ${a} ${Math.random().toString(36).slice(2, 7)}` },
        }),
      ),
    );
    expect(create).toEqual(only('owner', 'orgAdmin'));

    const g = (
      await call({
        method: 'POST',
        url: '/groups',
        slug: 'acme',
        cookie: cookies.owner,
        payload: { name: `Edit ${Math.random().toString(36).slice(2, 8)}` },
      })
    ).json();
    const edit = await run((_, c) =>
      status(
        call({
          method: 'PATCH',
          url: `/groups/${g.id}`,
          slug: 'acme',
          cookie: c,
          payload: { description: 'x' },
        }),
      ),
    );
    expect(edit).toEqual(only('owner', 'orgAdmin'));
    const members = await run((_, c) =>
      status(
        call({
          method: 'PUT',
          url: `/groups/${g.id}/members`,
          slug: 'acme',
          cookie: c,
          payload: { userIds: [] },
        }),
      ),
    );
    expect(members).toEqual(only('owner', 'orgAdmin'));
  });

  it('Create a space: everyone', async () => {
    const verdict = await run((a, c) =>
      status(
        call({
          method: 'POST',
          url: '/spaces',
          slug: 'acme',
          cookie: c,
          payload: {
            key: `C${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
            name: `By ${a}`,
          },
        }),
      ),
    );
    expect(verdict).toEqual(only(...ACTORS));
  });

  it('See all spaces (including private): owner and org admin only', async () => {
    const seesHidden = await run(async (_, c) => {
      const res = await call({
        method: 'GET',
        url: '/spaces?pageSize=100&status=all',
        slug: 'acme',
        cookie: c,
      });
      const items = res.json().items as { id: string }[];
      // 200 only when the private space nobody in the space roles belongs to is listed.
      return items.some((i) => i.id === hiddenSpace.id) ? 200 : 403;
    });
    expect(seesHidden).toEqual(only('owner', 'orgAdmin'));
    // Detail view agrees (hidden spaces are "not found", not "forbidden").
    const detail = await run((_, c) =>
      status(call({ method: 'GET', url: `/spaces/${hiddenSpace.id}`, slug: 'acme', cookie: c })),
    );
    expect(detail).toEqual(only('owner', 'orgAdmin'));
  });

  it('View audit log: owner and org admin org-wide; space admin for their own space only', async () => {
    const orgWide = await run((_, c) =>
      status(call({ method: 'GET', url: '/audit-logs', slug: 'acme', cookie: c })),
    );
    expect(orgWide).toEqual(only('owner', 'orgAdmin'));

    const own = await run((_, c) =>
      status(
        call({
          method: 'GET',
          url: `/spaces/${privateSpace.id}/audit-logs`,
          slug: 'acme',
          cookie: c,
        }),
      ),
    );
    expect(own).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));

    // "Own space only": the space admin gets nothing for a space they are not in.
    const other = await status(
      call({
        method: 'GET',
        url: `/spaces/${hiddenSpace.id}/audit-logs`,
        slug: 'acme',
        cookie: cookies.spaceAdmin,
      }),
    );
    expect(other).toBe(404);
    const otherOpen = await status(
      call({
        method: 'GET',
        url: `/spaces/${openSpace.id}/audit-logs`,
        slug: 'acme',
        cookie: cookies.orgMember,
      }),
    );
    expect(otherOpen).toBe(403);
  });
});

describe('Section 5 matrix: space-level actions', () => {
  it('Edit space settings and archive: owner, org admin, space admin', async () => {
    const edit = await run((_, c) =>
      status(
        call({
          method: 'PATCH',
          url: `/spaces/${privateSpace.id}`,
          slug: 'acme',
          cookie: c,
          payload: { description: 'matrix' },
        }),
      ),
    );
    expect(edit).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
    const archive = {} as Verdict;
    for (const a of ACTORS) {
      archive[a] = ok(
        await status(
          call({
            method: 'POST',
            url: `/spaces/${privateSpace.id}/archive`,
            slug: 'acme',
            cookie: cookies[a],
          }),
        ),
      );
      await call({
        method: 'POST',
        url: `/spaces/${privateSpace.id}/restore`,
        slug: 'acme',
        cookie: cookies.owner,
      });
    }
    expect(archive).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));

    // On an open space the plain org member can see it but still cannot change it.
    const openEdit = await status(
      call({
        method: 'PATCH',
        url: `/spaces/${openSpace.id}`,
        slug: 'acme',
        cookie: cookies.orgMember,
        payload: { description: 'nope' },
      }),
    );
    expect(openEdit).toBe(403);
  });

  it('Add / remove space members and change roles: owner, org admin, space admin', async () => {
    const add = {} as Verdict;
    const remove = {} as Verdict;
    const role = {} as Verdict;
    for (const a of ACTORS) {
      const person = await freshMember();
      add[a] = ok(
        await status(
          call({
            method: 'POST',
            url: `/spaces/${privateSpace.id}/members`,
            slug: 'acme',
            cookie: cookies[a],
            payload: { members: [{ type: 'user', id: person.id, role: 'member' }] },
          }),
        ),
      );
      // Set up a row to change/remove as the owner, so every actor faces the same state.
      const victimUser = await freshMember();
      const setup = await call({
        method: 'POST',
        url: `/spaces/${privateSpace.id}/members`,
        slug: 'acme',
        cookie: cookies.owner,
        payload: { members: [{ type: 'user', id: victimUser.id, role: 'viewer' }] },
      });
      expect(setup.statusCode).toBe(200);
      const list = (
        await call({
          method: 'GET',
          url: `/spaces/${privateSpace.id}/members?q=${victimUser.email}`,
          slug: 'acme',
          cookie: cookies.owner,
        })
      ).json();
      const victim = list.items[0] as { id: string };
      role[a] = ok(
        await status(
          call({
            method: 'PATCH',
            url: `/spaces/${privateSpace.id}/members/${victim.id}`,
            slug: 'acme',
            cookie: cookies[a],
            payload: { role: 'member' },
          }),
        ),
      );
      remove[a] = ok(
        await status(
          call({
            method: 'DELETE',
            url: `/spaces/${privateSpace.id}/members/${victim.id}`,
            slug: 'acme',
            cookie: cookies[a],
          }),
        ),
      );
    }
    expect(add).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
    expect(role).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
    expect(remove).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
  });

  it('Approve access requests: owner, org admin, space admin', async () => {
    const verdict = {} as Verdict;
    for (const a of ACTORS) {
      const requester = await freshMember();
      const rc = await signInAs(t.app, 'acme', requester);
      await call({
        method: 'POST',
        url: `/spaces/${privateSpace.key}/access-requests`,
        slug: 'acme',
        cookie: rc,
        payload: {},
      });
      const inbox = (
        await call({
          method: 'GET',
          url: '/access-requests?pageSize=100',
          slug: 'acme',
          cookie: cookies.owner,
        })
      ).json();
      const req = inbox.items.find(
        (r: { requesterEmail: string }) => r.requesterEmail === requester.email,
      );
      expect(req, 'request should exist').toBeTruthy();
      verdict[a] = ok(
        await status(
          call({
            method: 'POST',
            url: `/access-requests/${req.id}/approve`,
            slug: 'acme',
            cookie: cookies[a],
            payload: {},
          }),
        ),
      );
    }
    expect(verdict).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
  });

  it('View space and its members: org members see open spaces; space roles and admins see private ones', async () => {
    const openView = await run((_, c) =>
      status(call({ method: 'GET', url: `/spaces/${openSpace.id}`, slug: 'acme', cookie: c })),
    );
    expect(openView).toEqual(only(...ACTORS));
    const openMembers = await run((_, c) =>
      status(
        call({ method: 'GET', url: `/spaces/${openSpace.id}/members`, slug: 'acme', cookie: c }),
      ),
    );
    expect(openMembers).toEqual(only(...ACTORS));

    const privateView = await run((_, c) =>
      status(call({ method: 'GET', url: `/spaces/${privateSpace.id}`, slug: 'acme', cookie: c })),
    );
    expect(privateView).toEqual(
      only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember', 'spaceViewer'),
    );
    const privateMembers = await run((_, c) =>
      status(
        call({ method: 'GET', url: `/spaces/${privateSpace.id}/members`, slug: 'acme', cookie: c }),
      ),
    );
    expect(privateMembers).toEqual(
      only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember', 'spaceViewer'),
    );
  });

  it('Delete a space: owner and org admin only (a space admin is not enough)', async () => {
    const verdict = {} as Verdict;
    for (const a of ACTORS) {
      const s = (
        await call({
          method: 'POST',
          url: '/spaces',
          slug: 'acme',
          cookie: cookies.owner,
          payload: {
            key: `D${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
            name: 'Del',
            members: [{ type: 'user', id: users.spaceAdmin.id, role: 'admin' }],
          },
        })
      ).json();
      verdict[a] = ok(
        await status(
          call({
            method: 'DELETE',
            url: `/spaces/${s.id}?confirm=${s.key}`,
            slug: 'acme',
            cookie: cookies[a],
          }),
        ),
      );
    }
    expect(verdict).toEqual(only('owner', 'orgAdmin'));
  });
});

describe('Section 7 matrix: work items', () => {
  const item = async (space: { id: string }, cookie: string) => {
    const res = await call({
      method: 'POST',
      url: `/spaces/${space.id}/items`,
      slug: 'acme',
      cookie,
      payload: { type: 'task', title: 'Matrix item' },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { id: string; key: string; updatedAt: string };
  };

  it('View the board and items: everyone in an open space; only members of a private one', async () => {
    const seed = await item(privateSpace, cookies.spaceAdmin);
    expect(
      await run((_, c) => status(call({ method: 'GET', url: `/spaces/${privateSpace.id}/board`, slug: 'acme', cookie: c }))),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember', 'spaceViewer'));
    expect(
      await run((_, c) => status(call({ method: 'GET', url: `/items/${seed.key}`, slug: 'acme', cookie: c }))),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember', 'spaceViewer'));
    expect(
      await run((_, c) => status(call({ method: 'GET', url: `/spaces/${openSpace.id}/board`, slug: 'acme', cookie: c }))),
    ).toEqual(only('owner', 'orgAdmin', 'orgMember', 'spaceAdmin', 'spaceMember', 'spaceViewer'));
    expect(
      await run((_, c) => status(call({ method: 'GET', url: `/spaces/${hiddenSpace.id}/board`, slug: 'acme', cookie: c }))),
    ).toEqual(only('owner', 'orgAdmin'));
  });

  it('Create items: admins and space members, not viewers or outsiders', async () => {
    expect(
      await run((_, c) =>
        status(
          call({
            method: 'POST',
            url: `/spaces/${privateSpace.id}/items`,
            slug: 'acme',
            cookie: c,
            payload: { type: 'task', title: 'Created' },
          }),
        ),
      ),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember'));
  });

  it('Edit items and move them between statuses: admins and space members', async () => {
    const verdict = {} as Verdict;
    for (const a of ACTORS) {
      const it = await item(privateSpace, cookies.spaceAdmin);
      verdict[a] = ok(
        await status(
          Promise.resolve(
            t.app.inject({
              method: 'PATCH',
              url: `/api/v1/items/${it.id}`,
              headers: { host: 'acme.localhost:3000', 'if-match': it.updatedAt },
              cookies: { cd_session: cookies[a] },
              payload: { title: 'Edited', priority: 'high' },
            }),
          ),
        ),
      );
    }
    expect(verdict).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember'));
  });

  it('Delete items: admins any; a space member only their own; viewers never', async () => {
    const others = {} as Verdict;
    const own = {} as Verdict;
    for (const a of ACTORS) {
      const byAdmin = await item(privateSpace, cookies.spaceAdmin);
      others[a] = ok(
        await status(call({ method: 'DELETE', url: `/items/${byAdmin.id}`, slug: 'acme', cookie: cookies[a] })),
      );
      if (a === 'spaceViewer' || a === 'orgMember') {
        own[a] = false;
        continue;
      }
      const mine = await item(privateSpace, cookies[a]);
      own[a] = ok(
        await status(call({ method: 'DELETE', url: `/items/${mine.id}`, slug: 'acme', cookie: cookies[a] })),
      );
    }
    expect(others).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
    expect(own).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember'));
  });

  it('Manage statuses and board settings: space admins and org admins only', async () => {
    expect(
      await run((_, c) =>
        status(
          call({
            method: 'POST',
            url: `/spaces/${openSpace.id}/statuses`,
            slug: 'acme',
            cookie: c,
            payload: { name: `S${Math.random().toString(36).slice(2, 8)}`, category: 'todo' },
          }),
        ),
      ),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
    const board = (
      await call({ method: 'GET', url: `/spaces/${openSpace.id}/board`, slug: 'acme', cookie: cookies.owner })
    ).json();
    expect(
      await run((_, c) =>
        status(
          call({
            method: 'PATCH',
            url: `/boards/${board.board.id}`,
            slug: 'acme',
            cookie: c,
            payload: { settings: { swimlane: 'priority' } },
          }),
        ),
      ),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
  });

  it('Create labels: admins and space members; manage (rename, delete) labels: admins only', async () => {
    expect(
      await run((a, c) =>
        status(
          call({
            method: 'POST',
            url: `/spaces/${privateSpace.id}/labels`,
            slug: 'acme',
            cookie: c,
            payload: { name: `L-${a}-${Math.random().toString(36).slice(2, 7)}` },
          }),
        ),
      ),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember'));
    const label = (
      await call({
        method: 'POST',
        url: `/spaces/${privateSpace.id}/labels`,
        slug: 'acme',
        cookie: cookies.owner,
        payload: { name: `Managed-${Math.random().toString(36).slice(2, 7)}` },
      })
    ).json();
    expect(
      await run((a, c) =>
        status(
          call({
            method: 'PATCH',
            url: `/labels/${label.id}`,
            slug: 'acme',
            cookie: c,
            payload: { color: a === 'owner' ? 'red' : 'blue' },
          }),
        ),
      ),
    ).toEqual(only('owner', 'orgAdmin', 'spaceAdmin'));
  });

  it('Move cards between columns: same as editing, so admins and space members', async () => {
    const verdict = {} as Verdict;
    const board = (
      await call({ method: 'GET', url: `/spaces/${privateSpace.id}/statuses`, slug: 'acme', cookie: cookies.owner })
    ).json();
    const done = board.items.find((s: { category: string }) => s.category === 'done');
    for (const a of ACTORS) {
      const it = await item(privateSpace, cookies.spaceAdmin);
      verdict[a] = ok(
        await status(
          Promise.resolve(
            t.app.inject({
              method: 'POST',
              url: `/api/v1/items/${it.id}/move`,
              headers: { host: 'acme.localhost:3000', 'if-match': it.updatedAt },
              cookies: { cd_session: cookies[a] },
              payload: { statusId: done.id },
            }),
          ),
        ),
      );
    }
    expect(verdict).toEqual(only('owner', 'orgAdmin', 'spaceAdmin', 'spaceMember'));
  });
});
