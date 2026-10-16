import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { channelNameSchema, NOTIFICATION_LEVELS, S2C } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import {
  addMembers,
  browseChannels,
  createChannel,
  deleteChannel,
  getChannel,
  joinChannel,
  listMembers,
  listMyChannels,
  openDm,
  removeMember,
  setArchived,
  setMemberRole,
  updateChannel,
  updateMyMembership,
} from '../messaging/channels.js';
import type { MessagingCtx } from '../messaging/context.js';
import {
  deleteMessage,
  editMessage,
  getMessage,
  listMessages,
  sendMessage,
} from '../messaging/messages.js';
import { announcePresence, Presence } from '../messaging/presence.js';
import { markAllRead, markUnread, myUnreads, setRead } from '../messaging/read-state.js';
import type { Redis } from 'ioredis';

const id = z.object({ id: z.string().uuid() });
const uuids = z.array(z.string().uuid()).min(1).max(200);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export interface MessagingDeps extends AuthDeps {
  messaging: MessagingCtx;
  redis: Redis;
}

/** Channels, direct messages, messages, read state and presence. Thin: the services hold the rules. */
export async function messagingRoutes(app: FastifyInstance, deps: MessagingDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ctx = deps.messaging;
  const presence = new Presence(deps.redis);
  const pre = { preHandler: requireAuth };

  // ---- Channels -----------------------------------------------------------------------------------

  r.get('/channels', pre, async (req) => ({ channels: await listMyChannels(ctx, actorOf(req)) }));

  r.get(
    '/channels/browse',
    { ...pre, schema: { querystring: z.object({ search: z.string().max(80).optional() }) } },
    async (req) => ({
      channels: await browseChannels(ctx, actorOf(req), { search: req.query.search }),
    }),
  );

  r.post(
    '/channels',
    {
      ...pre,
      schema: {
        body: z.object({
          name: channelNameSchema,
          type: z.enum(['public', 'private']),
          topic: text(250).optional(),
          description: text(1000).optional(),
          isAnnouncement: z.boolean().optional(),
          memberIds: z.array(z.string().uuid()).max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      reply.status(201);
      return { channel: await createChannel(ctx, actorOf(req), req.body) };
    },
  );

  r.get('/channels/:id', { ...pre, schema: { params: id } }, async (req) => ({
    channel: await getChannel(ctx, actorOf(req), req.params.id),
  }));

  r.patch(
    '/channels/:id',
    {
      ...pre,
      schema: {
        params: id,
        body: z.object({
          name: channelNameSchema.optional(),
          topic: text(250).optional(),
          description: text(1000).optional(),
          isAnnouncement: z.boolean().optional(),
        }),
      },
    },
    async (req) => ({ channel: await updateChannel(ctx, actorOf(req), req.params.id, req.body) }),
  );

  r.post('/channels/:id/archive', { ...pre, schema: { params: id } }, async (req) => ({
    channel: await setArchived(ctx, actorOf(req), req.params.id, true),
  }));
  r.post('/channels/:id/unarchive', { ...pre, schema: { params: id } }, async (req) => ({
    channel: await setArchived(ctx, actorOf(req), req.params.id, false),
  }));
  r.delete('/channels/:id', { ...pre, schema: { params: id } }, async (req, reply) => {
    await deleteChannel(ctx, actorOf(req), req.params.id);
    return reply.status(204).send();
  });

  r.post(
    '/dms',
    { ...pre, schema: { body: z.object({ userIds: z.array(z.string().uuid()).max(8) }) } },
    async (req) => ({ channel: await openDm(ctx, actorOf(req), req.body.userIds) }),
  );

  // ---- Membership ---------------------------------------------------------------------------------

  r.get('/channels/:id/members', { ...pre, schema: { params: id } }, async (req) => ({
    members: await listMembers(ctx, actorOf(req), req.params.id),
  }));
  r.post(
    '/channels/:id/members',
    { ...pre, schema: { params: id, body: z.object({ userIds: uuids }) } },
    async (req) => addMembers(ctx, actorOf(req), req.params.id, req.body.userIds),
  );
  r.delete(
    '/channels/:id/members/:userId',
    { ...pre, schema: { params: id.extend({ userId: z.string().uuid() }) } },
    async (req, reply) => {
      await removeMember(ctx, actorOf(req), req.params.id, req.params.userId);
      return reply.status(204).send();
    },
  );
  r.patch(
    '/channels/:id/members/:userId',
    {
      ...pre,
      schema: {
        params: id.extend({ userId: z.string().uuid() }),
        body: z.object({ role: z.enum(['owner', 'member']) }),
      },
    },
    async (req, reply) => {
      await setMemberRole(ctx, actorOf(req), req.params.id, req.params.userId, req.body.role);
      return reply.status(204).send();
    },
  );
  r.post('/channels/:id/join', { ...pre, schema: { params: id } }, async (req, reply) => {
    await joinChannel(ctx, actorOf(req), req.params.id);
    return reply.status(204).send();
  });
  r.post('/channels/:id/leave', { ...pre, schema: { params: id } }, async (req, reply) => {
    const actor = actorOf(req);
    await removeMember(ctx, actor, req.params.id, actor.userId);
    return reply.status(204).send();
  });
  r.patch(
    '/channels/:id/me',
    {
      ...pre,
      schema: {
        params: id,
        body: z.object({
          notificationLevel: z.enum(NOTIFICATION_LEVELS).optional(),
          mutedUntil: z.coerce.date().nullable().optional(),
          isStarred: z.boolean().optional(),
          sectionId: z.string().uuid().nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      await updateMyMembership(ctx, actorOf(req), req.params.id, req.body);
      return reply.status(204).send();
    },
  );

  // ---- Messages -----------------------------------------------------------------------------------

  r.get(
    '/channels/:id/messages',
    {
      ...pre,
      schema: {
        params: id,
        querystring: z.object({
          before_seq: z.coerce.number().int().min(0).optional(),
          after_seq: z.coerce.number().int().min(0).optional(),
          around: z.coerce.number().int().min(0).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      return listMessages(ctx, actorOf(req), req.params.id, {
        beforeSeq: q.before_seq,
        afterSeq: q.after_seq,
        around: q.around,
        limit: q.limit,
      });
    },
  );

  r.post(
    '/channels/:id/messages',
    {
      ...pre,
      schema: {
        params: id,
        body: z.object({ clientMsgId: z.string().min(8).max(64), body: z.unknown() }),
      },
    },
    async (req, reply) => {
      const out = await sendMessage(ctx, actorOf(req), {
        channelId: req.params.id,
        clientMsgId: req.body.clientMsgId,
        body: req.body.body,
      });
      reply.status(out.duplicate ? 200 : 201);
      return out;
    },
  );

  r.get('/messages/:id', { ...pre, schema: { params: id } }, async (req) => ({
    message: await getMessage(ctx, actorOf(req), req.params.id),
  }));
  r.patch(
    '/messages/:id',
    { ...pre, schema: { params: id, body: z.object({ body: z.unknown() }) } },
    async (req) => ({
      message: await editMessage(ctx, actorOf(req), req.params.id, req.body.body),
    }),
  );
  r.delete('/messages/:id', { ...pre, schema: { params: id } }, async (req) => ({
    message: await deleteMessage(ctx, actorOf(req), req.params.id),
  }));

  // ---- Read state ---------------------------------------------------------------------------------

  r.put(
    '/channels/:id/read',
    { ...pre, schema: { params: id, body: z.object({ seq: z.number().int().min(0) }) } },
    async (req) => setRead(ctx, actorOf(req), req.params.id, req.body.seq),
  );
  r.put('/messages/:id/unread', { ...pre, schema: { params: id } }, async (req) =>
    markUnread(ctx, actorOf(req), req.params.id),
  );
  r.post('/me/read-all', pre, async (req) => markAllRead(ctx, actorOf(req)));
  r.get('/me/unreads', pre, async (req) => ({ unreads: await myUnreads(ctx, actorOf(req)) }));

  // ---- Presence and status ------------------------------------------------------------------------

  r.get(
    '/presence',
    {
      ...pre,
      schema: { querystring: z.object({ ids: z.string().max(40 * 100) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      const ids = [
        ...new Set(req.query.ids.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x))),
      ].slice(0, 100);
      const t = deps.db.tenant(actor.orgId);
      // Only people in this workspace resolve.
      const members = await t.memberships.find(
        { userId: { $in: ids }, status: 'active' },
        { projection: { userId: 1 } },
      );
      const known = members.map((m) => m.userId);
      const [states, statuses] = await Promise.all([
        presence.statesOf(actor.orgId, known),
        t.userStatuses.find({ userId: { $in: known } }),
      ]);
      const now = Date.now();
      const statusOf = new Map(
        statuses
          .filter((s) => !s.expiresAt || s.expiresAt.getTime() > now)
          .map((s) => [s.userId, s]),
      );
      return {
        people: known.map((userId) => ({
          id: userId,
          state: states.get(userId) ?? 'offline',
          status: statusOf.has(userId)
            ? {
                emoji: statusOf.get(userId)!.emoji,
                text: statusOf.get(userId)!.text,
                expiresAt: statusOf.get(userId)!.expiresAt,
              }
            : null,
        })),
      };
    },
  );

  r.put(
    '/me/status',
    {
      ...pre,
      schema: {
        body: z.object({
          emoji: z.string().trim().max(16).nullable(),
          text: z.string().trim().max(100).nullable(),
          expiresAt: z.coerce.date().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const t = deps.db.tenant(actor.orgId);
      const clear = !req.body.emoji && !req.body.text;
      await t.userStatuses.upsert(
        { userId: actor.userId },
        {
          emoji: clear ? null : req.body.emoji,
          text: clear ? null : req.body.text,
          expiresAt: clear ? null : (req.body.expiresAt ?? null),
        },
      );
      ctx.events.toOrg(actor.orgId, S2C.presenceChanged, {
        userId: actor.userId,
        state: await presence.stateOf(actor.orgId, actor.userId),
      });
      return { ok: true };
    },
  );

  r.put(
    '/me/dnd',
    {
      ...pre,
      schema: {
        body: z.object({
          minutes: z
            .number()
            .int()
            .min(1)
            .max(60 * 24 * 7)
            .nullable(),
        }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const change = await presence.setDnd(actor.orgId, actor.userId, req.body.minutes);
      announcePresence(ctx, actor.orgId, actor.userId, change);
      return { until: await presence.dndUntil(actor.orgId, actor.userId) };
    },
  );
}
