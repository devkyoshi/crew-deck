import { randomUUID } from 'node:crypto';
import type { OrgRole } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { withTenant, type Db } from '../db/client.js';
import type { OrganizationDoc } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { hasFeature, loadPlan } from '../plans/index.js';
import { hashPassword } from './password.js';

export type Org = {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: 'active' | 'suspended';
  suspended_reason: string | null;
  logo_url: string | null;
  accent_color: string | null;
  domain_restricted: boolean;
  work_type: string | null;
  usage: string[];
};

export const toOrg = (o: OrganizationDoc): Org => ({
  id: o.id,
  name: o.name,
  slug: o.slug,
  domain: o.domain,
  status: o.status,
  suspended_reason: o.suspendedReason,
  logo_url: o.logoUrl,
  accent_color: o.accentColor,
  domain_restricted: o.domainRestricted,
  work_type: o.workType,
  usage: o.usage ?? [],
});

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string;
  status: 'invited' | 'active' | 'deactivated';
  orgRole: OrgRole;
  crmRole: 'none' | 'viewer' | 'member' | 'admin';
}

export const emailDomain = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
export const emailMatchesOrg = (email: string, org: Org) =>
  emailDomain(email) === org.domain.toLowerCase();

/** Extracts the tenant slug from a host header: acme.localhost:3000 -> acme. */
export function tenantSlugFromHost(host: string | undefined, baseDomain: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
}

// Sign-in happens before a tenant is known, so these lookups use the global scope on purpose.
// Each takes a narrow key and returns the minimum needed, never a list.

export async function findOrgBySlug(db: Db, slug: string): Promise<Org | null> {
  const o = await db.global.organizations.findOne({ slug: slug.toLowerCase() });
  return o ? toOrg(o) : null;
}

export async function findOrgById(db: Db, id: string): Promise<Org | null> {
  const o = await db.global.organizations.findOne({ id });
  return o ? toOrg(o) : null;
}

type LookupUser = {
  id: string;
  email: string;
  name: string | null;
  status: AuthUser['status'];
  password_hash: string | null;
  org_role: OrgRole;
};

/** A member of the workspace by email. The status is the effective one: a deactivated membership wins. */
export async function lookupUserByEmail(
  db: Db,
  orgId: string,
  email: string,
): Promise<LookupUser | null> {
  const u = await db.global.users.findOne({ email: email.toLowerCase() });
  if (!u) return null;
  const m = await db.global.all.memberships.findOne({ orgId, userId: u.id });
  if (!m) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: m.status === 'deactivated' ? 'deactivated' : u.status,
    password_hash: u.passwordHash,
    org_role: m.orgRole,
  };
}

export async function loadAuthUser(
  db: Db,
  orgId: string,
  userId: string,
): Promise<AuthUser | null> {
  const t = db.tenant(orgId);
  const m = await t.memberships.findOne({ userId });
  if (!m) return null;
  const u = (await t.users([userId])).get(userId);
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    timezone: u.timezone,
    // Effective status: a deactivated membership wins over the global user status.
    status: m.status === 'deactivated' ? 'deactivated' : u.status,
    orgRole: m.orgRole,
    crmRole: m.crmRole,
  };
}

export async function touchLastLogin(db: Db, orgId: string, userId: string) {
  await db.tenant(orgId).updateUser(userId, { lastLoginAt: new Date() });
}

/** The workspaces a person can switch between (active membership, active workspace). */
export async function listUserOrgs(db: Db, userId: string) {
  const ms = await db.global.all.memberships.find({ userId, status: 'active' });
  if (ms.length === 0) return [];
  const orgs = await db.global.organizations.find({
    id: { $in: ms.map((m) => m.orgId) },
    status: 'active',
  });
  const roleOf = new Map(ms.map((m) => [m.orgId, m.orgRole]));
  return orgs
    .map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      orgRole: roleOf.get(o.id)!,
      workType: o.workType,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type InvitationRow = {
  id: string;
  org_id: string;
  email: string;
  org_role: OrgRole;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  group_ids: string[];
};

const invalidInvite = () =>
  new AppError(400, 'invalid_invitation', 'This invitation is invalid or has expired');

/** Looks up a usable invitation by raw token. Same error for unknown, used, revoked and expired. */
export async function findUsableInvitation(db: Db, token: string): Promise<InvitationRow> {
  const i = await db.global.all.invitations.findOne({ tokenHash: sha256(token) });
  if (!i || i.acceptedAt || i.revokedAt || i.expiresAt <= new Date()) throw invalidInvite();
  return {
    id: i.id,
    org_id: i.orgId,
    email: i.email,
    org_role: i.orgRole,
    expires_at: i.expiresAt,
    accepted_at: i.acceptedAt,
    revoked_at: i.revokedAt,
    group_ids: i.groupIds,
  };
}

export async function findPendingInvitation(db: Db, orgId: string, email: string) {
  const i = await db.global.all.invitations.findOne(
    {
      orgId,
      email: email.toLowerCase(),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } },
  );
  return i ? { id: i.id, org_role: i.orgRole, group_ids: i.groupIds } : null;
}

export interface AcceptProfile {
  name?: string;
  password?: string;
  timezone?: string;
  avatarUrl?: string;
}

/**
 * Accepts an invitation: creates the user if new (or reuses the global identity), adds the
 * membership with the invited role, and marks the invitation used. Runs in the invitation's tenant.
 */
export async function acceptInvitation(
  db: Db,
  org: Org,
  invitation: { id: string; email: string; role: OrgRole; groupIds?: string[] },
  profile: AcceptProfile,
): Promise<string> {
  const passwordHash = profile.password ? await hashPassword(profile.password) : null;

  // Free workspaces accept anyone; paid ones can lock invitations to the company domain.
  const plan = await withTenant(db, org.id, (t) => loadPlan(t, org.id));
  if (
    org.domain_restricted &&
    hasFeature(plan, 'domain_lock') &&
    !emailMatchesOrg(invitation.email, org)
  ) {
    throw new AppError(403, 'domain_not_allowed', 'This email is not on the workspace domain');
  }

  return db.globalTx(async (g) => {
    const t = g.forOrg(org.id);
    // Atomic claim so one token cannot be accepted twice concurrently.
    const claimed = await t.invitations.updateOne(
      { id: invitation.id, acceptedAt: null },
      { acceptedAt: new Date() },
    );
    if (claimed === 0) throw invalidInvite();

    const existing = await g.users.findOne({ email: invitation.email.toLowerCase() });
    let userId = existing?.id;
    if (userId) {
      // Pre-existing global identity joining a new tenant. Never overwrite their credentials.
      await t.memberships.insertIgnore({ userId, orgRole: invitation.role });
      await g.users.updateOne(
        { id: userId },
        {
          status: 'active',
          ...(profile.name ? { name: profile.name } : {}),
          ...(existing!.passwordHash ? {} : { passwordHash }),
        },
      );
    } else {
      userId = randomUUID();
      await g.users.insert({
        id: userId,
        email: invitation.email.toLowerCase(),
        name: profile.name ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        timezone: profile.timezone ?? 'UTC',
        status: 'active',
        passwordHash,
      });
      await t.memberships.insert({ userId, orgRole: invitation.role });
    }
    // Groups chosen at invite time. Groups deleted since then are skipped.
    let joinedGroups: string[] = [];
    if (invitation.groupIds?.length) {
      const still = await t.groups.find({ id: { $in: invitation.groupIds } });
      joinedGroups = still.map((x) => x.id);
      for (const groupId of joinedGroups) {
        await t.groupMembers.insertIgnore({ groupId, userId });
      }
    }
    await writeAudit(t, {
      orgId: org.id,
      actorId: userId,
      action: 'invitation.accepted',
      targetType: 'invitation',
      targetId: invitation.id,
      after: {
        email: invitation.email.toLowerCase(),
        orgRole: invitation.role,
        ...(joinedGroups.length ? { groupIds: joinedGroups } : {}),
      },
    });
    return userId;
  });
}
