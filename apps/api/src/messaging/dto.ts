import type {
  ChannelDTO,
  LinkPreviewDTO,
  MentionTarget,
  MessageDTO,
  PersonDTO,
  ReactionDTO,
  AttachmentDTO,
} from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import type { ChannelDoc, MessageAttachmentDoc, MessageDoc } from '../db/types.js';

const BOT_NAMES: Record<string, string> = { activity: 'Activity', tasks: 'Tasks', crm: 'CRM' };

/** People for a set of ids: only members of this workspace resolve, deactivated ones are marked. */
export async function peopleOf(
  t: TenantDb,
  ids: (string | null | undefined)[],
): Promise<Map<string, PersonDTO>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, PersonDTO>();
  if (unique.length === 0) return out;
  const [users, memberships] = await Promise.all([
    t.users(unique),
    t.memberships.find({ userId: { $in: unique } }, { projection: { userId: 1, status: 1 } }),
  ]);
  const inactive = new Set(
    memberships.filter((m) => m.status === 'deactivated').map((m) => m.userId),
  );
  for (const [id, u] of users) {
    out.set(id, {
      id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      ...(inactive.has(id) || u.status === 'deactivated' ? { deactivated: true } : {}),
    });
  }
  return out;
}

export const attachmentDTO = (a: MessageAttachmentDoc): AttachmentDTO => ({
  id: a.id,
  name: a.name,
  mime: a.mime,
  size: a.size,
  isImage: a.image !== null,
  url: `/api/v1/message-files/${a.id}`,
});

const MAX_REACTION_USERS = 100;

/** Groups reaction rows into one entry per emoji, in the order each emoji was first used. */
export function groupReactions(
  rows: { emoji: string; userId: string; createdAt: Date }[],
): ReactionDTO[] {
  const by = new Map<string, ReactionDTO>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const e = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
    e.count++;
    if (e.userIds.length < MAX_REACTION_USERS) e.userIds.push(r.userId);
    by.set(r.emoji, e);
  }
  return [...by.values()];
}

type Meta = { previews?: LinkPreviewDTO[]; previewsPending?: boolean };

/**
 * Turns stored messages into what clients see, loading reactions, files, pins, mentions and reply
 * authors for the whole batch at once. A deleted message is a tombstone: no text, no files, no reactions.
 */
export async function hydrate(t: TenantDb, rows: MessageDoc[]): Promise<MessageDTO[]> {
  if (rows.length === 0) return [];
  const live = rows.filter((m) => !m.deletedAt).map((m) => m.id);
  const ids = rows.map((m) => m.id);
  const hookIds = [
    ...new Set(
      rows.flatMap((m) => (m.kind === 'bot' && m.botId?.startsWith('wh:') ? [m.botId.slice(3)] : [])),
    ),
  ];
  const [reactions, attachments, pins, mentions, itemLinks, hooks] = await Promise.all([
    live.length ? t.messageReactions.find({ messageId: { $in: live } }) : [],
    live.length
      ? t.messageAttachments.find({ messageId: { $in: live } }, { sort: { createdAt: 1 } })
      : [],
    t.pins.find({ messageId: { $in: ids } }),
    live.length ? t.messageMentions.find({ messageId: { $in: live } }) : [],
    live.length ? t.messageLinks.find({ messageId: { $in: live } }) : [],
    hookIds.length ? t.incomingWebhooks.find({ id: { $in: hookIds } }) : [],
  ]);
  const hookName = new Map(hooks.map((h) => [`wh:${h.id}`, h.name]));
  const itemsBy = new Map<string, { id: string; key: string }[]>();
  for (const l of itemLinks)
    itemsBy.set(l.messageId, [...(itemsBy.get(l.messageId) ?? []), { id: l.itemId, key: l.itemKey }]);
  const authors = rows.flatMap((m) => [m.authorId, ...(m.replyAuthors ?? []).slice(-3)]);
  const people = await peopleOf(t, authors);

  const reactionsBy = new Map<string, typeof reactions>();
  for (const r of reactions)
    reactionsBy.set(r.messageId, [...(reactionsBy.get(r.messageId) ?? []), r]);
  const filesBy = new Map<string, MessageAttachmentDoc[]>();
  for (const a of attachments) filesBy.set(a.messageId!, [...(filesBy.get(a.messageId!) ?? []), a]);
  const pinned = new Set(pins.map((p) => p.messageId));
  const mentionsBy = new Map<string, MentionTarget[]>();
  for (const m of mentions) {
    mentionsBy.set(m.messageId, [
      ...(mentionsBy.get(m.messageId) ?? []),
      { type: m.targetType, id: m.targetId } as MentionTarget,
    ]);
  }

  return rows.map((m) => {
    const deleted = m.deletedAt !== null;
    const meta = (m.metadata ?? {}) as Meta;
    return {
      id: m.id,
      channelId: m.channelId,
      seq: m.seq,
      kind: m.kind,
      authorId: m.authorId,
      author: m.authorId ? (people.get(m.authorId) ?? null) : null,
      body: deleted ? null : m.body,
      bodyText: deleted ? null : m.bodyText,
      clientMsgId: m.clientMsgId,
      threadRootId: m.threadRootId,
      alsoInChannel: m.alsoInChannel,
      replyCount: m.replyCount,
      lastReplyAt: m.lastReplyAt ? m.lastReplyAt.toISOString() : null,
      replyAuthors: (m.replyAuthors ?? [])
        .slice(-3)
        .map((id) => people.get(id))
        .filter((p): p is PersonDTO => !!p),
      reactions: deleted ? [] : groupReactions(reactionsBy.get(m.id) ?? []),
      attachments: deleted ? [] : (filesBy.get(m.id) ?? []).map(attachmentDTO),
      pinned: pinned.has(m.id),
      mentions: deleted ? [] : (mentionsBy.get(m.id) ?? []),
      previews: deleted ? [] : (meta.previews ?? []),
      previewsPending: deleted ? false : meta.previewsPending === true,
      workItems: deleted ? [] : (itemsBy.get(m.id) ?? []),
      bot: m.kind === 'bot' && m.botId ? { id: m.botId, name: BOT_NAMES[m.botId] ?? hookName.get(m.botId) ?? 'Bot' } : null,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

export async function hydrateOne(t: TenantDb, row: MessageDoc): Promise<MessageDTO> {
  return (await hydrate(t, [row]))[0]!;
}

export function channelDTO(c: ChannelDoc, memberCount: number, people?: PersonDTO[]): ChannelDTO {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    topic: c.topic,
    description: c.description,
    spaceId: c.spaceId,
    isAnnouncement: c.isAnnouncement,
    isArchived: c.isArchived,
    lastSeq: c.lastSeq,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    memberCount,
    retentionDays: c.retentionDays ?? null,
    crm: c.crmLink ?? null,
    ...(people ? { people } : {}),
  };
}
