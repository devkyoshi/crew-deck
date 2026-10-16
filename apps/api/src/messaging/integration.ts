import type { CreateFromMessageResult } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { resolveItem } from '../work/service.js';
import { postAsBot } from './bot.js';
import type { MessagingCtx } from './context.js';
import { loadMessage } from './messages.js';

/** How long after creating an item it can still be tied back to the message it came from. */
const LINK_WINDOW_MS = 15 * 60 * 1000;

/**
 * Completes "Create work item" on a message. The client fills the normal create dialog (title from the
 * first line, the message as the description, the channel's space preselected) and creates the item
 * through the ordinary endpoint, which enforces every work rule. This call then ties the new item to the
 * message: the item remembers where it came from, and the Tasks bot answers in the message's thread with
 * the item's card. Only the person who created the item, and only just after, can do it.
 */
export async function linkItemToMessage(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  itemRef: string,
): Promise<CreateFromMessageResult> {
  const t = ctx.db.tenant(actor.orgId);
  const { msg, access } = await loadMessage(t, actor, messageId);
  if (msg.kind === 'system' || msg.deletedAt) throw notFound('Message');
  // The item was made through the normal create endpoint, which checked create rights. Here we only
  // make sure it is theirs, and recent.
  const { row, space } = await resolveItem(t, actor, itemRef);
  if (row.reporterId !== actor.userId) throw forbidden();
  if (row.createdFromMessage)
    throw new AppError(409, 'already_linked', 'That work item is already linked to a message');
  if (Date.now() - row.createdAt.getTime() > LINK_WINDOW_MS)
    throw new AppError(409, 'too_late', 'That work item was created too long ago to link');

  const rootId = msg.threadRootId ?? msg.id;
  await t.workItems.updateOne(
    { id: row.id },
    { createdFromMessage: { messageId: msg.id, channelId: msg.channelId, threadRootId: msg.threadRootId } },
  );
  const key = `${space.key}-${row.number}`;
  const reply = await postAsBot(ctx, actor.orgId, {
    botId: 'tasks',
    channelId: access.channel.id,
    text: `Work item ${key} was created from this message.`,
    threadRootId: rootId,
    itemIds: [row.id],
  });
  if (!reply) throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
  return { item: { id: row.id, key, spaceKey: space.key }, replyId: reply.id };
}

/**
 * Where an item came from, for the item's page: only when the viewer can open that conversation
 * (otherwise the item shows nothing, never a link they could not follow).
 */
export async function itemSource(
  t: TenantDb,
  actor: Actor,
  source: { messageId: string; channelId: string; threadRootId: string | null } | undefined,
) {
  if (!source) return null;
  try {
    const { msg } = await loadMessage(t, actor, source.messageId);
    const thread = msg.threadRootId ? `&thread=${msg.threadRootId}` : '';
    return { href: `/messages/${msg.channelId}?m=${msg.seq}${thread}`, messageId: msg.id };
  } catch {
    return null;
  }
}
