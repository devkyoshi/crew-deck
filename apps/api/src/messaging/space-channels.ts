import { S2C, type ChannelDTO } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { isDuplicateKey, type TenantDb } from '../db/client.js';
import type { ChannelDoc, SpaceDoc } from '../db/types.js';
import { notFound } from '../lib/errors.js';
import type { Actor, SpaceRole } from '../permissions/can.js';
import { effectiveRole } from '../spaces/access.js';
import { announceMembership, memberCounts } from './channels.js';
import { runLater, type MessagingCtx } from './context.js';
import { channelDTO } from './dto.js';

/** What caused a sync-driven change; recorded on every audit entry (brief section 4). */
const cause = (space: Pick<SpaceDoc, 'id' | 'key'>) => ({ type: 'space', id: space.id, key: space.key });

const nameOf = (space: SpaceDoc) => space.key.toLowerCase();

const typeOf = (space: SpaceDoc): ChannelDoc['type'] =>
  space.visibility === 'open' ? 'public' : 'private';

/** Spaces that no longer take part in chat: archived or deleted. Their channel becomes read-only. */
const inactive = (space: SpaceDoc) => space.status === 'archived' || space.deletedAt !== null;

/**
 * Finds a space's channel, creating it the first time. Safe to call concurrently: the unique index on
 * (workspace, space) decides the winner and the loser reads the winner's channel.
 */
export async function ensureSpaceChannel(
  ctx: MessagingCtx,
  t: TenantDb,
  space: SpaceDoc,
): Promise<ChannelDoc> {
  const existing = await t.channels.findOne({ spaceId: space.id });
  if (existing) return existing;
  // The key is the natural name (#eng); if a person already took it, fall back to #eng-space.
  for (const name of [nameOf(space), `${nameOf(space)}-space`]) {
    try {
      const created = await ctx.db.tx(t.orgId, async (tx) => {
        const c = await tx.channels.insert({
          type: typeOf(space),
          name,
          slug: name,
          topic: space.name,
          description: space.description,
          spaceId: space.id,
          isAnnouncement: false,
          isArchived: inactive(space),
          createdBy: null,
        });
        await writeAudit(tx, {
          orgId: t.orgId,
          actorId: null,
          action: 'channel.space_created',
          targetType: 'channel',
          targetId: c.id,
          after: { name: c.name, type: c.type, cause: cause(space) },
        });
        return c;
      });
      return created;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      const winner = await t.channels.findOne({ spaceId: space.id });
      if (winner) return winner;
      // Otherwise the name was taken: try the next one.
    }
  }
  throw new Error(`could not create a channel for space ${space.key}`);
}

export interface SyncResult {
  channelId: string;
  added: number;
  removed: number;
}

/** Every person who has a role in the space, directly or through a group, with their best role. */
async function roleHolders(t: TenantDb, spaceId: string): Promise<Map<string, SpaceRole>> {
  const rank: Record<SpaceRole, number> = { admin: 3, member: 2, viewer: 1 };
  const entries = await t.spaceMembers.find({ spaceId });
  const groupIds = entries.filter((e) => e.principalType === 'group').map((e) => e.principalId);
  const links = groupIds.length ? await t.groupMembers.find({ groupId: { $in: groupIds } }) : [];
  const groupRole = new Map(
    entries.filter((e) => e.principalType === 'group').map((e) => [e.principalId, e.spaceRole]),
  );
  const out = new Map<string, SpaceRole>();
  const note = (userId: string, role: SpaceRole) => {
    const cur = out.get(userId);
    if (!cur || rank[role] > rank[cur]) out.set(userId, role);
  };
  for (const e of entries) if (e.principalType === 'user') note(e.principalId, e.spaceRole);
  for (const l of links) note(l.userId, groupRole.get(l.groupId)!);
  return out;
}

/**
 * Brings one space's channel in line with the space: its visibility and archived state, and its
 * members. Membership is derived from effective space access: everyone with a role (directly or
 * through a group) is in, space admins own the channel, and in a private space anyone who lost their
 * role is taken out. In an open space people who joined without a role may stay. Idempotent, so it
 * serves the event-driven path and the nightly repair alike. Every change is audited with the space
 * as the cause.
 */
export function syncSpaceChannel(
  ctx: MessagingCtx,
  orgId: string,
  spaceId: string,
): Promise<SyncResult | null> {
  // One sync per space at a time in this process: two overlapping syncs (an event and the repair)
  // would write the same rows in competing transactions. Other processes are covered by the unique
  // indexes, and anything that slips through is repaired by the next run.
  const key = `${orgId}:${spaceId}`;
  const run = (running.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => doSync(ctx, orgId, spaceId));
  running.set(key, run);
  void run.finally(() => {
    if (running.get(key) === run) running.delete(key);
  }).catch(() => undefined);
  return run;
}

const running = new Map<string, Promise<unknown>>();

async function doSync(
  ctx: MessagingCtx,
  orgId: string,
  spaceId: string,
): Promise<SyncResult | null> {
  const t = ctx.db.tenant(orgId);
  const space = await t.spaces.findOne({ id: spaceId });
  if (!space) return null;
  // A deleted space keeps its channel (read-only) but never gets a new one.
  if (space.deletedAt && !(await t.channels.exists({ spaceId }))) return null;
  let channel = await ensureSpaceChannel(ctx, t, space);

  const type = typeOf(space);
  const archived = inactive(space);
  if (channel.type !== type || channel.isArchived !== archived) {
    const updated = await ctx.db.tx(orgId, async (tx) => {
      const c = await tx.channels.findOneAndUpdate({ id: channel.id }, { type, isArchived: archived });
      await writeAudit(tx, {
        orgId,
        actorId: null,
        action: archived !== channel.isArchived ? (archived ? 'channel.archived' : 'channel.unarchived') : 'channel.visibility_changed',
        targetType: 'channel',
        targetId: channel.id,
        before: { type: channel.type, isArchived: channel.isArchived },
        after: { type, isArchived: archived, cause: cause(space) },
      });
      return c;
    });
    if (updated) {
      channel = updated;
      const counts = await memberCounts(t, [channel.id]);
      ctx.events.toChannel(orgId, channel.id, S2C.channelUpdated, channelDTO(channel, counts.get(channel.id) ?? 0));
    }
  }

  const holders = archived ? new Map<string, SpaceRole>() : await roleHolders(t, spaceId);
  const active = new Set(
    (await t.memberships.find({ status: 'active' }, { projection: { userId: 1, orgRole: 1 } })).map(
      (m) => m.userId,
    ),
  );
  const adminLike = new Set(
    (await t.memberships.find({ status: 'active', orgRole: { $in: ['owner', 'admin'] } })).map((m) => m.userId),
  );
  const current = await t.channelMembers.find({ channelId: channel.id });
  const have = new Map(current.map((m) => [m.userId, m]));

  let added = 0;
  let removed = 0;

  // Add (and fix owner/member roles) for everyone who has a role.
  for (const [userId, role] of holders) {
    if (!active.has(userId)) continue;
    const want = role === 'admin' ? 'owner' : 'member';
    const row = have.get(userId);
    if (!row) {
      const fresh = (await t.channels.get(channel.id)) ?? channel;
      const stored = await ctx.db.tx(orgId, async (tx) => {
        const ok = await tx.channelMembers.insertIgnore({ channelId: channel.id, userId, role: want });
        if (!ok) return false;
        await tx.readCursors.upsert(
          { channelId: channel.id, userId },
          { lastReadSeq: fresh.lastSeq, lastReadAt: new Date() },
        );
        await writeAudit(tx, {
          orgId,
          actorId: null,
          action: 'channel.member_added',
          targetType: 'channel',
          targetId: channel.id,
          after: { userId, role: want, cause: cause(space) },
        });
        return true;
      });
      if (stored) {
        added++;
        announceMembership(ctx, orgId, userId, channel.id, 'added');
      }
    } else if (row.role !== want) {
      await t.channelMembers.updateOne({ channelId: channel.id, userId }, { role: want });
    }
  }

  // Take out people who no longer have access. An open space is visible to everyone, so only
  // inactive accounts go; a private space also drops anyone without a role (workspace admins stay).
  for (const row of archived ? [] : current) {
    const stillAllowed =
      active.has(row.userId) &&
      (holders.has(row.userId) || adminLike.has(row.userId) || space.visibility === 'open');
    if (stillAllowed) continue;
    await ctx.db.tx(orgId, async (tx) => {
      await tx.channelMembers.deleteOne({ channelId: channel.id, userId: row.userId });
      await tx.readCursors.deleteOne({ channelId: channel.id, userId: row.userId });
      await tx.threadFollows.deleteMany({ channelId: channel.id, userId: row.userId });
      await writeAudit(tx, {
        orgId,
        actorId: null,
        action: 'channel.member_removed',
        targetType: 'channel',
        targetId: channel.id,
        after: { userId: row.userId, cause: cause(space) },
      });
    });
    removed++;
    announceMembership(ctx, orgId, row.userId, channel.id, 'removed');
  }

  return { channelId: channel.id, added, removed };
}

/** Repairs every space in one workspace. Used by the nightly job, and after group changes. */
export async function reconcileOrg(ctx: MessagingCtx, orgId: string) {
  const t = ctx.db.tenant(orgId);
  const spaces = await t.spaces.find({}, { projection: { id: 1 } });
  let added = 0;
  let removed = 0;
  for (const s of spaces) {
    const r = await syncSpaceChannel(ctx, orgId, s.id);
    added += r?.added ?? 0;
    removed += r?.removed ?? 0;
  }
  return { spaces: spaces.length, added, removed };
}

/** The nightly repair for every workspace (drift from missed events or direct database changes). */
export async function reconcileAll(ctx: MessagingCtx, log: { error: (m: string) => void }) {
  const orgs = await ctx.db.global.organizations.find({}, { projection: { id: 1 } });
  for (const o of orgs) {
    await reconcileOrg(ctx, o.id).catch((e: Error) => log.error(`space channel repair failed: ${e.message}`));
  }
}

/** Follow-up after a space or group change: never delays or fails the request that caused it. */
export function syncSpaceLater(ctx: MessagingCtx, orgId: string, spaceId: string) {
  runLater(ctx, () => syncSpaceChannel(ctx, orgId, spaceId));
}

export function reconcileLater(ctx: MessagingCtx, orgId: string) {
  runLater(ctx, () => reconcileOrg(ctx, orgId));
}

/**
 * `GET /spaces/:id/channel`: the space's channel for someone who can see the space. Creates and fills it
 * the first time (spaces made before messaging existed), then answers as the caller sees it.
 */
export async function spaceChannelFor(
  ctx: MessagingCtx,
  actor: Actor,
  spaceKeyOrId: string,
): Promise<ChannelDTO & { readOnly: boolean; member: boolean }> {
  const t = ctx.db.tenant(actor.orgId);
  const space =
    (await t.spaces.findOne({ id: spaceKeyOrId, deletedAt: null })) ??
    (await t.spaces.findOne({ key: spaceKeyOrId.toUpperCase(), deletedAt: null }));
  if (!space) throw notFound('Space');
  const role = await effectiveRole(t, actor.userId, space.id);
  const admin = actor.orgRole === 'owner' || actor.orgRole === 'admin';
  // A private space is invisible to people with no role: the same answer as a space that is not there.
  if (space.visibility !== 'open' && !role && !admin) throw notFound('Space');
  let channel = await t.channels.findOne({ spaceId: space.id });
  if (!channel) {
    await syncSpaceChannel(ctx, actor.orgId, space.id);
    channel = await t.channels.findOne({ spaceId: space.id });
  } else if (role && !(await t.channelMembers.exists({ channelId: channel.id, userId: actor.userId }))) {
    // A role was granted a moment ago and the follow-up has not run yet: catch up now.
    await syncSpaceChannel(ctx, actor.orgId, space.id);
  }
  if (!channel) throw notFound('Channel');
  const counts = await memberCounts(t, [channel.id]);
  const member = await t.channelMembers.exists({ channelId: channel.id, userId: actor.userId });
  return {
    ...channelDTO(channel, counts.get(channel.id) ?? 0),
    readOnly: role !== 'admin' && role !== 'member' && !admin,
    member,
  };
}

/** Like `syncSpaceLater`, for a route parameter that may be the space's key or its id. */
export function syncSpaceRefLater(ctx: MessagingCtx, orgId: string, ref: string) {
  runLater(ctx, async () => {
    const t = ctx.db.tenant(orgId);
    const space =
      (await t.spaces.findOne({ id: ref })) ?? (await t.spaces.findOne({ key: ref.toUpperCase() }));
    if (space) await syncSpaceChannel(ctx, orgId, space.id);
  });
}
