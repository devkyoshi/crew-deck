import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../src/messaging/events.js';
import { emailUnseenMessages } from '../src/messaging/notify.js';
import { Presence } from '../src/messaging/presence.js';
import { inQuietHours } from '../src/messaging/quiet.js';
import { parseSearch, snippetOf } from '../src/messaging/search.js';
import { caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

const events = new MemoryEventSink();
const pending: Promise<unknown>[] = [];
const t = makeApp({
  events,
  messageLimits: { userMax: 10_000, orgMax: 100_000, windowMs: 10_000 },
  deferMessaging: (work) =>
    void pending.push(work().catch((e) => console.error('follow-up failed', e))),
});
const call = caller(t.app);
const presence = new Presence(t.redis);
/** Waits for the notifications of everything sent so far. */
const flush = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let slug: string;
let orgId: string;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};

const api = (
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: Json,
) => call({ method, url, slug, cookie: c[who], payload });
const text = (s: string, marks?: Json[]) => ({
  type: 'text',
  text: s,
  ...(marks ? { marks } : {}),
});
const doc = (...parts: Json[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: parts }],
});
const say = (s: string) => doc(text(s));
const mention = (
  id: string,
  label: string,
  kind: 'user' | 'group' | 'channel' | 'here' = 'user',
) => ({ type: 'mention', attrs: { id, label, kind } });
let n = 0;
const cid = () => `m3-${Date.now()}-${n++}`;
const post = (who: string, channelId: string, body: Json, extra: Json = {}) =>
  api(who, 'POST', `/channels/${channelId}/messages`, { clientMsgId: cid(), body, ...extra });
const reply = (who: string, rootId: string, body: Json) =>
  api(who, 'POST', `/messages/${rootId}/replies`, { clientMsgId: cid(), body });
const mk = async (
  who: string,
  name: string,
  memberNames: string[] = [],
  type: 'public' | 'private' = 'public',
) => {
  const res = await api(who, 'POST', '/channels', {
    name,
    type,
    memberIds: memberNames.map((m) => u[m]!.id),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().channel.id as string;
};
const level = (who: string, channelId: string, notificationLevel: string) =>
  api(who, 'PATCH', `/channels/${channelId}/me`, { notificationLevel });
/** The chat notifications a person holds, newest first (straight from the database). */
const inbox = async (who: string) =>
  (
    await t.db.tenant(orgId).notifications.find({ userId: u[who]!.id }, { sort: { createdAt: -1 } })
  ).filter((x) =>
    ['dm', 'mention', 'thread_reply', 'channel_message', 'added_to_channel'].includes(x.type),
  );
const _types = async (who: string) => (await inbox(who)).map((x) => x.type);

beforeAll(async () => {
  await t.app.ready();
  const org = await createOrg('m3');
  slug = org.slug;
  orgId = org.org.id;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const name of ['ann', 'bob', 'cy', 'dee', 'eve', 'fay', 'gus', 'hal']) {
    u[name] = await ensureUser({
      orgId,
      email: uniqueEmail(`m3-${name}`, `${slug}.test`),
      role: 'member',
    });
    c[name] = await signInAs(t.app, slug, u[name]);
    await api(name, 'GET', '/channels');
  }
  await api('owner', 'GET', '/channels');
});

describe('search query language', () => {
  it('reads operators out of the query and keeps the rest as text', () => {
    expect(
      parseSearch(
        'release plan from:@ann in:#general after:2026-01-01 before:2026-02-01 has:file has:link is:thread',
      ),
    ).toEqual({
      text: 'release plan',
      from: ['ann'],
      in: ['general'],
      before: '2026-02-01',
      after: '2026-01-01',
      has: ['file', 'link'],
      is: ['thread'],
    });
    expect(
      parseSearch('"exact phrase" from:"Ann Lee" nonsense:value has:video before:soon'),
    ).toMatchObject({
      text: '"exact phrase" nonsense:value has:video before:soon',
      from: ['Ann Lee'],
      has: [],
      before: null,
    });
    expect(parseSearch('   ')).toMatchObject({ text: '' });
  });

  it('cuts a snippet around the first match and marks every match', () => {
    const body = `${'filler '.repeat(30)}the Quarterly report is ready, quarterly numbers inside ${'tail '.repeat(30)}`;
    const parts = snippetOf(body, 'quarterly');
    expect(parts.filter((p) => p.match).map((p) => p.text.toLowerCase())).toEqual([
      'quarterly',
      'quarterly',
    ]);
    expect(
      parts
        .map((p) => p.text)
        .join('')
        .startsWith('…'),
    ).toBe(true);
    expect(snippetOf(null, 'x')).toEqual([]);
    expect(snippetOf('plain text', '')).toEqual([{ text: 'plain text', match: false }]);
  });
});

describe('search', () => {
  let open: string;
  let secret: string;
  let other: string;

  beforeAll(async () => {
    open = await mk('ann', 'search-open', ['bob']);
    secret = await mk('ann', 'search-secret', [], 'private');
    other = await mk('cy', 'search-cy', ['dee']);
    await post('ann', open, say('The quarterly roadmap review is on Friday'));
    await post('bob', open, say('Quarterly numbers are attached'));
    await post('ann', secret, say('Quarterly layoffs are confidential'));
    await post('cy', other, say('quarterly picnic planning'));
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.cy!.id] })).json().channel.id;
    await post('ann', dm, say('quarterly secret between ann and cy'));
  });

  it('finds messages in channels I am in and in public channels, and nothing else', async () => {
    const ann = (await api('ann', 'GET', '/search/messages?q=quarterly')).json().hits as Json[];
    const texts = ann.map((h) => h.message.bodyText);
    expect(texts).toContain('The quarterly roadmap review is on Friday');
    expect(texts).toContain('Quarterly layoffs are confidential'); // she is in it
    expect(texts).toContain('quarterly secret between ann and cy'); // her own DM
    expect(texts).toContain('quarterly picnic planning'); // public channel she has not joined

    // Bob: no private channel he is not in, no one else's DM.
    const bob = (
      (await api('bob', 'GET', '/search/messages?q=quarterly')).json().hits as Json[]
    ).map((h) => h.message.bodyText);
    expect(bob).toContain('The quarterly roadmap review is on Friday');
    expect(bob).not.toContain('Quarterly layoffs are confidential');
    expect(bob).not.toContain('quarterly secret between ann and cy');
    // Dee: same for DMs and private channels, and she cannot even name them in a filter.
    const dee = await api(
      'dee',
      'GET',
      `/search/messages?q=${encodeURIComponent('quarterly in:#search-secret')}`,
    );
    expect(dee.json().hits).toEqual([]);
    expect(dee.json().unresolved).toEqual(['in:search-secret']);
    const owner = (
      (await api('owner', 'GET', '/search/messages?q=quarterly')).json().hits as Json[]
    ).map((h) => h.message.bodyText);
    expect(owner).not.toContain('Quarterly layoffs are confidential'); // org admins do not read private channels
  });

  it('leaves out deleted messages, and loses access when someone leaves a channel', async () => {
    const m = (await post('ann', open, say('zebracrossing is the codeword'))).json().message;
    expect(
      ((await api('bob', 'GET', '/search/messages?q=zebracrossing')).json().hits as Json[]).length,
    ).toBe(1);
    await api('ann', 'DELETE', `/messages/${m.id}`);
    expect((await api('bob', 'GET', '/search/messages?q=zebracrossing')).json().hits).toEqual([]);
    const room = await mk('ann', 'search-leave', ['bob'], 'private');
    await post('ann', room, say('kiwifruit meeting notes'));
    expect(
      ((await api('bob', 'GET', '/search/messages?q=kiwifruit')).json().hits as Json[]).length,
    ).toBe(1);
    await api('ann', 'DELETE', `/channels/${room}/members/${u.bob!.id}`);
    expect((await api('bob', 'GET', '/search/messages?q=kiwifruit')).json().hits).toEqual([]);
  });

  it('filters by sender, channel and date, and combines them', async () => {
    const byBob = (
      await api('ann', 'GET', `/search/messages?q=${encodeURIComponent('quarterly from:bob')}`)
    ).json().hits as Json[];
    expect(byBob.map((h) => h.message.author.id)).toEqual([u.bob!.id]);
    const inOpen = (
      await api(
        'ann',
        'GET',
        `/search/messages?q=${encodeURIComponent('quarterly in:#search-open')}`,
      )
    ).json().hits as Json[];
    expect(inOpen.every((h) => h.channel.id === open)).toBe(true);
    expect(inOpen.length).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(
      (
        (
          await api(
            'ann',
            'GET',
            `/search/messages?q=${encodeURIComponent(`quarterly after:${tomorrow}`)}`,
          )
        ).json().hits as Json[]
      ).length,
    ).toBe(0);
    expect(
      (
        (
          await api(
            'ann',
            'GET',
            `/search/messages?q=${encodeURIComponent(`quarterly after:${today} in:#search-open`)}`,
          )
        ).json().hits as Json[]
      ).length,
    ).toBe(2);
    expect(
      (
        (
          await api(
            'ann',
            'GET',
            `/search/messages?q=${encodeURIComponent(`quarterly before:${today}`)}`,
          )
        ).json().hits as Json[]
      ).length,
    ).toBe(0);
    const unknown = (
      await api(
        'ann',
        'GET',
        `/search/messages?q=${encodeURIComponent('quarterly from:nobodyhere')}`,
      )
    ).json();
    expect(unknown.unresolved).toEqual(['from:nobodyhere']);
    expect(unknown.hits).toEqual([]);
  });

  it('supports has:link, has:file and is:thread, quoted phrases, and filter-only searches', async () => {
    const room = await mk('ann', 'search-has', ['bob']);
    await post(
      'ann',
      room,
      doc(
        text('see '),
        text('docs', [{ type: 'link', attrs: { href: 'https://example.com/pelican' } }]),
        text(' pelican guide'),
      ),
    );
    const rootMsg = (await post('bob', room, say('pelican thread starter'))).json().message;
    await reply('ann', rootMsg.id, say('pelican reply inside thread'));
    const hasLink = (
      await api('ann', 'GET', `/search/messages?q=${encodeURIComponent('pelican has:link')}`)
    ).json().hits as Json[];
    expect(hasLink.map((h) => h.message.bodyText)).toEqual(['see docs pelican guide']);
    const thread = (
      (
        await api('ann', 'GET', `/search/messages?q=${encodeURIComponent('pelican is:thread')}`)
      ).json().hits as Json[]
    )
      .map((h) => h.message.bodyText)
      .sort();
    expect(thread).toEqual(['pelican reply inside thread', 'pelican thread starter']);
    const phrase = (
      await api('ann', 'GET', `/search/messages?q=${encodeURIComponent('"pelican reply"')}`)
    ).json().hits as Json[];
    expect(phrase.map((h) => h.message.bodyText)).toEqual(['pelican reply inside thread']);
    // Only filters, no words: newest first in that channel.
    const only = (
      await api('ann', 'GET', `/search/messages?q=${encodeURIComponent('in:#search-has')}`)
    ).json().hits as Json[];
    expect(only.length).toBe(3);
    expect(only[0]!.message.bodyText).toBe('pelican reply inside thread');
    expect(
      (
        await api(
          'ann',
          'GET',
          `/search/messages?q=${encodeURIComponent('has:file in:#search-has')}`,
        )
      ).json().hits,
    ).toEqual([]);
    // Highlights come back as plain parts.
    const hit = hasLink[0]!;
    expect(hit.snippet.some((p: Json) => p.match && p.text.toLowerCase() === 'pelican')).toBe(true);
  });

  it('pages through results', async () => {
    const room = await mk('ann', 'search-pages', ['bob']);
    for (let i = 0; i < 25; i++) await post('ann', room, say(`paginator entry ${i}`));
    const one = (await api('bob', 'GET', '/search/messages?q=paginator&page=1')).json();
    expect(one.hits).toHaveLength(20);
    expect(one.hasMore).toBe(true);
    const two = (await api('bob', 'GET', '/search/messages?q=paginator&page=2')).json();
    expect(two.hits).toHaveLength(5);
    expect(two.hasMore).toBe(false);
  });

  it('does not search across workspaces, and searches files by name within access', async () => {
    const other2 = await createOrg('m3x');
    const otherCookie = await signInAs(t.app, other2.slug, other2.owner);
    const res = await call({
      method: 'GET',
      url: '/search/messages?q=quarterly',
      slug: other2.slug,
      cookie: otherCookie,
    });
    expect(res.json().hits).toEqual([]);
    const db = t.db.tenant(orgId);
    const msg = (await post('ann', secret, say('with a file'))).json().message;
    await db.messageAttachments.insert({
      channelId: secret,
      messageId: msg.id,
      uploaderId: u.ann!.id,
      name: 'budget-2026.xlsx',
      mime: 'x',
      size: 10,
      storageKey: `${orgId}/${secret}/${randomUUID()}/${randomUUID()}`,
    });
    const mine = (await api('ann', 'GET', '/search/files?q=budget')).json().files as Json[];
    expect(mine.map((f) => f.name)).toEqual(['budget-2026.xlsx']);
    expect((await api('bob', 'GET', '/search/files?q=budget')).json().files).toEqual([]);
  });
});

describe('notification rules', () => {
  it('notifies the other person in a direct message, never the author', async () => {
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id;
    await post('ann', dm, say('hello bob, this is private'));
    await flush();
    const mineBob = (await inbox('bob')).filter((x) => x.data.channelId === dm);
    expect(mineBob.map((x) => x.type)).toEqual(['dm']);
    expect(mineBob[0]!.actorId).toBe(u.ann!.id);
    expect((await inbox('ann')).filter((x) => x.data.channelId === dm)).toEqual([]);
    // It reads like a sentence in the inbox.
    const list = (await api('bob', 'GET', '/notifications')).json().items as Json[];
    expect(list.find((x) => x.type === 'dm')!.text).toMatch(
      /sent you a message: “hello bob, this is private”/,
    );
    // A pushed event reaches the person's own tabs.
    expect(
      events.log.some(
        (e) => e.kind === 'user' && e.target === u.bob!.id && e.event === 'notification:new',
      ),
    ).toBe(true);
  });

  it('keeps channels quiet by default, notifies mentions, and notifies everything for channels set to "all"', async () => {
    const room = await mk('ann', 'rules-room', ['bob', 'cy']);
    await post('ann', room, say('just a normal message'));
    await flush();
    expect((await inbox('bob')).filter((x) => x.data.channelId === room)).toEqual([]);
    await post('ann', room, doc(text('hey '), mention(u.bob!.id, 'Bob'), text(' look')));
    await flush();
    expect(
      (await inbox('bob')).filter((x) => x.data.channelId === room).map((x) => x.type),
    ).toEqual(['mention']);
    expect((await inbox('cy')).filter((x) => x.data.channelId === room)).toEqual([]);
    // Cy turns on every message for this channel.
    expect((await level('cy', room, 'all')).statusCode).toBe(204);
    await post('ann', room, say('now cy hears everything'));
    await flush();
    expect((await inbox('cy')).filter((x) => x.data.channelId === room).map((x) => x.type)).toEqual(
      ['channel_message'],
    );
    expect((await inbox('bob')).filter((x) => x.data.channelId === room)).toHaveLength(1); // still only the mention
  });

  it('lets "nothing" and mute silence everything except being called by name', async () => {
    const room = await mk('ann', 'quiet-room', ['bob', 'cy', 'dee']);
    await level('bob', room, 'all');
    await level('cy', room, 'all');
    await level('dee', room, 'all');
    await level('bob', room, 'none');
    await api('cy', 'PATCH', `/channels/${room}/me`, {
      mutedUntil: new Date(Date.now() + 3600_000).toISOString(),
    });
    await post('ann', room, say('plain message'));
    await post('ann', room, doc(mention('channel', 'channel', 'channel'), text(' everyone')));
    await flush();
    const forRoom = async (who: string) =>
      (await inbox(who)).filter((x) => x.data.channelId === room).map((x) => x.type);
    expect(await forRoom('bob')).toEqual([]);
    expect(await forRoom('cy')).toEqual([]);
    expect((await forRoom('dee')).sort()).toEqual(['channel_message', 'mention']);
    await post('ann', room, doc(mention(u.bob!.id, 'Bob'), text(' by name')));
    await post('ann', room, doc(mention(u.cy!.id, 'Cy'), text(' by name')));
    await flush();
    expect(await forRoom('bob')).toEqual(['mention']);
    expect(await forRoom('cy')).toEqual(['mention']);
  });

  it('sends group mentions to the group members in the channel, and @here only to people who are online', async () => {
    const room = await mk('ann', 'group-room', ['bob', 'cy', 'dee']);
    const g = await t.db.tenant(orgId).groups.insert({ name: 'Platform' });
    await t.db.tenant(orgId).groupMembers.insert([{ groupId: g.id, userId: u.bob!.id }]);
    await post('ann', room, doc(mention(g.id, 'Platform', 'group'), text(' standup')));
    await flush();
    const forRoom = async (who: string) =>
      (await inbox(who)).filter((x) => x.data.channelId === room).map((x) => x.type);
    expect(await forRoom('bob')).toEqual(['mention']);
    expect(await forRoom('cy')).toEqual([]);
    await presence.beat(orgId, u.dee!.id, 'conn-dee', 'active');
    await post('ann', room, doc(mention('here', 'here', 'here'), text(' who is around?')));
    await flush();
    expect(await forRoom('dee')).toEqual(['mention']);
    expect(await forRoom('cy')).toEqual([]);
    expect(await forRoom('bob')).toEqual(['mention']); // only the group mention from before
    await presence.drop(orgId, u.dee!.id, 'conn-dee');
  });

  it('notifies followers of a thread when "mentions only", but not everyone in the channel', async () => {
    const room = await mk('ann', 'thread-notify', ['bob', 'cy']);
    const root = (await post('ann', room, say('thread root'))).json().message;
    await reply('bob', root.id, say('bob joins the thread'));
    await flush();
    await reply('ann', root.id, say('ann replies'));
    await flush();
    const forRoom = async (who: string) =>
      (await inbox(who)).filter((x) => x.data.channelId === room).map((x) => x.type);
    expect(await forRoom('bob')).toEqual(['thread_reply']);
    expect(await forRoom('cy')).toEqual([]);
    expect(await forRoom('ann')).toEqual([]); // the author's own message
    // A reply that is also sent to the channel reaches "all" people as a channel message too.
    await level('cy', room, 'all');
    await api('ann', 'POST', `/messages/${root.id}/replies`, {
      clientMsgId: cid(),
      body: say('everyone should see'),
      alsoInChannel: true,
    });
    await flush();
    expect(await forRoom('cy')).toEqual(['channel_message']);
  });

  it('does not notify someone who is looking at the conversation, and does again once they look away', async () => {
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.eve!.id] })).json().channel.id;
    try {
      await presence.setViewing(orgId, u.eve!.id, 'conn-eve', dm);
      await post('ann', dm, say('you are reading this right now'));
      await flush();
      expect((await inbox('eve')).filter((x) => x.data.channelId === dm)).toEqual([]);
    } finally {
      await presence.setViewing(orgId, u.eve!.id, 'conn-eve', null);
    }
    await post('ann', dm, say('now you looked away'));
    await flush();
    expect((await inbox('eve')).filter((x) => x.data.channelId === dm)).toHaveLength(1);
  });

  it('notifies a person who is added to a channel, but not someone who joins by themselves', async () => {
    const room = await mk('ann', 'added-room', [], 'private');
    await api('ann', 'POST', `/channels/${room}/members`, { userIds: [u.dee!.id] });
    await flush();
    const added = (await inbox('dee')).filter((x) => x.data.channelId === room);
    expect(added.map((x) => x.type)).toEqual(['added_to_channel']);
    expect(
      ((await api('dee', 'GET', '/notifications')).json().items as Json[]).find(
        (x) => x.type === 'added_to_channel',
      )!.text,
    ).toMatch(/added you to #added-room/);
    const open = await mk('ann', 'self-join');
    await api('bob', 'POST', `/channels/${open}/join`);
    await flush();
    expect((await inbox('bob')).filter((x) => x.data.channelId === open)).toEqual([]);
  });

  it('marks chat notifications read when the conversation is read', async () => {
    const dm = (await api('bob', 'POST', '/dms', { userIds: [u.dee!.id] })).json().channel.id;
    const sent = (await post('bob', dm, say('read me'))).json().message;
    await flush();
    expect((await inbox('dee')).find((x) => x.data.channelId === dm)!.readAt).toBeNull();
    const before = (await api('dee', 'GET', '/notifications/count')).json().unread as number;
    await api('dee', 'PUT', `/channels/${dm}/read`, { seq: sent.seq });
    expect((await inbox('dee')).find((x) => x.data.channelId === dm)!.readAt).toBeTruthy();
    expect((await api('dee', 'GET', '/notifications/count')).json().unread as number).toBe(
      before - 1,
    );
  });

  it('respects the inbox switch per kind, and links to the message', async () => {
    const room = await mk('ann', 'pref-room', ['bob']);
    await api('bob', 'PUT', '/me/notification-preferences', {
      preferences: { mention: { inApp: false, email: false } },
    });
    await post('ann', room, doc(mention(u.bob!.id, 'Bob'), text(' ping')));
    await flush();
    // Nothing is stored when both inbox and email are off for that kind.
    expect((await inbox('bob')).filter((x) => x.data.channelId === room)).toEqual([]);
    await api('bob', 'PUT', '/me/notification-preferences', {
      preferences: { mention: { inApp: true, email: true } },
    });
    const m = (await post('ann', room, doc(mention(u.bob!.id, 'Bob'), text(' ping again')))).json()
      .message;
    await flush();
    const item = ((await api('bob', 'GET', '/notifications')).json().items as Json[]).find(
      (x) => x.data.channelId === room,
    )!;
    expect(item.data.seq).toBe(String(m.seq));
  });
});

describe('emails for unseen messages', () => {
  it('emails only what is still unseen after the delay, in the shared batch queue', async () => {
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id;
    await post('ann', dm, say('please read this soon'));
    await flush();
    const n = (await inbox('bob')).find((x) => x.data.channelId === dm)!;
    expect(n.emailDueAt).toBeTruthy();
    const db = t.db.tenant(orgId);
    // Too early: nothing happens.
    expect(await emailUnseenMessages(t.db, { now: new Date(Date.now() + 5 * 60_000) })).toBe(0);
    // After the 15 minute delay it is queued for the batch email.
    const queued = await emailUnseenMessages(t.db, { now: new Date(Date.now() + 16 * 60_000) });
    expect(queued).toBeGreaterThanOrEqual(1);
    const batch = await db.emailBatches.findOne({ userId: u.bob!.id, sentAt: null });
    expect(batch?.notificationIds).toContain(n.id);
  });

  it('skips the email when it was read in the meantime, in quiet hours, or in do not disturb', async () => {
    const db = t.db.tenant(orgId);
    const dmOf = async (who: string) =>
      (await api('ann', 'POST', '/dms', { userIds: [u[who]!.id] })).json().channel.id as string;
    // Fay reads it elsewhere; Hal is in quiet hours all day; Gus is in do not disturb.
    const dmFay = await dmOf('fay');
    const m1 = (await post('ann', dmFay, say('fay will read this'))).json().message;
    await api('hal', 'PUT', '/me/notification-preferences', {
      quiet: { enabled: true, start: '00:00', end: '23:59' },
    });
    await post('ann', await dmOf('hal'), say('hal is asleep'));
    await post('ann', await dmOf('gus'), say('gus is busy'));
    await flush();
    await db.readCursors.upsert({ channelId: dmFay, userId: u.fay!.id }, { lastReadSeq: m1.seq });
    const later = new Date(Date.now() + 20 * 60_000);
    await emailUnseenMessages(t.db, { now: later, isDnd: async (_o, uid) => uid === u.gus!.id });
    expect((await inbox('fay')).find((x) => x.data.channelId === dmFay)!.readAt).toBeTruthy(); // seen elsewhere: marked read
    for (const who of ['fay', 'hal', 'gus']) {
      expect(await db.emailBatches.count({ userId: u[who]!.id }), who).toBe(0);
    }
  });
});

describe('quiet hours and preferences', () => {
  it('knows when it is quiet, across midnight and in other timezones', () => {
    const q = { enabled: true, start: '22:00', end: '07:00' };
    const at = (iso: string) => new Date(iso);
    expect(inQuietHours(q, 'UTC', at('2026-03-10T23:30:00Z'))).toBe(true);
    expect(inQuietHours(q, 'UTC', at('2026-03-10T06:59:00Z'))).toBe(true);
    expect(inQuietHours(q, 'UTC', at('2026-03-10T07:00:00Z'))).toBe(false);
    expect(inQuietHours(q, 'UTC', at('2026-03-10T12:00:00Z'))).toBe(false);
    // 12:00 UTC is 17:30 in Colombo and 05:00 in New York.
    expect(
      inQuietHours(
        { enabled: true, start: '05:00', end: '06:00' },
        'America/New_York',
        at('2026-01-10T10:30:00Z'),
      ),
    ).toBe(true);
    expect(
      inQuietHours(
        { enabled: true, start: '17:00', end: '18:00' },
        'Asia/Colombo',
        at('2026-01-10T12:00:00Z'),
      ),
    ).toBe(true);
    expect(inQuietHours({ ...q, enabled: false }, 'UTC', at('2026-03-10T23:30:00Z'))).toBe(false);
    expect(inQuietHours(q, 'Not/AZone', at('2026-03-10T23:30:00Z'))).toBe(true);
    expect(inQuietHours({ enabled: true, start: '09:00', end: '09:00' }, 'UTC')).toBe(false);
  });

  it('flags pushed notifications as silent during quiet hours, but still delivers them to the inbox', async () => {
    await api('dee', 'PUT', '/me/notification-preferences', {
      quiet: { enabled: true, start: '00:00', end: '23:59' },
    });
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.dee!.id] })).json().channel.id;
    events.log.length = 0;
    await post('ann', dm, say('quiet hours ping'));
    await flush();
    const ev = events.log.find((e) => e.event === 'notification:new' && e.target === u.dee!.id)!;
    expect((ev.payload as Json).silent).toBe(true);
    expect((ev.payload as Json).href).toContain(`/messages/${dm}`);
    expect((await inbox('dee')).some((x) => x.data.channelId === dm)).toBe(true);
  });

  it('saves and validates quiet hours, email delay and desktop alerts', async () => {
    const res = await api('ann', 'PUT', '/me/notification-preferences', {
      quiet: { enabled: true, start: '21:30', end: '06:15' },
      emailDelayMinutes: 30,
      desktop: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      quiet: { enabled: true, start: '21:30', end: '06:15' },
      emailDelayMinutes: 30,
      desktop: true,
    });
    expect((await api('ann', 'GET', '/me/notification-preferences')).json()).toMatchObject({
      emailDelayMinutes: 30,
      desktop: true,
    });
    expect(
      (
        await api('ann', 'PUT', '/me/notification-preferences', {
          quiet: { enabled: true, start: '25:00', end: '06:15' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await api('ann', 'PUT', '/me/notification-preferences', { emailDelayMinutes: 0 }))
        .statusCode,
    ).toBe(400);
    // The new kinds appear in the preferences with sensible defaults: email only for DMs and mentions.
    const prefs = (await api('bob', 'GET', '/me/notification-preferences')).json()
      .preferences as Json;
    expect(prefs.dm.email).toBe(true);
    expect(prefs.mention.email).toBe(true);
    expect(prefs.channel_message.email).toBe(false);
    expect(prefs.thread_reply.email).toBe(false);
  });
});

describe('sidebar sections', () => {
  it('creates, renames, orders and deletes my own sections, and assigns channels to them', async () => {
    const a = (await api('ann', 'POST', '/me/sidebar-sections', { name: 'Projects' })).json()
      .section;
    const b = (await api('ann', 'POST', '/me/sidebar-sections', { name: 'Clients' })).json()
      .section;
    expect(
      (await api('ann', 'GET', '/me/sidebar-sections')).json().sections.map((s: Json) => s.name),
    ).toEqual(['Projects', 'Clients']);
    expect(
      (await api('ann', 'PATCH', `/me/sidebar-sections/${b.id}`, { name: 'Customers' })).json()
        .section.name,
    ).toBe('Customers');
    const room = await mk('ann', 'sectioned');
    expect(
      (await api('ann', 'PATCH', `/channels/${room}/me`, { sectionId: a.id })).statusCode,
    ).toBe(204);
    expect((await mine('ann', room)).sectionId).toBe(a.id);
    // Reorder and assign in one call.
    const saved = (
      await api('ann', 'PUT', '/me/sidebar-order', {
        sections: [b.id, a.id],
        assign: { [room]: b.id },
      })
    ).json().sections;
    expect(saved.map((s: Json) => s.name)).toEqual(['Customers', 'Projects']);
    expect((await mine('ann', room)).sectionId).toBe(b.id);
    // Deleting a section puts its channels back.
    expect((await api('ann', 'DELETE', `/me/sidebar-sections/${b.id}`)).statusCode).toBe(204);
    expect((await mine('ann', room)).sectionId).toBeNull();
  });

  it("never lets one person use or see another person's sections", async () => {
    const mineSection = (
      await api('ann', 'POST', '/me/sidebar-sections', { name: 'Private to Ann' })
    ).json().section;
    expect((await api('bob', 'GET', '/me/sidebar-sections')).json().sections).toEqual([]);
    const room = await mk('bob', 'bobs-room');
    expect(
      (await api('bob', 'PATCH', `/channels/${room}/me`, { sectionId: mineSection.id })).statusCode,
    ).toBe(404);
    expect(
      (await api('bob', 'PATCH', `/me/sidebar-sections/${mineSection.id}`, { name: 'x' }))
        .statusCode,
    ).toBe(404);
    expect((await api('bob', 'DELETE', `/me/sidebar-sections/${mineSection.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await api('bob', 'PUT', '/me/sidebar-order', { sections: [mineSection.id] })).statusCode,
    ).toBe(404);
    expect((await api('ann', 'POST', '/me/sidebar-sections', { name: '   ' })).statusCode).toBe(
      400,
    );
  });
});

describe('activity', () => {
  it('lists mentions of me and reactions to my messages, only from conversations I am in', async () => {
    const room = await mk('ann', 'activity-room', ['bob']);
    await post('ann', room, doc(mention(u.bob!.id, 'Bob'), text(' can you check this?')));
    const mine1 = (await post('bob', room, say('my own message'))).json().message;
    await api('ann', 'PUT', `/messages/${mine1.id}/reactions/${encodeURIComponent('🎉')}`);
    const items = (await api('bob', 'GET', '/me/activity')).json().items as Json[];
    const forRoom = items.filter((i) => i.channel.id === room);
    expect(forRoom.map((i) => i.kind).sort()).toEqual(['mention', 'reaction']);
    expect(forRoom.find((i) => i.kind === 'reaction')).toMatchObject({
      emoji: '🎉',
      by: { id: u.ann!.id },
    });
    expect(forRoom.find((i) => i.kind === 'mention')!.by.id).toBe(u.ann!.id);
    // Someone outside the channel sees none of it.
    expect(
      ((await api('dee', 'GET', '/me/activity')).json().items as Json[]).filter(
        (i) => i.channel.id === room,
      ),
    ).toEqual([]);
  });
});

async function mine(who: string, id: string): Promise<Json> {
  return ((await api(who, 'GET', '/channels')).json().channels as Json[]).find((x) => x.id === id)!;
}
