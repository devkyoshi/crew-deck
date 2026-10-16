import { randomUUID } from 'node:crypto';
import {
  modulesFor,
  suggestedUsageFor,
  WORKSPACE_TEMPLATES,
  workTypesOf,
  type WorkType,
} from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import type { Db, TenantDb } from '../db/client.js';
import { AppError, isUniqueViolation } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { seedSpaceWork } from '../work/seed.js';

export interface ProvisionInput {
  name: string;
  slug: string;
  /** The email domain recorded for the workspace (the owner's). */
  domain: string;
  ownerEmail: string;
  ownerName?: string | null;
  /** Set for sign-ups, where the owner chose a password. Existing accounts keep their own. */
  ownerPasswordHash?: string | null;
  timezone?: string;
  plan: string;
  trialDays: number;
  domainRestricted: boolean;
  via: 'signup' | 'platform';
  /** 'verified': owner exists now (their email was proven). 'invite': owner joins through an invitation. */
  ownerMode: 'verified' | 'invite';
  /** Sign-up token to consume in the same transaction, so a failure never burns it. */
  consumeTokenHash?: string;
  /** Who created it, for the audit trail (platform admin email or "signup"). */
  createdBy: string;
  /** What the workspace is for, and how the team plans to use it. Drives the template. */
  workType?: WorkType | null;
  /** Every kind of work the company does; the first is the primary one. Falls back to `workType`. */
  workTypes?: readonly string[];
  usage?: string[];
}

export interface Provisioned {
  orgId: string;
  slug: string;
  userId: string | null;
  inviteToken: string | null;
}

const slugTaken = () =>
  new AppError(409, 'slug_taken', 'That address is already taken', {
    slug: 'That address is already taken',
  });

/**
 * Creates a workspace end to end in one transaction: the workspace itself, its settings, its first
 * owner and the plan. Either all of it exists afterwards or none of it does.
 *
 * The workspace type picks a template: it decides which modules are on and is remembered so new spaces
 * start with the matching columns (see WORKSPACE_TEMPLATES in @crew-deck/shared).
 */
export async function provisionWorkspace(db: Db, input: ProvisionInput): Promise<Provisioned> {
  const workTypes = workTypesOf(input.workTypes?.[0] ?? input.workType, input.workTypes);
  const workType = workTypes[0] ?? null;
  const usage = input.usage?.length ? input.usage : suggestedUsageFor(workTypes);
  const modules = modulesFor(workTypes.length ? workTypes : 'other', usage);
  try {
    return await db.globalTx(async (g) => {
      if (input.consumeTokenHash) {
        const used = await g.signupRequests.updateOne(
          { tokenHash: input.consumeTokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
          { usedAt: new Date() },
        );
        if (used === 0) {
          throw new AppError(
            400,
            'invalid_signup_link',
            'This sign-up link is invalid or has expired',
          );
        }
      }
      const trialEnds =
        input.trialDays > 0 ? new Date(Date.now() + input.trialDays * 86_400_000) : null;
      const orgId = randomUUID();
      await g.organizations.insert({
        id: orgId,
        name: input.name,
        slug: input.slug.toLowerCase(),
        domain: input.domain.toLowerCase(),
        planKey: input.plan,
        onTrial: trialEnds !== null,
        trialEndsAt: trialEnds,
        domainRestricted: input.domainRestricted,
        createdVia: input.via,
        workType,
        workTypes,
        usage,
      });
      const t = g.forOrg(orgId);
      await t.tenantSettings.upsert({}, { enabledModules: modules, updatedAt: new Date() }, {
        timezone: input.timezone ?? 'UTC',
      });

      let userId: string | null = null;
      let inviteToken: string | null = null;
      if (input.ownerMode === 'verified') {
        const existing = await g.users.findOne({ email: input.ownerEmail.toLowerCase() });
        userId = existing?.id ?? null;
        if (userId) {
          await g.users.updateOne({ id: userId }, { status: 'active' });
        } else {
          userId = randomUUID();
          await g.users.insert({
            id: userId,
            email: input.ownerEmail.toLowerCase(),
            name: input.ownerName ?? null,
            status: 'active',
            passwordHash: input.ownerPasswordHash ?? null,
            timezone: input.timezone ?? 'UTC',
          });
        }
        await t.memberships.insert({ userId, orgRole: 'owner' });
        // A workspace of a known kind starts with a first space, so the team lands on a real board.
        // One starter space per kind of work; templates that share a space key only get one.
        const keys = new Set<string>();
        for (const type of workTypes) {
          const key = WORKSPACE_TEMPLATES[type].starter.space.key;
          if (keys.has(key)) continue;
          keys.add(key);
          await createStarterSpace(t, type, userId);
        }
      } else {
        inviteToken = randomToken();
        await t.invitations.insert({
          email: input.ownerEmail.toLowerCase(),
          orgRole: 'owner',
          groupIds: [],
          tokenHash: sha256(inviteToken),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        });
      }
      await writeAudit(t, {
        orgId,
        actorId: userId,
        action: 'workspace.created',
        targetType: 'settings',
        targetId: orgId,
        after: {
          plan: input.plan,
          via: input.via,
          createdBy: input.createdBy,
          owner: input.ownerEmail,
          workType,
          workTypes,
        },
      });
      return { orgId, slug: input.slug.toLowerCase(), userId, inviteToken };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw slugTaken();
    throw e;
  }
}

/**
 * The template's first space: the owner as its admin, the template's columns, and a few labels. Only for
 * workspaces whose owner already exists (sign-up, "Create a workspace"); a workspace created by the
 * platform waits for its owner to accept the invitation and starts empty.
 */
async function createStarterSpace(t: TenantDb, workType: WorkType, ownerId: string) {
  const { space, labels } = WORKSPACE_TEMPLATES[workType].starter;
  const created = await t.spaces.insert({
    key: space.key,
    name: space.name,
    description: space.description,
    icon: space.icon,
    visibility: 'open',
    ownerId,
  });
  await seedSpaceWork(t, created.id, { statuses: WORKSPACE_TEMPLATES[workType].statuses });
  await t.spaceMembers.insert({
    spaceId: created.id,
    principalType: 'user',
    principalId: ownerId,
    spaceRole: 'admin',
  });
  if (labels.length) {
    await t.labels.insert(labels.map((l) => ({ spaceId: created.id, name: l.name, color: l.color })));
  }
  await writeAudit(t, {
    orgId: t.orgId,
    actorId: ownerId,
    action: 'space.created',
    targetType: 'space',
    targetId: created.id,
    after: { key: space.key, name: space.name, visibility: 'open', starter: true },
  });
}

