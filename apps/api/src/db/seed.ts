import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { modulesFor, usageNeedsCrm, WORKSPACE_TEMPLATES, type ModuleKey, type WorkType } from '@crew-deck/shared';
import { hashPassword } from '../auth/password.js';
import { sha256 } from '../lib/crypto.js';
import { createDb, type Db, type TenantDb } from './client.js';
import { ensureIndexes } from './indexes.js';
import { ensurePlans } from './reference.js';
import type { CrmRole, OrgRole } from './types.js';

/**
 * Dev-only fixtures: workspaces of different kinds and one login per role, so every screen can be seen
 * the way each person sees it. Skipped when NODE_ENV=production.
 *
 * Every dev account uses DEV_PASSWORD. The API does not enforce a minimum length when signing in, so the
 * short dev password works here; real sign-ups still require 10 characters.
 */
export const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'dev@1234';
export const DEV_INVITE_TOKEN = 'dev-invite-acme-token-0001';

export interface DevPerson {
  handle: string;
  name: string;
  title: string;
  role: OrgRole;
  crmRole?: CrmRole;
  /** Deactivated in this workspace (cannot sign in there). */
  deactivated?: boolean;
}

export interface DevWorkspace {
  name: string;
  slug: string;
  domain: string;
  workType: WorkType;
  /** null = internal workspace with no plan limits. */
  plan: string | null;
  onTrial?: boolean;
  suspended?: boolean;
  /** Modules switched on beyond the template, so the demo data is visible. */
  extraModules?: ModuleKey[];
  ownerEmail: string;
  ownerName: string;
  people: DevPerson[];
}

/** Compat: the two original tenants, now part of a larger set. */
export const DEMO_TENANTS = [
  {
    name: 'Acme Inc',
    slug: 'acme',
    domain: 'acme.test',
    ownerEmail: 'owner@acme.test',
    ownerName: 'Alice Acme',
  },
  {
    name: 'Globex Corp',
    slug: 'globex',
    domain: 'globex.test',
    ownerEmail: 'owner@globex.test',
    ownerName: 'Gary Globex',
  },
];

export const DEV_WORKSPACES: DevWorkspace[] = [
  {
    name: 'Acme Inc',
    slug: 'acme',
    domain: 'acme.test',
    workType: 'software',
    plan: 'business',
    extraModules: ['crm'],
    ownerEmail: 'owner@acme.test',
    ownerName: 'Alice Acme',
    people: [
      { handle: 'admin', name: 'Ada Admin', title: 'Operations', role: 'admin' },
      { handle: 'member', name: 'Mia Member', title: 'Engineer', role: 'member' },
      { handle: 'member2', name: 'Max Member', title: 'Designer', role: 'member' },
      { handle: 'viewer', name: 'Vera Viewer', title: 'Auditor', role: 'member', crmRole: 'none' },
      {
        handle: 'deactivated',
        name: 'Dan Deactivated',
        title: 'Former contractor',
        role: 'member',
        deactivated: true,
      },
    ],
  },
  {
    name: 'Globex Corp',
    slug: 'globex',
    domain: 'globex.test',
    workType: 'sales',
    plan: null,
    ownerEmail: 'owner@globex.test',
    ownerName: 'Gary Globex',
    people: [
      { handle: 'admin', name: 'Gina Admin', title: 'Sales Operations', role: 'admin' },
      { handle: 'member', name: 'Gus Member', title: 'Account Executive', role: 'member' },
      { handle: 'member2', name: 'Gwen Member', title: 'SDR', role: 'member' },
    ],
  },
  {
    name: 'Buildwell Construction',
    slug: 'buildwell',
    domain: 'buildwell.test',
    workType: 'construction',
    plan: 'team',
    ownerEmail: 'owner@buildwell.test',
    ownerName: 'Bella Buildwell',
    people: [
      { handle: 'foreman', name: 'Frank Foreman', title: 'Site Foreman', role: 'admin' },
      { handle: 'worker', name: 'Wes Worker', title: 'Carpenter', role: 'member' },
      { handle: 'worker2', name: 'Willa Worker', title: 'Electrician', role: 'member' },
      { handle: 'inspector', name: 'Ivy Inspector', title: 'Site Inspector', role: 'member' },
    ],
  },
  {
    name: 'Brightly Marketing',
    slug: 'brightly',
    domain: 'brightly.test',
    workType: 'marketing',
    plan: 'free',
    ownerEmail: 'owner@brightly.test',
    ownerName: 'Bo Brightly',
    people: [
      { handle: 'member', name: 'Maya Marketer', title: 'Content Lead', role: 'member' },
      { handle: 'member2', name: 'Milo Marketer', title: 'Designer', role: 'member' },
    ],
  },
  {
    name: 'Suspended Co',
    slug: 'suspended',
    domain: 'suspended.test',
    workType: 'other',
    plan: 'free',
    suspended: true,
    ownerEmail: 'owner@suspended.test',
    ownerName: 'Sam Suspended',
    people: [],
  },
];

/** One person who belongs to several workspaces, to try the workspace switcher. */
export const MULTI_USER = {
  email: 'multi@crewdeck.test',
  name: 'Morgan Multi',
  title: 'Consultant',
  memberships: [
    { slug: 'acme', role: 'member' as OrgRole },
    { slug: 'globex', role: 'admin' as OrgRole },
    { slug: 'buildwell', role: 'member' as OrgRole },
    { slug: 'brightly', role: 'owner' as OrgRole },
  ],
};

export const PLATFORM_ADMIN = { email: 'platform@crewdeck.test', name: 'Platform Admin' };

/** Finds or creates a user, optionally resetting their password. Returns the user's id. */
async function upsertUser(
  db: Db,
  u: { email: string; name: string; title?: string; passwordHash: string | null },
) {
  const email = u.email.toLowerCase();
  const existing = await db.global.users.findOne({ email });
  if (existing) {
    await db.global.users.updateOne(
      { id: existing.id },
      {
        name: u.name,
        status: 'active',
        ...(u.title ? { jobTitle: u.title } : {}),
        ...(u.passwordHash ? { passwordHash: u.passwordHash } : {}),
      },
    );
    return existing.id;
  }
  const row = await db.global.users.insert({
    email,
    name: u.name,
    jobTitle: u.title ?? null,
    status: 'active',
    passwordHash: u.passwordHash,
  });
  return row.id;
}

async function upsertMembership(
  t: TenantDb,
  userId: string,
  role: OrgRole,
  extra: { crmRole?: CrmRole; deactivated?: boolean } = {},
) {
  const existing = await t.memberships.findOne({ userId });
  const set = {
    orgRole: role,
    status: extra.deactivated ? ('deactivated' as const) : ('active' as const),
    deactivatedAt: extra.deactivated ? new Date() : null,
    ...(extra.crmRole ? { crmRole: extra.crmRole } : {}),
  };
  if (existing) await t.memberships.updateOne({ userId }, set);
  else await t.memberships.insert({ userId, ...set });
}

/** Idempotent. Creates indexes and plans, then (outside production) the dev workspaces and logins. */
export async function seed(uri: string, dbName: string) {
  const { db, close } = await createDb(uri, dbName);
  const dev = process.env.NODE_ENV !== 'production';
  const passwordHash = dev ? await hashPassword(DEV_PASSWORD) : null;
  try {
    await ensureIndexes(db.handle);
    await ensurePlans(db);
    if (!dev) return;

    const orgIds = new Map<string, string>();
    for (const w of DEV_WORKSPACES) {
      const template = WORKSPACE_TEMPLATES[w.workType];
      // A workspace seeded with the CRM also says it tracks leads, as the settings page expects.
      const usage = w.extraModules?.includes('crm') && !usageNeedsCrm(template.suggestedUsage)
        ? [...template.suggestedUsage, 'track_leads']
        : template.suggestedUsage;
      let org = await db.global.organizations.findOne({ slug: w.slug });
      if (!org) {
        org = await db.global.organizations.insert({
          id: randomUUID(),
          name: w.name,
          slug: w.slug,
          domain: w.domain,
          workType: w.workType,
          usage,
          planKey: w.plan,
          onTrial: w.onTrial ?? false,
          status: w.suspended ? 'suspended' : 'active',
          suspendedAt: w.suspended ? new Date() : null,
          suspendedReason: w.suspended ? 'Seeded as suspended to try the platform console' : null,
        });
      } else {
        await db.global.organizations.updateOne(
          { id: org.id },
          { name: w.name, workType: w.workType, usage, planKey: w.plan },
        );
      }
      orgIds.set(w.slug, org.id);
      const t = db.global.forOrg(org.id);
      await t.tenantSettings.upsert(
        {},
        {
          enabledModules: [...new Set([...modulesFor(w.workType, usage), ...(w.extraModules ?? [])])],
          updatedAt: new Date(),
        },
        { timezone: 'UTC' },
      );

      const ownerId = await upsertUser(db, {
        email: w.ownerEmail,
        name: w.ownerName,
        passwordHash,
      });
      await upsertMembership(t, ownerId, 'owner');
      for (const p of w.people) {
        const id = await upsertUser(db, {
          email: `${p.handle}@${w.domain}`,
          name: p.name,
          title: p.title,
          passwordHash,
        });
        await upsertMembership(t, id, p.role, { crmRole: p.crmRole, deactivated: p.deactivated });
      }
      if (w.slug === 'acme') {
        if (!(await t.invitations.exists({ email: 'newbie@acme.test', acceptedAt: null }))) {
          await t.invitations.insert({
            email: 'newbie@acme.test',
            orgRole: 'member',
            tokenHash: sha256(DEV_INVITE_TOKEN),
            expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
            invitedBy: ownerId,
          });
        }
      }
      console.log(`seeded ${w.slug}`);
    }

    // The multi-workspace person.
    const multiId = await upsertUser(db, {
      email: MULTI_USER.email,
      name: MULTI_USER.name,
      title: MULTI_USER.title,
      passwordHash,
    });
    for (const m of MULTI_USER.memberships) {
      await upsertMembership(db.global.forOrg(orgIds.get(m.slug)!), multiId, m.role);
    }

    // Platform settings back to their defaults (open sign-ups, free email allowed, 14-day trial), so a
    // reseed also undoes anything a test or a person changed in the console.
    await db.global.platformSettings.upsert(
      { id: 'singleton' },
      { blockFreeEmailDomains: false, signupsEnabled: true, trialDays: 14, updatedAt: new Date() },
    );

    // A platform admin for the console at /platform (development only; production uses create-platform-admin).
    const admin = await db.global.platformAdmins.findOne({ email: PLATFORM_ADMIN.email });
    if (admin) {
      await db.global.platformAdmins.updateOne({ id: admin.id }, { passwordHash: passwordHash! });
    } else {
      await db.global.platformAdmins.insert({
        email: PLATFORM_ADMIN.email,
        name: PLATFORM_ADMIN.name,
        passwordHash: passwordHash!,
      });
    }
    console.log('seeded platform admin and the multi-workspace user');
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await seed(uri, process.env.MONGODB_DB ?? 'crewdeck');
}
