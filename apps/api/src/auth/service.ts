import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { OrgRole } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { withTenant, type Db } from '../db/client.js';
import { groupMembers, groups, invitations, memberships, users } from '../db/schema.js';
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
};

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

export async function findOrgBySlug(db: Db, slug: string): Promise<Org | null> {
  const rows = await db.execute<Org>(sql`select * from auth_org_by_slug(${slug})`);
  return rows[0] ?? null;
}

type LookupUser = {
  id: string;
  email: string;
  name: string | null;
  status: AuthUser['status'];
  password_hash: string | null;
  org_role: OrgRole;
};

export async function lookupUserByEmail(db: Db, orgId: string, email: string) {
  const rows = await db.execute<LookupUser>(
    sql`select * from auth_user_by_email(${orgId}, ${email})`,
  );
  return rows[0] ?? null;
}

export async function loadAuthUser(
  db: Db,
  orgId: string,
  userId: string,
): Promise<AuthUser | null> {
  const rows = await withTenant(db, orgId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        timezone: users.timezone,
        // Effective status: a deactivated membership wins over the global user status.
        status: sql<
          AuthUser['status']
        >`case when ${memberships.status} = 'deactivated' then 'deactivated' else ${users.status} end`,
        orgRole: memberships.orgRole,
        crmRole: memberships.crmRole,
      })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, orgId)))
      .where(eq(users.id, userId)),
  );
  return rows[0] ?? null;
}

export async function touchLastLogin(db: Db, orgId: string, userId: string) {
  await withTenant(db, orgId, (tx) =>
    tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)),
  );
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
  const rows = await db.execute<InvitationRow>(
    sql`select * from auth_invitation_by_hash(${sha256(token)})`,
  );
  const inv = rows[0];
  if (!inv || inv.accepted_at || inv.revoked_at || new Date(inv.expires_at) <= new Date()) {
    throw invalidInvite();
  }
  return inv;
}

export async function findPendingInvitation(db: Db, orgId: string, email: string) {
  const rows = await db.execute<{ id: string; org_role: OrgRole; group_ids: string[] }>(
    sql`select * from auth_pending_invitation(${orgId}, ${email})`,
  );
  return rows[0] ?? null;
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

  return withTenant(db, org.id, async (tx) => {
    // Free workspaces accept anyone; paid ones can lock invitations to the company domain.
    const plan = await loadPlan(tx, org.id);
    if (
      org.domain_restricted &&
      hasFeature(plan, 'domain_lock') &&
      !emailMatchesOrg(invitation.email, org)
    ) {
      throw new AppError(403, 'domain_not_allowed', 'This email is not on the workspace domain');
    }
    // Atomic claim so one token cannot be accepted twice concurrently.
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(invitations.id, invitation.id),
          eq(invitations.orgId, org.id),
          sql`accepted_at is null`,
        ),
      )
      .returning({ id: invitations.id });
    if (claimed.length === 0) throw invalidInvite();

    const existing = await tx.execute<{ id: string; password_hash: string | null }>(
      sql`select * from auth_user_id_by_email(${invitation.email})`,
    );
    let userId = existing[0]?.id;
    if (userId) {
      // Pre-existing global identity joining a new tenant. Never overwrite their credentials.
      await tx
        .insert(memberships)
        .values({ orgId: org.id, userId, orgRole: invitation.role })
        .onConflictDoNothing();
      await tx
        .update(users)
        .set({
          status: 'active',
          ...(profile.name ? { name: profile.name } : {}),
          ...(existing[0]!.password_hash ? {} : { passwordHash }),
        })
        .where(eq(users.id, userId));
    } else {
      userId = randomUUID();
      await tx.insert(users).values({
        id: userId,
        email: invitation.email.toLowerCase(),
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        timezone: profile.timezone ?? 'UTC',
        status: 'active',
        passwordHash,
      });
      await tx.insert(memberships).values({ orgId: org.id, userId, orgRole: invitation.role });
    }
    // Groups chosen at invite time. Groups deleted since then are skipped.
    let joinedGroups: string[] = [];
    if (invitation.groupIds?.length) {
      const still = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.orgId, org.id), inArray(groups.id, invitation.groupIds)));
      joinedGroups = still.map((g) => g.id);
      if (joinedGroups.length) {
        await tx
          .insert(groupMembers)
          .values(joinedGroups.map((groupId) => ({ groupId, orgId: org.id, userId: userId! })))
          .onConflictDoNothing();
      }
    }
    await writeAudit(tx, {
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
