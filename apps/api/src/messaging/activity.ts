import type { MessageDTO, PersonDTO } from '@crew-deck/shared';
import type { Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { hydrate, peopleOf } from './dto.js';

export interface ActivityItem {
  kind: 'mention' | 'reaction';
  at: string;
  message: MessageDTO;
  channel: { id: string; type: string; name: string | null };
  by: PersonDTO | null;
  emoji?: string;
}

/**
 * "Mentions and reactions": who called me by name (or @channel, @here, one of my groups) and who reacted
 * to what I wrote, newest first, only in conversations I am in.
 */
export async function listActivity(
  ctx: MessagingCtx,
  actor: Actor,
  limit = 50,
): Promise<ActivityItem[]> {
  const t = ctx.db.tenant(actor.orgId);
  const mine = (
    await t.channelMembers.find({ userId: actor.userId }, { projection: { channelId: 1 } })
  ).map((m) => m.channelId);
  if (mine.length === 0) return [];
  const myGroups = (
    await t.groupMembers.find({ userId: actor.userId }, { projection: { groupId: 1 } })
  ).map((g) => g.groupId);

  const mentions = await t.messageMentions.find(
    {
      channelId: { $in: mine },
      $or: [
        { targetType: 'user', targetId: actor.userId },
        { targetType: { $in: ['channel', 'here'] } },
        ...(myGroups.length ? [{ targetType: 'group' as const, targetId: { $in: myGroups } }] : []),
      ],
    },
    { sort: { seq: -1 }, limit: 200 },
  );
  const myMessages = await t.messages.find(
    { channelId: { $in: mine }, authorId: actor.userId, deletedAt: null },
    { sort: { createdAt: -1 }, limit: 200, projection: { id: 1 } },
  );
  const reactions = myMessages.length
    ? await t.messageReactions.find(
        { messageId: { $in: myMessages.map((m) => m.id) }, userId: { $ne: actor.userId } },
        { sort: { createdAt: -1 }, limit: 100 },
      )
    : [];

  const messageIds = [
    ...new Set([...mentions.map((m) => m.messageId), ...reactions.map((r) => r.messageId)]),
  ];
  const rows = await t.messages.find({ id: { $in: messageIds }, deletedAt: null });
  const byId = new Map(rows.map((m) => [m.id, m]));
  const [dtos, channels] = await Promise.all([
    hydrate(t, rows),
    t.channels.find({ id: { $in: [...new Set(rows.map((m) => m.channelId))] } }),
  ]);
  const dtoOf = new Map(dtos.map((d) => [d.id, d]));
  const channelOf = new Map(channels.map((c) => [c.id, c]));
  const people = await peopleOf(t, [
    ...rows.map((m) => m.authorId),
    ...reactions.map((r) => r.userId),
  ]);

  const items: ActivityItem[] = [];
  const seenMention = new Set<string>();
  for (const m of mentions) {
    const msg = byId.get(m.messageId);
    if (!msg || seenMention.has(m.messageId) || msg.authorId === actor.userId) continue;
    seenMention.add(m.messageId);
    items.push({
      kind: 'mention',
      at: msg.createdAt.toISOString(),
      message: dtoOf.get(msg.id)!,
      channel: {
        id: msg.channelId,
        type: channelOf.get(msg.channelId)?.type ?? 'public',
        name: channelOf.get(msg.channelId)?.name ?? null,
      },
      by: msg.authorId ? (people.get(msg.authorId) ?? null) : null,
    });
  }
  for (const r of reactions) {
    const msg = byId.get(r.messageId);
    if (!msg) continue;
    items.push({
      kind: 'reaction',
      at: r.createdAt.toISOString(),
      message: dtoOf.get(msg.id)!,
      channel: {
        id: msg.channelId,
        type: channelOf.get(msg.channelId)?.type ?? 'public',
        name: channelOf.get(msg.channelId)?.name ?? null,
      },
      by: people.get(r.userId) ?? null,
      emoji: r.emoji,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
