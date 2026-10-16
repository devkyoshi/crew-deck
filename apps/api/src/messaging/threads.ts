import type { MessageDTO } from '@crew-deck/shared';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { hydrate } from './dto.js';
import { loadMessage } from './messages.js';

/** Threads do not nest: any message id resolves to the top-level message its thread hangs from. */
async function rootOf(ctx: MessagingCtx, actor: Actor, messageId: string) {
  const t = ctx.db.tenant(actor.orgId);
  const { msg, access } = await loadMessage(t, actor, messageId);
  const root = msg.threadRootId ? await t.messages.get(msg.threadRootId) : msg;
  if (!root) throw notFound('Message');
  return { t, root, access };
}

/** The thread's root message and its replies (oldest first), paged by seq. */
export async function listReplies(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  q: { afterSeq?: number; limit?: number } = {},
) {
  const { t, root } = await rootOf(ctx, actor, messageId);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const page = await t.messages.find(
    { threadRootId: root.id, ...(q.afterSeq !== undefined ? { seq: { $gt: q.afterSeq } } : {}) },
    { sort: { seq: 1 }, limit: limit + 1 },
  );
  const follow = await t.threadFollows.findOne({ threadRootId: root.id, userId: actor.userId });
  const [rootDto, ...replies] = await hydrate(t, [root, ...page.slice(0, limit)]);
  return {
    root: rootDto!,
    replies,
    hasMore: page.length > limit,
    following: !!follow,
    lastReadSeq: follow?.lastReadSeq ?? 0,
  };
}

/** Follow or unfollow a thread. Only people in the channel can follow. */
export async function setFollow(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  follow: boolean,
) {
  const { t, root, access } = await rootOf(ctx, actor, messageId);
  if (!access.member)
    throw new AppError(403, 'forbidden', 'Join the channel to follow its threads');
  if (follow) {
    // Following starts "caught up": earlier replies are not suddenly unread.
    await t.threadFollows.upsert(
      { threadRootId: root.id, userId: actor.userId },
      {},
      { channelId: root.channelId, lastReadSeq: await latestSeq(t, root.id) },
    );
  } else {
    await t.threadFollows.deleteOne({ threadRootId: root.id, userId: actor.userId });
  }
  return { following: follow };
}

async function latestSeq(t: ReturnType<MessagingCtx['db']['tenant']>, rootId: string) {
  const last = await t.messages.findOne(
    { threadRootId: rootId },
    { sort: { seq: -1 }, projection: { seq: 1 } },
  );
  return last?.seq ?? 0;
}

/** Marks a thread read up to `seq`. Only moves forward. */
export async function markThreadRead(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  seq: number,
) {
  const { t, root } = await rootOf(ctx, actor, messageId);
  await t.threadFollows.updateOne(
    { threadRootId: root.id, userId: actor.userId },
    { $max: { lastReadSeq: seq } },
  );
  return { threadRootId: root.id, lastReadSeq: seq };
}

export interface ThreadSummary {
  root: MessageDTO;
  /** Replies from other people since I last read the thread. */
  unread: number;
  latestReply: MessageDTO | null;
}

/** The threads I follow, most recently active first, with unread counts. */
export async function listThreads(ctx: MessagingCtx, actor: Actor): Promise<ThreadSummary[]> {
  const t = ctx.db.tenant(actor.orgId);
  const follows = await t.threadFollows.find({ userId: actor.userId }, { limit: 300 });
  if (follows.length === 0) return [];
  const mine = new Set(
    (await t.channelMembers.find({ userId: actor.userId })).map((m) => m.channelId),
  );
  const live = follows.filter((f) => mine.has(f.channelId));
  const roots = await t.messages.find({ id: { $in: live.map((f) => f.threadRootId) } });
  const rootBy = new Map(roots.map((r) => [r.id, r]));
  const ordered = live
    .map((f) => ({ f, root: rootBy.get(f.threadRootId) }))
    .filter(
      (x): x is { f: typeof x.f; root: NonNullable<typeof x.root> } =>
        !!x.root && x.root.replyCount > 0,
    )
    .sort((a, b) => (b.root.lastReplyAt?.getTime() ?? 0) - (a.root.lastReplyAt?.getTime() ?? 0))
    .slice(0, 100);

  const out: ThreadSummary[] = [];
  const latest = await Promise.all(
    ordered.map(({ f }) =>
      t.messages.findOne({ threadRootId: f.threadRootId, deletedAt: null }, { sort: { seq: -1 } }),
    ),
  );
  const unread = await Promise.all(
    ordered.map(({ f }) =>
      t.messages.count({
        threadRootId: f.threadRootId,
        seq: { $gt: f.lastReadSeq },
        authorId: { $ne: actor.userId },
        deletedAt: null,
      }),
    ),
  );
  const dtos = new Map(
    (
      await hydrate(t, [
        ...ordered.map((x) => x.root),
        ...latest.filter((m): m is NonNullable<typeof m> => !!m),
      ])
    ).map((d) => [d.id, d]),
  );
  ordered.forEach(({ root }, i) => {
    out.push({
      root: dtos.get(root.id)!,
      unread: unread[i] ?? 0,
      latestReply: latest[i] ? (dtos.get(latest[i]!.id) ?? null) : null,
    });
  });
  return out;
}
