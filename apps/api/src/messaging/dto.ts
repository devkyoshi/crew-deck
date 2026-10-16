import type { ChannelDTO, MessageDTO, PersonDTO } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import type { ChannelDoc, MessageDoc } from '../db/types.js';

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

export function messageDTO(m: MessageDoc, people: Map<string, PersonDTO>): MessageDTO {
  const deleted = m.deletedAt !== null;
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
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function messageDTOs(t: TenantDb, rows: MessageDoc[]): Promise<MessageDTO[]> {
  const people = await peopleOf(
    t,
    rows.map((r) => r.authorId),
  );
  return rows.map((r) => messageDTO(r, people));
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
    ...(people ? { people } : {}),
  };
}
