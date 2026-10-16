import { S2C, type ReadSyncedEvent } from '@crew-deck/shared';
import { notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { unreadCounts } from './channels.js';

/**
 * Read state is a cursor per person and channel, not a row per message. The cursor only moves forward
 * here; "mark as unread" is the one way back (`markUnread`).
 */
export async function setRead(ctx: MessagingCtx, actor: Actor, channelId: string, seq: number) {
  const t = ctx.db.tenant(actor.orgId);
  if (!(await t.channelMembers.exists({ channelId, userId: actor.userId })))
    throw notFound('Channel');
  const channel = await t.channels.get(channelId);
  if (!channel) throw notFound('Channel');
  // Never beyond what exists, so a wrong client cannot hide future messages.
  const target = Math.min(seq, channel.lastSeq);
  await t.readCursors.updateOne(
    { channelId, userId: actor.userId },
    { $max: { lastReadSeq: target }, $set: { lastReadAt: new Date() } },
    { upsert: true },
  );
  const cursor = await t.readCursors.findOne({ channelId, userId: actor.userId });
  const lastReadSeq = cursor?.lastReadSeq ?? target;
  await clearChatNotifications(t, actor.userId, channelId, lastReadSeq);
  // Other tabs and devices of this person.
  ctx.events.toUser(actor.orgId, actor.userId, S2C.readSynced, {
    channelId,
    seq: lastReadSeq,
  } satisfies ReadSyncedEvent);
  return { channelId, lastReadSeq };
}

/** Reading a conversation marks its chat notifications (up to what was read) as read. */
export async function clearChatNotifications(
  t: ReturnType<MessagingCtx['db']['tenant']>,
  userId: string,
  channelId: string,
  upToSeq: number,
) {
  const open = await t.notifications.find(
    { userId, readAt: null, 'data.channelId': channelId } as never,
    {
      projection: { id: 1, data: 1 },
    },
  );
  const ids = open
    .filter((n) => Number((n.data as { seq?: string }).seq ?? 0) <= upToSeq)
    .map((n) => n.id);
  if (ids.length) await t.notifications.updateMany({ id: { $in: ids } }, { readAt: new Date() });
}

/** Moves the cursor back so this message and everything after it count as unread. */
export async function markUnread(ctx: MessagingCtx, actor: Actor, messageId: string) {
  const t = ctx.db.tenant(actor.orgId);
  const msg = await t.messages.get(messageId);
  if (!msg) throw notFound('Message');
  if (!(await t.channelMembers.exists({ channelId: msg.channelId, userId: actor.userId })))
    throw notFound('Message');
  const seq = Math.max(0, msg.seq - 1);
  await t.readCursors.upsert(
    { channelId: msg.channelId, userId: actor.userId },
    { lastReadSeq: seq, lastReadAt: new Date() },
  );
  ctx.events.toUser(actor.orgId, actor.userId, S2C.readSynced, {
    channelId: msg.channelId,
    seq,
  } satisfies ReadSyncedEvent);
  return { channelId: msg.channelId, lastReadSeq: seq };
}

export async function markAllRead(ctx: MessagingCtx, actor: Actor) {
  const t = ctx.db.tenant(actor.orgId);
  const mine = await t.channelMembers.find({ userId: actor.userId });
  const channels = await t.channels.find({ id: { $in: mine.map((m) => m.channelId) } });
  for (const c of channels) {
    await t.readCursors.updateOne(
      { channelId: c.id, userId: actor.userId },
      { $max: { lastReadSeq: c.lastSeq }, $set: { lastReadAt: new Date() } },
      { upsert: true },
    );
    await clearChatNotifications(t, actor.userId, c.id, c.lastSeq);
    ctx.events.toUser(actor.orgId, actor.userId, S2C.readSynced, {
      channelId: c.id,
      seq: c.lastSeq,
    } satisfies ReadSyncedEvent);
  }
  return { channels: channels.length };
}

/** Unread count per channel, for refreshing badges after a reconnect. */
export async function myUnreads(ctx: MessagingCtx, actor: Actor) {
  const t = ctx.db.tenant(actor.orgId);
  const mine = await t.channelMembers.find({ userId: actor.userId });
  const ids = mine.map((m) => m.channelId);
  const [channels, cursors] = await Promise.all([
    t.channels.find({ id: { $in: ids } }),
    t.readCursors.find({ userId: actor.userId, channelId: { $in: ids } }),
  ]);
  const cursorOf = new Map(cursors.map((c) => [c.channelId, c.lastReadSeq]));
  const counts = await unreadCounts(
    t,
    actor.userId,
    channels.map((c) => ({ id: c.id, lastSeq: c.lastSeq, lastReadSeq: cursorOf.get(c.id) ?? 0 })),
  );
  return channels.map((c) => ({
    channelId: c.id,
    lastSeq: c.lastSeq,
    lastReadSeq: cursorOf.get(c.id) ?? 0,
    unread: counts.get(c.id) ?? 0,
  }));
}
