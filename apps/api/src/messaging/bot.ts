import { S2C } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import type { MessageDoc } from '../db/types.js';
import { textToDoc } from '../work/doc.js';
import type { MessagingCtx } from './context.js';
import { hydrateOne } from './dto.js';
import { itemKeysIn, storeItemLinks } from './item-links.js';
import { insertMessage, publishNew, threadEvent } from './messages.js';

export const BOTS = {
  activity: { id: 'activity', name: 'Activity' },
  tasks: { id: 'tasks', name: 'Tasks' },
} as const;
export type BotId = keyof typeof BOTS;

export interface BotPost {
  botId: BotId;
  channelId: string;
  /** Plain text; work item keys in it get cards. */
  text: string;
  /** Reply in this message's thread. */
  threadRootId?: string | null;
  /** Items to show cards for even when their keys are not in the text. */
  itemIds?: string[];
}

/**
 * Posts a message as a bot, through the same path every message takes (sequence number, links,
 * publish after commit). Bots never write to the message collections any other way. Returns null when
 * the channel is gone or archived: an archived channel stays read-only for bots too.
 */
export async function postAsBot(
  ctx: MessagingCtx,
  orgId: string,
  post: BotPost,
): Promise<MessageDoc | null> {
  const t = ctx.db.tenant(orgId);
  const channel = await t.channels.get(post.channelId);
  if (!channel || channel.isArchived) return null;
  const keys = itemKeysIn(null, post.text);
  const stored = await ctx.db.tx(orgId, async (tx) => {
    const msg = await insertMessage(tx, post.channelId, {
      kind: 'bot',
      authorId: null,
      botId: post.botId,
      body: textToDoc(post.text),
      bodyText: post.text,
      threadRootId: post.threadRootId ?? null,
      alsoInChannel: false,
    });
    await storeItemLinks(tx, msg, keys, post.itemIds ?? []);
    if (post.threadRootId) {
      await tx.messages.updateOne(
        { id: post.threadRootId },
        { $inc: { replyCount: 1 }, $set: { lastReplyAt: msg.createdAt } },
      );
    }
    return msg;
  });
  await publishBot(ctx, t, orgId, stored);
  return stored;
}

async function publishBot(ctx: MessagingCtx, t: TenantDb, orgId: string, msg: MessageDoc) {
  publishNew(ctx, orgId, await hydrateOne(t, msg));
  if (msg.threadRootId) {
    const root = await t.messages.get(msg.threadRootId);
    if (root) ctx.events.toChannel(orgId, msg.channelId, S2C.threadUpdated, await threadEvent(t, root));
  }
}
