import { fileURLToPath } from 'node:url';
import { generateKeyBetween } from 'fractional-indexing';
import { hashPassword } from '../auth/password.js';
import { DEFAULT_STAGES } from '../crm/helpers.js';
import { createDb, type Db, type TenantDb } from './client.js';
import { DEV_PASSWORD, MULTI_USER } from './seed.js';
import type { SpaceRole } from './types.js';
import { seedSpaceWork } from '../work/seed.js';

type DemoItem = {
  type: 'epic' | 'story' | 'task' | 'bug' | 'subtask';
  title: string;
  status: string;
  priority?: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
  assignee?: string;
  estimate?: number;
  dueInDays?: number;
  parent?: string;
  description?: string;
  labels?: string[];
};

const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 15, 0, 0);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

// ---- Shared helpers ------------------------------------------------------------------------------------

interface SpaceSeed {
  key: string;
  name: string;
  description: string;
  icon: string;
  visibility: 'open' | 'private';
  status?: 'archived';
  members: { who: string; type: 'user' | 'group'; role: SpaceRole }[];
}

/** Everything a workspace seeder needs to look people and groups up by handle. */
interface Ctx {
  t: TenantDb;
  orgId: string;
  domain: string;
  userId: (handle: string) => string;
  groupId: Map<string, string>;
  owner: string;
  /** Email -> user id for the workspace's people; grows as people are added. */
  emails: Map<string, string>;
}

async function ctxFor(db: Db, slug: string): Promise<Ctx | null> {
  const org = await db.global.organizations.findOne({ slug });
  if (!org) return null;
  const t = db.global.forOrg(org.id);
  const ms = await t.memberships.find({});
  const people = await t.users(ms.map((m) => m.userId));
  const byEmail = new Map([...people.values()].map((u) => [u.email, u.id]));
  const userId = (handle: string) => {
    const id = byEmail.get(`${handle}@${org.domain}`);
    if (!id) throw new Error(`demo person ${handle}@${org.domain} missing`);
    return id;
  };
  return {
    t,
    orgId: org.id,
    domain: org.domain,
    userId,
    groupId: new Map(),
    owner: userId('owner'),
    emails: byEmail,
  };
}

async function ensurePerson(
  db: Db,
  ctx: Ctx,
  handle: string,
  name: string,
  title: string,
  passwordHash: string,
) {
  const email = `${handle}@${ctx.domain}`;
  let user = await db.global.users.findOne({ email });
  if (!user) {
    user = await db.global.users.insert({
      email,
      name,
      jobTitle: title,
      status: 'active',
      passwordHash,
      lastLoginAt: daysAgo(Math.floor(Math.random() * 6)),
    });
  }
  if (!(await ctx.t.memberships.exists({ userId: user.id }))) {
    await ctx.t.memberships.insert({ userId: user.id, orgRole: 'member' });
  }
  ctx.emails.set(email, user.id);
  return user.id;
}

async function ensureGroup(ctx: Ctx, name: string, description: string, members: string[]) {
  const { t, orgId, owner, userId } = ctx;
  let g = await t.groups.findOne({ nameLower: name.toLowerCase() });
  if (!g) {
    g = await t.groups.insert({ name, description, createdAt: daysAgo(12) });
    await t.auditLogs.insert({
      actorId: owner,
      action: 'group.created',
      targetType: 'group',
      targetId: g.id,
      after: { name },
      createdAt: daysAgo(12),
    });
  }
  ctx.groupId.set(name, g.id);
  for (const h of members) await t.groupMembers.insertIgnore({ groupId: g.id, userId: userId(h) });
  void orgId;
  return g.id;
}

async function ensureSpace(ctx: Ctx, s: SpaceSeed, age: number) {
  const { t, owner, userId, groupId } = ctx;
  let space = await t.spaces.findOne({ key: s.key });
  if (!space) {
    space = await t.spaces.insert({
      key: s.key,
      name: s.name,
      description: s.description,
      icon: s.icon,
      visibility: s.visibility,
      status: s.status ?? 'active',
      ownerId: owner,
      createdAt: daysAgo(age),
      updatedAt: daysAgo(age),
    });
    await seedSpaceWork(t, space.id);
    await t.auditLogs.insert({
      actorId: owner,
      action: 'space.created',
      targetType: 'space',
      targetId: space.id,
      after: { key: s.key, name: s.name, visibility: s.visibility },
      createdAt: daysAgo(age),
    });
    if (s.status === 'archived') {
      await t.auditLogs.insert({
        actorId: owner,
        action: 'space.archived',
        targetType: 'space',
        targetId: space.id,
        before: { status: 'active' },
        after: { status: 'archived' },
        createdAt: daysAgo(2),
      });
    }
  }
  for (const m of s.members) {
    const principalId = m.type === 'group' ? groupId.get(m.who)! : userId(m.who);
    const added = await t.spaceMembers.insertIgnore({
      spaceId: space.id,
      principalType: m.type,
      principalId,
      spaceRole: m.role,
    });
    if (added) {
      await t.auditLogs.insert({
        actorId: owner,
        action: 'space.member_added',
        targetType: 'space',
        targetId: space.id,
        after: { principalType: m.type, principalId, role: m.role },
        createdAt: daysAgo(Math.max(age - 1, 0)),
      });
    }
  }
  return space.id;
}

/** Fills a space's board with a believable spread of work (only when the space has no items yet). */
async function seedItems(ctx: Ctx, spaceId: string, items: DemoItem[], reporter: string) {
  const { t, userId } = ctx;
  if (await t.workItems.exists({ spaceId })) return;
  const statuses = await t.spaceStatuses.find({ spaceId });
  const statusByName = new Map(statuses.map((st) => [st.name, st]));
  const labelByName = new Map<string, string>();
  const lastRank = new Map<string, string | null>();
  const idByTitle = new Map<string, string>();
  for (const it of items) {
    const status = statusByName.get(it.status);
    if (!status) continue;
    const counter = await t.spaceCounters.findOneAndUpdate({ spaceId }, { $inc: { lastNumber: 1 } });
    const rank = generateKeyBetween(lastRank.get(status.id) ?? null, null);
    lastRank.set(status.id, rank);
    const labelIds: string[] = [];
    for (const name of it.labels ?? []) {
      let id = labelByName.get(name);
      if (!id) {
        const existing = await t.labels.findOne({ spaceId, nameLower: name.toLowerCase() });
        id = existing?.id ?? (await t.labels.insert({ spaceId, name, color: 'blue' })).id;
        labelByName.set(name, id);
      }
      labelIds.push(id);
    }
    const row = await t.workItems.insert({
      spaceId,
      number: counter!.lastNumber,
      type: it.type,
      parentId: it.parent ? (idByTitle.get(it.parent) ?? null) : null,
      title: it.title,
      description: it.description
        ? {
            type: 'doc',
            content: it.description
              .split('\n')
              .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
          }
        : null,
      statusId: status.id,
      priority: it.priority ?? 'medium',
      assigneeId: it.assignee ? userId(it.assignee) : null,
      reporterId: reporter,
      estimate: it.estimate ?? null,
      dueDate: it.dueInDays === undefined ? null : inDays(it.dueInDays),
      rank,
      labelIds,
      resolvedAt: status.category === 'done' ? new Date(Date.now() - 2 * 86_400_000) : null,
    });
    idByTitle.set(it.title, row.id);
  }
}

async function seedStars(ctx: Ctx, stars: [string, string][]) {
  for (const [who, key] of stars) {
    const space = await ctx.t.spaces.findOne({ key });
    if (space) await ctx.t.spaceStars.insertIgnore({ spaceId: space.id, userId: ctx.userId(who) });
  }
}

// ---- Check-in ---------------------------------------------------------------------------------------------

interface CheckinSeed {
  sites: [string, string][];
  holidays: [number, string][];
  managers: [string, string][];
  /** [who, location, site name | null, check-in HH:MM, note?] */
  today: [string, 'onsite' | 'remote' | 'offsite', string | null, string, string?][];
  planned: [string, 'remote' | 'leave' | 'onsite'][];
  /** People with two weeks of history: [who, location, site]. */
  history: [string, 'onsite' | 'remote', string | null][];
  forgottenCheckout?: string;
}

async function seedCheckin(ctx: Ctx, c: CheckinSeed) {
  const { t, userId } = ctx;
  await t.tenantSettings.upsert({}, { updatedAt: new Date() }, { timezone: 'UTC' });
  const siteIds = new Map<string, string>();
  for (const [name, address] of c.sites) {
    let site = await t.sites.findOne({ nameLower: name.toLowerCase() });
    site ??= await t.sites.insert({ name, address });
    siteIds.set(name, site.id);
  }
  for (const [offset, name] of c.holidays) {
    await t.holidays.insertIgnore({ date: inDays(offset), name });
  }
  for (const [report, boss] of c.managers) {
    await t.memberships.updateOne({ userId: userId(report) }, { reportsTo: userId(boss) });
  }

  const today = new Date();
  const todayStr = iso(today);
  const midnight = new Date(`${todayStr}T00:05:00Z`);
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00Z`);
  const clamp = (d: Date) => (d > today ? midnight : d);
  if (today >= midnight) {
    for (const [who, loc, site, time, note] of c.today) {
      await t.workDays.insertIgnore({
        userId: userId(who),
        date: todayStr,
        locationType: loc,
        siteId: site ? (siteIds.get(site) ?? null) : null,
        checkinAt: clamp(at(todayStr, time)),
        note: note ?? null,
      });
    }
    for (const [who, loc] of c.planned) {
      await t.workDays.insertIgnore({
        userId: userId(who),
        date: todayStr,
        plannedLocation: loc,
        source: 'plan',
      });
    }
  }
  // The forgotten check-out example goes on the first weekday at least three days back.
  let autoClosedBack = 3;
  while ([0, 6].includes(new Date(`${inDays(-autoClosedBack)}T00:00:00Z`).getUTCDay()))
    autoClosedBack++;
  for (let back = 1; back <= 14; back++) {
    const date = inDays(-back);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const [i, [who, loc, site]] of c.history.entries()) {
      const forgotten = back === autoClosedBack && who === c.forgottenCheckout;
      await t.workDays.insertIgnore({
        userId: userId(who),
        date,
        locationType: loc,
        siteId: site ? (siteIds.get(site) ?? null) : null,
        checkinAt: at(date, `08:${String(40 + ((back + i) % 5) * 3).padStart(2, '0')}`),
        checkoutAt: forgotten
          ? at(date, '20:00')
          : at(date, `17:${String(10 + ((back * 7 + i) % 6) * 5).padStart(2, '0')}`),
        ...(forgotten ? { autoClosed: true, source: 'auto' as const } : {}),
      });
    }
  }
}

// ---- CRM --------------------------------------------------------------------------------------------------

async function seedCrm(ctx: Ctx, second: string) {
  const { t } = ctx;
  if (await t.crmCompanies.exists({})) return;
  const o = ctx.owner;
  const p = ctx.userId(second);
  const [tagVip, tagPartner, tagEu] = await t.crmTags.insert([
    { name: 'VIP', color: 'pink' },
    { name: 'Partner', color: 'violet' },
    { name: 'EU', color: 'blue' },
  ]);
  const companies = await t.crmCompanies.insert(
    [
      ['Northwind Traders', 'northwind.example', 'Retail', '201-500'],
      ['Globex Logistics', 'globexlogistics.example', 'Logistics', '51-200'],
      ['Initech Software', 'initech.example', 'Software', '11-50'],
      ['Umbrella Health', 'umbrellahealth.example', 'Healthcare', '501-1000'],
      ['Stark Robotics', 'starkrobotics.example', 'Manufacturing', '51-200'],
      ['Wayne Foods', 'waynefoods.example', 'Food and beverage', '201-500'],
    ].map(([name, website, industry, size], i) => ({
      name: name!,
      website,
      industry,
      size,
      ownerId: i % 2 ? p : o,
      createdBy: o,
    })),
  );
  const co = (n: number) => companies[n]!.id;
  const contacts = await t.crmContacts.insert(
    (
      [
        ['Alice Bennett', 'alice@northwind.example', 'Head of Procurement', 0],
        ['Marcus Chen', 'marcus@northwind.example', 'IT Director', 0],
        ['Sofia Alvarez', 'sofia@globexlogistics.example', 'COO', 1],
        ['Tom Brandt', 'tom@initech.example', 'CTO', 2],
        ['Nadia Karim', 'nadia@umbrellahealth.example', 'Operations Lead', 3],
        ['Leo Fischer', 'leo@starkrobotics.example', 'VP Engineering', 4],
        ['Maya Patel', 'maya@waynefoods.example', 'Buyer', 5],
      ] as const
    ).map(([name, email, jobTitle, c]) => ({
      name,
      email,
      jobTitle,
      companyId: co(c),
      ownerId: o,
      createdBy: o,
    })),
  );
  await t.crmRecordTags.insert([
    { tagId: tagVip!.id, recordType: 'company', recordId: co(0) },
    { tagId: tagPartner!.id, recordType: 'company', recordId: co(2) },
    { tagId: tagEu!.id, recordType: 'company', recordId: co(1) },
    { tagId: tagVip!.id, recordType: 'contact', recordId: contacts[0]!.id },
  ]);
  await t.crmLeads.insert(
    (
      [
        ['Rina Okada', 'rina@kestrel.example', 'Kestrel Air', 'Website', 'new'],
        ['Jonas Weber', 'jonas@brightwave.example', 'Brightwave', 'Referral', 'contacted'],
        ['Aisha Bello', 'aisha@lagoon.example', 'Lagoon Pay', 'Event', 'qualified'],
        ['Paolo Neri', 'paolo@verona.example', 'Verona Studio', 'Website', 'new'],
        ['Hana Kim', 'hana@moonrise.example', 'Moonrise Labs', 'Outbound', 'unqualified'],
        ['Victor Hale', 'victor@ironclad.example', 'Ironclad Security', 'Referral', 'contacted'],
      ] as const
    ).map(([name, email, companyName, source, status]) => ({
      name,
      email,
      companyName,
      source,
      status,
      ownerId: o,
      createdBy: o,
    })),
  );
  const pipeline = await t.crmPipelines.insert({ name: 'Sales pipeline', isDefault: true });
  const stages = (
    await t.crmStages.insert(
      DEFAULT_STAGES.map((s, i) => ({ ...s, pipelineId: pipeline.id, position: i + 1 })),
    )
  ).sort((a, b) => a.position - b.position);
  const deals = await t.crmDeals.insert(
    (
      [
        ['Northwind renewal', 0, 0, 48000, 'USD', 14, 0],
        ['Globex fleet tracking', 1, 1, 22000, 'EUR', 30, 1],
        ['Initech platform migration', 2, 2, 75000, 'USD', 45, 2],
        ['Umbrella clinic rollout', 3, 3, 120000, 'USD', 21, 3],
        ['Stark pilot programme', 4, 1, 15000, 'USD', 10, 4],
        ['Wayne Foods supply portal', 5, 0, 9500, 'GBP', 60, 5],
        ['Northwind add-on seats', 0, 4, 12000, 'USD', -5, 0],
        ['Globex expansion', 1, 5, 30000, 'EUR', -20, 1],
      ] as const
    ).map(([title, c, s, value, currency, close, k], i) => {
      const stage = stages[s]!;
      const closed = stage.isWon || stage.isLost;
      return {
        pipelineId: pipeline.id,
        stageId: stage.id,
        companyId: co(c),
        contactId: contacts[k]!.id,
        title,
        value,
        currency,
        expectedClose: inDays(close),
        status: stage.isWon ? ('won' as const) : stage.isLost ? ('lost' as const) : ('open' as const),
        closedAt: closed ? new Date(Date.now() - 3 * 86_400_000) : null,
        position: (i + 1) * 1000,
        ownerId: i % 3 === 0 ? p : o,
        createdBy: o,
      };
    }),
  );
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
  await t.crmActivities.insert([
    {
      type: 'call',
      subject: 'Intro call with Alice',
      dueAt: hours(-30),
      assigneeId: o,
      linkedType: 'contact',
      linkedId: contacts[0]!.id,
      createdBy: o,
    },
    {
      type: 'task',
      subject: 'Send revised proposal',
      dueAt: hours(-4),
      assigneeId: o,
      linkedType: 'deal',
      linkedId: deals[2]!.id,
      createdBy: o,
    },
    {
      type: 'meeting',
      subject: 'Clinic rollout kickoff',
      dueAt: hours(26),
      assigneeId: o,
      linkedType: 'deal',
      linkedId: deals[3]!.id,
      createdBy: o,
    },
    {
      type: 'email',
      subject: 'Follow up on pricing',
      dueAt: hours(50),
      assigneeId: p,
      linkedType: 'company',
      linkedId: co(1),
      createdBy: o,
    },
    {
      type: 'task',
      subject: 'Prepare QBR deck',
      dueAt: hours(-72),
      completedAt: hours(-60),
      assigneeId: o,
      createdBy: o,
    },
  ]);
  await t.crmNotes.insert([
    {
      body: 'Alice prefers email over calls. Budget is approved for this quarter.',
      authorId: o,
      linkedType: 'contact',
      linkedId: contacts[0]!.id,
    },
    {
      body: 'Waiting on legal review of the master agreement.',
      authorId: p,
      linkedType: 'deal',
      linkedId: deals[3]!.id,
      mentions: [o],
    },
  ]);
}

// ---- Workspaces ---------------------------------------------------------------------------------------------

const ACME_PEOPLE = [
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

const ACME_SPACES: SpaceSeed[] = [
  {
    key: 'ENG',
    name: 'Engineering',
    description: 'Roadmap, architecture and delivery for the platform.',
    icon: 'code',
    visibility: 'open',
    members: [
      { who: 'owner', type: 'user', role: 'admin' },
      { who: 'priya', type: 'user', role: 'admin' },
      { who: 'viewer', type: 'user', role: 'viewer' },
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

const ACME_ITEMS: Record<string, DemoItem[]> = {
  ENG: [
    { type: 'epic', title: 'Checkout redesign', status: 'In Progress', priority: 'high', description: 'A faster, clearer checkout for returning customers.' },
    { type: 'story', title: 'Let customers save a card for next time', status: 'In Progress', priority: 'high', assignee: 'priya', estimate: 5, dueInDays: 4, parent: 'Checkout redesign', labels: ['payments'], description: 'Tokenise the card with the payment provider.\nShow saved cards on the payment step.' },
    { type: 'subtask', title: 'Add the saved cards table', status: 'Done', assignee: 'ben', parent: 'Let customers save a card for next time' },
    { type: 'subtask', title: 'Show saved cards on the payment step', status: 'To Do', assignee: 'priya', parent: 'Let customers save a card for next time' },
    { type: 'story', title: 'Guest checkout without an account', status: 'To Do', priority: 'medium', estimate: 3, parent: 'Checkout redesign' },
    { type: 'bug', title: 'Payment page crashes with more than twenty line items', status: 'To Do', priority: 'highest', assignee: 'ben', estimate: 3, dueInDays: -3, labels: ['payments', 'regression'] },
    { type: 'task', title: 'Set up error tracking', status: 'Done', priority: 'medium', assignee: 'ben', estimate: 2 },
    { type: 'task', title: 'Update the onboarding copy', status: 'To Do', priority: 'low' },
    { type: 'task', title: 'Review the payment provider contract', status: 'In Review', priority: 'medium', assignee: 'priya', estimate: 1, dueInDays: 1 },
    { type: 'task', title: 'Move CI to the new runners', status: 'In Progress', priority: 'medium', assignee: 'ben', estimate: 8 },
  ],
  OPS: [
    { type: 'task', title: 'Rotate the staging credentials', status: 'To Do', priority: 'high', dueInDays: 2 },
    { type: 'task', title: 'Write the on-call handover notes', status: 'In Progress', priority: 'medium' },
    { type: 'bug', title: 'Backup job reports success on empty dumps', status: 'To Do', priority: 'highest' },
  ],
};

async function seedAcme(db: Db, passwordHash: string) {
  const ctx = await ctxFor(db, 'acme');
  if (!ctx) throw new Error('Run the base seed first (the acme workspace is missing).');
  for (const [h, name, title] of ACME_PEOPLE) await ensurePerson(db, ctx, h, name, title, passwordHash);
  await ensureGroup(ctx, 'Backend', 'Server-side engineering', ['priya', 'ben', 'dmitri']);
  await ensureGroup(ctx, 'BA', 'Business analysis', ['carla', 'elena']);
  await ensureGroup(ctx, 'QA', 'Quality assurance', ['farid', 'grace']);
  await ensureGroup(ctx, 'Design', 'Product and brand design', ['hiro', 'ines', 'member2']);

  const spaceIds = new Map<string, string>();
  for (const [i, s] of ACME_SPACES.entries()) spaceIds.set(s.key, await ensureSpace(ctx, s, 10 - i));
  for (const [key, items] of Object.entries(ACME_ITEMS)) {
    await seedItems(ctx, spaceIds.get(key)!, items, ctx.owner);
  }
  await seedStars(ctx, [
    ['owner', 'ENG'],
    ['owner', 'OPS'],
    ['member', 'ENG'],
  ]);

  // A pending access request, so the inbox has something to show.
  const ops = spaceIds.get('OPS')!;
  const farid = ctx.userId('farid');
  if (!(await ctx.t.spaceAccessRequests.exists({ spaceId: ops, userId: farid, status: { $in: ['pending', 'approved'] } }))) {
    const req = await ctx.t.spaceAccessRequests.insert({
      spaceId: ops,
      userId: farid,
      message: 'I am covering on-call next month and need the runbooks.',
      createdAt: daysAgo(1),
    });
    await ctx.t.auditLogs.insert({
      actorId: farid,
      action: 'space.access_requested',
      targetType: 'space',
      targetId: ops,
      after: { requestId: req.id },
      createdAt: daysAgo(1),
    });
  }

  await seedCheckin(ctx, {
    sites: [
      ['London HQ', '12 Fleet Street, London'],
      ['Colombo Office', '45 Galle Road, Colombo'],
    ],
    holidays: [
      [9, 'Company Day'],
      [30, 'Founders Day'],
    ],
    managers: [
      ['ben', 'priya'],
      ['dmitri', 'priya'],
      ['carla', 'elena'],
      ['grace', 'farid'],
      ['ines', 'hiro'],
    ],
    today: [
      ['priya', 'onsite', 'London HQ', '08:50'],
      ['elena', 'onsite', 'Colombo Office', '09:05'],
      ['ben', 'remote', null, '09:20'],
      ['hiro', 'remote', null, '08:40'],
      ['dmitri', 'offsite', null, '09:30', 'Client workshop'],
    ],
    planned: [
      ['carla', 'leave'],
      ['farid', 'remote'],
    ],
    history: [
      ['priya', 'onsite', 'London HQ'],
      ['ben', 'remote', null],
      ['grace', 'remote', null],
      ['owner', 'onsite', 'London HQ'],
    ],
    forgottenCheckout: 'ben',
  });
  await seedCrm(ctx, 'priya');
  console.log('seeded demo workspace (acme: software)');
}

async function seedGlobex(db: Db, passwordHash: string) {
  const ctx = await ctxFor(db, 'globex');
  if (!ctx) return;
  await ensurePerson(db, ctx, 'rep', 'Rita Rep', 'Account Executive', passwordHash);
  await seedCrm(ctx, 'member');
  const space = await ensureSpace(
    ctx,
    {
      key: 'SALES',
      name: 'Sales follow-ups',
      description: 'Day-to-day follow-ups that sit outside the pipeline.',
      icon: 'chart',
      visibility: 'open',
      members: [
        { who: 'owner', type: 'user', role: 'admin' },
        { who: 'member', type: 'user', role: 'member' },
        { who: 'member2', type: 'user', role: 'member' },
      ],
    },
    8,
  );
  await seedItems(
    ctx,
    space,
    [
      { type: 'task', title: 'Send the revised quote to Initech', status: 'In Progress', assignee: 'member', priority: 'high', dueInDays: 1 },
      { type: 'task', title: 'Book renewal calls for next quarter', status: 'To Do', assignee: 'member2', priority: 'medium' },
      { type: 'task', title: 'Update the pricing one-pager', status: 'To Do', priority: 'low' },
      { type: 'task', title: 'Log last week’s meetings in the CRM', status: 'Done', assignee: 'member' },
    ],
    ctx.owner,
  );
  console.log('seeded demo workspace (globex: sales)');
}

async function seedBuildwell(db: Db, passwordHash: string) {
  const ctx = await ctxFor(db, 'buildwell');
  if (!ctx) return;
  void passwordHash;
  await ensureGroup(ctx, 'Site crew', 'People who work on site', ['foreman', 'worker', 'worker2']);
  const jobs = await ensureSpace(
    ctx,
    {
      key: 'RIVER',
      name: 'Riverside Apartments',
      description: 'Four-storey residential build on the east bank.',
      icon: 'briefcase',
      visibility: 'open',
      members: [
        { who: 'owner', type: 'user', role: 'admin' },
        { who: 'foreman', type: 'user', role: 'admin' },
        { who: 'Site crew', type: 'group', role: 'member' },
        { who: 'inspector', type: 'user', role: 'member' },
      ],
    },
    9,
  );
  const punch = await ensureSpace(
    ctx,
    {
      key: 'PUNCH',
      name: 'Punch list',
      description: 'Defects to close before handover. Private to the site leads.',
      icon: 'bug',
      visibility: 'private',
      members: [
        { who: 'foreman', type: 'user', role: 'admin' },
        { who: 'inspector', type: 'user', role: 'member' },
        { who: 'owner', type: 'user', role: 'viewer' },
      ],
    },
    6,
  );
  await seedItems(
    ctx,
    jobs,
    [
      { type: 'epic', title: 'Level 3 fit-out', status: 'On site', priority: 'high' },
      { type: 'task', title: 'Pour the level 3 slab', status: 'Complete', assignee: 'worker', parent: 'Level 3 fit-out', labels: ['structure'] },
      { type: 'task', title: 'Install electrical conduit on level 3', status: 'On site', assignee: 'worker2', priority: 'high', dueInDays: 3, parent: 'Level 3 fit-out', labels: ['electrical'] },
      { type: 'task', title: 'Frame the internal partitions', status: 'Planned', assignee: 'worker', dueInDays: 7, parent: 'Level 3 fit-out' },
      { type: 'bug', title: 'Cracked beam at gridline C', status: 'Inspection', priority: 'highest', assignee: 'inspector', labels: ['structure'], description: 'Hairline crack found during the pre-pour check.\nStructural engineer to sign off before the next pour.' },
      { type: 'task', title: 'Order the rebar delivery for level 4', status: 'Planned', assignee: 'foreman', dueInDays: 5 },
      { type: 'task', title: 'Scaffold inspection', status: 'Inspection', assignee: 'inspector', dueInDays: -1 },
    ],
    ctx.owner,
  );
  await seedItems(
    ctx,
    punch,
    [
      { type: 'bug', title: 'Paint touch-up in the stairwell', status: 'Planned', priority: 'low' },
      { type: 'bug', title: 'Fire door on level 2 does not self-close', status: 'On site', priority: 'high', assignee: 'foreman' },
      { type: 'bug', title: 'Missing socket cover in flat 3B', status: 'Planned', priority: 'medium', assignee: 'worker2' },
      { type: 'bug', title: 'Loose handrail on the east stair', status: 'Complete', priority: 'high', assignee: 'worker' },
    ],
    ctx.userId('foreman'),
  );
  // The multi-workspace person is only a viewer here, to see a read-only space.
  const multi = await db.global.users.findOne({ email: MULTI_USER.email });
  if (multi) {
    await ctx.t.spaceMembers.insertIgnore({
      spaceId: jobs,
      principalType: 'user',
      principalId: multi.id,
      spaceRole: 'viewer',
    });
  }
  await seedStars(ctx, [
    ['owner', 'RIVER'],
    ['foreman', 'RIVER'],
    ['foreman', 'PUNCH'],
  ]);
  await seedCheckin(ctx, {
    sites: [
      ['Riverside Apartments', 'East bank, plot 12'],
      ['Harbour Warehouse', 'Dock Road 4'],
    ],
    holidays: [[12, 'Site closure']],
    managers: [
      ['worker', 'foreman'],
      ['worker2', 'foreman'],
      ['inspector', 'foreman'],
    ],
    today: [
      ['foreman', 'onsite', 'Riverside Apartments', '07:00'],
      ['worker', 'onsite', 'Riverside Apartments', '07:15'],
      ['worker2', 'onsite', 'Harbour Warehouse', '07:30'],
    ],
    planned: [['inspector', 'remote']],
    history: [
      ['foreman', 'onsite', 'Riverside Apartments'],
      ['worker', 'onsite', 'Riverside Apartments'],
      ['worker2', 'onsite', 'Harbour Warehouse'],
      ['inspector', 'onsite', 'Riverside Apartments'],
    ],
    forgottenCheckout: 'worker2',
  });
  console.log('seeded demo workspace (buildwell: construction)');
}

async function seedBrightly(db: Db) {
  const ctx = await ctxFor(db, 'brightly');
  if (!ctx) return;
  const camp = await ensureSpace(
    ctx,
    {
      key: 'SPRING',
      name: 'Spring campaign',
      description: 'Launch plan, content and channels for the spring push.',
      icon: 'megaphone',
      visibility: 'open',
      members: [
        { who: 'owner', type: 'user', role: 'admin' },
        { who: 'member', type: 'user', role: 'member' },
        { who: 'member2', type: 'user', role: 'member' },
      ],
    },
    7,
  );
  await seedItems(
    ctx,
    camp,
    [
      { type: 'epic', title: 'Spring launch', status: 'Drafting', priority: 'high' },
      { type: 'task', title: 'Write the launch blog post', status: 'Drafting', assignee: 'member', parent: 'Spring launch', dueInDays: 3, labels: ['content'] },
      { type: 'task', title: 'Design the email header', status: 'Review', assignee: 'member2', parent: 'Spring launch', labels: ['design'] },
      { type: 'task', title: 'Schedule social posts', status: 'Ideas', assignee: 'member', labels: ['social'] },
      { type: 'task', title: 'Publish the case study', status: 'Published', assignee: 'member', labels: ['content'] },
    ],
    ctx.owner,
  );
  console.log('seeded demo workspace (brightly: marketing)');
}

export async function seedDemo(uri: string, dbName: string) {
  if (process.env.NODE_ENV === 'production') {
    console.log('demo seed skipped in production');
    return;
  }
  const { db, close } = await createDb(uri, dbName);
  try {
    const passwordHash = await hashPassword(DEV_PASSWORD);
    await seedAcme(db, passwordHash);
    await seedGlobex(db, passwordHash);
    await seedBuildwell(db, passwordHash);
    await seedBrightly(db);
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await seedDemo(uri, process.env.MONGODB_DB ?? 'crewdeck');
}
