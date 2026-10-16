import { createHash } from 'node:crypto';
import {
  GROUP_DM_MAX,
  S2C,
  type ChannelDTO,
  type ChannelType,
  type MembershipEvent,
  type MyChannelDTO,
  type NotificationLevel,
  type PersonDTO,
} from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { isDuplicateKey, type TenantDb } from '../db/client.js';
import type { ChannelDoc, ChannelMemberDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { escapeRegex } from '../lib/pagination.js';
import { can, type Actor } from '../permissions/can.js';
import { channelResource, loadChannel, requireChannel } from './access.js';
import { runLater, type MessagingCtx } from './context.js';
import { notifyAdded } from './notify.js';
import { ownsSection } from './sections.js';
import { channelDTO, peopleOf } from './dto.js';
import { insertSystem, publishStored } from './messages.js';

const DEFAULT_CHANNELS = [
  { name: 'general', topic: 'Company-wide conversation', isAnnouncement: false },
  { name: 'announcements', topic: 'Official updates from the team', isAnnouncement: true },
] as const;

const nameTaken = () =>
  new AppError(409, 'name_taken', 'A channel with that name already exists', {
    name: 'A channel with that name already exists',
  });

export const dmKeyOf = (userIds: string[]) =>
  createHash('sha256')
    .update([...new Set(userIds)].sort().join(','))
    .digest('hex');

// ---- Bootstrap ---------------------------------------------------------------------------------------

/**
 * Makes sure the workspace has #general and #announcements, and that this person has been put in them
 * once. Idempotent and cheap after the first call, so it runs whenever someone opens Messages: that
 * covers new workspaces, new members however they joined, and workspaces that existed before
 * messaging did. Someone who later leaves #general is not put back (the one-time claim below).
 */
export async function ensureBootstrap(ctx: MessagingCtx, t: TenantDb, userId: string) {
  const claimed = await t.memberships.updateOne(
    { userId, messagingInitAt: null },
    { messagingInitAt: new Date() },
  );
  if (claimed === 0) return;
  const joined: string[] = [];
  for (const def of DEFAULT_CHANNELS) {
    let ch = await t.channels.findOne({ nameLower: def.name });
    if (!ch) {
      try {
        ch = await t.channels.insert({
          type: 'public',
          name: def.name,
          slug: def.name,
          topic: def.topic,
          isAnnouncement: def.isAnnouncement,
          createdBy: userId,
        });
      } catch (e) {
        if (!isDuplicateKey(e)) throw e;
        ch = await t.channels.findOne({ nameLower: def.name });
      }
    }
    if (!ch) continue;
    const isCreator = ch.createdBy === userId;
    const added = await t.channelMembers.insertIgnore({
      channelId: ch.id,
      userId,
      role: isCreator ? 'owner' : 'member',
    });
    if (added) {
      // Joining a channel starts you at its present, not at the top of its history.
      await t.readCursors.upsert(
        { channelId: ch.id, userId },
        { lastReadSeq: ch.lastSeq, lastReadAt: new Date() },
      );
      joined.push(ch.id);
    }
  }
  for (const channelId of joined) ctx.events.joinChannel(t.orgId, userId, channelId);
}

// ---- Reading -----------------------------------------------------------------------------------------

async function memberCounts(t: TenantDb, channelIds: string[]) {
  if (channelIds.length === 0) return new Map<string, number>();
  const rows = await t.channelMembers.aggregate<{ _id: string; n: number }>([
    { $match: { channelId: { $in: channelIds } } },
    { $group: { _id: '$channelId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

/** For direct messages, the other people (or the caller alone for a self-DM). */
async function dmPeople(t: TenantDb, channels: ChannelDoc[], me: string) {
  const dms = channels.filter((c) => c.type === 'dm' || c.type === 'group_dm');
  const out = new Map<string, PersonDTO[]>();
  if (dms.length === 0) return out;
  const members = await t.channelMembers.find({ channelId: { $in: dms.map((c) => c.id) } });
  const people = await peopleOf(
    t,
    members.map((m) => m.userId),
  );
  for (const c of dms) {
    const ids = members.filter((m) => m.channelId === c.id).map((m) => m.userId);
    const others = ids.filter((id) => id !== me);
    const shown = others.length ? others : ids;
    out.set(
      c.id,
      shown.map((id) => people.get(id)).filter((p): p is PersonDTO => !!p),
    );
  }
  return out;
}

/** Everything the sidebar needs: my channels with unread counts. */
export async function listMyChannels(ctx: MessagingCtx, actor: Actor): Promise<MyChannelDTO[]> {
  const t = ctx.db.tenant(actor.orgId);
  await ensureBootstrap(ctx, t, actor.userId);
  const mine = await t.channelMembers.find({ userId: actor.userId });
  if (mine.length === 0) return [];
  const ids = mine.map((m) => m.channelId);
  const [channels, cursors, counts] = await Promise.all([
    t.channels.find({ id: { $in: ids } }),
    t.readCursors.find({ userId: actor.userId, channelId: { $in: ids } }),
    memberCounts(t, ids),
  ]);
  const people = await dmPeople(t, channels, actor.userId);
  const cursorOf = new Map(cursors.map((c) => [c.channelId, c.lastReadSeq]));
  const memberOf = new Map(mine.map((m) => [m.channelId, m]));

  const unread = await unreadCounts(
    t,
    actor.userId,
    channels.map((c) => ({ id: c.id, lastSeq: c.lastSeq, lastReadSeq: cursorOf.get(c.id) ?? 0 })),
  );
  const mentions = await mentionCounts(
    t,
    actor.userId,
    channels.map((c) => ({ id: c.id, lastSeq: c.lastSeq, lastReadSeq: cursorOf.get(c.id) ?? 0 })),
  );
  return channels.map((c) => {
    const m = memberOf.get(c.id)!;
    return {
      ...channelDTO(c, counts.get(c.id) ?? 0, people.get(c.id)),
      role: m.role,
      notificationLevel: m.notificationLevel,
      mutedUntil: m.mutedUntil ? m.mutedUntil.toISOString() : null,
      isStarred: m.isStarred,
      sectionId: m.sectionId,
      lastReadSeq: cursorOf.get(c.id) ?? 0,
      unread: unread.get(c.id) ?? 0,
      mentionCount: mentions.get(c.id) ?? 0,
    };
  });
}

/** Unread messages that mention me by name, through one of my groups, or with @channel or @here. */
export async function mentionCounts(
  t: TenantDb,
  userId: string,
  channels: { id: string; lastSeq: number; lastReadSeq: number }[],
) {
  const out = new Map<string, number>();
  const pending = channels.filter((c) => c.lastSeq > c.lastReadSeq);
  if (pending.length === 0) return out;
  const myGroups = (await t.groupMembers.find({ userId }, { projection: { groupId: 1 } })).map(
    (g) => g.groupId,
  );
  await Promise.all(
    pending.map(async (c) => {
      const n = await t.messageMentions.count({
        channelId: c.id,
        inChannel: true,
        seq: { $gt: c.lastReadSeq },
        $or: [
          { targetType: 'user', targetId: userId },
          { targetType: { $in: ['channel', 'here'] } },
          ...(myGroups.length
            ? [{ targetType: 'group' as const, targetId: { $in: myGroups } }]
            : []),
        ],
      });
      out.set(c.id, n);
    }),
  );
  return out;
}

/** Unread = messages after the cursor that someone else wrote, not counting deleted ones or thread replies. */
export async function unreadCounts(
  t: TenantDb,
  userId: string,
  channels: { id: string; lastSeq: number; lastReadSeq: number }[],
) {
  const out = new Map<string, number>();
  await Promise.all(
    channels
      .filter((c) => c.lastSeq > c.lastReadSeq)
      .map(async (c) => {
        const n = await t.messages.count({
          channelId: c.id,
          seq: { $gt: c.lastReadSeq },
          authorId: { $ne: userId },
          deletedAt: null,
          $or: [{ threadRootId: null }, { alsoInChannel: true }],
        });
        out.set(c.id, n);
      }),
  );
  return out;
}

export async function getChannel(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
): Promise<MyChannelDTO | ChannelDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const { channel, member } = await loadChannel(t, actor, channelId);
  const [counts, people] = await Promise.all([
    memberCounts(t, [channel.id]),
    dmPeople(t, [channel], actor.userId),
  ]);
  const dto = channelDTO(channel, counts.get(channel.id) ?? 0, people.get(channel.id));
  if (!member) return dto;
  const cursor = await t.readCursors.findOne({ channelId, userId: actor.userId });
  const lastReadSeq = cursor?.lastReadSeq ?? 0;
  const unread = await unreadCounts(t, actor.userId, [
    { id: channel.id, lastSeq: channel.lastSeq, lastReadSeq },
  ]);
  const mentions = await mentionCounts(t, actor.userId, [
    { id: channel.id, lastSeq: channel.lastSeq, lastReadSeq },
  ]);
  return {
    ...dto,
    role: member.role,
    notificationLevel: member.notificationLevel,
    mutedUntil: member.mutedUntil ? member.mutedUntil.toISOString() : null,
    isStarred: member.isStarred,
    sectionId: member.sectionId,
    lastReadSeq,
    unread: unread.get(channel.id) ?? 0,
    mentionCount: mentions.get(channel.id) ?? 0,
  };
}

/** Public channels anyone can browse, with whether the caller is already in them. */
export async function browseChannels(
  ctx: MessagingCtx,
  actor: Actor,
  q: { search?: string; limit?: number },
) {
  const t = ctx.db.tenant(actor.orgId);
  const filter: Record<string, unknown> = { type: 'public' };
  if (q.search?.trim()) filter.nameLower = { $regex: escapeRegex(q.search.trim().toLowerCase()) };
  const channels = await t.channels.find(filter, {
    sort: { nameLower: 1 },
    limit: Math.min(q.limit ?? 100, 200),
  });
  const [mine, counts] = await Promise.all([
    t.channelMembers.find({ userId: actor.userId, channelId: { $in: channels.map((c) => c.id) } }),
    memberCounts(
      t,
      channels.map((c) => c.id),
    ),
  ]);
  const joined = new Set(mine.map((m) => m.channelId));
  return channels.map((c) => ({
    ...channelDTO(c, counts.get(c.id) ?? 0),
    joined: joined.has(c.id),
  }));
}

// ---- Creating ----------------------------------------------------------------------------------------

export interface CreateChannelInput {
  name: string;
  type: 'public' | 'private';
  topic?: string | null;
  description?: string | null;
  isAnnouncement?: boolean;
  memberIds?: string[];
}

async function activeMemberIds(t: TenantDb, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await t.memberships.find(
    { userId: { $in: unique }, status: 'active' },
    { projection: { userId: 1 } },
  );
  return rows.map((r) => r.userId);
}

/** Publishes that a person is now (or no longer) in a channel: moves their sockets and tells their tabs. */
function announceMembership(
  ctx: MessagingCtx,
  orgId: string,
  userId: string,
  channelId: string,
  change: MembershipEvent['change'],
) {
  if (change === 'added') ctx.events.joinChannel(orgId, userId, channelId);
  else ctx.events.leaveChannel(orgId, userId, channelId);
  ctx.events.toUser(orgId, userId, S2C.channelMembership, {
    channelId,
    change,
  } satisfies MembershipEvent);
}

export async function createChannel(
  ctx: MessagingCtx,
  actor: Actor,
  input: CreateChannelInput,
): Promise<ChannelDTO> {
  if (!can(actor, 'channel.create')) throw forbidden();
  const t = ctx.db.tenant(actor.orgId);
  const extra = (await activeMemberIds(t, input.memberIds ?? [])).filter(
    (id) => id !== actor.userId,
  );
  let channel: ChannelDoc;
  try {
    channel = await ctx.db.tx(actor.orgId, async (tx) => {
      const c = await tx.channels.insert({
        type: input.type,
        name: input.name,
        slug: input.name,
        topic: input.topic ?? null,
        description: input.description ?? null,
        isAnnouncement: input.isAnnouncement ?? false,
        createdBy: actor.userId,
      });
      await tx.channelMembers.insert([
        { channelId: c.id, userId: actor.userId, role: 'owner' },
        ...extra.map((userId) => ({ channelId: c.id, userId, role: 'member' as const })),
      ]);
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'channel.created',
        targetType: 'channel',
        targetId: c.id,
        after: { name: c.name, type: c.type, members: extra.length + 1 },
      });
      return c;
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw nameTaken();
    throw e;
  }
  for (const userId of [actor.userId, ...extra])
    announceMembership(ctx, actor.orgId, userId, channel.id, 'added');
  return channelDTO(channel, extra.length + 1);
}

/**
 * Opens the direct message with exactly these people (the caller is always included). One DM per pair
 * and one group DM per exact set; asking again returns the existing one.
 */
export async function openDm(
  ctx: MessagingCtx,
  actor: Actor,
  userIds: string[],
): Promise<ChannelDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const ids = [...new Set([actor.userId, ...userIds])];
  if (ids.length > GROUP_DM_MAX) {
    throw new AppError(
      422,
      'too_many_people',
      `A group message can have up to ${GROUP_DM_MAX} people`,
    );
  }
  const valid = await activeMemberIds(t, ids);
  if (valid.length !== ids.length)
    throw new AppError(422, 'unknown_person', 'Someone in that list is not an active member');

  const key = dmKeyOf(ids);
  const find = async () => t.channels.findOne({ dmKey: key });
  let channel = await find();
  let created = false;
  if (!channel) {
    try {
      channel = await ctx.db.tx(actor.orgId, async (tx) => {
        const c = await tx.channels.insert({
          type: ids.length > 2 ? 'group_dm' : 'dm',
          dmKey: key,
          createdBy: actor.userId,
        });
        await tx.channelMembers.insert(
          ids.map((userId) => ({
            channelId: c.id,
            userId,
            role: 'member' as const,
            notificationLevel: 'all' as const,
          })),
        );
        return c;
      });
      created = true;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      channel = await find();
    }
  } else if (!(await t.channelMembers.exists({ channelId: channel.id, userId: actor.userId }))) {
    // Someone left a group DM and is opening it again by its exact set of people.
    await t.channelMembers.insertIgnore({
      channelId: channel.id,
      userId: actor.userId,
      role: 'member',
      notificationLevel: 'all',
    });
    announceMembership(ctx, actor.orgId, actor.userId, channel.id, 'added');
  }
  if (!channel) throw notFound('Conversation');
  if (created)
    for (const userId of ids) announceMembership(ctx, actor.orgId, userId, channel.id, 'added');
  const people = await dmPeople(t, [channel], actor.userId);
  return channelDTO(channel, ids.length, people.get(channel.id));
}

// ---- Changing ----------------------------------------------------------------------------------------

export interface UpdateChannelInput {
  name?: string;
  topic?: string | null;
  description?: string | null;
  isAnnouncement?: boolean;
}

export async function updateChannel(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  input: UpdateChannelInput,
): Promise<ChannelDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  requireChannel(actor, access, 'channel.manage');
  if (access.channel.isArchived)
    throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
  const set: Partial<ChannelDoc> = {};
  if (input.name !== undefined) {
    set.name = input.name;
    set.slug = input.name;
  }
  if (input.topic !== undefined) set.topic = input.topic;
  if (input.description !== undefined) set.description = input.description;
  if (input.isAnnouncement !== undefined) set.isAnnouncement = input.isAnnouncement;

  let sys: Awaited<ReturnType<typeof insertSystem>> | null = null;
  let updated: ChannelDoc | null;
  try {
    updated = await ctx.db.tx(actor.orgId, async (tx) => {
      const c = await tx.channels.findOneAndUpdate({ id: channelId }, set);
      if (c && input.topic !== undefined && input.topic !== access.channel.topic) {
        sys = await insertSystem(
          tx,
          c,
          actor.userId,
          input.topic ? `set the channel topic: ${input.topic}` : 'cleared the channel topic',
        );
      }
      if (c && input.name !== undefined && input.name !== access.channel.name) {
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'channel.renamed',
          targetType: 'channel',
          targetId: channelId,
          before: { name: access.channel.name },
          after: { name: input.name },
        });
      }
      return c;
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw nameTaken();
    throw e;
  }
  if (!updated) throw notFound('Channel');
  const counts = await memberCounts(t, [channelId]);
  const dto = channelDTO(updated, counts.get(channelId) ?? 0);
  ctx.events.toChannel(actor.orgId, channelId, S2C.channelUpdated, dto);
  if (sys) await publishStored(ctx, t, actor.orgId, sys);
  return dto;
}

export async function setArchived(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  archived: boolean,
): Promise<ChannelDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  requireChannel(actor, access, 'channel.archive');
  if (access.channel.spaceId)
    throw new AppError(409, 'space_channel', "A space's channel follows the space");
  const updated = await ctx.db.tx(actor.orgId, async (tx) => {
    const c = await tx.channels.findOneAndUpdate({ id: channelId }, { isArchived: archived });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: archived ? 'channel.archived' : 'channel.unarchived',
      targetType: 'channel',
      targetId: channelId,
    });
    return c;
  });
  if (!updated) throw notFound('Channel');
  const counts = await memberCounts(t, [channelId]);
  const dto = channelDTO(updated, counts.get(channelId) ?? 0);
  ctx.events.toChannel(actor.orgId, channelId, S2C.channelUpdated, dto);
  return dto;
}

/** Deleting a channel removes it with its messages, memberships and cursors. Admins only, and audited. */
export async function deleteChannel(ctx: MessagingCtx, actor: Actor, channelId: string) {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  requireChannel(actor, access, 'channel.delete');
  const members = await t.channelMembers.find({ channelId });
  const files = await t.messageAttachments.find({ channelId });
  await ctx.db.tx(actor.orgId, async (tx) => {
    const ids = (await tx.messages.find({ channelId }, { projection: { id: 1 } })).map((m) => m.id);
    if (ids.length) await tx.messageEdits.deleteMany({ messageId: { $in: ids } });
    await tx.messages.deleteMany({ channelId });
    // Everything that hangs off the channel's messages goes with them.
    await Promise.all([
      tx.messageReactions.deleteMany({ channelId }),
      tx.messageMentions.deleteMany({ channelId }),
      tx.pins.deleteMany({ channelId }),
      tx.savedMessages.deleteMany({ channelId }),
      tx.threadFollows.deleteMany({ channelId }),
      tx.messageAttachments.deleteMany({ channelId }),
    ]);
    await tx.readCursors.deleteMany({ channelId });
    await tx.channelMembers.deleteMany({ channelId });
    await tx.channels.deleteOne({ id: channelId });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'channel.deleted',
      targetType: 'channel',
      targetId: channelId,
      before: { name: access.channel.name, type: access.channel.type },
    });
  });
  // The records are gone; the bytes follow once the transaction has committed.
  await Promise.all(files.map((f) => ctx.storage?.delete(f.storageKey).catch(() => undefined)));
  for (const m of members) announceMembership(ctx, actor.orgId, m.userId, channelId, 'removed');
}

// ---- Membership --------------------------------------------------------------------------------------

export async function listMembers(ctx: MessagingCtx, actor: Actor, channelId: string) {
  const t = ctx.db.tenant(actor.orgId);
  await loadChannel(t, actor, channelId);
  const members = await t.channelMembers.find({ channelId }, { sort: { joinedAt: 1 } });
  const people = await peopleOf(
    t,
    members.map((m) => m.userId),
  );
  return members.map((m) => ({
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    person: people.get(m.userId) ?? null,
  }));
}

async function joinOne(
  ctx: MessagingCtx,
  t: TenantDb,
  channel: ChannelDoc,
  userId: string,
  role: 'owner' | 'member' = 'member',
) {
  // Checked first: a duplicate insert inside the transaction below would abort it.
  if (await t.channelMembers.exists({ channelId: channel.id, userId })) return false;
  const stored = await ctx.db.tx(t.orgId, async (tx) => {
    const added = await tx.channelMembers.insertIgnore({ channelId: channel.id, userId, role });
    if (!added) return null;
    const fresh = (await tx.channels.get(channel.id)) ?? channel;
    await tx.readCursors.upsert(
      { channelId: channel.id, userId },
      { lastReadSeq: fresh.lastSeq, lastReadAt: new Date() },
    );
    return insertSystem(tx, channel, userId, 'joined the channel');
  });
  if (!stored) return false;
  announceMembership(ctx, t.orgId, userId, channel.id, 'added');
  await publishStored(ctx, t, t.orgId, stored);
  return true;
}

export async function joinChannel(ctx: MessagingCtx, actor: Actor, channelId: string) {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  if (access.member) return;
  if (!can(actor, 'channel.join', access.resource)) throw forbidden();
  if (access.channel.isArchived)
    throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
  await joinOne(ctx, t, access.channel, actor.userId);
}

export async function addMembers(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  userIds: string[],
) {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  if (access.channel.type === 'dm' || access.channel.type === 'group_dm') {
    throw new AppError(409, 'dm_fixed', 'Start a new group message to include more people');
  }
  // A public channel is open anyway; for private channels the manage rule applies.
  if (access.channel.type === 'private' || access.channel.isArchived)
    requireChannel(actor, access, 'channel.manage');
  else if (!access.member && !can(actor, 'channel.manage', access.resource)) throw forbidden();
  const valid = await activeMemberIds(t, userIds);
  let added = 0;
  for (const userId of valid) {
    if (await joinOne(ctx, t, access.channel, userId)) {
      added++;
      await ctx.db.tx(actor.orgId, (tx) =>
        writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'channel.member_added',
          targetType: 'channel',
          targetId: channelId,
          after: { userId },
        }),
      );
      runLater(ctx, () => notifyAdded(ctx, actor.orgId, access.channel, userId, actor.userId));
    }
  }
  return { added };
}

/** Takes someone out of a channel: a person leaving, or an owner or admin removing them. */
export async function removeMember(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  userId: string,
) {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  const self = userId === actor.userId;
  if (!self) {
    if (access.channel.type === 'dm' || access.channel.type === 'group_dm') throw forbidden();
    requireChannel(actor, access, 'channel.manage');
  }
  const target = await t.channelMembers.findOne({ channelId, userId });
  if (!target) throw notFound('Member');
  if (access.channel.type === 'dm')
    throw new AppError(409, 'dm_fixed', 'You cannot leave a one-to-one message');
  if (access.channel.spaceId)
    throw new AppError(409, 'space_channel', "A space's channel follows the space");
  if (target.role === 'owner') {
    const owners = await t.channelMembers.count({ channelId, role: 'owner' });
    const members = await t.channelMembers.count({ channelId });
    if (owners <= 1 && members > 1 && access.channel.type !== 'group_dm') {
      throw new AppError(409, 'last_owner', 'Make someone else an owner before leaving');
    }
  }
  const stored = await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.channelMembers.deleteOne({ channelId, userId });
    await tx.readCursors.deleteOne({ channelId, userId });
    await tx.threadFollows.deleteMany({ channelId, userId });
    if (!self) {
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'channel.member_removed',
        targetType: 'channel',
        targetId: channelId,
        after: { userId },
      });
    }
    return access.channel.type === 'group_dm' ||
      access.channel.type === 'public' ||
      access.channel.type === 'private'
      ? insertSystem(
          tx,
          access.channel,
          userId,
          self ? 'left the channel' : 'was removed from the channel',
        )
      : null;
  });
  announceMembership(ctx, actor.orgId, userId, channelId, 'removed');
  if (stored) await publishStored(ctx, t, actor.orgId, stored);
}

export async function setMemberRole(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  userId: string,
  role: 'owner' | 'member',
) {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  requireChannel(actor, access, 'channel.manage');
  if (role === 'member') {
    const target = await t.channelMembers.findOne({ channelId, userId });
    if (
      target?.role === 'owner' &&
      (await t.channelMembers.count({ channelId, role: 'owner' })) <= 1
    ) {
      throw new AppError(409, 'last_owner', 'A channel needs at least one owner');
    }
  }
  if ((await t.channelMembers.updateOne({ channelId, userId }, { role })) === 0)
    throw notFound('Member');
}

export interface MyMembershipInput {
  notificationLevel?: NotificationLevel;
  mutedUntil?: Date | null;
  isStarred?: boolean;
  sectionId?: string | null;
}

/** My own settings for a channel: notification level, mute, star. */
export async function updateMyMembership(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  input: MyMembershipInput,
) {
  const t = ctx.db.tenant(actor.orgId);
  const set: Partial<ChannelMemberDoc> = {};
  if (input.notificationLevel !== undefined) set.notificationLevel = input.notificationLevel;
  if (input.mutedUntil !== undefined) set.mutedUntil = input.mutedUntil;
  if (input.isStarred !== undefined) set.isStarred = input.isStarred;
  if (input.sectionId !== undefined) {
    if (input.sectionId !== null && !(await ownsSection(ctx, actor, input.sectionId)))
      throw notFound('Section');
    set.sectionId = input.sectionId;
  }
  if ((await t.channelMembers.updateOne({ channelId, userId: actor.userId }, set)) === 0)
    throw notFound('Channel');
}

/**
 * Removes a deactivated person from every channel and disconnects their sockets. Their messages stay,
 * shown with a deactivated marker.
 */
export async function onMemberDeactivated(ctx: MessagingCtx, orgId: string, userId: string) {
  const t = ctx.db.tenant(orgId);
  await t.channelMembers.deleteMany({ userId });
  await t.readCursors.deleteMany({ userId });
  await t.threadFollows.deleteMany({ userId });
  // Reactivating them later puts them back in the default channels.
  await t.memberships.updateOne({ userId }, { messagingInitAt: null });
  ctx.events.disconnectUser(orgId, userId);
}

export { channelResource };
export type { ChannelType };
