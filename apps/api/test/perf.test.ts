import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminDb,
  caller,
  createOrg,
  ensureUser,
  makeApp,
  signInAs,
  uniqueEmail,
} from './helpers.js';

/**
 * Performance guard for large workspaces: 5,000 people, 40 groups (one with 2,000 members),
 * and 1,500 spaces. Budgets are generous so CI hardware does not make this flaky; they exist to catch
 * accidental full scans or N+1 queries, not to benchmark. Timings are printed for the record.
 */
const t = makeApp();
const call = caller(t.app);
const timings: Record<string, number> = {};
let slug: string, adminC: string, memberC: string, bigGroupId: string, someSpaceKey: string;

async function timed<T>(label: string, fn: () => Promise<T>) {
  const start = performance.now();
  const out = await fn();
  timings[label] = Math.round(performance.now() - start);
  return out;
}

beforeAll(async () => {
  const org = await createOrg('perf');
  slug = org.slug;
  const orgId = org.org.id;
  const domain = `${slug}.test`;
  const db = adminDb();
  let member: Awaited<ReturnType<typeof ensureUser>>;
  try {
    const tenant = db.db.global.forOrg(orgId);
    const people = await db.db.global.users.insert(
      Array.from({ length: 5000 }, (_, i) => ({
        email: `p${i + 1}@${domain}`,
        name: `Person ${String(i + 1).padStart(5, '0')}`,
        status: 'active' as const,
        jobTitle: `Role ${(i + 1) % 20}`,
        lastLoginAt: new Date(Date.now() - (i + 1) * 60_000),
      })),
    );
    await tenant.memberships.insert(people.map((u) => ({ userId: u.id, orgRole: 'member' as const })));
    const groups = await tenant.groups.insert(
      Array.from({ length: 40 }, (_, i) => ({ name: `Group ${i + 1}` })),
    );
    bigGroupId = groups[0]!.id;
    await tenant.groupMembers.insert(
      people.slice(0, 2000).map((u) => ({ groupId: bigGroupId, userId: u.id })),
    );
    const owner = await db.db.global.users.findOne({ email: `owner@${domain}` });
    const spaces = await tenant.spaces.insert(
      Array.from({ length: 1500 }, (_, i) => ({
        key: `S${String(i + 1).padStart(4, '0')}`,
        name: `Space ${String(i + 1).padStart(4, '0')}`,
        visibility: ((i + 1) % 3 === 0 ? 'private' : 'open') as 'private' | 'open',
        ownerId: owner!.id,
      })),
    );
    someSpaceKey = 'S0001';
    member = await ensureUser({
      orgId,
      email: uniqueEmail('perf-mem', domain),
      role: 'member',
    });
    // The member holds a role in every private space (500 of them), which stresses the role calculation.
    await tenant.spaceMembers.insert(
      spaces
        .filter((sp) => sp.visibility === 'private')
        .map((sp) => ({
          spaceId: sp.id,
          principalType: 'user' as const,
          principalId: member.id,
          spaceRole: 'member' as const,
        })),
    );
  } finally {
    await db.close();
  }
  adminC = await signInAs(t.app, slug, org.owner);
  memberC = await signInAs(t.app, slug, member);
  await t.app.ready();
}, 120_000);

afterAll(async () => {
  console.log(
    '\nlarge-workspace timings (ms):\n' +
      Object.entries(timings)
        .map(([k, v]) => `  ${k.padEnd(44)} ${v}`)
        .join('\n'),
  );
  await t.close();
});

const BUDGET = 1500;
const get = (url: string, cookie: string) => call({ method: 'GET', url, slug, cookie });

describe('large workspace', () => {
  it('lists members quickly: default, search, filters, sorting and deep pages', async () => {
    const first = await timed('members: first page (5,000 people)', () =>
      get('/members?pageSize=20', adminC),
    );
    expect(first.json().total).toBe(5002); // 5,000 generated + owner + one member
    await timed('members: search "Person 04"', () => get('/members?q=Person%2004', adminC));
    await timed('members: search by email', () => get('/members?q=p4999%40', adminC));
    await timed('members: sort by last active', () =>
      get('/members?sort=lastLoginAt&dir=desc', adminC),
    );
    await timed('members: sort by role then status', () =>
      get('/members?sort=status&dir=desc&role=member', adminC),
    );
    await timed('members: deep page (page 200 of 250)', () =>
      get('/members?pageSize=20&page=200', adminC),
    );
    await timed('members: as ordinary member', () => get('/members?pageSize=20', memberC));
    for (const [k, v] of Object.entries(timings)) expect(v, k).toBeLessThan(BUDGET);
  });

  it('serves groups and a 2,000-person group', async () => {
    const list = await timed('groups: list 40 with counts and previews', () =>
      get('/groups?pageSize=40', adminC),
    );
    expect(list.json().total).toBe(40);
    const detail = await timed('groups: detail with 2,000 members', () =>
      get(`/groups/${bigGroupId}`, adminC),
    );
    expect(detail.json().members).toHaveLength(2000);
    expect(timings['groups: list 40 with counts and previews']).toBeLessThan(BUDGET);
    expect(timings['groups: detail with 2,000 members']).toBeLessThan(BUDGET);
  });

  it('lists spaces quickly, including the role calculation for 500 private spaces', async () => {
    const admin = await timed('spaces: first page as admin (1,500)', () =>
      get('/spaces?pageSize=12', adminC),
    );
    expect(admin.json().total).toBe(1500);
    const member = await timed('spaces: first page as member', () =>
      get('/spaces?pageSize=12', memberC),
    );
    expect(member.json().total).toBe(1500); // 1,000 open + the 500 private ones they belong to
    await timed('spaces: "mine" filter as member', () =>
      get('/spaces?mine=true&pageSize=12', memberC),
    );
    await timed('spaces: search', () => get('/spaces?q=Space%200123', memberC));
    await timed('spaces: detail by key', () => get(`/spaces/${someSpaceKey}`, memberC));
    await timed('spaces: members tab', () => get(`/spaces/${someSpaceKey}/members`, adminC));
    for (const [k, v] of Object.entries(timings))
      if (k.startsWith('spaces')) expect(v, k).toBeLessThan(BUDGET);
  });

  it('answers a burst of concurrent requests without errors', async () => {
    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        get(
          i % 2 ? '/members?pageSize=20&page=3' : '/spaces?pageSize=12',
          i % 3 ? adminC : memberC,
        ),
      ),
    );
    timings['40 concurrent mixed requests (total)'] = Math.round(performance.now() - start);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(timings['40 concurrent mixed requests (total)']).toBeLessThan(8000);
  });
});
