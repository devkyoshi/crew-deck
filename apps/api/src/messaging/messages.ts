import {
  BROADCAST_MENTION_LIMIT,
  HISTORY_PAGE,
  MAX_FILES_PER_MESSAGE,
  MAX_MESSAGE_CHARS,
  S2C,
  SYNC_LIMIT,
  type MessageDTO,
  type PersonDTO,
  type SendResult,
  type SyncResult,
  type ThreadEvent,
} from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { isDuplicateKey } from '../db/client.js';
import type { ChannelDoc, MessageDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { can } from '../permissions/can.js';
import { textToDoc } from '../work/doc.js';
import { sanitizeDoc, type CleanDoc } from '../work/rich-text.js';
import { loadChannel, requireChannel } from './access.js';
import { runLater, type MessagingCtx } from './context.js';
import { hydrate, hydrateOne, peopleOf } from './dto.js';
import { hasAnyLink, linksIn } from './link-preview.js';
import { notifyMessage } from './notify.js';

/** Thread replies are not part of the channel timeline unless they were also sent to the channel. */
export const TIMELINE = { $or: [{ threadRootId: null }, { alsoInChannel: true }] };

/**
 * Validates a body from a client: rebuilt from an allow-list, within the length limit, and non-empty
 * unless the message carries files.
 */
export function cleanBody(
  input: unknown,
  opts: { allowEmpty?: boolean } = {},
): CleanDoc & { doc: NonNullable<CleanDoc['doc']> } {
  const clean = sanitizeDoc(input, 'body', { broadcastMentions: true });
  if (!clean.doc) {
    if (!opts.allowEmpty)
      throw new AppError(422, 'empty_message', 'Write something first', {
        body: 'Write something first',
      });
    return { ...clean, doc: { type: 'doc', content: [{ type: 'paragraph' }] } };
  }
  if (clean.text.length > MAX_MESSAGE_CHARS) {
    throw new AppError(
      413,
      'message_too_long',
      `Messages can be up to ${MAX_MESSAGE_CHARS} characters`,
      {
        body: `Messages can be up to ${MAX_MESSAGE_CHARS} characters`,
      },
    );
  }
  return { ...clean, doc: clean.doc };
}

/**
 * Appends a message to a channel inside the caller's transaction. The channel's `lastSeq` counter is
 * bumped in the same transaction, so `seq` is strictly increasing per channel and is the order
 * everyone sees. Concurrent senders conflict on the channel document and one of them retries.
 */
export async function insertMessage(
  t: TenantDb,
  channelId: string,
  fields: Partial<MessageDoc> & Pick<MessageDoc, 'body' | 'bodyText'>,
): Promise<MessageDoc> {
  const at = new Date();
  const channel = await t.channels.findOneAndUpdate(
    { id: channelId },
    { $inc: { lastSeq: 1 }, $set: { lastMessageAt: at } },
  );
  if (!channel) throw notFound('Channel');
  return t.messages.insert({ ...fields, channelId, seq: channel.lastSeq, createdAt: at });
}

/** Moves a person's read cursor forward (never back). */
export async function advanceCursor(t: TenantDb, channelId: string, userId: string, seq: number) {
  await t.readCursors.updateOne(
    { channelId, userId },
    { $max: { lastReadSeq: seq }, $set: { lastReadAt: new Date() } },
    { upsert: true },
  );
}

/** Tells everyone in the channel about a stored message. Called only after the transaction committed. */
export function publishNew(ctx: MessagingCtx, orgId: string, dto: MessageDTO) {
  ctx.events.toChannel(orgId, dto.channelId, S2C.messageNew, dto);
}

/** Sends the changed message to the channel. */
export async function publishUpdated(
  ctx: MessagingCtx,
  t: TenantDb,
  orgId: string,
  msg: MessageDoc,
) {
  const dto = await hydrateOne(t, msg);
  ctx.events.toChannel(orgId, msg.channelId, S2C.messageUpdated, dto);
  return dto;
}

export interface SendInput {
  channelId: string;
  clientMsgId: string;
  body: unknown;
  attachmentIds?: string[];
  /** Reply in this message's thread. Threads do not nest. */
  threadRootId?: string;
  /** For replies: show it in the channel too. */
  alsoInChannel?: boolean;
}

/** Keeps only mentions that point at real people and groups of this workspace. */
async function validTargets(t: TenantDb, targets: CleanDoc['targets']) {
  const userIds = targets.filter((x) => x.type === 'user').map((x) => x.id);
  const groupIds = targets.filter((x) => x.type === 'group').map((x) => x.id);
  const [members, groups] = await Promise.all([
    userIds.length
      ? t.memberships.find(
          { userId: { $in: userIds }, status: 'active' },
          { projection: { userId: 1 } },
        )
      : [],
    groupIds.length ? t.groups.find({ id: { $in: groupIds } }, { projection: { id: 1 } }) : [],
  ]);
  const okUsers = new Set(members.map((m) => m.userId));
  const okGroups = new Set(groups.map((g) => g.id));
  return targets.filter((x) =>
    x.type === 'user' ? okUsers.has(x.id) : x.type === 'group' ? okGroups.has(x.id) : true,
  );
}

/** Replaces the stored mentions of a message. */
async function storeMentions(
  tx: TenantDb,
  msg: Pick<MessageDoc, 'id' | 'channelId' | 'seq'>,
  targets: CleanDoc['targets'],
  inChannel: boolean,
) {
  await tx.messageMentions.deleteMany({ messageId: msg.id });
  if (targets.length === 0) return;
  await tx.messageMentions.insert(
    targets.map((x) => ({
      channelId: msg.channelId,
      messageId: msg.id,
      seq: msg.seq,
      targetType: x.type,
      targetId: x.id,
      inChannel,
    })),
  );
}

/** Mentioned people who are not in the channel (so the author can be offered to add them). */
async function outsiders(
  t: TenantDb,
  channelId: string,
  authorId: string,
  targets: CleanDoc['targets'],
): Promise<PersonDTO[]> {
  const wanted = new Set<string>(targets.filter((x) => x.type === 'user').map((x) => x.id));
  const groupIds = targets.filter((x) => x.type === 'group').map((x) => x.id);
  if (groupIds.length) {
    for (const g of await t.groupMembers.find({ groupId: { $in: groupIds } })) wanted.add(g.userId);
  }
  wanted.delete(authorId);
  if (wanted.size === 0) return [];
  const inside = new Set(
    (await t.channelMembers.find({ channelId, userId: { $in: [...wanted] } })).map((m) => m.userId),
  );
  const active = new Set(
    (
      await t.memberships.find(
        { userId: { $in: [...wanted] }, status: 'active' },
        { projection: { userId: 1 } },
      )
    ).map((m) => m.userId),
  );
  const missing = [...wanted].filter((id) => !inside.has(id) && active.has(id));
  return [...(await peopleOf(t, missing)).values()];
}

/** People mentioned by name who are in the channel follow the thread they were mentioned in. */
async function followThread(
  tx: TenantDb,
  channelId: string,
  rootId: string,
  userId: string,
  readSeq?: number,
) {
  // Upserts, never a duplicate-key insert: inside a transaction a failed write would abort all of it.
  if (readSeq === undefined) {
    await tx.threadFollows.updateOne(
      { threadRootId: rootId, userId },
      { $setOnInsert: { channelId, lastReadSeq: 0, createdAt: new Date() } },
      { upsert: true },
    );
    return;
  }
  await tx.threadFollows.upsert(
    { threadRootId: rootId, userId },
    { lastReadSeq: readSeq },
    { channelId },
  );
}

async function threadEvent(t: TenantDb, root: MessageDoc): Promise<ThreadEvent> {
  const people = await peopleOf(t, (root.replyAuthors ?? []).slice(-3));
  return {
    channelId: root.channelId,
    rootId: root.id,
    replyCount: root.replyCount,
    lastReplyAt: root.lastReplyAt ? root.lastReplyAt.toISOString() : null,
    replyAuthors: (root.replyAuthors ?? [])
      .slice(-3)
      .map((id) => people.get(id))
      .filter((p): p is PersonDTO => !!p),
  };
}

/**
 * Sends a message, or a reply in a thread. Persist first, publish second: the sender is acknowledged with
 * the stored message, and only then does it fan out. Retrying with the same `clientMsgId` returns the
 * first message instead of creating a duplicate. Both the REST routes and the socket handler call this.
 */
export async function sendMessage(
  ctx: MessagingCtx,
  actor: Actor,
  input: SendInput,
): Promise<SendResult> {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, input.channelId);
  // Announcement channels let everyone reply in threads and react, but only owners and admins post.
  requireChannel(actor, access, input.threadRootId ? 'channel.reply' : 'channel.post');

  const existing = await t.messages.findOne({
    channelId: input.channelId,
    clientMsgId: input.clientMsgId,
  });
  if (existing) {
    if (existing.authorId !== actor.userId) throw forbidden();
    return { message: await hydrateOne(t, existing), duplicate: true, notInChannel: [] };
  }

  let root: MessageDoc | null = null;
  if (input.threadRootId) {
    root = await t.messages.findOne({ id: input.threadRootId, channelId: input.channelId });
    if (!root) throw notFound('Message');
    if (root.threadRootId)
      throw new AppError(
        422,
        'no_nested_threads',
        'Replies go in the thread of the original message',
      );
    if (root.kind === 'system')
      throw new AppError(422, 'not_threadable', 'You cannot reply to that');
  }

  await ctx.limiter?.message(actor.orgId, actor.userId);

  const fileIds = [...new Set(input.attachmentIds ?? [])];
  if (fileIds.length > MAX_FILES_PER_MESSAGE) {
    throw new AppError(
      422,
      'too_many_files',
      `A message can have up to ${MAX_FILES_PER_MESSAGE} files`,
    );
  }
  const clean = cleanBody(input.body, { allowEmpty: fileIds.length > 0 });

  const isAdmin = actor.orgRole === 'owner' || actor.orgRole === 'admin';
  if (clean.targets.some((x) => x.type === 'channel' || x.type === 'here') && !isAdmin) {
    if ((await t.channelMembers.count({ channelId: input.channelId })) > BROADCAST_MENTION_LIMIT) {
      throw new AppError(
        403,
        'mention_restricted',
        `Only admins can use @channel and @here in channels with more than ${BROADCAST_MENTION_LIMIT} people`,
      );
    }
  }
  const targets = await validTargets(t, clean.targets);

  const files = fileIds.length
    ? await t.messageAttachments.find({
        id: { $in: fileIds },
        channelId: input.channelId,
        uploaderId: actor.userId,
        messageId: null,
      })
    : [];
  if (files.length !== fileIds.length)
    throw new AppError(
      422,
      'bad_attachment',
      'One of the files is no longer available. Upload it again.',
    );

  const links = linksIn(clean.doc, clean.text);
  const alsoInChannel = !!root && input.alsoInChannel === true;
  const inChannel = !root || alsoInChannel;
  const mentionedMembers = targets.filter((x) => x.type === 'user').map((x) => x.id);

  let stored: MessageDoc;
  let updatedRoot: MessageDoc | null = null;
  try {
    const out = await ctx.db.tx(actor.orgId, async (tx) => {
      const msg = await insertMessage(tx, input.channelId, {
        kind: 'user',
        authorId: actor.userId,
        body: clean.doc,
        bodyText: clean.text,
        hasLink: hasAnyLink(clean.doc, clean.text),
        clientMsgId: input.clientMsgId,
        threadRootId: root?.id ?? null,
        alsoInChannel,
        metadata: links.length ? { previews: [], previewsPending: true } : {},
      });
      await storeMentions(tx, msg, targets, inChannel);
      if (files.length)
        await tx.messageAttachments.updateMany(
          { id: { $in: fileIds }, messageId: null },
          { messageId: msg.id },
        );
      if (inChannel) await advanceCursor(tx, input.channelId, actor.userId, msg.seq);
      let newRoot: MessageDoc | null = null;
      if (root) {
        newRoot = await tx.messages.findOneAndUpdate(
          { id: root.id },
          {
            $inc: { replyCount: 1 },
            $set: { lastReplyAt: msg.createdAt },
            $addToSet: { replyAuthors: actor.userId },
          },
        );
        // Repliers and mentioned channel members follow the thread; the replier has read up to their own reply.
        await followThread(tx, input.channelId, root.id, actor.userId, msg.seq);
        if (mentionedMembers.length) {
          const inside = await tx.channelMembers.find({
            channelId: input.channelId,
            userId: { $in: mentionedMembers },
          });
          for (const m of inside)
            if (m.userId !== actor.userId)
              await followThread(tx, input.channelId, root.id, m.userId);
        }
      }
      return { msg, newRoot };
    });
    stored = out.msg;
    updatedRoot = out.newRoot;
  } catch (e) {
    if (isDuplicateKey(e)) {
      // A retry that raced the first attempt: hand back the message that won.
      const won = await t.messages.findOne({
        channelId: input.channelId,
        clientMsgId: input.clientMsgId,
      });
      if (won && won.authorId === actor.userId)
        return { message: await hydrateOne(t, won), duplicate: true, notInChannel: [] };
    }
    throw e;
  }

  const dto = await hydrateOne(t, stored);
  publishNew(ctx, actor.orgId, dto);
  if (updatedRoot)
    ctx.events.toChannel(
      actor.orgId,
      input.channelId,
      S2C.threadUpdated,
      await threadEvent(t, updatedRoot),
    );
  if (inChannel)
    ctx.events.toUser(actor.orgId, actor.userId, S2C.readSynced, {
      channelId: stored.channelId,
      seq: stored.seq,
    });
  if (links.length)
    await ctx.enqueueLinkPreviews?.({ orgId: actor.orgId, messageId: stored.id, urls: links });
  // Notifications never delay the acknowledgement or the fan-out.
  runLater(ctx, () =>
    notifyMessage(ctx, { orgId: actor.orgId, message: stored, channel: access.channel, targets }),
  );
  return {
    message: dto,
    duplicate: false,
    notInChannel: await outsiders(t, input.channelId, actor.userId, targets),
  };
}

/** Stores a system message ("X joined", "topic changed") on behalf of a person, inside the caller's transaction. */
export async function insertSystem(
  t: TenantDb,
  channel: ChannelDoc,
  userId: string,
  text: string,
): Promise<MessageDoc> {
  return insertMessage(t, channel.id, {
    kind: 'system',
    authorId: userId,
    body: textToDoc(text),
    bodyText: text,
  });
}

/** Publishes a stored system message (after its transaction committed). */
export async function publishStored(
  ctx: MessagingCtx,
  t: TenantDb,
  orgId: string,
  msg: MessageDoc,
) {
  publishNew(ctx, orgId, await hydrateOne(t, msg));
}

export async function loadMessage(t: TenantDb, actor: Actor, messageId: string) {
  const msg = await t.messages.get(messageId);
  if (!msg) throw notFound('Message');
  const access = await loadChannel(t, actor, msg.channelId);
  return { msg, access };
}

export async function getMessage(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
): Promise<MessageDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const { msg } = await loadMessage(t, actor, messageId);
  return hydrateOne(t, msg);
}

export async function editMessage(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  body: unknown,
): Promise<MessageDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const { msg, access } = await loadMessage(t, actor, messageId);
  if (msg.kind !== 'user' || msg.deletedAt) throw notFound('Message');
  const resource = { ...access.resource, isAuthor: msg.authorId === actor.userId };
  requireChannel(actor, { ...access, resource }, 'message.editOwn');
  const hasFiles = (await t.messageAttachments.count({ messageId: msg.id })) > 0;
  const clean = cleanBody(body, { allowEmpty: hasFiles });
  const targets = await validTargets(t, clean.targets);
  const links = linksIn(clean.doc, clean.text);

  const updated = await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.messageEdits.insert({ messageId: msg.id, oldBody: msg.body });
    const m = await tx.messages.findOneAndUpdate(
      { id: msg.id, deletedAt: null },
      {
        body: clean.doc,
        bodyText: clean.text,
        hasLink: hasAnyLink(clean.doc, clean.text),
        editedAt: new Date(),
        metadata: links.length ? { previews: [], previewsPending: true } : {},
      },
    );
    if (m) await storeMentions(tx, m, targets, !m.threadRootId || m.alsoInChannel);
    return m;
  });
  if (!updated) throw notFound('Message');
  const dto = await publishUpdated(ctx, t, actor.orgId, updated);
  if (links.length)
    await ctx.enqueueLinkPreviews?.({ orgId: actor.orgId, messageId: msg.id, urls: links });
  return dto;
}

/** Removes everything attached to a message (files, reactions, mentions, pins) when it is deleted. */
export async function dropMessageExtras(ctx: MessagingCtx, orgId: string, messageIds: string[]) {
  if (messageIds.length === 0) return;
  const t = ctx.db.tenant(orgId);
  const files = await t.messageAttachments.find({ messageId: { $in: messageIds } });
  await Promise.all([
    t.messageAttachments.deleteMany({ messageId: { $in: messageIds } }),
    t.messageReactions.deleteMany({ messageId: { $in: messageIds } }),
    t.messageMentions.deleteMany({ messageId: { $in: messageIds } }),
    t.pins.deleteMany({ messageId: { $in: messageIds } }),
  ]);
  // The records are gone; the bytes follow.
  await Promise.all(files.map((f) => ctx.storage?.delete(f.storageKey).catch(() => undefined)));
}

/** Deletes leave a tombstone, so ordering and threads stay intact. */
export async function deleteMessage(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
): Promise<MessageDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const { msg, access } = await loadMessage(t, actor, messageId);
  if (msg.deletedAt) throw notFound('Message');
  const own = msg.authorId === actor.userId && msg.kind === 'user';
  const resource = { ...access.resource, isAuthor: own };
  const allowed =
    (own && can(actor, 'message.editOwn', resource)) || can(actor, 'message.deleteAny', resource);
  if (!allowed) {
    if (access.channel.isArchived)
      throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
    throw forbidden();
  }
  const updated = await t.messages.findOneAndUpdate(
    { id: msg.id, deletedAt: null },
    { deletedAt: new Date(), body: null, bodyText: null, metadata: {} },
  );
  if (!updated) throw notFound('Message');
  await dropMessageExtras(ctx, actor.orgId, [msg.id]);
  const dto = await hydrateOne(t, updated);
  ctx.events.toChannel(actor.orgId, dto.channelId, S2C.messageDeleted, dto);
  return dto;
}

export interface HistoryQuery {
  beforeSeq?: number;
  afterSeq?: number;
  around?: number;
  limit?: number;
}

export interface History {
  messages: MessageDTO[];
  lastSeq: number;
  hasOlder: boolean;
  hasNewer: boolean;
}

/**
 * History is paged by `seq`, never by offset or time. Default is the latest page; `beforeSeq` pages
 * back; `afterSeq` pages forward; `around` loads the window around one message (message links).
 */
export async function listMessages(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  q: HistoryQuery = {},
): Promise<History> {
  const t = ctx.db.tenant(actor.orgId);
  const { channel } = await loadChannel(t, actor, channelId);
  const limit = Math.min(Math.max(q.limit ?? HISTORY_PAGE, 1), 100);
  const base = { channelId, ...TIMELINE };

  let rows: MessageDoc[];
  let hasOlder: boolean;
  let hasNewer: boolean;
  if (q.around !== undefined) {
    const half = Math.floor(limit / 2);
    const [before, after] = await Promise.all([
      t.messages.find({ ...base, seq: { $lte: q.around } }, { sort: { seq: -1 }, limit: half + 1 }),
      t.messages.find({ ...base, seq: { $gt: q.around } }, { sort: { seq: 1 }, limit: half + 1 }),
    ]);
    hasOlder = before.length > half;
    hasNewer = after.length > half;
    rows = [...before.slice(0, half).reverse(), ...after.slice(0, half)];
  } else if (q.afterSeq !== undefined) {
    const page = await t.messages.find(
      { ...base, seq: { $gt: q.afterSeq } },
      { sort: { seq: 1 }, limit: limit + 1 },
    );
    hasNewer = page.length > limit;
    hasOlder = true;
    rows = page.slice(0, limit);
  } else {
    const seq = q.beforeSeq !== undefined ? { seq: { $lt: q.beforeSeq } } : {};
    const page = await t.messages.find(
      { ...base, ...seq },
      { sort: { seq: -1 }, limit: limit + 1 },
    );
    hasOlder = page.length > limit;
    hasNewer = false;
    rows = page.slice(0, limit).reverse();
  }
  return { messages: await hydrate(t, rows), lastSeq: channel.lastSeq, hasOlder, hasNewer };
}

/**
 * After a reconnect the client says what it last saw per channel. We return what it missed (up to
 * SYNC_LIMIT per channel) or tell it to refetch through REST. Channels the caller is not in are skipped.
 */
export async function syncChannels(
  ctx: MessagingCtx,
  actor: Actor,
  channels: { channelId: string; lastSeq: number }[],
): Promise<SyncResult> {
  const t = ctx.db.tenant(actor.orgId);
  const mine = new Set(
    (
      await t.channelMembers.find({
        userId: actor.userId,
        channelId: { $in: channels.map((c) => c.channelId) },
      })
    ).map((m) => m.channelId),
  );
  const out: SyncResult = [];
  for (const c of channels) {
    if (!mine.has(c.channelId)) continue;
    const channel = await t.channels.get(c.channelId);
    if (!channel) continue;
    if (channel.lastSeq <= c.lastSeq) {
      out.push({ channelId: c.channelId, messages: [], refetch: false, lastSeq: channel.lastSeq });
      continue;
    }
    const rows = await t.messages.find(
      { channelId: c.channelId, seq: { $gt: c.lastSeq }, ...TIMELINE },
      { sort: { seq: 1 }, limit: SYNC_LIMIT + 1 },
    );
    if (rows.length > SYNC_LIMIT) {
      out.push({ channelId: c.channelId, messages: [], refetch: true, lastSeq: channel.lastSeq });
    } else {
      out.push({
        channelId: c.channelId,
        messages: await hydrate(t, rows),
        refetch: false,
        lastSeq: channel.lastSeq,
      });
    }
  }
  return out;
}
