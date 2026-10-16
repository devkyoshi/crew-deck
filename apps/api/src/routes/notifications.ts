import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, type TenantDb } from '../db/client.js';
import { EMAIL_DELAY_DEFAULT_MINUTES, QUIET_HOURS_DEFAULT } from '@crew-deck/shared';
import { isValidTime } from '../messaging/quiet.js';
import type { NotificationType } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { describeNotification } from '../work/notify-jobs.js';
import { digestOf, NOTIFICATION_TYPES, preferencesOf } from '../work/notify.js';

const typeEnum = z.enum(NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]]);

/** The caller's own notifications and their channel preferences. Nobody can read anyone else's. */
/** Chat settings with their defaults, for the preferences screen. */
async function messagingSettings(t: TenantDb, userId: string) {
  const row = await t.notificationPrefs.findOne({ userId });
  return {
    quiet: row?.quiet ?? QUIET_HOURS_DEFAULT,
    emailDelayMinutes: row?.emailDelayMinutes ?? EMAIL_DELAY_DEFAULT_MINUTES,
    desktop: row?.desktop === true,
  };
}

export async function notificationRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/notifications',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          unread: z.enum(['1']).optional(),
          cursor: z.string().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { unread, cursor, limit } = req.query;
      return withTenant(deps.db, actor.orgId, async (t) => {
        const filter: Record<string, unknown> = { userId: actor.userId, hidden: { $ne: true } };
        if (unread) filter.readAt = null;
        if (cursor) {
          const at = new Date(cursor);
          if (Number.isNaN(at.getTime()))
            throw new AppError(400, 'bad_cursor', 'That page marker is not valid');
          filter.createdAt = { $lt: at };
        }
        const rows = await t.notifications.find(filter, {
          sort: { createdAt: -1 },
          limit: limit + 1,
        });
        const page = rows.slice(0, limit);
        const people = await t.users(page.map((n) => n.actorId ?? ''));
        const unreadCount = await t.notifications.count({
          userId: actor.userId,
          hidden: { $ne: true },
          readAt: null,
        });
        return {
          items: page.map((n) => {
            const a = n.actorId ? people.get(n.actorId) : undefined;
            return {
              id: n.id,
              type: n.type,
              itemId: n.itemId,
              data: n.data,
              text: describeNotification(n, a ? (a.name ?? a.email) : null),
              actor: a ? { id: a.id, name: a.name, email: a.email, avatarUrl: a.avatarUrl } : null,
              readAt: n.readAt,
              createdAt: n.createdAt,
            };
          }),
          unreadCount,
          nextCursor: rows.length > limit ? page.at(-1)!.createdAt.toISOString() : null,
        };
      });
    },
  );

  r.get('/notifications/count', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => ({
      unread: await t.notifications.count({
        userId: actor.userId,
        hidden: { $ne: true },
        readAt: null,
      }),
    }));
  });

  r.post(
    '/notifications/read',
    {
      preHandler: requireAuth,
      schema: {
        body: z.union([
          z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }),
          z.object({ all: z.literal(true) }),
        ]),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const filter: Record<string, unknown> = { userId: actor.userId, readAt: null };
        if ('ids' in req.body) filter.id = { $in: req.body.ids };
        const updated = await t.notifications.updateMany(filter, { readAt: new Date() });
        return { updated };
      });
    },
  );

  r.get('/me/notification-preferences', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => ({
      preferences: await preferencesOf(t, actor.userId),
      digest: await digestOf(t, actor.userId),
      ...(await messagingSettings(t, actor.userId)),
    }));
  });

  r.put(
    '/me/notification-preferences',
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          preferences: z
            .partialRecord(typeEnum, z.object({ inApp: z.boolean(), email: z.boolean() }))
            .optional(),
          digest: z.boolean().optional(),
          /** Chat: quiet hours (HH:MM in the person's timezone), email delay and desktop alerts. */
          quiet: z
            .object({
              enabled: z.boolean(),
              start: z.string().refine(isValidTime),
              end: z.string().refine(isValidTime),
            })
            .optional(),
          emailDelayMinutes: z
            .number()
            .int()
            .min(1)
            .max(24 * 60)
            .optional(),
          desktop: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const current = await preferencesOf(t, actor.userId);
        const settings = { ...current, ...req.body.preferences };
        const digest = req.body.digest ?? (await digestOf(t, actor.userId));
        const { quiet, emailDelayMinutes, desktop } = req.body;
        await t.notificationPrefs.upsert({ userId: actor.userId }, {
          settings,
          digest,
          updatedAt: new Date(),
          ...(quiet ? { quiet } : {}),
          ...(emailDelayMinutes !== undefined ? { emailDelayMinutes } : {}),
          ...(desktop !== undefined ? { desktop } : {}),
        } as never);
        return {
          preferences: await preferencesOf(t, actor.userId),
          digest,
          ...(await messagingSettings(t, actor.userId)),
        };
      });
    },
  );
}
