import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OrgRole } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import {
  createMemberWithTemporaryPassword,
  emailMatchesOrg,
  findPendingInvitation,
  lookupUserByEmail,
} from '../auth/service.js';
import { emailEnabled } from '../config.js';
import { withTenant, withTenantTx } from '../db/client.js';
import type { InvitationDoc } from '../db/types.js';
import type { EnqueueInviteEmail } from '../email/queue.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { containsRegex, offsetOf, pageQuery } from '../lib/pagination.js';
import { can } from '../permissions/can.js';
import { assertWithinLimit, countSeats, hasFeature, loadPlan } from '../plans/index.js';

const DAY_MS = 24 * 3600 * 1000;
const email = z.string().trim().toLowerCase().email().max(254);
const idParam = z.object({ id: z.string().uuid() });

type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

const statusOf = (i: InvitationDoc, now = new Date()): InviteStatus =>
  i.acceptedAt ? 'accepted' : i.revokedAt ? 'revoked' : i.expiresAt <= now ? 'expired' : 'pending';

/** Mongo filter equivalent of statusOf. */
function statusFilter(status: InviteStatus, now = new Date()): Record<string, unknown> {
  switch (status) {
    case 'accepted':
      return { acceptedAt: { $ne: null } };
    case 'revoked':
      return { acceptedAt: null, revokedAt: { $ne: null } };
    case 'expired':
      return { acceptedAt: null, revokedAt: null, expiresAt: { $lte: now } };
    default:
      return { acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } };
  }
}

type InviteResult = {
  email: string;
  status:
    | 'invited'
    | 'created'
    | 'already_member'
    | 'deactivated_member'
    | 'already_invited'
    | 'invalid_domain';
  invitationId?: string;
  /** Mode "password": shown to the admin once and never stored. Absent for people who already had a sign-in. */
  temporaryPassword?: string;
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
      const filter: Record<string, unknown> = q.status === 'all' ? {} : statusFilter(q.status);
      if (q.q) filter.email = containsRegex(q.q);

      return withTenant(db, actor.orgId, async (t) => {
        const rows = await t.invitations.find(filter, {
          sort: { createdAt: -1, id: -1 },
          skip: offsetOf(q),
          limit: q.pageSize,
        });
        const total = await t.invitations.count(filter);
        const people = await t.users(rows.map((i) => i.invitedBy).filter((x): x is string => !!x));
        const items = rows.map((i) => ({
          id: i.id,
          email: i.email,
          orgRole: i.orgRole,
          status: statusOf(i),
          expiresAt: i.expiresAt,
          createdAt: i.createdAt,
          invitedByName: i.invitedBy ? (people.get(i.invitedBy)?.name ?? null) : null,
        }));
        return { items, total, page: q.page, pageSize: q.pageSize };
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
          /**
           * email: send the invitation link by mail (default). link: make the link and show it, send nothing.
           * password: create the account now with a temporary password the person must change.
           */
          mode: z.enum(['email', 'link', 'password']).default('email'),
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
      const mode = req.body.mode;

      if (mode === 'password') return createWithPasswords();

      const results = await withTenantTx(db, actor.orgId, async (t) => {
        // A retried transaction must not queue the same mail twice.
        jobs.length = 0;
        const out: InviteResult[] = [];
        const plan = await loadPlan(t, actor.orgId);
        const restricted = org.domain_restricted && hasFeature(plan, 'domain_lock');
        let seatsUsed = await countSeats(t, actor.orgId);
        const groupIds = [...new Set(req.body.groupIds)];
        if (groupIds.length) {
          const found = await t.groups.count({ id: { $in: groupIds } });
          if (found !== groupIds.length) {
            throw new AppError(400, 'invalid_groups', 'One of the selected groups does not exist');
          }
        }
        for (const addr of emails) {
          if (restricted && !emailMatchesOrg(addr, org)) {
            out.push({ email: addr, status: 'invalid_domain' });
            continue;
          }
          const member = await lookupUserByEmail(db, actor.orgId, addr);
          if (member) {
            out.push({
              email: addr,
              status: member.status === 'deactivated' ? 'deactivated_member' : 'already_member',
            });
            continue;
          }
          const pending = await findPendingInvitation(db, actor.orgId, addr);
          if (pending) {
            out.push({ email: addr, status: 'already_invited', invitationId: pending.id });
            continue;
          }
          assertWithinLimit(plan, 'seats', seatsUsed);
          seatsUsed++;
          const token = randomToken();
          const row = await t.invitations.insert({
            email: addr,
            orgRole: req.body.orgRole as OrgRole,
            groupIds,
            tokenHash: sha256(token),
            expiresAt,
            invitedBy: actor.userId,
          });
          await writeAudit(t, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'invitation.created',
            targetType: 'invitation',
            targetId: row.id,
            after: {
              email: addr,
              orgRole: req.body.orgRole,
              ...(groupIds.length ? { groupIds } : {}),
            },
          });
          const link = linkFor(org.slug, token);
          if (mode === 'email') {
            jobs.push({
              orgId: actor.orgId,
              to: addr,
              link,
              orgName: org.name,
              inviterName: req.user!.name ?? req.user!.email,
              expiresInDays: config.INVITE_TTL_DAYS,
            });
          }
          out.push({
            email: addr,
            status: 'invited',
            invitationId: row.id,
            // Link mode always shows the link; email mode only when mail cannot be sent.
            ...(mode === 'link' || !deliverable ? { link } : {}),
          });
        }
        return out;
      });

      // Queue after commit so a rolled-back batch never sends mail.
      for (const job of jobs) await deps.enqueueInviteEmail(job);
      return { results, emailDelivery: deliverable && mode === 'email', mode };

      /** Mode "password": the same checks, then the account exists straight away. */
      async function createWithPasswords() {
        const groupIds = [...new Set(req.body.groupIds)];
        const { plan, restricted, seats } = await withTenantTx(db, actor.orgId, async (t) => {
          const p = await loadPlan(t, actor.orgId);
          if (groupIds.length && (await t.groups.count({ id: { $in: groupIds } })) !== groupIds.length) {
            throw new AppError(400, 'invalid_groups', 'One of the selected groups does not exist');
          }
          return {
            plan: p,
            restricted: org.domain_restricted && hasFeature(p, 'domain_lock'),
            seats: await countSeats(t, actor.orgId),
          };
        });
        let seatsUsed = seats;
        const out: InviteResult[] = [];
        for (const addr of emails) {
          if (restricted && !emailMatchesOrg(addr, org)) {
            out.push({ email: addr, status: 'invalid_domain' });
            continue;
          }
          const member = await lookupUserByEmail(db, actor.orgId, addr);
          if (member) {
            out.push({
              email: addr,
              status: member.status === 'deactivated' ? 'deactivated_member' : 'already_member',
            });
            continue;
          }
          const pending = await findPendingInvitation(db, actor.orgId, addr);
          if (pending) {
            out.push({ email: addr, status: 'already_invited', invitationId: pending.id });
            continue;
          }
          assertWithinLimit(plan, 'seats', seatsUsed);
          seatsUsed++;
          const made = await createMemberWithTemporaryPassword(db, org, {
            email: addr,
            role: req.body.orgRole as OrgRole,
            groupIds,
            invitedBy: actor.userId,
          });
          out.push({
            email: addr,
            status: 'created',
            ...(made.temporaryPassword ? { temporaryPassword: made.temporaryPassword } : {}),
          });
        }
        return { results: out, emailDelivery: false, mode };
      }
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

      const inv = await withTenantTx(db, actor.orgId, async (t) => {
        const row = await t.invitations.get(req.params.id);
        if (!row) throw notFound('Invitation');
        if (row.acceptedAt)
          throw new AppError(409, 'already_accepted', 'Invitation was already accepted');
        if (row.revokedAt) throw new AppError(409, 'revoked', 'Invitation was revoked');
        // A fresh token replaces the old one, so the previously sent link stops working.
        await t.invitations.updateOne({ id: row.id }, { tokenHash: sha256(token), expiresAt });
        await writeAudit(t, {
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
      await withTenantTx(db, actor.orgId, async (t) => {
        const row = await t.invitations.get(req.params.id);
        if (!row) throw notFound('Invitation');
        if (row.acceptedAt)
          throw new AppError(409, 'already_accepted', 'Invitation was already accepted');
        if (row.revokedAt) return;
        await t.invitations.updateOne({ id: row.id }, { revokedAt: new Date() });
        await writeAudit(t, {
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
