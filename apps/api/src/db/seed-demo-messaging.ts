import type { Db } from './client.js';
import { ensureBootstrap, createChannel, openDm } from '../messaging/channels.js';
import type { MessagingCtx } from '../messaging/context.js';
import { postAsBot } from '../messaging/bot.js';
import { sendMessage } from '../messaging/messages.js';
import { setPinned } from '../messaging/pins.js';
import { toggleReaction } from '../messaging/reactions.js';
import { syncSpaceChannel } from '../messaging/space-channels.js';
import { MemoryEventSink } from '../messaging/events.js';
import type { Actor } from '../permissions/can.js';

/**
 * Chat for the demo workspace (acme): channels people would really have, threads, reactions, mentions,
 * pins, work item keys, a direct message with unread messages, a space channel with its bot, and a
 * custom status. Written through the same services as the app, then dated back over the last days so
 * the screens do not look brand new. Safe to run again: it does nothing once its channels exist.
 */

const text = (s: string, marks?: object[]) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) });
const para = (...c: object[]) => ({ type: 'paragraph', content: c });
const doc = (...p: object[]) => ({ type: 'doc', content: p });
const say = (s: string) => doc(para(text(s)));

export async function seedMessagingDemo(db: Db, org: { id: string }, who: (handle: string) => string) {
  const t = db.tenant(org.id);
  if (await t.channels.exists({ nameLower: 'engineering' })) return;

  const pending: Promise<unknown>[] = [];
  const ctx: MessagingCtx = {
    db,
    events: new MemoryEventSink(),
    defer: (work) => void pending.push(work().catch(() => undefined)),
  };
  const actors = new Map<string, Actor>();
  const as = async (handle: string): Promise<Actor> => {
    const cached = actors.get(handle);
    if (cached) return cached;
    const userId = who(handle);
    const m = await t.memberships.findOne({ userId });
    const a: Actor = { userId, orgId: org.id, orgRole: m?.orgRole ?? 'member' };
    actors.set(handle, a);
    return a;
  };

  // Everyone gets #general and #announcements, as they would on first opening Messages.
  const handles = ['owner', 'member', 'priya', 'ben', 'dmitri', 'carla', 'elena', 'farid', 'grace', 'hiro', 'ines', 'member2'];
  const people = await t.users(handles.map(who));
  const name = (handle: string) => people.get(who(handle))?.name ?? handle;
  for (const h of handles) await ensureBootstrap(ctx, t, who(h));

  let n = 0;
  const posted: { id: string; at: number }[] = [];
  const send = async (handle: string, channelId: string, body: object | string, extra: { threadRootId?: string; agoMin: number }) => {
    const res = await sendMessage(ctx, await as(handle), {
      channelId,
      clientMsgId: `demo-${org.id.slice(0, 6)}-${++n}`,
      body: typeof body === 'string' ? say(body) : body,
      threadRootId: extra.threadRootId,
    });
    posted.push({ id: res.message.id, at: Date.now() - extra.agoMin * 60_000 });
    return res.message.id;
  };
  const react = async (handle: string, messageId: string, emoji: string) => {
    await toggleReaction(ctx, await as(handle), messageId, emoji, true);
  };
  const mention = (handle: string) => ({ type: 'mention', attrs: { id: who(handle), label: name(handle), kind: 'user' } });

  const general = (await t.channels.findOne({ nameLower: 'general' }))!.id;
  const announcements = (await t.channels.findOne({ nameLower: 'announcements' }))!.id;

  // ---- #general ----------------------------------------------------------------------------------------
  const welcome = await send('owner', general, 'Welcome to Acme chat. Channels are for topics, threads keep them tidy, and Ctrl+K jumps anywhere.', { agoMin: 6 * 1440 });
  await react('priya', welcome, '👋');
  await react('ben', welcome, '👋');
  await react('elena', welcome, '🎉');
  await send('priya', general, doc(para(text('Morning all! '), mention('owner'), text(' the new office plan is in the shared drive.'))), { agoMin: 3 * 1440 });
  const lunch = await send('ben', general, 'Anyone up for lunch at the place on Fleet Street?', { agoMin: 3 * 1440 - 20 });
  await send('elena', general, 'Yes please, 12:30?', { agoMin: 3 * 1440 - 25, threadRootId: lunch });
  await send('ben', general, '12:30 works. I will book a table for five.', { agoMin: 3 * 1440 - 27, threadRootId: lunch });
  await send('grace', general, 'Count me in.', { agoMin: 3 * 1440 - 30, threadRootId: lunch });
  await react('grace', lunch, '🍜');
  await send('hiro', general, 'Reminder: Company Day is next week, the office is closed.', { agoMin: 1440 });

  // ---- #announcements ----------------------------------------------------------------------------------
  const shipped = await send('owner', announcements, 'Release 2.4 is live. Thank you to everyone who tested it. Notes are on the Releases tab.', { agoMin: 2 * 1440 });
  await react('priya', shipped, '🚀');
  await react('carla', shipped, '🎉');
  await setPinned(ctx, await as('owner'), shipped, true);

  // ---- #engineering (public) --------------------------------------------------------------------------
  const eng = await createChannel(ctx, await as('priya'), {
    name: 'engineering',
    type: 'public',
    topic: 'Backend and platform engineering',
    description: 'Design questions, incidents and releases for the engineering team.',
    memberIds: ['ben', 'dmitri', 'farid', 'grace', 'owner'].map(who),
  });
  const standup = await send('priya', eng.id, 'Standup notes: the importer is done, ENG-3 is blocked on the API key, and we need a decision on the retry policy.', { agoMin: 2 * 1440 });
  await send('ben', eng.id, 'I would go with three retries and exponential backoff.', { agoMin: 2 * 1440 - 10, threadRootId: standup });
  await send('dmitri', eng.id, 'Agree. Also log the final failure so support can see it.', { agoMin: 2 * 1440 - 14, threadRootId: standup });
  await send('priya', eng.id, 'Done. Writing it up in the runbook.', { agoMin: 2 * 1440 - 20, threadRootId: standup });
  await send('ben', eng.id, doc(para(text('Quick tip for the retry helper:')), { type: 'codeBlock', content: [text('await retry(() => fetchPage(n), { tries: 3, backoff: "exp" });')] }), { agoMin: 1500 });
  const incident = await send('dmitri', eng.id, doc(para(mention('priya'), text(' the nightly sync took 40 minutes last night instead of 8. Looking into it.'))), { agoMin: 600 });
  await react('priya', incident, '👀');
  await send('priya', eng.id, 'Thanks. Pinning this so we remember to check the index.', { agoMin: 590 });
  await setPinned(ctx, await as('priya'), incident, true);

  // ---- #design-crits (private) -------------------------------------------------------------------------
  const crits = await createChannel(ctx, await as('hiro'), {
    name: 'design-crits',
    type: 'private',
    topic: 'Weekly design critique',
    memberIds: ['ines', 'member2', 'owner'].map(who),
  });
  const crit = await send('hiro', crits.id, 'Dropped the new onboarding mockups in the Design space. Fresh eyes please.', { agoMin: 1800 });
  await react('ines', crit, '❤️');
  await send('ines', crits.id, 'The empty states feel much friendlier. Can we try a darker header on mobile?', { agoMin: 1700 });
  await send('member2', crits.id, 'Seconding the darker header. Otherwise ship it.', { agoMin: 1650 });

  // ---- Direct messages, with unread ones for the owner -------------------------------------------------
  const dm = await openDm(ctx, await as('priya'), [who('owner')]);
  await send('priya', dm.id, 'Do you have ten minutes today to talk about the hiring plan?', { agoMin: 45 });
  await send('priya', dm.id, 'No rush, just before the end of the day works.', { agoMin: 44 });
  const dm2 = await openDm(ctx, await as('ben'), [who('priya')]);
  await send('ben', dm2.id, 'Can you review my pull request when you get a minute?', { agoMin: 200 });
  await send('priya', dm2.id, 'On it.', { agoMin: 190 });

  // ---- Space channels: each space has one, and the ENG channel has the activity bot and a work item ----
  const spaces = await t.spaces.find({ deletedAt: null });
  for (const s of spaces) await syncSpaceChannel(ctx, org.id, s.id);
  const engSpace = spaces.find((s) => s.key === 'ENG');
  if (engSpace) {
    const channel = await t.channels.findOne({ spaceId: engSpace.id });
    const item = await t.workItems.findOne({ spaceId: engSpace.id, deletedAt: null }, { sort: { number: 1 } });
    if (channel && item) {
      await send('priya', channel.id, `Can we get ENG-${item.number} into this sprint? It unblocks the importer.`, { agoMin: 300 });
      await postAsBot(ctx, org.id, { botId: 'activity', channelId: channel.id, text: `Priya created ENG-${item.number}.`, itemIds: [item.id] });
    }
  }

  // ---- A status for someone ------------------------------------------------------------------------------
  await t.userStatuses.upsert({ userId: who('priya') }, { emoji: '🌴', text: 'On leave from the 28th', expiresAt: null });

  await Promise.all(pending);

  // Spread the conversation over the last days: each message gets the time it was "sent".
  for (const p of posted) await t.messages.updateOne({ id: p.id }, { createdAt: new Date(p.at) });
  // A thread's "last reply" is the time of its newest reply.
  const roots = await t.messages.find({ replyCount: { $gt: 0 } });
  for (const r of roots) {
    const replies = await t.messages.find({ threadRootId: r.id }, { sort: { createdAt: -1 }, limit: 1 });
    if (replies[0]) await t.messages.updateOne({ id: r.id }, { lastReplyAt: replies[0].createdAt });
  }
  const touched = await t.channels.find({});
  for (const c of touched) {
    const last = await t.messages.find({ channelId: c.id }, { sort: { seq: -1 }, limit: 1 });
    if (last[0]) await t.channels.updateOne({ id: c.id }, { lastMessageAt: last[0].createdAt });
  }
  console.log('seeded demo chat (acme)');
}

