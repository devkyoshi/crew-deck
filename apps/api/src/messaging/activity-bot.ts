import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  ACTIVITY_COALESCE_SECONDS,
  ACTIVITY_DEFAULTS,
  ACTIVITY_EVENT_TYPES,
  type ActivityEventType,
  type ActivityRulesDTO,
} from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import type { Db, TenantDb } from '../db/client.js';
import type { ChatActivityEventDoc } from '../db/types.js';
import { AppError } from '../lib/errors.js';
import { createTenantQueue, createTenantWorker, type TenantJobData } from '../lib/redis.js';
import type { Actor } from '../permissions/can.js';
import { loadChannel, requireChannel } from './access.js';
import { postAsBot } from './bot.js';
import type { MessagingCtx } from './context.js';

// ---- Rules ---------------------------------------------------------------------------------------------

const known = new Set<string>(ACTIVITY_EVENT_TYPES);

async function eventTypesFor(t: TenantDb, channelId: string): Promise<ActivityEventType[]> {
  const rule = await t.activityRules.findOne({ channelId });
  return rule ? rule.eventTypes : [...ACTIVITY_DEFAULTS];
}

export async function getActivityRules(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
): Promise<ActivityRulesDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const { channel } = await loadChannel(t, actor, channelId);
  if (!channel.spaceId)
    throw new AppError(409, 'not_space_channel', 'Only a space channel has an activity bot');
  return { eventTypes: await eventTypesFor(t, channelId) };
}

/** Space admins (who own the channel) choose what the bot posts. */
export async function setActivityRules(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  eventTypes: string[],
): Promise<ActivityRulesDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  requireChannel(actor, access, 'channel.manage');
  if (!access.channel.spaceId)
    throw new AppError(409, 'not_space_channel', 'Only a space channel has an activity bot');
  const unique = [...new Set(eventTypes)];
  const wanted = unique.filter((x): x is ActivityEventType => known.has(x));
  if (wanted.length !== unique.length) throw new AppError(422, 'validation_error', 'Unknown event type');
  const before = await eventTypesFor(t, channelId);
  await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.activityRules.upsert(
      { channelId },
      { channelId, spaceId: access.channel.spaceId!, eventTypes: wanted, updatedAt: new Date() },
    );
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'channel.activity_rules_changed',
      targetType: 'channel',
      targetId: channelId,
      before: { eventTypes: before },
      after: { eventTypes: wanted },
    });
  });
  return { eventTypes: wanted };
}

// ---- Collecting events ---------------------------------------------------------------------------------

export interface WorkEvent {
  type: ActivityEventType;
  spaceId: string;
  actorId: string | null;
  itemId?: string | null;
  /** The sprint's name, the new assignee's id... */
  detail?: Record<string, unknown>;
}

/**
 * Notes a work event for the space's channel, if the channel exists, is not archived, and its rules ask
 * for this kind of event. Called from the same transaction as the change, so an event exists exactly when
 * the change committed. Posting happens later, in the worker.
 */
export async function bufferWorkEvent(t: TenantDb, e: WorkEvent) {
  const channel = await t.channels.findOne({ spaceId: e.spaceId });
  if (!channel || channel.isArchived) return;
  if (!(await eventTypesFor(t, channel.id)).includes(e.type)) return;
  let itemKey: string | null = null;
  let title: string | null = null;
  if (e.itemId) {
    const item = await t.workItems.findOne({ id: e.itemId });
    const space = await t.spaces.findOne({ id: e.spaceId });
    if (item && space) {
      itemKey = `${space.key}-${item.number}`;
      title = item.title;
    }
  }
  await t.chatActivityEvents.insert({
    channelId: channel.id,
    spaceId: e.spaceId,
    type: e.type,
    itemId: e.itemId ?? null,
    itemKey,
    title,
    actorId: e.actorId,
    detail: e.detail ?? {},
  });
}

/** Turns one entry of an item's history into the chat event it implies, if any. */
export async function bufferFromActivity(
  t: TenantDb,
  e: {
    item: { id: string; spaceId: string };
    actorId: string;
    kind: string;
    field?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
) {
  const base = { spaceId: e.item.spaceId, actorId: e.actorId, itemId: e.item.id };
  if (e.kind === 'created') return bufferWorkEvent(t, { ...base, type: 'item_created' });
  if (e.kind === 'commented') return bufferWorkEvent(t, { ...base, type: 'comment_added' });
  if (e.kind !== 'updated' && e.kind !== 'moved') return;
  if (e.field === 'assignee' && e.newValue)
    return bufferWorkEvent(t, { ...base, type: 'item_assigned' });
  if (e.field === 'status') {
    const now = (e.newValue as { category?: string } | null)?.category;
    const was = (e.oldValue as { category?: string } | null)?.category;
    if (now === 'done' && was !== 'done') return bufferWorkEvent(t, { ...base, type: 'item_done' });
  }
}

// ---- Posting -------------------------------------------------------------------------------------------

const list = (keys: string[]) => {
  const unique = [...new Set(keys)];
  return unique.length <= 8
    ? unique.join(', ')
    : `${unique.slice(0, 8).join(', ')} and ${unique.length - 8} more`;
};

/** The sentence for a group of events of one type, e.g. "4 items moved to Done: ENG-1, ENG-2". */
export function describeGroup(
  type: ActivityEventType,
  events: Pick<ChatActivityEventDoc, 'itemKey' | 'detail'>[],
  who: string | null,
): string {
  const keys = events.map((e) => e.itemKey).filter((k): k is string => !!k);
  const n = new Set(keys).size;
  const by = who ? `${who} ` : '';
  switch (type) {
    case 'item_created':
      return n === 1 ? `${by}created ${keys[0]}.` : `${by}created ${n} work items: ${list(keys)}.`;
    case 'item_assigned':
      return n === 1 ? `${by}assigned ${keys[0]}.` : `${by}assigned ${n} work items: ${list(keys)}.`;
    case 'item_done':
      return n === 1 ? `${keys[0]} moved to Done.` : `${n} items moved to Done: ${list(keys)}.`;
    case 'comment_added':
      return n === 1
        ? `${by}commented on ${keys[0]}.`
        : `${by}commented on ${n} work items: ${list(keys)}.`;
    case 'sprint_started':
    case 'sprint_completed': {
      const name = String(events[0]?.detail?.sprint ?? 'A sprint');
      return `Sprint ${name} ${type === 'sprint_started' ? 'started' : 'was completed'}.`;
    }
  }
}

/**
 * Posts the events whose 60-second window has closed, one compact message per event type per channel.
 * A burst waits until its first event is a minute old, so changes made within that minute become one post.
 * Safe to run from several instances: each event is claimed with an atomic update, so it is posted once.
 */
export async function flushActivity(ctx: MessagingCtx, orgId: string, now = new Date()) {
  const t = ctx.db.tenant(orgId);
  const cutoff = new Date(now.getTime() - ACTIVITY_COALESCE_SECONDS * 1000);
  const pending = await t.chatActivityEvents.find({ postedAt: null }, { sort: { at: 1 } });
  const byChannel = new Map<string, ChatActivityEventDoc[]>();
  for (const e of pending) byChannel.set(e.channelId, [...(byChannel.get(e.channelId) ?? []), e]);
  let posted = 0;
  for (const [channelId, events] of byChannel) {
    if (events[0]!.at > cutoff) continue;
    const claimed: ChatActivityEventDoc[] = [];
    for (const e of events) {
      const won = await t.chatActivityEvents.findOneAndUpdate(
        { id: e.id, postedAt: null },
        { postedAt: now },
      );
      if (won) claimed.push(e);
    }
    if (claimed.length === 0) continue;
    const people = new Map(
      [...(await t.users(claimed.flatMap((e) => (e.actorId ? [e.actorId] : []))))].map(([id, u]) => [
        id,
        u.name ?? u.email,
      ]),
    );
    for (const type of ACTIVITY_EVENT_TYPES) {
      const group = claimed.filter((e) => e.type === type);
      if (group.length === 0) continue;
      const actors = new Set(group.map((e) => e.actorId));
      const first = group[0]!.actorId;
      const who = actors.size === 1 && first ? (people.get(first) ?? null) : null;
      const text = describeGroup(type, group, who);
      const itemIds = [...new Set(group.flatMap((e) => (e.itemId ? [e.itemId] : [])))];
      const msg = await postAsBot(ctx, orgId, { botId: 'activity', channelId, text, itemIds });
      if (msg) posted++;
    }
  }
  return posted;
}

// ---- The worker ----------------------------------------------------------------------------------------

const TICK_QUEUE = 'chat-activity-tick';
const ORG_QUEUE = 'chat-activity-org';
const EVERY_MS = 15_000;

/** Every 15 seconds a tick queues a job for each workspace with waiting events; the job posts what is due. */
export async function startActivityBotJobs(
  redis: Redis,
  db: Db,
  ctx: MessagingCtx,
  log: { error: (m: string) => void },
) {
  const tickQueue = new Queue(TICK_QUEUE, { connection: redis });
  const orgQueue = createTenantQueue<TenantJobData>(ORG_QUEUE, redis);
  await tickQueue.upsertJobScheduler(
    'every-15s',
    { every: EVERY_MS },
    { name: 'tick', opts: { removeOnComplete: true, removeOnFail: 20 } },
  );
  const tickWorker = new Worker(
    TICK_QUEUE,
    async () => {
      const waiting = await db.global.all.chatActivityEvents.find(
        { postedAt: null },
        { projection: { orgId: 1 }, limit: 500 },
      );
      for (const orgId of new Set(waiting.map((w) => w.orgId))) {
        await orgQueue.add(
          'flush',
          { orgId },
          {
            jobId: `${orgId}-${Math.floor(Date.now() / EVERY_MS)}`,
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
      }
    },
    { connection: redis },
  );
  const orgWorker = createTenantWorker<TenantJobData>(ORG_QUEUE, redis, async (_job, orgId) => {
    await flushActivity(ctx, orgId);
  });
  for (const w of [tickWorker, orgWorker])
    w.on('failed', (job, err) => log.error(`${w.name} job ${job?.id} failed: ${err.message}`));
  return {
    async close() {
      await Promise.all([tickWorker.close(), orgWorker.close(), tickQueue.close(), orgQueue.close()]);
    },
  };
}
