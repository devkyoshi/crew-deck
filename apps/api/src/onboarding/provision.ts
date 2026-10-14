import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { writeAudit } from '../audit/service.js';
import type { Db } from '../db/client.js';
import { invitations, memberships, tenantSettings, users } from '../db/schema.js';
import { AppError, isUniqueViolation } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';

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
 */
export async function provisionWorkspace(db: Db, input: ProvisionInput): Promise<Provisioned> {
  try {
    return await db.transaction(async (tx) => {
      if (input.consumeTokenHash) {
        const used = await tx.execute<{ id: string }>(
          sql`select id from signup_request_consume(${input.consumeTokenHash})`,
        );
        if (!used[0]) {
          throw new AppError(
            400,
            'invalid_signup_link',
            'This sign-up link is invalid or has expired',
          );
        }
      }
      const trialEnds =
        input.trialDays > 0 ? new Date(Date.now() + input.trialDays * 86_400_000) : null;
      const created = await tx.execute<{ id: string }>(sql`
        select platform_create_org(${input.name}, ${input.slug}, ${input.domain}, ${input.plan},
          ${trialEnds !== null}, ${trialEnds ? trialEnds.toISOString() : null}::timestamptz, ${input.domainRestricted}, ${input.via}) as id`);
      const orgId = created[0]!.id;
      await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
      await tx.insert(tenantSettings).values({ orgId }).onConflictDoNothing();

      let userId: string | null = null;
      let inviteToken: string | null = null;
      if (input.ownerMode === 'verified') {
        const existing = await tx.execute<{ id: string }>(
          sql`select id from auth_user_id_by_email(${input.ownerEmail})`,
        );
        userId = existing[0]?.id ?? null;
        if (userId) {
          await tx
            .update(users)
            .set({ status: 'active' })
            .where(sql`id = ${userId}`);
        } else {
          // The id is chosen here (not RETURNING) because the person is only visible to this workspace
          // once their membership exists.
          userId = randomUUID();
          await tx.insert(users).values({
            id: userId,
            email: input.ownerEmail.toLowerCase(),
            name: input.ownerName ?? null,
            status: 'active',
            passwordHash: input.ownerPasswordHash ?? null,
            timezone: input.timezone ?? 'UTC',
          });
        }
        await tx.insert(memberships).values({ orgId, userId, orgRole: 'owner' });
      } else {
        inviteToken = randomToken();
        await tx.insert(invitations).values({
          orgId,
          email: input.ownerEmail.toLowerCase(),
          orgRole: 'owner',
          groupIds: [],
          tokenHash: sha256(inviteToken),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        });
      }
      await writeAudit(tx, {
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
        },
      });
      return { orgId, slug: input.slug.toLowerCase(), userId, inviteToken };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw slugTaken();
    throw e;
  }
}
