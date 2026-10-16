import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROADCAST_MENTION_LIMIT, MAX_REACTION_EMOJI } from '@crew-deck/shared';
import { MemoryEventSink } from '../src/messaging/events.js';
import { isEmoji } from '../src/messaging/reactions.js';
import { sanitizeDoc } from '../src/work/rich-text.js';
import { caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

const events = new MemoryEventSink();
const queued: { messageId: string; urls: string[] }[] = [];
const t = makeApp({
  events,
  messageLimits: { userMax: 10_000, orgMax: 100_000, windowMs: 10_000 },
  enqueueLinkPreviews: (job) => void queued.push({ messageId: job.messageId, urls: job.urls }),
});
const call = caller(t.app);
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
const cid = () => `rich-${Date.now()}-${n++}`;
const post = (who: string, channelId: string, body: Json, extra: Json = {}) =>
  api(who, 'POST', `/channels/${channelId}/messages`, { clientMsgId: cid(), body, ...extra });
const reply = (who: string, rootId: string, body: Json, extra: Json = {}) =>
  api(who, 'POST', `/messages/${rootId}/replies`, { clientMsgId: cid(), body, ...extra });
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
const mine = async (who: string, id: string): Promise<Json> => {
  const list = (await api(who, 'GET', '/channels')).json().channels as Json[];
  return list.find((x) => x.id === id)!;
};

beforeAll(async () => {
  const org = await createOrg('rich');
  slug = org.slug;
  orgId = org.org.id;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const name of ['ann', 'bob', 'cy', 'dee']) {
    u[name] = await ensureUser({
      orgId,
      email: uniqueEmail(`rich-${name}`, `${slug}.test`),
      role: 'member',
    });
    c[name] = await signInAs(t.app, slug, u[name]);
    await api(name, 'GET', '/channels');
  }
  await api('owner', 'GET', '/channels');
});

describe('threads', () => {
  let ch: string;
  beforeAll(async () => {
    ch = await mk('ann', 'threads-room', ['bob', 'cy']);
  });

  it('keeps replies out of the channel, counts them on the root, and follows repliers', async () => {
    const root = (await post('ann', ch, say('Shall we ship?'))).json().message;
    events.log.length = 0;
    const r1 = await reply('bob', root.id, say('Yes'));
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json().message.threadRootId).toBe(root.id);
    expect((await reply('cy', root.id, say('Agreed'))).statusCode).toBe(201);
    expect((await reply('bob', root.id, say('Shipping now'))).statusCode).toBe(201);

    const history = (await api('ann', 'GET', `/channels/${ch}/messages`)).json().messages as Json[];
    expect(history.map((m) => m.bodyText)).toEqual(['Shall we ship?']);
    expect(history[0]).toMatchObject({ replyCount: 3 });
    expect(history[0]!.replyAuthors.map((p: Json) => p.id).sort()).toEqual(
      [u.bob!.id, u.cy!.id].sort(),
    );
    expect(history[0]!.lastReplyAt).toBeTruthy();

    const thread = (await api('ann', 'GET', `/messages/${root.id}/replies`)).json();
    expect(thread.root.id).toBe(root.id);
    expect(thread.replies.map((m: Json) => m.bodyText)).toEqual(['Yes', 'Agreed', 'Shipping now']);
    // The thread summary reaches everyone in the channel.
    expect(
      events.log.some(
        (e) => e.event === 'thread:updated' && (e.payload as Json).rootId === root.id,
      ),
    ).toBe(true);
    expect(await t.db.tenant(orgId).threadFollows.count({ threadRootId: root.id })).toBe(2);
  });

  it('does not count thread replies as unread channel messages unless also sent to the channel', async () => {
    const root = (await post('ann', ch, say('Unread test'))).json().message;
    await api('bob', 'PUT', `/channels/${ch}/read`, { seq: root.seq });
    expect((await mine('bob', ch)).unread).toBe(0);
    await reply('ann', root.id, say('quiet reply'));
    expect((await mine('bob', ch)).unread).toBe(0);
    const loud = await reply('ann', root.id, say('loud reply'), { alsoInChannel: true });
    expect(loud.json().message.alsoInChannel).toBe(true);
    expect((await mine('bob', ch)).unread).toBe(1);
    const history = (await api('bob', 'GET', `/channels/${ch}/messages`)).json().messages as Json[];
    expect(history.map((m) => m.bodyText)).toContain('loud reply');
    expect(history.map((m) => m.bodyText)).not.toContain('quiet reply');
  });

  it('does not nest: replying to a reply is refused', async () => {
    const root = (await post('ann', ch, say('Nest?'))).json().message;
    const r = (await reply('bob', root.id, say('first'))).json().message;
    const nested = await reply('cy', r.id, say('nested'));
    expect(nested.statusCode).toBe(422);
    expect(nested.json().code).toBe('no_nested_threads');
  });

  it('lists followed threads with unread counts, and marks them read', async () => {
    const root = (await post('ann', ch, say('Follow me'))).json().message;
    await reply('bob', root.id, say('b1'));
    const second = (await reply('bob', root.id, say('b2'))).json().message;
    // Ann follows only after her own reply; replies from Bob after that are unread.
    await reply('ann', root.id, say('a1'));
    await reply('bob', root.id, say('b3'));
    let threads = (await api('ann', 'GET', '/threads')).json().threads as Json[];
    const mineThread = threads.find((x) => x.root.id === root.id)!;
    expect(mineThread.unread).toBe(1);
    expect(mineThread.latestReply.bodyText).toBe('b3');
    await api('ann', 'PUT', `/messages/${root.id}/follow/read`, { seq: second.seq + 100 });
    threads = (await api('ann', 'GET', '/threads')).json().threads as Json[];
    expect(threads.find((x) => x.root.id === root.id)!.unread).toBe(0);
  });

  it('lets people follow and unfollow by hand', async () => {
    const root = (await post('ann', ch, say('Manual follow'))).json().message;
    await reply('bob', root.id, say('hello'));
    expect((await api('cy', 'PUT', `/messages/${root.id}/follow`)).json()).toEqual({
      following: true,
    });
    expect((await api('cy', 'GET', `/messages/${root.id}/replies`)).json().following).toBe(true);
    expect((await api('cy', 'DELETE', `/messages/${root.id}/follow`)).json()).toEqual({
      following: false,
    });
    // A public-channel visitor who has not joined cannot follow.
    const open = await mk('ann', 'open-threads');
    const r2 = (await post('ann', open, say('x'))).json().message;
    expect((await api('dee', 'PUT', `/messages/${r2.id}/follow`)).statusCode).toBe(403);
  });

  it('lets members reply in announcement channels but not post, and blocks replies when archived', async () => {
    const ann = ((await api('bob', 'GET', '/channels')).json().channels as Json[]).find(
      (x) => x.name === 'announcements',
    )!;
    expect((await post('bob', ann.id, say('nope'))).statusCode).toBe(403);
    const official = (await post('owner', ann.id, say('Big news'))).json().message;
    expect((await reply('bob', official.id, say('Congrats!'))).statusCode).toBe(201);

    const old = await mk('ann', 'archived-threads', ['bob']);
    const m = (await post('ann', old, say('before'))).json().message;
    await api('ann', 'POST', `/channels/${old}/archive`);
    const blocked = await reply('bob', m.id, say('too late'));
    expect(blocked.statusCode).toBe(409);
  });

  it('hides threads in private channels from outsiders', async () => {
    const secret = await mk('ann', 'secret-threads', ['bob'], 'private');
    const root = (await post('ann', secret, say('classified'))).json().message;
    expect((await api('cy', 'GET', `/messages/${root.id}/replies`)).statusCode).toBe(404);
    expect((await reply('cy', root.id, say('let me in'))).statusCode).toBe(404);
  });

  it('keeps the thread when the root is deleted', async () => {
    const root = (await post('ann', ch, say('to be deleted'))).json().message;
    await reply('bob', root.id, say('a reply'));
    expect((await api('ann', 'DELETE', `/messages/${root.id}`)).statusCode).toBe(200);
    const thread = (await api('bob', 'GET', `/messages/${root.id}/replies`)).json();
    expect(thread.root.deletedAt).toBeTruthy();
    expect(thread.replies).toHaveLength(1);
  });
});

describe('reactions', () => {
  let ch: string;
  let msgId: string;
  beforeAll(async () => {
    ch = await mk('ann', 'reactions-room', ['bob']);
    msgId = (await post('ann', ch, say('react to me'))).json().message.id;
  });

  it('adds and removes reactions and counts each person once per emoji', async () => {
    events.log.length = 0;
    const add = await api('bob', 'PUT', `/messages/${msgId}/reactions/${encodeURIComponent('👍')}`);
    expect(add.json().reactions).toEqual([{ emoji: '👍', count: 1, userIds: [u.bob!.id] }]);
    // Adding twice is harmless.
    await api('bob', 'PUT', `/messages/${msgId}/reactions/${encodeURIComponent('👍')}`);
    await api('ann', 'PUT', `/messages/${msgId}/reactions/${encodeURIComponent('👍')}`);
    const both = (await api('ann', 'GET', `/messages/${msgId}`)).json().message.reactions;
    expect(both).toEqual([{ emoji: '👍', count: 2, userIds: [u.bob!.id, u.ann!.id] }]);
    expect(events.log.some((e) => e.event === 'reaction:updated')).toBe(true);
    const gone = await api(
      'bob',
      'DELETE',
      `/messages/${msgId}/reactions/${encodeURIComponent('👍')}`,
    );
    expect(gone.json().reactions[0].count).toBe(1);
  });

  it('only accepts real emoji', async () => {
    for (const bad of ['hello', '1', '<script>', '👍a']) {
      expect(
        (await api('bob', 'PUT', `/messages/${msgId}/reactions/${encodeURIComponent(bad)}`))
          .statusCode,
        bad,
      ).toBe(422);
    }
    for (const good of ['👍', '👍🏽', '🇱🇰', '👨‍👩‍👧', '1️⃣', '❤️']) expect(isEmoji(good), good).toBe(true);
    expect(isEmoji('')).toBe(false);
  });

  it('allows at most 50 different emoji per message', async () => {
    const id = (await post('ann', ch, say('lots of reactions'))).json().message.id;
    const emojis = Array.from({ length: MAX_REACTION_EMOJI }, (_, i) =>
      String.fromCodePoint(0x1f600 + i),
    );
    for (const e of emojis)
      await t.db
        .tenant(orgId)
        .messageReactions.insertIgnore({
          channelId: ch,
          messageId: id,
          userId: u.ann!.id,
          emoji: e,
        });
    const over = await api('bob', 'PUT', `/messages/${id}/reactions/${encodeURIComponent('🦄')}`);
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('too_many_reactions');
    // Joining an existing emoji is still fine.
    expect(
      (await api('bob', 'PUT', `/messages/${id}/reactions/${encodeURIComponent(emojis[0]!)}`))
        .statusCode,
    ).toBe(200);
  });

  it('lets everyone in an announcement channel react, but not people outside it or in archived channels', async () => {
    const ann = ((await api('bob', 'GET', '/channels')).json().channels as Json[]).find(
      (x) => x.name === 'announcements',
    )!;
    const m = (await post('owner', ann.id, say('Reactions welcome'))).json().message;
    expect(
      (await api('bob', 'PUT', `/messages/${m.id}/reactions/${encodeURIComponent('🎉')}`))
        .statusCode,
    ).toBe(200);
    // A visitor who is only previewing a public channel is not a member.
    const lonely = await mk('ann', 'preview-only');
    const pm = (await post('ann', lonely, say('hi'))).json().message;
    expect(
      (await api('dee', 'PUT', `/messages/${pm.id}/reactions/${encodeURIComponent('🎉')}`))
        .statusCode,
    ).toBe(403);
    await api('ann', 'POST', `/channels/${lonely}/archive`);
    expect(
      (await api('ann', 'PUT', `/messages/${pm.id}/reactions/${encodeURIComponent('🎉')}`))
        .statusCode,
    ).toBe(409);
  });

  it('removes reactions when a message is deleted', async () => {
    const id = (await post('ann', ch, say('short lived'))).json().message.id;
    await api('bob', 'PUT', `/messages/${id}/reactions/${encodeURIComponent('😀')}`);
    await api('ann', 'DELETE', `/messages/${id}`);
    expect(await t.db.tenant(orgId).messageReactions.count({ messageId: id })).toBe(0);
  });
});

describe('mentions', () => {
  let ch: string;
  beforeAll(async () => {
    ch = await mk('ann', 'mentions-room', ['bob'], 'private');
  });

  it('stores mentions, counts them for the person mentioned, and clears when read', async () => {
    const m = (
      await post('ann', ch, doc(text('Hi '), mention(u.bob!.id, 'Bob'), text(' please look')))
    ).json().message;
    expect(m.mentions).toEqual([{ type: 'user', id: u.bob!.id }]);
    const bobView = await mine('bob', ch);
    expect(bobView.unread).toBe(1);
    expect(bobView.mentionCount).toBe(1);
    await post('ann', ch, say('no mention here'));
    expect((await mine('bob', ch)).mentionCount).toBe(1);
    await api('bob', 'PUT', `/channels/${ch}/read`, { seq: 99999 });
    expect((await mine('bob', ch)).mentionCount).toBe(0);
  });

  it('offers to add mentioned people who are not in a private channel', async () => {
    const res = await post('ann', ch, doc(mention(u.cy!.id, 'Cy'), text(' join us')));
    expect(res.statusCode).toBe(201);
    expect(res.json().notInChannel.map((p: Json) => p.id)).toEqual([u.cy!.id]);
    // Someone already in the channel is not offered.
    const again = await post('ann', ch, doc(mention(u.bob!.id, 'Bob')));
    expect(again.json().notInChannel).toEqual([]);
  });

  it('drops mentions of people who are not in the workspace', async () => {
    const res = await post('ann', ch, doc(mention(randomUUID(), 'Ghost'), text(' hello')));
    expect(res.statusCode).toBe(201);
    expect(res.json().message.mentions).toEqual([]);
  });

  it('expands group mentions to the members who are outside the channel', async () => {
    const g = await t.db.tenant(orgId).groups.insert({ name: 'Designers' });
    await t.db.tenant(orgId).groupMembers.insert([
      { groupId: g.id, userId: u.cy!.id },
      { groupId: g.id, userId: u.bob!.id },
    ]);
    const res = await post('ann', ch, doc(mention(g.id, 'Designers', 'group'), text(' standup')));
    expect(res.json().message.mentions).toEqual([{ type: 'group', id: g.id }]);
    expect(res.json().notInChannel.map((p: Json) => p.id)).toEqual([u.cy!.id]);
    // A member of the group is counted as mentioned.
    expect((await mine('bob', ch)).mentionCount).toBeGreaterThan(0);
  });

  it('counts @channel and @here for everyone in the channel', async () => {
    const room = await mk('ann', 'broadcast-room', ['bob']);
    await post('ann', room, doc(mention('channel', 'channel', 'channel'), text(' deploy at 5')));
    expect((await mine('bob', room)).mentionCount).toBe(1);
    await post('ann', room, doc(mention('here', 'here', 'here'), text(' anyone around?')));
    expect((await mine('bob', room)).mentionCount).toBe(2);
  });

  it('limits @channel and @here to admins in big channels', async () => {
    const big = await mk('ann', 'big-room', ['bob']);
    const db = t.db.tenant(orgId);
    await db.channelMembers.insert(
      Array.from({ length: BROADCAST_MENTION_LIMIT }, () => ({
        channelId: big,
        userId: randomUUID(),
      })),
    );
    const denied = await post(
      'ann',
      big,
      doc(mention('channel', 'channel', 'channel'), text(' hi all')),
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('mention_restricted');
    // An org admin who is in the channel may.
    await api('owner', 'POST', `/channels/${big}/join`);
    expect(
      (await post('owner', big, doc(mention('channel', 'channel', 'channel'), text(' hi all'))))
        .statusCode,
    ).toBe(201);
    // Ordinary mentions still work.
    expect((await post('ann', big, doc(mention(u.bob!.id, 'Bob'), text(' hi')))).statusCode).toBe(
      201,
    );
  });

  it('keeps group, @channel and @here out of work item text', () => {
    expect(() => sanitizeDoc(doc(mention('channel', 'channel', 'channel')), 'body')).toThrow();
    expect(() => sanitizeDoc(doc(mention(randomUUID(), 'g', 'group')), 'body')).toThrow();
    expect(
      sanitizeDoc(doc(mention(randomUUID(), 'g', 'group')), 'body', { broadcastMentions: true })
        .targets,
    ).toHaveLength(1);
    // A fake id for a broadcast mention is refused.
    expect(() =>
      sanitizeDoc(doc(mention(randomUUID(), 'x', 'channel')), 'body', { broadcastMentions: true }),
    ).toThrow();
  });

  it('does not count mentions inside thread replies toward the channel', async () => {
    const room = await mk('ann', 'thread-mentions', ['bob']);
    const root = (await post('ann', room, say('root'))).json().message;
    await api('bob', 'PUT', `/channels/${room}/read`, { seq: root.seq });
    await reply('ann', root.id, doc(mention(u.bob!.id, 'Bob'), text(' see this')));
    expect((await mine('bob', room)).mentionCount).toBe(0);
    // But Bob now follows the thread, so he sees it under Threads.
    expect(
      ((await api('bob', 'GET', '/threads')).json().threads as Json[]).some(
        (x) => x.root.id === root.id,
      ),
    ).toBe(true);
  });
});

describe('pins and saved messages', () => {
  let ch: string;
  let m: Json;
  beforeAll(async () => {
    ch = await mk('ann', 'pins-room', ['bob']);
    m = (await post('bob', ch, say('Important'))).json().message;
  });

  it('lets channel owners and admins pin, and everyone read the pins', async () => {
    expect((await api('bob', 'POST', `/channels/${ch}/pins`, { messageId: m.id })).statusCode).toBe(
      403,
    );
    const pinned = await api('ann', 'POST', `/channels/${ch}/pins`, { messageId: m.id });
    expect(pinned.statusCode).toBe(201);
    expect(pinned.json().message.pinned).toBe(true);
    const list = (await api('bob', 'GET', `/channels/${ch}/pins`)).json().pins as Json[];
    expect(list.map((x) => x.id)).toEqual([m.id]);
    expect((await api('ann', 'GET', `/messages/${m.id}`)).json().message.pinned).toBe(true);
    expect((await api('ann', 'DELETE', `/channels/${ch}/pins/${m.id}`)).json().message.pinned).toBe(
      false,
    );
    expect((await api('bob', 'GET', `/channels/${ch}/pins`)).json().pins).toEqual([]);
    // Public channel: an org admin who is not a member may pin.
    expect(
      (await api('owner', 'POST', `/channels/${ch}/pins`, { messageId: m.id })).statusCode,
    ).toBe(201);
  });

  it('lets everyone in a DM pin', async () => {
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id;
    const x = (await post('ann', dm, say('our plan'))).json().message;
    expect((await api('bob', 'POST', `/channels/${dm}/pins`, { messageId: x.id })).statusCode).toBe(
      201,
    );
  });

  it('saves messages for the person only, and hides them when access is lost', async () => {
    const room = await mk('ann', 'saved-room', ['bob'], 'private');
    const sm = (await post('ann', room, say('keep this'))).json().message;
    expect((await api('bob', 'PUT', `/me/saved/${sm.id}`)).json()).toEqual({ saved: true });
    expect((await api('bob', 'PUT', `/me/saved/${sm.id}`)).statusCode).toBe(200);
    let saved = (await api('bob', 'GET', '/me/saved')).json().saved as Json[];
    expect(saved.map((s) => s.message.id)).toContain(sm.id);
    expect(saved.find((s) => s.message.id === sm.id)!.channel).toMatchObject({
      id: room,
      type: 'private',
    });
    expect(
      ((await api('ann', 'GET', '/me/saved')).json().saved as Json[]).map((s) => s.message.id),
    ).not.toContain(sm.id);
    // Cy cannot save what he cannot see.
    expect((await api('cy', 'PUT', `/me/saved/${sm.id}`)).statusCode).toBe(404);
    await api('ann', 'DELETE', `/channels/${room}/members/${u.bob!.id}`);
    saved = (await api('bob', 'GET', '/me/saved')).json().saved as Json[];
    expect(saved.map((s) => s.message.id)).not.toContain(sm.id);
    expect((await api('bob', 'DELETE', `/me/saved/${sm.id}`)).json()).toEqual({ saved: false });
  });
});

describe('files', () => {
  let ch: string;
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('fake-png-body'),
  ]);

  beforeAll(async () => {
    ch = await mk('ann', 'files-room', ['bob'], 'private');
  });

  function upload(
    who: string,
    channelId: string,
    file: { name: string; body: Buffer; type?: string },
    host = slug,
  ) {
    const boundary = `----cd${randomUUID()}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      file.body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/channels/${channelId}/uploads`,
      headers: {
        host: `${host}.localhost:3000`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: { cd_session: c[who]! },
      payload: body,
    });
  }
  const download = (who: string, url: string) =>
    t.app.inject({
      method: 'GET',
      url,
      headers: { host: `${slug}.localhost:3000` },
      cookies: { cd_session: c[who]! },
    });

  it('sends a message with files, shows images inline, and checks channel access on every download', async () => {
    const up = await upload('ann', ch, { name: 'logo.png', body: PNG, type: 'image/png' });
    expect(up.statusCode, up.body).toBe(201);
    const file = up.json().file;
    expect(file).toMatchObject({ name: 'logo.png', isImage: true, size: PNG.length });
    const doc2 = await upload('ann', ch, {
      name: 'notes.txt',
      body: Buffer.from('plain notes'),
      type: 'text/plain',
    });
    const sent = await post('ann', ch, say('here you go'), {
      attachmentIds: [file.id, doc2.json().file.id],
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().message.attachments.map((a: Json) => a.name)).toEqual([
      'logo.png',
      'notes.txt',
    ]);

    const img = await download('bob', file.url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(String(img.headers['content-disposition'])).toMatch(/^inline/);
    expect(img.rawPayload.equals(PNG)).toBe(true);
    const txt = await download('bob', doc2.json().file.url);
    expect(String(txt.headers['content-disposition'])).toMatch(/^attachment/);
    expect(txt.headers['content-type']).toBe('application/octet-stream');

    // Not a member of this private channel: the file does not exist for Cy, nor for another workspace.
    expect((await download('cy', file.url)).statusCode).toBe(404);
    const other = await createOrg('richx');
    const otherCookie = await signInAs(t.app, other.slug, other.owner);
    const cross = await t.app.inject({
      method: 'GET',
      url: file.url,
      headers: { host: `${other.slug}.localhost:3000` },
      cookies: { cd_session: otherCookie },
    });
    expect(cross.statusCode).toBe(404);
    const anon = await t.app.inject({
      method: 'GET',
      url: file.url,
      headers: { host: `${slug}.localhost:3000` },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('allows a message with only files', async () => {
    const up = await upload('ann', ch, { name: 'only.png', body: PNG, type: 'image/png' });
    const sent = await api('ann', 'POST', `/channels/${ch}/messages`, {
      clientMsgId: cid(),
      body: { type: 'doc', content: [] },
      attachmentIds: [up.json().file.id],
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().message.attachments).toHaveLength(1);
    expect(
      (
        await api('ann', 'POST', `/channels/${ch}/messages`, {
          clientMsgId: cid(),
          body: { type: 'doc', content: [] },
        })
      ).statusCode,
    ).toBe(422);
  });

  it('blocks programs and scripts, and empty files', async () => {
    expect(
      (await upload('ann', ch, { name: 'setup.exe', body: Buffer.from('MZ....') })).statusCode,
    ).toBe(415);
    expect(
      (await upload('ann', ch, { name: 'run.sh', body: Buffer.from('#!/bin/sh\necho hi') }))
        .statusCode,
    ).toBe(415);
    expect((await upload('ann', ch, { name: 'empty.txt', body: Buffer.alloc(0) })).statusCode).toBe(
      422,
    );
  });

  it('only lets people who can post upload, and keeps unsent files private to the uploader', async () => {
    expect((await upload('cy', ch, { name: 'a.txt', body: Buffer.from('x') })).statusCode).toBe(
      404,
    );
    const ann = ((await api('bob', 'GET', '/channels')).json().channels as Json[]).find(
      (x) => x.name === 'announcements',
    )!;
    expect(
      (await upload('bob', ann.id, { name: 'a.txt', body: Buffer.from('x') })).statusCode,
    ).toBe(403);
    const mine1 = await upload('ann', ch, { name: 'draft.txt', body: Buffer.from('wip') });
    expect((await download('bob', mine1.json().file.url)).statusCode).toBe(404);
    expect((await download('ann', mine1.json().file.url)).statusCode).toBe(200);
    // Bob cannot attach Ann's unsent file to his message.
    const steal = await post('bob', ch, say('mine now'), { attachmentIds: [mine1.json().file.id] });
    expect(steal.statusCode).toBe(422);
    // She can discard it.
    expect((await api('ann', 'DELETE', `/uploads/${mine1.json().file.id}`)).statusCode).toBe(204);
  });

  it('removes files when their message is deleted, and lists channel files', async () => {
    const up = await upload('bob', ch, { name: 'temp.txt', body: Buffer.from('temporary') });
    const sent = (
      await post('bob', ch, say('with file'), { attachmentIds: [up.json().file.id] })
    ).json().message;
    const files = (await api('bob', 'GET', `/channels/${ch}/files`)).json().files as Json[];
    expect(files.map((f) => f.name)).toContain('temp.txt');
    expect(files.find((f) => f.name === 'temp.txt')).toMatchObject({
      messageId: sent.id,
      uploader: { id: u.bob!.id },
    });
    await api('bob', 'DELETE', `/messages/${sent.id}`);
    expect((await download('bob', up.json().file.url)).statusCode).toBe(404);
    expect(await t.db.tenant(orgId).messageAttachments.count({ messageId: sent.id })).toBe(0);
  });

  it('counts chat files toward workspace storage', async () => {
    const { storageBytes } = await import('../src/plans/index.js');
    const before = await storageBytes(t.db.tenant(orgId));
    expect(before).toBeGreaterThan(0);
  });
});

describe('link previews', () => {
  it('queues a lookup for the links in a message and marks the preview as pending', async () => {
    const ch = await mk('ann', 'links-room');
    queued.length = 0;
    const res = await post(
      'ann',
      ch,
      doc(
        text('See '),
        text('our docs', [{ type: 'link', attrs: { href: 'https://example.com/docs' } }]),
        text(' and https://example.org/page.'),
      ),
    );
    const msg = res.json().message;
    expect(msg.previewsPending).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.urls).toEqual(['https://example.com/docs', 'https://example.org/page']);
    // Addresses that could never be fetched are not even queued.
    queued.length = 0;
    const internal = await post(
      'ann',
      ch,
      say('look at http://169.254.169.254/latest and http://localhost:3000/admin'),
    );
    expect(internal.json().message.previewsPending).toBe(false);
    expect(queued).toHaveLength(0);
  });
});
