import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { channelNameSchema, NOTIFICATION_LEVELS } from '@crew-deck/shared';
import { checkinBadges, profileCard } from '../messaging/people.js';
import { getActivityRules, setActivityRules } from '../messaging/activity-bot.js';
import { executeCommand, listCommands } from '../messaging/commands.js';
import { linkItemToMessage } from '../messaging/integration.js';
import { itemCard } from '../messaging/item-links.js';
import { spaceChannelFor } from '../messaging/space-channels.js';
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
import { Presence } from '../messaging/presence.js';
import { setCustomStatus, setDoNotDisturb } from '../messaging/me.js';
import { markAllRead, markUnread, myUnreads, setRead } from '../messaging/read-state.js';
import type { Redis } from 'ioredis';
import { MAX_FILES_PER_MESSAGE } from '@crew-deck/shared';
import { notFound } from '../lib/errors.js';
import { toggleReaction } from '../messaging/reactions.js';
import { listPins, listSaved, setPinned, setSaved } from '../messaging/pins.js';
import { listReplies, listThreads, markThreadRead, setFollow } from '../messaging/threads.js';
import {
  discardChannelFile,
  listChannelFiles,
  receiveChannelFile,
  serveMessageFile,
} from '../messaging/files.js';
import type { StorageDriver } from '../storage/index.js';
import { listActivity } from '../messaging/activity.js';
import { mongoSearch } from '../messaging/search.js';
import {
  createSection,
  deleteSection,
  listSections,
  renameSection,
  saveOrder,
} from '../messaging/sections.js';

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
  storage: StorageDriver;
}

/** Channels, direct messages, messages, read state and presence. Thin: the services hold the rules. */
export async function messagingRoutes(app: FastifyInstance, deps: MessagingDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const ctx = deps.messaging;
  const presence = new Presence(deps.redis);
  const pre = { preHandler: requireAuth };

  // ---- Channels -----------------------------------------------------------------------------------

  // ---- Platform integration (M4) ----------------------------------------------------------------

  // A work item's card as this person may see it (a neutral "no access" card otherwise).
  r.get(
    '/items/:ref/card',
    { ...pre, schema: { params: z.object({ ref: z.string().min(1).max(64) }) } },
    async (req) => {
      const actor = actorOf(req);
      return { card: await itemCard(ctx.db.tenant(actor.orgId), actor, req.params.ref) };
    },
  );

  // Ties an item the caller just created (through the normal create dialog) back to a message.
  r.post(
    '/messages/:id/create-work-item',
    { ...pre, schema: { params: id, body: z.object({ itemId: z.string().min(1).max(64) }) } },
    async (req, reply) => {
      const out = await linkItemToMessage(ctx, actorOf(req), req.params.id, req.body.itemId);
      reply.status(201);
      return out;
    },
  );

  r.get('/channels/:id/activity-rules', { ...pre, schema: { params: id } }, async (req) =>
    getActivityRules(ctx, actorOf(req), req.params.id),
  );
  r.put(
    '/channels/:id/activity-rules',
    { ...pre, schema: { params: id, body: z.object({ eventTypes: z.array(z.string().max(40)).max(20) }) } },
    async (req) => setActivityRules(ctx, actorOf(req), req.params.id, req.body.eventTypes),
  );

  r.get('/commands', pre, async (req) => ({ commands: await listCommands(ctx, actorOf(req)) }));
  r.post(
    '/commands/execute',
    {
      ...pre,
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(40),
          args: z.string().max(2000).default(''),
          channelId: z.string().max(64).nullish(),
        }),
      },
    },
    async (req) => ({ result: await executeCommand(ctx, actorOf(req), req.body) }),
  );

  // The card behind a name (profile popover).
  r.get(
    '/people/:id/card',
    { ...pre, schema: { params: id } },
    async (req) => ({ person: await profileCard(ctx, actorOf(req), req.params.id) }),
  );

  // The channel that belongs to a space (created and filled the first time it is asked for).
  r.get(
    '/spaces/:id/channel',
    // A space is addressed by its key or its id.
    { ...pre, schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (req) => ({ channel: await spaceChannelFor(ctx, actorOf(req), req.params.id) }),
  );

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
        body: z.object({
          clientMsgId: z.string().min(8).max(64),
          body: z.unknown(),
          attachmentIds: z.array(z.string().uuid()).max(MAX_FILES_PER_MESSAGE).optional(),
        }),
      },
    },
    async (req, reply) => {
      const out = await sendMessage(ctx, actorOf(req), {
        channelId: req.params.id,
        clientMsgId: req.body.clientMsgId,
        body: req.body.body,
        attachmentIds: req.body.attachmentIds,
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

  // ---- Threads -------------------------------------------------------------------------------------

  r.get(
    '/messages/:id/replies',
    {
      ...pre,
      schema: {
        params: id,
        querystring: z.object({
          after_seq: z.coerce.number().int().min(0).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
    },
    async (req) =>
      listReplies(ctx, actorOf(req), req.params.id, {
        afterSeq: req.query.after_seq,
        limit: req.query.limit,
      }),
  );

  r.post(
    '/messages/:id/replies',
    {
      ...pre,
      schema: {
        params: id,
        body: z.object({
          clientMsgId: z.string().min(8).max(64),
          body: z.unknown(),
          alsoInChannel: z.boolean().optional(),
          attachmentIds: z.array(z.string().uuid()).max(MAX_FILES_PER_MESSAGE).optional(),
        }),
      },
    },
    async (req, reply) => {
      const actor = actorOf(req);
      const root = await deps.db.tenant(actor.orgId).messages.get(req.params.id);
      if (!root) throw notFound('Message');
      const out = await sendMessage(ctx, actor, {
        channelId: root.channelId,
        clientMsgId: req.body.clientMsgId,
        body: req.body.body,
        attachmentIds: req.body.attachmentIds,
        threadRootId: root.id,
        alsoInChannel: req.body.alsoInChannel,
      });
      reply.status(out.duplicate ? 200 : 201);
      return out;
    },
  );

  r.put('/messages/:id/follow', { ...pre, schema: { params: id } }, async (req) =>
    setFollow(ctx, actorOf(req), req.params.id, true),
  );
  r.delete('/messages/:id/follow', { ...pre, schema: { params: id } }, async (req) =>
    setFollow(ctx, actorOf(req), req.params.id, false),
  );
  r.put(
    '/messages/:id/follow/read',
    { ...pre, schema: { params: id, body: z.object({ seq: z.number().int().min(0) }) } },
    async (req) => markThreadRead(ctx, actorOf(req), req.params.id, req.body.seq),
  );
  r.get('/threads', pre, async (req) => ({ threads: await listThreads(ctx, actorOf(req)) }));

  // ---- Reactions, pins and saved messages --------------------------------------------------------------

  const emojiParam = id.extend({ emoji: z.string().min(1).max(64) });
  r.put(
    '/messages/:id/reactions/:emoji',
    { ...pre, schema: { params: emojiParam } },
    async (req) => ({
      reactions: await toggleReaction(ctx, actorOf(req), req.params.id, req.params.emoji, true),
    }),
  );
  r.delete(
    '/messages/:id/reactions/:emoji',
    { ...pre, schema: { params: emojiParam } },
    async (req) => ({
      reactions: await toggleReaction(ctx, actorOf(req), req.params.id, req.params.emoji, false),
    }),
  );

  r.get('/channels/:id/pins', { ...pre, schema: { params: id } }, async (req) => ({
    pins: await listPins(ctx, actorOf(req), req.params.id),
  }));
  r.post(
    '/channels/:id/pins',
    { ...pre, schema: { params: id, body: z.object({ messageId: z.string().uuid() }) } },
    async (req, reply) => {
      const message = await setPinned(ctx, actorOf(req), req.body.messageId, true);
      if (message.channelId !== req.params.id) throw notFound('Message');
      reply.status(201);
      return { message };
    },
  );
  r.delete(
    '/channels/:id/pins/:messageId',
    { ...pre, schema: { params: id.extend({ messageId: z.string().uuid() }) } },
    async (req) => ({ message: await setPinned(ctx, actorOf(req), req.params.messageId, false) }),
  );

  r.get('/me/saved', pre, async (req) => ({ saved: await listSaved(ctx, actorOf(req)) }));
  const savedParam = z.object({ messageId: z.string().uuid() });
  r.put('/me/saved/:messageId', { ...pre, schema: { params: savedParam } }, async (req) =>
    setSaved(ctx, actorOf(req), req.params.messageId, true),
  );
  r.delete('/me/saved/:messageId', { ...pre, schema: { params: savedParam } }, async (req) =>
    setSaved(ctx, actorOf(req), req.params.messageId, false),
  );

  // ---- Files -------------------------------------------------------------------------------------------

  const uploadLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  r.post(
    '/channels/:id/uploads',
    { ...pre, config: uploadLimit, schema: { params: id } },
    async (req, reply) => {
      const file = await receiveChannelFile(
        req,
        { db: deps.db, storage: deps.storage },
        actorOf(req),
        req.params.id,
      );
      reply.status(201);
      return { file };
    },
  );
  r.delete('/uploads/:id', { ...pre, schema: { params: id } }, async (req, reply) => {
    await discardChannelFile({ db: deps.db, storage: deps.storage }, actorOf(req), req.params.id);
    return reply.status(204).send();
  });
  r.get('/message-files/:id', { ...pre, schema: { params: id } }, async (req, reply) =>
    serveMessageFile({ db: deps.db, storage: deps.storage }, actorOf(req), req.params.id, reply),
  );
  r.get(
    '/channels/:id/files',
    {
      ...pre,
      schema: {
        params: id,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
      },
    },
    async (req) => ({
      files: await listChannelFiles(deps, actorOf(req), req.params.id, req.query.limit),
    }),
  );

  // ---- Search, activity and sidebar sections -------------------------------------------------------------

  r.get(
    '/search/messages',
    {
      ...pre,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          q: z.string().max(500),
          page: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
    },
    async (req) => mongoSearch.messages(ctx, actorOf(req), req.query.q, { page: req.query.page }),
  );
  r.get(
    '/search/files',
    {
      ...pre,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { querystring: z.object({ q: z.string().max(100) }) },
    },
    async (req) => ({ files: await mongoSearch.files(ctx, actorOf(req), req.query.q) }),
  );
  r.get('/me/activity', pre, async (req) => ({ items: await listActivity(ctx, actorOf(req)) }));

  const sectionName = z.string().trim().min(1).max(40);
  r.get('/me/sidebar-sections', pre, async (req) => ({
    sections: await listSections(ctx, actorOf(req)),
  }));
  r.post(
    '/me/sidebar-sections',
    { ...pre, schema: { body: z.object({ name: sectionName }) } },
    async (req, reply) => {
      reply.status(201);
      return { section: await createSection(ctx, actorOf(req), req.body.name) };
    },
  );
  r.patch(
    '/me/sidebar-sections/:id',
    { ...pre, schema: { params: id, body: z.object({ name: sectionName }) } },
    async (req) => ({
      section: await renameSection(ctx, actorOf(req), req.params.id, req.body.name),
    }),
  );
  r.delete('/me/sidebar-sections/:id', { ...pre, schema: { params: id } }, async (req, reply) => {
    await deleteSection(ctx, actorOf(req), req.params.id);
    return reply.status(204).send();
  });
  r.put(
    '/me/sidebar-order',
    {
      ...pre,
      schema: {
        body: z.object({
          sections: z.array(z.string().uuid()).max(20).optional(),
          assign: z.record(z.string().uuid(), z.string().uuid().nullable()).optional(),
        }),
      },
    },
    async (req) => ({ sections: await saveOrder(ctx, actorOf(req), req.body) }),
  );

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
      const [states, statuses, badges] = await Promise.all([
        presence.statesOf(actor.orgId, known),
        t.userStatuses.find({ userId: { $in: known } }),
        checkinBadges(t, known),
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
          // Where they are working today, as a status only (never times).
          checkin: badges.get(userId) ?? null,
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
      await setCustomStatus(ctx, actor, req.body);
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
      return { until: await setDoNotDisturb(ctx, actor, req.body.minutes) };
    },
  );
}
