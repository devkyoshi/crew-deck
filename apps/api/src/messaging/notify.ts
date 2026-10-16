import { EMAIL_DELAY_DEFAULT_MINUTES, S2C, type NotificationEvent } from '@crew-deck/shared';
import type { Db, TenantDb } from '../db/client.js';
import type { ChannelDoc, MessageDoc, NotificationDoc, NotificationType } from '../db/types.js';
import { isValidTimezone } from '../lib/time.js';
import { queueEmail, preferencesOf } from '../work/notify.js';
import { describeNotification, linkFor } from '../work/notify-jobs.js';
import type { CleanDoc } from '../work/rich-text.js';
import type { MessagingCtx } from './context.js';
import { peopleOf } from './dto.js';
import { inQuietHours, type QuietHours } from './quiet.js';
import { silencedByLeave } from './settings.js';

/**
 * Chat notifications (brief section 7). Events that notify: direct messages, @mentions, replies in
 * threads I follow, new messages in channels set to "all", and being added to a channel.
 *
 * Rules, in one place:
 * - never for my own messages, and not while I am looking at that conversation;
 * - a channel set to "nothing", or muted, stays silent except for @mentions of me by name;
 * - "mentions only" lets mentions, direct messages and followed threads through, not every message;
 * - do not disturb and quiet hours keep desktop alerts and emails quiet but the inbox and badges still update;
 * - email is only for what is still unseen after the person's email delay, and only for the types they chose.
 */

type Kind = Extract<
  NotificationType,
  'dm' | 'mention' | 'thread_reply' | 'channel_message' | 'added_to_channel'
>;

const excerptOf = (text: string | null) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
};

/** Everything that depends on the person: quiet hours, email delay, timezone. */
async function settingsOf(t: TenantDb, userId: string) {
  const row = await t.notificationPrefs.findOne({ userId });
  const tz = (await t.users([userId])).get(userId)?.timezone ?? 'UTC';
  return {
    quiet: row?.quiet as QuietHours | undefined,
    emailDelay: row?.emailDelayMinutes ?? EMAIL_DELAY_DEFAULT_MINUTES,
    tz: isValidTimezone(tz) ? tz : 'UTC',
  };
}

interface Delivery {
  userId: string;
  kind: Kind;
}

/**
 * Decides who is notified about one new message and how (see the rules above). Pure apart from reading
 * the channel's people, so it can be tested without sending anything.
 */
export async function recipientsOfMessage(
  ctx: MessagingCtx,
  t: TenantDb,
  channel: ChannelDoc,
  message: MessageDoc,
  targets: CleanDoc['targets'],
  now = new Date(),
): Promise<Delivery[]> {
  const authorId = message.authorId;
  if (!authorId || message.kind !== 'user') return [];
  const members = await t.channelMembers.find({ channelId: channel.id });
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const memberIds = new Set(members.map((m) => m.userId));

  const direct = new Set(targets.filter((x) => x.type === 'user').map((x) => x.id));
  const byGroup = new Set<string>();
  const groupIds = targets.filter((x) => x.type === 'group').map((x) => x.id);
  if (groupIds.length)
    for (const g of await t.groupMembers.find({ groupId: { $in: groupIds } }))
      byGroup.add(g.userId);
  const everyone = targets.some((x) => x.type === 'channel');
  let onlineHere = new Set<string>();
  if (targets.some((x) => x.type === 'here') && ctx.presence) {
    const states = await ctx.presence.statesOf(t.orgId, [...memberIds]);
    onlineHere = new Set([...states].filter(([, s]) => s === 'online').map(([id]) => id));
  }
  const followers = message.threadRootId
    ? new Set(
        (await t.threadFollows.find({ threadRootId: message.threadRootId })).map((f) => f.userId),
      )
    : new Set<string>();
  // A thread-only reply is not a channel message: it reaches followers and the mentioned, nobody else.
  const onTimeline = !message.threadRootId || message.alsoInChannel;

  const out: Delivery[] = [];
  for (const m of members) {
    if (m.userId === authorId) continue;
    const named = direct.has(m.userId);
    const mentioned = named || byGroup.has(m.userId) || everyone || onlineHere.has(m.userId);
    const silenced =
      (m.mutedUntil && m.mutedUntil.getTime() > now.getTime()) || m.notificationLevel === 'none';

    let kind: Kind | null = null;
    if (silenced) {
      // Muted or "nothing": only being called by name gets through.
      if (named) kind = 'mention';
    } else if (mentioned) kind = 'mention';
    else if (followers.has(m.userId)) kind = 'thread_reply';
    else if (isDm) kind = 'dm';
    else if (m.notificationLevel === 'all' && onTimeline) kind = 'channel_message';
    if (!kind) continue;
    // Looking at the conversation right now: the message is already in front of them.
    if (ctx.presence && (await ctx.presence.isViewing(t.orgId, m.userId, channel.id))) continue;
    out.push({ userId: m.userId, kind });
  }
  return out;
}

/** Writes the inbox rows for a new message, pushes them to the person's open tabs and schedules emails. */
export async function notifyMessage(
  ctx: MessagingCtx,
  args: { orgId: string; message: MessageDoc; channel: ChannelDoc; targets: CleanDoc['targets'] },
  now = new Date(),
) {
  const t = ctx.db.tenant(args.orgId);
  const { message, channel } = args;
  const who = recipientsOfMessage(ctx, t, channel, message, args.targets, now);
  const deliveries = await who;
  if (deliveries.length === 0) return 0;
  const data = {
    channelId: channel.id,
    channelName: channel.name,
    channelType: channel.type,
    messageId: message.id,
    seq: String(message.seq),
    threadRootId: message.threadRootId,
    excerpt: excerptOf(message.bodyText),
  };
  let made = 0;
  for (const d of deliveries) {
    made += (await notifyOne(ctx, t, { ...d, actorId: message.authorId, data }, now)) ? 1 : 0;
  }
  return made;
}

/** One chat notification to one person, honouring their preferences for that kind of notification. */
export async function notifyOne(
  ctx: MessagingCtx,
  t: TenantDb,
  d: Delivery & { actorId: string | null; data: Record<string, unknown> },
  now = new Date(),
): Promise<NotificationDoc | null> {
  const prefs = (await preferencesOf(t, d.userId))[d.kind];
  if (!prefs.inApp && !prefs.email) return null;
  const s = await settingsOf(t, d.userId);
  const doc = await t.notifications.insert({
    userId: d.userId,
    type: d.kind,
    itemId: null,
    spaceId: null,
    actorId: d.actorId,
    data: d.data,
    // Kept only to back an email when the inbox is switched off for this kind.
    hidden: !prefs.inApp,
    readAt: null,
    dedupeKey: null,
    // Emailed later, and only if it is still unseen by then.
    emailDueAt: prefs.email ? new Date(now.getTime() + s.emailDelay * 60_000) : null,
    emailChecked: false,
    createdAt: now,
  });
  if (prefs.inApp) {
    const silent =
      inQuietHours(s.quiet, s.tz, now) ||
      (await ctx.presence?.isDnd(t.orgId, d.userId)) === true ||
      (await silencedByLeave(t, d.userId, now));
    const people = await peopleOf(t, [d.actorId]);
    const actorName = d.actorId
      ? (people.get(d.actorId)?.name ?? people.get(d.actorId)?.email ?? null)
      : null;
    const ev: NotificationEvent = {
      id: doc.id,
      type: d.kind,
      text: describeNotification(doc, actorName),
      channelId: (d.data.channelId as string) ?? null,
      href: `/messages/${d.data.channelId}${d.data.seq ? `?m=${d.data.seq}` : ''}${d.data.threadRootId ? `&thread=${d.data.threadRootId}` : ''}`,
      silent,
      createdAt: now.toISOString(),
    };
    ctx.events.toUser(t.orgId, d.userId, S2C.notificationNew, ev);
  }
  return doc;
}

/** "Added to a channel" (by someone else). */
export async function notifyAdded(
  ctx: MessagingCtx,
  orgId: string,
  channel: ChannelDoc,
  userId: string,
  byId: string,
) {
  if (userId === byId) return;
  const t = ctx.db.tenant(orgId);
  await notifyOne(ctx, t, {
    userId,
    kind: 'added_to_channel',
    actorId: byId,
    data: { channelId: channel.id, channelName: channel.name, channelType: channel.type },
  });
}

// ---- The unseen-email check ------------------------------------------------------------------------------

/**
 * Emails chat notifications that are still unseen once their delay has passed. "Seen" means read in the
 * inbox, or the person's read position in the channel has moved past the message. Quiet hours and do not
 * disturb suppress the email. The emails themselves go out through the shared batch queue.
 */
export async function emailUnseenMessages(
  db: Db,
  opts: { isDnd?: (orgId: string, userId: string) => Promise<boolean>; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const due = await db.global.all.notifications.find(
    { emailDueAt: { $lte: now }, emailChecked: { $ne: true } },
    { limit: 500 },
  );
  let queued = 0;
  for (const n of due) {
    // Claim it so two instances never handle the same one.
    const claimed = await db.global.all.notifications.updateOne(
      { id: n.id, emailChecked: { $ne: true } },
      { emailChecked: true },
    );
    if (claimed === 0 || n.readAt) continue;
    const t = db.tenant(n.orgId);
    const channelId = n.data.channelId as string | undefined;
    const seq = Number(n.data.seq ?? 0);
    if (channelId && seq) {
      const cursor = await t.readCursors.findOne({ channelId, userId: n.userId });
      if ((cursor?.lastReadSeq ?? 0) >= seq) {
        await t.notifications.updateOne({ id: n.id }, { readAt: now });
        continue;
      }
    }
    const s = await settingsOf(t, n.userId);
    if (inQuietHours(s.quiet, s.tz, now)) continue;
    if (opts.isDnd && (await opts.isDnd(n.orgId, n.userId))) continue;
    if (await silencedByLeave(t, n.userId, now)) continue;
    await queueEmail(t, n.userId, n.id);
    queued++;
  }
  return queued;
}

export function startMessageEmailJobs(
  db: Db,
  isDnd: (orgId: string, userId: string) => Promise<boolean>,
  log: { error: (m: string) => void },
) {
  const run = () =>
    void emailUnseenMessages(db, { isDnd }).catch((e: Error) =>
      log.error(`message emails failed: ${e.message}`),
    );
  const timer = setInterval(run, 60_000);
  return { close: async () => clearInterval(timer) };
}

export { linkFor };
