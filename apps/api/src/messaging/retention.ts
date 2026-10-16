import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import type { Db } from '../db/client.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { createTenantQueue, createTenantWorker, type TenantJobData } from '../lib/redis.js';
import { can, type Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { expireExports } from './export.js';
import { dropMessageExtras } from './messages.js';
import { loadMessagingSettings } from './settings.js';

const DAY_MS = 86_400_000;
/** Roots purged per batch, and batches per channel per run: a huge backlog is worked off over several runs. */
const BATCH = 200;
const MAX_BATCHES = 5;

export interface PurgeResult {
  channels: number;
  messages: number;
}

/**
 * Deletes what has outlived its retention: the channel's own setting if it has one, otherwise the
 * workspace's. A thread goes when its last activity is older than the window (the root and its replies
 * together), so a conversation that is still alive is never cut in half. Files, reactions, mentions,
 * pins and saved copies go with their messages. Each purge is audited with how much it removed.
 */
export async function purgeExpired(
  ctx: MessagingCtx,
  orgId: string,
  now = new Date(),
): Promise<PurgeResult> {
  const t = ctx.db.tenant(orgId);
  const workspaceDays = (await loadMessagingSettings(t)).retentionDays;
  // Nothing to do unless the workspace has a default or a channel has its own window.
  const channels = await t.channels.find(workspaceDays ? {} : { retentionDays: { $gt: 0 } });
  const out: PurgeResult = { channels: 0, messages: 0 };
  for (const channel of channels) {
    const days = channel.retentionDays ?? workspaceDays;
    if (!days) continue;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    let removed = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const roots = await t.messages.find(
        {
          channelId: channel.id,
          threadRootId: null,
          createdAt: { $lt: cutoff },
          $or: [{ lastReplyAt: null }, { lastReplyAt: { $lt: cutoff } }],
        },
        { sort: { seq: 1 }, limit: BATCH, projection: { id: 1 } },
      );
      if (roots.length === 0) break;
      const rootIds = roots.map((r) => r.id);
      const replies = await t.messages.find(
        { channelId: channel.id, threadRootId: { $in: rootIds } },
        { projection: { id: 1 } },
      );
      const ids = [...rootIds, ...replies.map((r) => r.id)];
      await dropMessageExtras(ctx, orgId, ids);
      await t.messageEdits.deleteMany({ messageId: { $in: ids } });
      await t.savedMessages.deleteMany({ messageId: { $in: ids } });
      await t.threadFollows.deleteMany({ threadRootId: { $in: rootIds } });
      await t.messages.deleteMany({ id: { $in: ids } });
      removed += ids.length;
      if (roots.length < BATCH) break;
    }
    if (removed > 0) {
      out.channels++;
      out.messages += removed;
      await ctx.db.tx(orgId, (tx) =>
        writeAudit(tx, {
          orgId,
          actorId: null,
          action: 'channel.retention_purged',
          targetType: 'channel',
          targetId: channel.id,
          after: { messages: removed, olderThan: cutoff.toISOString(), days },
        }),
      );
    }
  }
  return out;
}

// ---- Per-channel override (admin policy: no access to the channel's content is needed) -----------------------

export async function setChannelRetention(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  days: number | null,
) {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  if (days !== null && (!Number.isInteger(days) || days < RETENTION_MIN_DAYS || days > RETENTION_MAX_DAYS))
    throw new AppError(422, 'validation_error', 'Choose a number of days', { days: 'Choose a number of days' });
  const t = ctx.db.tenant(actor.orgId);
  const channel = await t.channels.get(channelId);
  if (!channel) throw notFound('Channel');
  await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.channels.updateOne({ id: channelId }, { retentionDays: days });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'channel.retention_changed',
      targetType: 'channel',
      targetId: channelId,
      before: { days: channel.retentionDays ?? null },
      after: { days },
    });
  });
  return { channelId, retentionDays: days };
}

/** The channels that have their own retention, for the admin screen. Direct messages are not named. */
export async function listRetentionOverrides(ctx: MessagingCtx, actor: Actor) {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  const t = ctx.db.tenant(actor.orgId);
  const rows = await t.channels.find({ retentionDays: { $gt: 0 } });
  return rows.map((c) => ({
    channelId: c.id,
    name: c.type === 'public' || c.type === 'private' ? c.name : 'Direct message',
    type: c.type,
    retentionDays: c.retentionDays as number,
  }));
}

// ---- The worker ----------------------------------------------------------------------------------------

const TICK_QUEUE = 'chat-retention-tick';
const ORG_QUEUE = 'chat-retention-org';
const EVERY_MS = 60 * 60 * 1000;

/** Hourly: one job per workspace that keeps messages for a limited time. */
export async function startRetentionJobs(
  redis: Redis,
  db: Db,
  ctx: MessagingCtx,
  log: { error: (m: string) => void },
) {
  const tickQueue = new Queue(TICK_QUEUE, { connection: redis });
  const orgQueue = createTenantQueue<TenantJobData>(ORG_QUEUE, redis);
  await tickQueue.upsertJobScheduler(
    'hourly',
    { every: EVERY_MS },
    { name: 'tick', opts: { removeOnComplete: true, removeOnFail: 20 } },
  );
  const tickWorker = new Worker(
    TICK_QUEUE,
    async () => {
      const orgs = await db.global.organizations.find({}, { projection: { id: 1 } });
      for (const o of orgs) {
        await orgQueue.add(
          'purge',
          { orgId: o.id },
          {
            jobId: `${o.id}-${Math.floor(Date.now() / EVERY_MS)}`,
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
      }
    },
    { connection: redis },
  );
  const orgWorker = createTenantWorker<TenantJobData>(ORG_QUEUE, redis, async (_job, orgId) => {
    await purgeExpired(ctx, orgId);
    await expireExports(ctx, orgId);
  });
  for (const w of [tickWorker, orgWorker])
    w.on('failed', (job, err) => log.error(`${w.name} job ${job?.id} failed: ${err.message}`));
  return {
    async close() {
      await Promise.all([tickWorker.close(), orgWorker.close(), tickQueue.close(), orgQueue.close()]);
    },
  };
}
