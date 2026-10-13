import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import { createDb } from './client.js';
import {
  holidays,
  sites,
  tenantSettings,
  workDays,
  auditLogs,
  groupMembers,
  groups,
  memberships,
  organizations,
  spaceAccessRequests,
  spaceMembers,
  spaceStars,
  spaces,
  users,
} from './schema.js';

/**
 * A believable demo workspace for the Acme tenant: people, teams, spaces with a mix of open,
 * private and archived, group-based access, stars, a pending access request, and an audit trail.
 * Development only and idempotent. Run after the base seed.
 */
const PEOPLE = [
  ['priya', 'Priya Raman', 'Staff Engineer'],
  ['ben', 'Ben Okafor', 'Backend Engineer'],
  ['dmitri', 'Dmitri Volkov', 'Platform Engineer'],
  ['carla', 'Carla Mendes', 'Business Analyst'],
  ['elena', 'Elena Rossi', 'Senior BA'],
  ['farid', 'Farid Haddad', 'QA Lead'],
  ['grace', 'Grace Lin', 'QA Engineer'],
  ['hiro', 'Hiro Tanaka', 'Design Lead'],
  ['ines', 'Ines Duarte', 'Product Designer'],
] as const;

const GROUPS: Record<string, { description: string; members: string[] }> = {
  Backend: { description: 'Server-side engineering', members: ['priya', 'ben', 'dmitri'] },
  BA: { description: 'Business analysis', members: ['carla', 'elena'] },
  QA: { description: 'Quality assurance', members: ['farid', 'grace'] },
  Design: { description: 'Product and brand design', members: ['hiro', 'ines', 'member2'] },
};

type Role = 'admin' | 'member' | 'viewer';
const SPACES: {
  key: string;
  name: string;
  description: string;
  icon: string;
  visibility: 'open' | 'private';
  status?: 'archived';
  members: { who: string; type: 'user' | 'group'; role: Role }[];
}[] = [
  {
    key: 'ENG',
    name: 'Engineering',
    description: 'Roadmap, architecture and delivery for the platform.',
    icon: 'code',
    visibility: 'open',
    members: [
      { who: 'owner', type: 'user', role: 'admin' },
      { who: 'priya', type: 'user', role: 'admin' },
      { who: 'Backend', type: 'group', role: 'member' },
      { who: 'QA', type: 'group', role: 'member' },
    ],
  },
  {
    key: 'OPS',
    name: 'Operations',
    description: 'Runbooks, incidents and vendor management. Private to the ops team.',
    icon: 'shield',
    visibility: 'private',
    members: [
      { who: 'admin', type: 'user', role: 'admin' },
      { who: 'BA', type: 'group', role: 'viewer' },
      { who: 'carla', type: 'user', role: 'member' },
    ],
  },
  {
    key: 'MKT',
    name: 'Marketing',
    description: 'Campaigns, launches and brand.',
    icon: 'megaphone',
    visibility: 'open',
    members: [
      { who: 'hiro', type: 'user', role: 'admin' },
      { who: 'ines', type: 'user', role: 'member' },
    ],
  },
  {
    key: 'DSYS',
    name: 'Design System',
    description: 'Components, tokens and guidelines.',
    icon: 'palette',
    visibility: 'private',
    members: [
      { who: 'Design', type: 'group', role: 'admin' },
      { who: 'owner', type: 'user', role: 'viewer' },
    ],
  },
  {
    key: 'LEGACY',
    name: 'Legacy Portal',
    description: 'Retired in 2025. Kept for reference.',
    icon: 'folder',
    visibility: 'open',
    status: 'archived',
    members: [{ who: 'owner', type: 'user', role: 'admin' }],
  },
];

const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 15, 0, 0);
  return d;
};

export async function seedDemo(adminUrl: string) {
  if (process.env.NODE_ENV === 'production') {
    console.log('demo seed skipped in production');
    return;
  }
  const { db, close } = createDb(adminUrl);
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, 'acme'));
    if (!org) throw new Error('Run the base seed first (the acme workspace is missing).');
    const passwordHash = await hashPassword(process.env.SEED_PASSWORD ?? 'dev-password-123');

    // People
    for (const [handle, name, title] of PEOPLE) {
      const [u] = await db
        .insert(users)
        .values({
          email: `${handle}@acme.test`,
          name,
          jobTitle: title,
          status: 'active',
          passwordHash,
          lastLoginAt: daysAgo(Math.floor(Math.random() * 6)),
        })
        .onConflictDoUpdate({ target: users.email, set: { name, jobTitle: title } })
        .returning();
      await db
        .insert(memberships)
        .values({ orgId: org.id, userId: u!.id, orgRole: 'member' })
        .onConflictDoNothing();
    }
    const everyone = await db
      .select({ id: users.id, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, org.id));
    const userId = (handle: string) => {
      const found = everyone.find((u) => u.email === `${handle}@acme.test`);
      if (!found) throw new Error(`demo person ${handle} missing`);
      return found.id;
    };
    const owner = userId('owner');

    // Groups
    const groupId = new Map<string, string>();
    for (const [name, g] of Object.entries(GROUPS)) {
      const existing = await db
        .select()
        .from(groups)
        .where(and(eq(groups.orgId, org.id), eq(groups.name, name)));
      let id = existing[0]?.id;
      if (!id) {
        const [created] = await db
          .insert(groups)
          .values({ orgId: org.id, name, description: g.description, createdAt: daysAgo(12) })
          .returning();
        id = created!.id;
        await db.insert(auditLogs).values({
          orgId: org.id,
          actorId: owner,
          action: 'group.created',
          targetType: 'group',
          targetId: id,
          after: { name },
          createdAt: daysAgo(12),
        });
      }
      groupId.set(name, id);
      await db
        .insert(groupMembers)
        .values(g.members.map((h) => ({ groupId: id!, orgId: org.id, userId: userId(h) })))
        .onConflictDoNothing();
    }

    // Spaces
    const spaceId = new Map<string, string>();
    for (const [i, s] of SPACES.entries()) {
      const existing = await db
        .select()
        .from(spaces)
        .where(and(eq(spaces.orgId, org.id), eq(spaces.key, s.key)));
      let id = existing[0]?.id;
      if (!id) {
        const [created] = await db
          .insert(spaces)
          .values({
            orgId: org.id,
            key: s.key,
            name: s.name,
            description: s.description,
            icon: s.icon,
            visibility: s.visibility,
            status: s.status ?? 'active',
            ownerId: owner,
            createdAt: daysAgo(10 - i),
          })
          .returning();
        id = created!.id;
        await db.insert(auditLogs).values({
          orgId: org.id,
          actorId: owner,
          action: 'space.created',
          targetType: 'space',
          targetId: id,
          after: { key: s.key, name: s.name, visibility: s.visibility },
          createdAt: daysAgo(10 - i),
        });
        if (s.status === 'archived') {
          await db.insert(auditLogs).values({
            orgId: org.id,
            actorId: owner,
            action: 'space.archived',
            targetType: 'space',
            targetId: id,
            before: { status: 'active' },
            after: { status: 'archived' },
            createdAt: daysAgo(2),
          });
        }
      }
      spaceId.set(s.key, id);
      for (const m of s.members) {
        const principalId = m.type === 'group' ? groupId.get(m.who)! : userId(m.who);
        const inserted = await db
          .insert(spaceMembers)
          .values({
            spaceId: id,
            orgId: org.id,
            principalType: m.type,
            principalId,
            spaceRole: m.role,
          })
          .onConflictDoNothing()
          .returning({ id: spaceMembers.id });
        if (inserted.length) {
          await db.insert(auditLogs).values({
            orgId: org.id,
            actorId: owner,
            action: 'space.member_added',
            targetType: 'space',
            targetId: id,
            after: { principalType: m.type, principalId, role: m.role },
            createdAt: daysAgo(9 - i),
          });
        }
      }
    }

    // Stars: the owner and the demo member each pin a couple of spaces.
    const stars: [string, string][] = [
      ['owner', 'ENG'],
      ['owner', 'OPS'],
      ['member', 'ENG'],
    ];
    for (const [who, key] of stars) {
      if (!spaceId.has(key)) continue;
      await db
        .insert(spaceStars)
        .values({ spaceId: spaceId.get(key)!, orgId: org.id, userId: userId(who) })
        .onConflictDoNothing();
    }

    // A pending access request, so the inbox has something to show.
    const ops = spaceId.get('OPS')!;
    const farid = userId('farid');
    const pending = await db
      .select({ id: spaceAccessRequests.id })
      .from(spaceAccessRequests)
      .where(
        and(
          eq(spaceAccessRequests.spaceId, ops),
          eq(spaceAccessRequests.userId, farid),
          inArray(spaceAccessRequests.status, ['pending', 'approved']),
        ),
      );
    if (!pending.length) {
      const [req] = await db
        .insert(spaceAccessRequests)
        .values({
          orgId: org.id,
          spaceId: ops,
          userId: farid,
          message: 'I am covering on-call next month and need the runbooks.',
          createdAt: daysAgo(1),
        })
        .returning();
      await db.insert(auditLogs).values({
        orgId: org.id,
        actorId: farid,
        action: 'space.access_requested',
        targetType: 'space',
        targetId: ops,
        after: { requestId: req!.id },
        createdAt: daysAgo(1),
      });
    }
    // Check-in: settings, sites, holidays, managers, today's statuses and two weeks of history.
    await db
      .insert(tenantSettings)
      .values({ orgId: org.id, timezone: 'UTC' })
      .onConflictDoNothing();
    const siteIds = new Map<string, string>();
    for (const [name, address] of [
      ['London HQ', '12 Fleet Street, London'],
      ['Colombo Office', '45 Galle Road, Colombo'],
    ] as const) {
      const [site] = await db
        .insert(sites)
        .values({ orgId: org.id, name, address })
        .onConflictDoNothing()
        .returning();
      const found =
        site ??
        (
          await db
            .select()
            .from(sites)
            .where(and(eq(sites.orgId, org.id), eq(sites.name, name)))
        )[0];
      siteIds.set(name, found!.id);
    }
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    const inDays = (n: number) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + n);
      return iso(d);
    };
    await db
      .insert(holidays)
      .values([
        { orgId: org.id, date: inDays(9), name: 'Company Day' },
        { orgId: org.id, date: inDays(30), name: 'Founders Day' },
      ])
      .onConflictDoNothing();

    const managers: [string, string][] = [
      ['ben', 'priya'],
      ['dmitri', 'priya'],
      ['carla', 'elena'],
      ['grace', 'farid'],
      ['ines', 'hiro'],
    ];
    for (const [report, boss] of managers) {
      await db
        .update(memberships)
        .set({ reportsTo: userId(boss) })
        .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, userId(report))));
    }

    const midnight = new Date(`${iso(today)}T00:05:00Z`);
    const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00Z`);
    const live = today >= midnight;
    const todayStr = iso(today);
    const hq = siteIds.get('London HQ')!;
    const colombo = siteIds.get('Colombo Office')!;
    const clamp = (d: Date) => (d > today ? midnight : d);
    if (live) {
      const rows: (typeof workDays.$inferInsert)[] = [
        {
          orgId: org.id,
          userId: userId('priya'),
          date: todayStr,
          locationType: 'onsite',
          siteId: hq,
          checkinAt: clamp(at(todayStr, '08:50')),
        },
        {
          orgId: org.id,
          userId: userId('elena'),
          date: todayStr,
          locationType: 'onsite',
          siteId: colombo,
          checkinAt: clamp(at(todayStr, '09:05')),
        },
        {
          orgId: org.id,
          userId: userId('ben'),
          date: todayStr,
          locationType: 'remote',
          checkinAt: clamp(at(todayStr, '09:20')),
        },
        {
          orgId: org.id,
          userId: userId('hiro'),
          date: todayStr,
          locationType: 'remote',
          checkinAt: clamp(at(todayStr, '08:40')),
        },
        {
          orgId: org.id,
          userId: userId('dmitri'),
          date: todayStr,
          locationType: 'offsite',
          note: 'Client workshop',
          checkinAt: clamp(at(todayStr, '09:30')),
        },
        {
          orgId: org.id,
          userId: userId('carla'),
          date: todayStr,
          plannedLocation: 'leave',
          source: 'plan',
        },
        {
          orgId: org.id,
          userId: userId('farid'),
          date: todayStr,
          plannedLocation: 'remote',
          source: 'plan',
        },
      ];
      await db.insert(workDays).values(rows).onConflictDoNothing();
    }
    // Two weeks of history for a few people (weekdays only).
    const people: [string, 'onsite' | 'remote'][] = [
      ['priya', 'onsite'],
      ['ben', 'remote'],
      ['grace', 'remote'],
      ['owner', 'onsite'],
    ];
    // The forgotten check-out example goes on the first weekday at least three days back.
    let autoClosedBack = 3;
    while ([0, 6].includes(new Date(`${inDays(-autoClosedBack)}T00:00:00Z`).getUTCDay()))
      autoClosedBack++;
    for (let back = 1; back <= 14; back++) {
      const date = inDays(-back);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const rows = people.map(([who, loc], i) => ({
        orgId: org.id,
        userId: userId(who),
        date,
        locationType: loc,
        siteId: loc === 'onsite' ? hq : null,
        checkinAt: at(date, `08:${String(40 + ((back + i) % 5) * 3).padStart(2, '0')}`),
        checkoutAt: at(date, `17:${String(10 + ((back * 7 + i) % 6) * 5).padStart(2, '0')}`),
        // One forgotten check-out so the auto-closed flag has an example.
        ...(back === autoClosedBack && who === 'ben'
          ? { checkoutAt: at(date, '20:00'), autoClosed: true, source: 'auto' as const }
          : {}),
      }));
      await db.insert(workDays).values(rows).onConflictDoNothing();
    }
    console.log('seeded demo workspace (acme)');
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  await seedDemo(url);
}
