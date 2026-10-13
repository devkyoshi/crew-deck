import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { OrgRole } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { emailMatchesOrg } from '../auth/service.js';
import { emailEnabled } from '../config.js';
import { withTenant } from '../db/client.js';
import { groups, invitations, users } from '../db/schema.js';
import type { EnqueueInviteEmail } from '../email/queue.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { likePattern, offsetOf, pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';

const DAY_MS = 24 * 3600 * 1000;
const email = z.string().trim().toLowerCase().email().max(254);
const idParam = z.object({ id: z.string().uuid() });

const status = sql<'pending' | 'accepted' | 'revoked' | 'expired'>`case
  when ${invitations.acceptedAt} is not null then 'accepted'
  when ${invitations.revokedAt} is not null then 'revoked'
  when ${invitations.expiresAt} <= now() then 'expired'
  else 'pending' end`;

type InviteResult = {
  email: string;
  status:
    'invited' | 'already_member' | 'deactivated_member' | 'already_invited' | 'invalid_domain';
  invitationId?: string;
  /** Only present when email delivery is not configured, so an admin can share it by hand. */
  link?: string;
};

export async function invitationRoutes(
  app: FastifyInstance,
  deps: AuthDeps & { enqueueInviteEmail: EnqueueInviteEmail },
) {
  const { db, config } = deps;
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const deliverable = emailEnabled(config);

  const linkFor = (slug: string, token: string) =>
    `${config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', slug)}/accept-invite?token=${encodeURIComponent(token)}`;

  r.get(
    '/invitations',
    {
      preHandler: requireAuth,
      schema: {
        querystring: pageQuery.extend({
          status: z.enum(['pending', 'accepted', 'revoked', 'expired', 'all']).default('pending'),
          q: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'member.invite')) throw forbidden();
      const q = req.query;
      const conds: (SQL | undefined)[] = [eq(invitations.orgId, actor.orgId)];
      if (q.status !== 'all') conds.push(sql`${status} = ${q.status}`);
      if (q.q) conds.push(ilike(invitations.email, likePattern(q.q)));
      const where = and(...conds);

      return withTenant(db, actor.orgId, async (tx) => {
        const items = await tx
          .select({
            id: invitations.id,
            email: invitations.email,
            orgRole: invitations.orgRole,
            status,
            expiresAt: invitations.expiresAt,
            createdAt: invitations.createdAt,
            invitedByName: users.name,
          })
          .from(invitations)
          .leftJoin(users, eq(users.id, invitations.invitedBy))
          .where(where)
          .orderBy(desc(invitations.createdAt), desc(invitations.id))
          .limit(q.pageSize)
          .offset(offsetOf(q));
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(invitations)
          .where(where);
        return { items, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
      });
    },
  );

  r.post(
    '/invitations',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          emails: z.array(email).min(1).max(50),
          orgRole: z.enum(['admin', 'member', 'owner']).default('member'),
          /** Groups the person joins automatically when they accept. */
          groupIds: z.array(z.string().uuid()).max(20).default([]),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'member.invite')) throw forbidden();
      // Only owners can hand out ownership.
      if (req.body.orgRole === 'owner' && actor.orgRole !== 'owner') throw forbidden();
      const emails = [...new Set(req.body.emails)];
      const org = req.org!;
      const expiresAt = new Date(Date.now() + config.INVITE_TTL_DAYS * DAY_MS);
      const jobs: Parameters<EnqueueInviteEmail>[0][] = [];

      const results = await withTenant(db, actor.orgId, async (tx) => {
        const out: InviteResult[] = [];
        const groupIds = [...new Set(req.body.groupIds)];
        if (groupIds.length) {
          const found = await tx
            .select({ id: groups.id })
            .from(groups)
            .where(and(eq(groups.orgId, actor.orgId), inArray(groups.id, groupIds)));
          if (found.length !== groupIds.length) {
            throw new AppError(400, 'invalid_groups', 'One of the selected groups does not exist');
          }
        }
        for (const addr of emails) {
          if (!emailMatchesOrg(addr, org)) {
            out.push({ email: addr, status: 'invalid_domain' });
            continue;
          }
          const member = await tx.execute<{ status: string }>(
            sql`select status from auth_user_by_email(${actor.orgId}, ${addr})`,
          );
          if (member[0]) {
            out.push({
              email: addr,
              status: member[0].status === 'deactivated' ? 'deactivated_member' : 'already_member',
            });
            continue;
          }
          const pending = await tx.execute<{ id: string }>(
            sql`select id from auth_pending_invitation(${actor.orgId}, ${addr})`,
          );
          if (pending[0]) {
            out.push({ email: addr, status: 'already_invited', invitationId: pending[0].id });
            continue;
          }
          const token = randomToken();
          const [row] = await tx
            .insert(invitations)
            .values({
              orgId: actor.orgId,
              email: addr,
              orgRole: req.body.orgRole as OrgRole,
              groupIds,
              tokenHash: sha256(token),
              expiresAt,
              invitedBy: actor.userId,
            })
            .returning({ id: invitations.id });
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'invitation.created',
            targetType: 'invitation',
            targetId: row!.id,
            after: {
              email: addr,
              orgRole: req.body.orgRole,
              ...(groupIds.length ? { groupIds } : {}),
            },
          });
          const link = linkFor(org.slug, token);
          jobs.push({
            orgId: actor.orgId,
            to: addr,
            link,
            orgName: org.name,
            inviterName: req.user!.name ?? req.user!.email,
            expiresInDays: config.INVITE_TTL_DAYS,
          });
          out.push({
            email: addr,
            status: 'invited',
            invitationId: row!.id,
            ...(deliverable ? {} : { link }),
          });
        }
        return out;
      });

      // Queue after commit so a rolled-back batch never sends mail.
      for (const job of jobs) await deps.enqueueInviteEmail(job);
      return { results, emailDelivery: deliverable };
    },
  );

  r.post(
    '/invitations/:id/resend',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'member.invite')) throw forbidden();
      const org = req.org!;
      const token = randomToken();
      const expiresAt = new Date(Date.now() + config.INVITE_TTL_DAYS * DAY_MS);

      const inv = await withTenant(db, actor.orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(invitations)
          .where(and(eq(invitations.id, req.params.id), eq(invitations.orgId, actor.orgId)));
        if (!row) throw notFound('Invitation');
        if (row.acceptedAt)
          throw new AppError(409, 'already_accepted', 'Invitation was already accepted');
        if (row.revokedAt) throw new AppError(409, 'revoked', 'Invitation was revoked');
        // A fresh token replaces the old one, so the previously sent link stops working.
        await tx
          .update(invitations)
          .set({ tokenHash: sha256(token), expiresAt })
          .where(and(eq(invitations.id, row.id), eq(invitations.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'invitation.resent',
          targetType: 'invitation',
          targetId: row.id,
          after: { email: row.email, expiresAt: expiresAt.toISOString() },
        });
        return row;
      });

      const link = linkFor(org.slug, token);
      await deps.enqueueInviteEmail({
        orgId: actor.orgId,
        to: inv.email,
        link,
        orgName: org.name,
        inviterName: req.user!.name ?? req.user!.email,
        expiresInDays: config.INVITE_TTL_DAYS,
      });
      return { ok: true, emailDelivery: deliverable, ...(deliverable ? {} : { link }) };
    },
  );

  r.delete(
    '/invitations/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'member.invite')) throw forbidden();
      await withTenant(db, actor.orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(invitations)
          .where(and(eq(invitations.id, req.params.id), eq(invitations.orgId, actor.orgId)));
        if (!row) throw notFound('Invitation');
        if (row.acceptedAt)
          throw new AppError(409, 'already_accepted', 'Invitation was already accepted');
        if (row.revokedAt) return;
        await tx
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(and(eq(invitations.id, row.id), eq(invitations.orgId, actor.orgId)));
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'invitation.revoked',
          targetType: 'invitation',
          targetId: row.id,
          before: { email: row.email },
        });
      });
      return { ok: true };
    },
  );
}
