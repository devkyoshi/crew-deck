import {
  HISTORY_PAGE,
  MAX_MESSAGE_CHARS,
  S2C,
  SYNC_LIMIT,
  type MessageDTO,
  type SyncResult,
} from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { isDuplicateKey } from '../db/client.js';
import type { ChannelDoc, MessageDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { can } from '../permissions/can.js';
import { textToDoc } from '../work/doc.js';
import { sanitizeDoc } from '../work/rich-text.js';
import { loadChannel, requireChannel } from './access.js';
import type { MessagingCtx } from './context.js';
import { messageDTO, messageDTOs, peopleOf } from './dto.js';

/** Thread replies are not part of the channel timeline unless they were also sent to the channel. */
export const TIMELINE = { $or: [{ threadRootId: null }, { alsoInChannel: true }] };

/** Validates a body from a client: rebuilt from an allow-list, non-empty, within the length limit. */
export function cleanBody(input: unknown) {
  const clean = sanitizeDoc(input, 'body');
  if (!clean.doc)
    throw new AppError(422, 'empty_message', 'Write something first', {
      body: 'Write something first',
    });
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

export interface SendInput {
  channelId: string;
  clientMsgId: string;
  body: unknown;
}

/**
 * Sends a message. Persist first, publish second: the sender is acknowledged with the stored message,
 * and only then does it fan out. Retrying with the same `clientMsgId` returns the first message
 * instead of creating a duplicate. Both the REST route and the socket handler call this.
 */
export async function sendMessage(
  ctx: MessagingCtx,
  actor: Actor,
  input: SendInput,
): Promise<{ message: MessageDTO; duplicate: boolean }> {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, input.channelId);
  requireChannel(actor, access, 'channel.post');

  const existing = await t.messages.findOne({
    channelId: input.channelId,
    clientMsgId: input.clientMsgId,
  });
  if (existing) {
    if (existing.authorId !== actor.userId) throw forbidden();
    return {
      message: messageDTO(existing, await peopleOf(t, [existing.authorId])),
      duplicate: true,
    };
  }

  await ctx.limiter?.message(actor.orgId, actor.userId);
  const clean = cleanBody(input.body);

  let stored: MessageDoc;
  try {
    stored = await ctx.db.tx(actor.orgId, async (tx) => {
      const msg = await insertMessage(tx, input.channelId, {
        kind: 'user',
        authorId: actor.userId,
        body: clean.doc,
        bodyText: clean.text,
        clientMsgId: input.clientMsgId,
      });
      // Sending means the author has seen everything up to their own message.
      await advanceCursor(tx, input.channelId, actor.userId, msg.seq);
      return msg;
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
      // A retry that raced the first attempt: hand back the message that won.
      const won = await t.messages.findOne({
        channelId: input.channelId,
        clientMsgId: input.clientMsgId,
      });
      if (won && won.authorId === actor.userId) {
        return { message: messageDTO(won, await peopleOf(t, [won.authorId])), duplicate: true };
      }
    }
    throw e;
  }

  const dto = messageDTO(stored, await peopleOf(t, [stored.authorId]));
  publishNew(ctx, actor.orgId, dto);
  ctx.events.toUser(actor.orgId, actor.userId, S2C.readSynced, {
    channelId: stored.channelId,
    seq: stored.seq,
  });
  return { message: dto, duplicate: false };
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
  publishNew(ctx, orgId, messageDTO(msg, await peopleOf(t, [msg.authorId])));
}

async function loadMessage(t: TenantDb, actor: Actor, messageId: string) {
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
  return messageDTO(msg, await peopleOf(t, [msg.authorId]));
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
  const clean = cleanBody(body);

  const updated = await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.messageEdits.insert({ messageId: msg.id, oldBody: msg.body });
    return tx.messages.findOneAndUpdate(
      { id: msg.id, deletedAt: null },
      { body: clean.doc, bodyText: clean.text, editedAt: new Date() },
    );
  });
  if (!updated) throw notFound('Message');
  const dto = messageDTO(updated, await peopleOf(t, [updated.authorId]));
  ctx.events.toChannel(actor.orgId, dto.channelId, S2C.messageUpdated, dto);
  return dto;
}

/** Deletes leave a tombstone, so ordering and (later) threads stay intact. */
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
    { deletedAt: new Date(), body: null, bodyText: null },
  );
  if (!updated) throw notFound('Message');
  const dto = messageDTO(updated, await peopleOf(t, [updated.authorId]));
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
  return { messages: await messageDTOs(t, rows), lastSeq: channel.lastSeq, hasOlder, hasNewer };
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
        messages: await messageDTOs(t, rows),
        refetch: false,
        lastSeq: channel.lastSeq,
      });
    }
  }
  return out;
}
