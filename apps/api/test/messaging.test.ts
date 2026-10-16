import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../src/messaging/events.js';
import { can } from '../src/permissions/can.js';
import { caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

const events = new MemoryEventSink();
// Generous limits: the rate limit itself has its own test below.
const t = makeApp({
  events,
  messageLimits: { userMax: 10_000, orgMax: 100_000, windowMs: 10_000 },
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
const doc = (s: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }],
});
let n = 0;
const msgId = () => `client-msg-${Date.now()}-${n++}`;
const post = (who: string, channelId: string, s: string, clientMsgId = msgId()) =>
  api(who, 'POST', `/channels/${channelId}/messages`, { clientMsgId, body: doc(s) });

const channelNamed = async (who: string, name: string): Promise<Json> => {
  const res = await api(who, 'GET', '/channels');
  expect(res.statusCode, res.body).toBe(200);
  return res.json().channels.find((ch: Json) => ch.name === name);
};

beforeAll(async () => {
  const org = await createOrg('msg');
  slug = org.slug;
  orgId = org.org.id;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const name of ['ann', 'bob', 'cy', 'dee']) {
    u[name] = await ensureUser({
      orgId,
      email: uniqueEmail(`msg-${name}`, `${slug}.test`),
      role: 'member',
    });
    c[name] = await signInAs(t.app, slug, u[name]);
  }
});

describe('channels and bootstrap', () => {
  it('creates #general and #announcements on first use and puts the person in them', async () => {
    const list = (await api('owner', 'GET', '/channels')).json().channels as Json[];
    expect(list.map((x) => x.name).sort()).toEqual(['announcements', 'general']);
    expect(list.find((x) => x.name === 'announcements')!.isAnnouncement).toBe(true);
    // The next person joins the same channels instead of getting copies.
    const bob = (await api('bob', 'GET', '/channels')).json().channels as Json[];
    expect(bob.map((x) => x.name).sort()).toEqual(['announcements', 'general']);
    const general = list.find((x) => x.name === 'general')!;
    expect(bob.find((x) => x.name === 'general')!.id).toBe(general.id);
  });

  it('does not put someone back in #general after they leave it', async () => {
    await api('cy', 'GET', '/channels');
    const general = await channelNamed('cy', 'general');
    expect((await api('cy', 'POST', `/channels/${general.id}/leave`)).statusCode).toBe(204);
    const again = (await api('cy', 'GET', '/channels')).json().channels as Json[];
    expect(again.find((x) => x.name === 'general')).toBeUndefined();
    // They can still join it again from the browser.
    expect((await api('cy', 'POST', `/channels/${general.id}/join`)).statusCode).toBe(204);
  });

  it('creates channels with unique case-insensitive names', async () => {
    const res = await api('ann', 'POST', '/channels', { name: 'project-x', type: 'public' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().channel.name).toBe('project-x');
    // A channel with only its creator is fine: the browser sends an empty list.
    const solo = await api('ann', 'POST', '/channels', { name: 'solo-room', type: 'public', memberIds: [] });
    expect(solo.statusCode, solo.body).toBe(201);
    expect(solo.json().channel.memberCount).toBe(1);
    const dup = await api('bob', 'POST', '/channels', { name: 'Project-X', type: 'private' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('name_taken');
    expect(
      (await api('bob', 'POST', '/channels', { name: 'bad name!', type: 'public' })).statusCode,
    ).toBe(400);
  });

  it('hides private channels from non-members as if they did not exist', async () => {
    const made = await api('ann', 'POST', '/channels', {
      name: 'secret',
      type: 'private',
      memberIds: [u.bob!.id],
    });
    const id = made.json().channel.id;
    expect((await api('bob', 'GET', `/channels/${id}`)).statusCode).toBe(200);
    expect((await api('cy', 'GET', `/channels/${id}`)).statusCode).toBe(404);
    expect((await api('cy', 'GET', `/channels/${id}/messages`)).statusCode).toBe(404);
    expect((await post('cy', id, 'hi')).statusCode).toBe(404);
    expect((await api('cy', 'POST', `/channels/${id}/join`)).statusCode).toBe(404);
    const browse = (await api('cy', 'GET', '/channels/browse')).json().channels as Json[];
    expect(browse.find((x) => x.id === id)).toBeUndefined();
  });

  it('lets people browse and join public channels', async () => {
    const id = (await channelNamed('ann', 'project-x')).id;
    const browse = (await api('dee', 'GET', '/channels/browse?search=proj')).json()
      .channels as Json[];
    expect(browse.find((x) => x.id === id)).toMatchObject({ joined: false });
    expect((await api('dee', 'POST', `/channels/${id}/join`)).statusCode).toBe(204);
    expect(
      (await api('dee', 'GET', '/channels')).json().channels.some((x: Json) => x.id === id),
    ).toBe(true);
  });

  it('keeps announcement channels to owners and admins for posting', async () => {
    const ann = await channelNamed('bob', 'announcements');
    expect((await post('bob', ann.id, 'hello everyone')).statusCode).toBe(403);
    expect((await post('owner', ann.id, 'Welcome')).statusCode).toBe(201);
  });

  it('makes archived channels read-only and unarchivable by an owner', async () => {
    const made = await api('ann', 'POST', '/channels', {
      name: 'old-stuff',
      type: 'public',
      memberIds: [u.bob!.id],
    });
    const id = made.json().channel.id;
    expect((await post('bob', id, 'before')).statusCode).toBe(201);
    expect((await api('bob', 'POST', `/channels/${id}/archive`)).statusCode).toBe(403);
    expect((await api('ann', 'POST', `/channels/${id}/archive`)).statusCode).toBe(200);
    const blocked = await post('bob', id, 'after');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('channel_archived');
    // Still readable.
    expect((await api('bob', 'GET', `/channels/${id}/messages`)).json().messages).toHaveLength(1);
    expect((await api('ann', 'POST', `/channels/${id}/unarchive`)).statusCode).toBe(200);
    expect((await post('bob', id, 'again')).statusCode).toBe(201);
  });

  it('only lets admins delete a channel, and audits it', async () => {
    const made = await api('ann', 'POST', '/channels', { name: 'to-delete', type: 'public' });
    const id = made.json().channel.id;
    expect((await api('ann', 'DELETE', `/channels/${id}`)).statusCode).toBe(403);
    expect((await api('owner', 'DELETE', `/channels/${id}`)).statusCode).toBe(204);
    expect((await api('ann', 'GET', `/channels/${id}`)).statusCode).toBe(404);
    const logs = await t.db.tenant(orgId).auditLogs.find({ targetId: id });
    expect(logs.map((l) => l.action).sort()).toEqual(['channel.created', 'channel.deleted']);
  });

  it('will not let the last owner leave while others remain', async () => {
    const made = await api('ann', 'POST', '/channels', {
      name: 'owned',
      type: 'public',
      memberIds: [u.bob!.id],
    });
    const id = made.json().channel.id;
    const res = await api('ann', 'POST', `/channels/${id}/leave`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('last_owner');
    expect(
      (await api('ann', 'PATCH', `/channels/${id}/members/${u.bob!.id}`, { role: 'owner' }))
        .statusCode,
    ).toBe(204);
    expect((await api('ann', 'POST', `/channels/${id}/leave`)).statusCode).toBe(204);
  });
});

describe('direct messages', () => {
  it('returns the same DM for the same pair, in either order', async () => {
    const a = await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] });
    const b = await api('bob', 'POST', '/dms', { userIds: [u.ann!.id] });
    expect(a.json().channel.id).toBe(b.json().channel.id);
    expect(a.json().channel.type).toBe('dm');
    expect(a.json().channel.people[0].id).toBe(u.bob!.id);
  });

  it('gives each exact set of people one group DM, capped at eight', async () => {
    const one = await api('ann', 'POST', '/dms', { userIds: [u.bob!.id, u.cy!.id] });
    const two = await api('cy', 'POST', '/dms', { userIds: [u.ann!.id, u.bob!.id] });
    expect(one.json().channel.id).toBe(two.json().channel.id);
    expect(one.json().channel.type).toBe('group_dm');
    const pair = await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] });
    expect(pair.json().channel.id).not.toBe(one.json().channel.id);
    const nine = Array.from({ length: 8 }, () => crypto.randomUUID());
    expect((await api('ann', 'POST', '/dms', { userIds: nine })).statusCode).toBe(422);
  });

  it('allows a self-DM and rejects people outside the workspace', async () => {
    const me = await api('dee', 'POST', '/dms', { userIds: [] });
    expect(me.statusCode).toBe(200);
    expect(me.json().channel.type).toBe('dm');
    const stranger = await api('dee', 'POST', '/dms', { userIds: [crypto.randomUUID()] });
    expect(stranger.statusCode).toBe(422);
  });

  it('keeps DMs private from everyone else, including admins', async () => {
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id;
    await post('ann', dm, 'between us');
    for (const who of ['cy', 'owner']) {
      expect((await api(who, 'GET', `/channels/${dm}/messages`)).statusCode).toBe(404);
    }
  });
});

describe('sending and ordering', () => {
  let channelId: string;
  beforeAll(async () => {
    channelId = (
      await api('ann', 'POST', '/channels', {
        name: 'chatter',
        type: 'public',
        memberIds: [u.bob!.id],
      })
    ).json().channel.id;
  });

  it('numbers messages 1, 2, 3 in the order they were stored', async () => {
    const base = (await api('ann', 'GET', `/channels/${channelId}/messages`)).json()
      .lastSeq as number;
    const seqs: number[] = [];
    for (const word of ['one', 'two', 'three'])
      seqs.push((await post('ann', channelId, word)).json().message.seq);
    expect(seqs).toEqual([base + 1, base + 2, base + 3]);
  });

  it('returns the original message when a send is retried with the same client id', async () => {
    const id = msgId();
    const first = await post('ann', channelId, 'once only', id);
    const retry = await post('ann', channelId, 'once only', id);
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().message.id).toBe(first.json().message.id);
    const all = (await api('ann', 'GET', `/channels/${channelId}/messages?limit=100`)).json()
      .messages as Json[];
    expect(all.filter((m) => m.bodyText === 'once only')).toHaveLength(1);
    // Someone else cannot claim that client id.
    expect((await post('bob', channelId, 'steal', id)).statusCode).toBe(403);
  });

  it('keeps seq unique and gap-free under concurrent senders', async () => {
    const before = (await api('ann', 'GET', `/channels/${channelId}/messages`)).json()
      .lastSeq as number;
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => post(i % 2 ? 'ann' : 'bob', channelId, `burst ${i}`)),
    );
    expect(
      results.every((r) => r.statusCode === 201),
      results.map((r) => r.body).join('\n'),
    ).toBe(true);
    const seqs = results.map((r) => r.json().message.seq as number).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 16 }, (_, i) => before + 1 + i));
  });

  it('publishes a stored message to the channel room, after it is stored', async () => {
    events.log.length = 0;
    const res = await post('ann', channelId, 'fan out');
    const ev = events.log.find((e) => e.kind === 'channel' && e.event === 'message:new');
    expect(ev).toMatchObject({ orgId, target: channelId });
    expect((ev!.payload as Json).id).toBe(res.json().message.id);
    // Failed sends publish nothing.
    events.log.length = 0;
    await post('ann', channelId, '   ');
    expect(events.log.filter((e) => e.event === 'message:new')).toHaveLength(0);
  });

  it('rebuilds bodies from an allow-list and enforces limits', async () => {
    expect((await post('ann', channelId, '')).statusCode).toBe(422);
    const long = await post('ann', channelId, 'x'.repeat(4001));
    expect(long.statusCode).toBe(413);
    const bad = await api('ann', 'POST', `/channels/${channelId}/messages`, {
      clientMsgId: msgId(),
      body: { type: 'doc', content: [{ type: 'script', content: [] }] },
    });
    expect(bad.statusCode).toBe(422);
    const link = await api('ann', 'POST', `/channels/${channelId}/messages`, {
      clientMsgId: msgId(),
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    });
    expect(link.statusCode).toBe(201);
    expect(JSON.stringify(link.json().message.body)).not.toContain('javascript');
  });

  it('rate limits a person who sends too fast', async () => {
    const limited = makeApp({ messageLimits: { userMax: 3, orgMax: 1000, windowMs: 60_000 } });
    try {
      const call2 = caller(limited.app);
      const cookie = await signInAs(limited.app, slug, u.bob!);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await call2({
          method: 'POST',
          url: `/channels/${channelId}/messages`,
          slug,
          cookie,
          payload: { clientMsgId: msgId(), body: doc(`spam ${i}`) },
        });
        out.push(r.statusCode);
      }
      expect(out.slice(0, 3)).toEqual([201, 201, 201]);
      expect(out.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('history', () => {
  let channelId: string;
  beforeAll(async () => {
    channelId = (await api('ann', 'POST', '/channels', { name: 'history', type: 'public' })).json()
      .channel.id;
    for (let i = 1; i <= 30; i++) await post('ann', channelId, `m${i}`);
  });

  it('pages by seq: latest page, older pages, and a window around a message', async () => {
    const latest = (await api('ann', 'GET', `/channels/${channelId}/messages?limit=10`)).json();
    expect(latest.messages.map((m: Json) => m.bodyText)).toEqual(
      Array.from({ length: 10 }, (_, i) => `m${21 + i}`),
    );
    expect(latest.hasOlder).toBe(true);
    expect(latest.hasNewer).toBe(false);
    const older = (
      await api(
        'ann',
        'GET',
        `/channels/${channelId}/messages?limit=10&before_seq=${latest.messages[0].seq}`,
      )
    ).json();
    expect(older.messages[9].bodyText).toBe('m20');
    const around = (
      await api('ann', 'GET', `/channels/${channelId}/messages?limit=10&around=15`)
    ).json();
    expect(around.messages.some((m: Json) => m.seq === 15)).toBe(true);
    expect(around.hasOlder && around.hasNewer).toBe(true);
    const after = (
      await api('ann', 'GET', `/channels/${channelId}/messages?limit=5&after_seq=28`)
    ).json();
    expect(after.messages.map((m: Json) => m.seq)).toEqual(
      [29, 30, 31].filter((s) => s <= after.lastSeq).slice(0, 5),
    );
  });
});

describe('editing and deleting', () => {
  let channelId: string;
  beforeAll(async () => {
    channelId = (
      await api('ann', 'POST', '/channels', {
        name: 'edits',
        type: 'public',
        memberIds: [u.bob!.id, u.cy!.id],
      })
    ).json().channel.id;
  });

  it('lets authors edit their own messages and keeps the old text', async () => {
    const m = (await post('bob', channelId, 'typo')).json().message;
    expect((await api('cy', 'PATCH', `/messages/${m.id}`, { body: doc('hax') })).statusCode).toBe(
      403,
    );
    const edited = await api('bob', 'PATCH', `/messages/${m.id}`, { body: doc('fixed') });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().message.bodyText).toBe('fixed');
    expect(edited.json().message.editedAt).toBeTruthy();
    const history = await t.db.tenant(orgId).messageEdits.find({ messageId: m.id });
    expect(history).toHaveLength(1);
  });

  it('leaves a tombstone when a message is deleted', async () => {
    const m = (await post('bob', channelId, 'oops')).json().message;
    expect((await api('cy', 'DELETE', `/messages/${m.id}`)).statusCode).toBe(403);
    const res = await api('bob', 'DELETE', `/messages/${m.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatchObject({ body: null, bodyText: null });
    expect(res.json().message.deletedAt).toBeTruthy();
    const list = (await api('cy', 'GET', `/channels/${channelId}/messages`)).json()
      .messages as Json[];
    const tomb = list.find((x) => x.id === m.id)!;
    expect(tomb.seq).toBe(m.seq);
    expect(tomb.body).toBeNull();
    // A deleted message cannot be edited back to life.
    expect((await api('bob', 'PATCH', `/messages/${m.id}`, { body: doc('back') })).statusCode).toBe(
      404,
    );
  });

  it("lets channel owners and admins delete anyone's message", async () => {
    const m = (await post('bob', channelId, 'rude')).json().message;
    expect((await api('ann', 'DELETE', `/messages/${m.id}`)).statusCode).toBe(200);
    const m2 = (await post('bob', channelId, 'also rude')).json().message;
    // The org owner moderates public channels without being a member of this one.
    expect((await api('owner', 'DELETE', `/messages/${m2.id}`)).statusCode).toBe(200);
    // A plain member cannot.
    const m3 = (await post('bob', channelId, 'fine')).json().message;
    expect((await api('cy', 'DELETE', `/messages/${m3.id}`)).statusCode).toBe(403);
  });
});

describe('read state', () => {
  let channelId: string;
  beforeAll(async () => {
    channelId = (
      await api('ann', 'POST', '/channels', {
        name: 'unreads',
        type: 'public',
        memberIds: [u.bob!.id],
      })
    ).json().channel.id;
  });

  it("counts other people's messages as unread until the cursor moves", async () => {
    for (const w of ['a', 'b', 'c']) await post('ann', channelId, w);
    const mine = async (who: string) => (await channelNamed(who, 'unreads')) as Json;
    expect((await mine('ann')).unread).toBe(0); // sending reads your own
    const bob = await mine('bob');
    expect(bob.unread).toBe(3);
    const read = await api('bob', 'PUT', `/channels/${channelId}/read`, { seq: bob.lastSeq - 1 });
    expect(read.json().lastReadSeq).toBe(bob.lastSeq - 1);
    expect((await mine('bob')).unread).toBe(1);
    // The cursor never moves backwards, nor past the end.
    expect(
      (await api('bob', 'PUT', `/channels/${channelId}/read`, { seq: 1 })).json().lastReadSeq,
    ).toBe(bob.lastSeq - 1);
    expect(
      (await api('bob', 'PUT', `/channels/${channelId}/read`, { seq: 9999 })).json().lastReadSeq,
    ).toBe(bob.lastSeq);
    expect((await mine('bob')).unread).toBe(0);
  });

  it('supports marking a message unread and reading everything', async () => {
    const msgs = (await api('bob', 'GET', `/channels/${channelId}/messages`)).json()
      .messages as Json[];
    const second = msgs[1]!;
    const res = await api('bob', 'PUT', `/messages/${second.id}/unread`);
    expect(res.json().lastReadSeq).toBe(second.seq - 1);
    expect(((await channelNamed('bob', 'unreads')) as Json).unread).toBe(msgs.length - 1);
    expect((await api('bob', 'POST', '/me/read-all')).statusCode).toBe(200);
    expect(((await channelNamed('bob', 'unreads')) as Json).unread).toBe(0);
  });

  it("tells the person's other tabs when the cursor moves", async () => {
    events.log.length = 0;
    await api('bob', 'PUT', `/channels/${channelId}/read`, { seq: 1 });
    expect(
      events.log.some(
        (e) => e.kind === 'user' && e.target === u.bob!.id && e.event === 'read:synced',
      ),
    ).toBe(true);
  });

  it('ignores read updates for channels the person is not in', async () => {
    expect((await api('cy', 'PUT', `/channels/${channelId}/read`, { seq: 1 })).statusCode).toBe(
      404,
    );
  });
});

describe('membership changes reach the gateway', () => {
  it('joins and removes sockets from the room as people come and go', async () => {
    const id = (await api('ann', 'POST', '/channels', { name: 'rooms', type: 'private' })).json()
      .channel.id;
    events.log.length = 0;
    expect(
      (await api('ann', 'POST', `/channels/${id}/members`, { userIds: [u.bob!.id] })).json().added,
    ).toBe(1);
    expect(events.log.some((e) => e.kind === 'join' && e.target === `${u.bob!.id}:${id}`)).toBe(
      true,
    );
    expect((await api('bob', 'GET', `/channels/${id}`)).statusCode).toBe(200);
    events.log.length = 0;
    expect((await api('ann', 'DELETE', `/channels/${id}/members/${u.bob!.id}`)).statusCode).toBe(
      204,
    );
    expect(events.log.some((e) => e.kind === 'leave' && e.target === `${u.bob!.id}:${id}`)).toBe(
      true,
    );
    expect((await api('bob', 'GET', `/channels/${id}`)).statusCode).toBe(404);
    expect(
      (await api('bob', 'POST', `/channels/${id}/members`, { userIds: [u.cy!.id] })).statusCode,
    ).toBe(404);
  });

  it('removes a deactivated person from every channel and disconnects them', async () => {
    const dee = await ensureUser({
      orgId,
      email: uniqueEmail('msg-gone', `${slug}.test`),
      role: 'member',
    });
    const cookie = await signInAs(t.app, slug, dee);
    c.gone = cookie;
    await api('gone', 'GET', '/channels');
    const before = (await api('gone', 'GET', '/channels')).json().channels as Json[];
    expect(before.length).toBeGreaterThan(0);
    events.log.length = 0;
    expect((await api('owner', 'POST', `/members/${dee.id}/deactivate`)).statusCode).toBe(200);
    expect(events.log.some((e) => e.kind === 'disconnect' && e.target === dee.id)).toBe(true);
    const members = await t.db.tenant(orgId).channelMembers.find({ userId: dee.id });
    expect(members).toHaveLength(0);
    // Their messages stay, marked as from a deactivated person.
    expect((await api('gone', 'GET', '/channels')).statusCode).toBe(401);
  });

  it("disconnects the session's sockets on logout", async () => {
    const who = await ensureUser({
      orgId,
      email: uniqueEmail('msg-out', `${slug}.test`),
      role: 'member',
    });
    const cookie = await signInAs(t.app, slug, who);
    events.log.length = 0;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { host: `${slug}.localhost:3000` },
      cookies: { cd_session: cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(events.log.some((e) => e.kind === 'disconnect-session')).toBe(true);
  });
});

describe('tenant isolation', () => {
  it("never shows one workspace another workspace's channels or messages", async () => {
    const other = await createOrg('msgx');
    const otherCookie = await signInAs(t.app, other.slug, other.owner);
    const general = await channelNamed('owner', 'general');
    // Same channel id asked on the other workspace's host.
    const peek = await call({
      method: 'GET',
      url: `/channels/${general.id}/messages`,
      slug: other.slug,
      cookie: otherCookie,
    });
    expect(peek.statusCode).toBe(404);
    const write = await call({
      method: 'POST',
      url: `/channels/${general.id}/messages`,
      slug: other.slug,
      cookie: otherCookie,
      payload: { clientMsgId: msgId(), body: doc('cross-tenant') },
    });
    expect(write.statusCode).toBe(404);
    // And a session from this workspace means nothing on the other host.
    const replay = await call({
      method: 'GET',
      url: '/channels',
      slug: other.slug,
      cookie: c.owner,
    });
    expect(replay.statusCode).toBe(401);
    expect(await t.db.tenant(orgId).messages.count({ bodyText: 'cross-tenant' })).toBe(0);
    const theirs = (
      await call({ method: 'GET', url: '/channels', slug: other.slug, cookie: otherCookie })
    ).json().channels as Json[];
    expect(theirs.map((x) => x.id)).not.toContain(general.id);
  });
});

describe('permissions (can)', () => {
  const member = { userId: 'u', orgId: 'o', orgRole: 'member' as const };
  const admin = { ...member, orgRole: 'admin' as const };
  const pub = { channelType: 'public' as const, channelRole: 'member' as const };

  it('matches the matrix in the brief', () => {
    expect(can(member, 'channel.join', { channelType: 'public', channelRole: null })).toBe(true);
    expect(can(member, 'channel.join', { channelType: 'private', channelRole: null })).toBe(false);
    expect(can(member, 'channel.view', { channelType: 'private', channelRole: null })).toBe(false);
    expect(can(member, 'channel.post', pub)).toBe(true);
    expect(can(member, 'channel.post', { ...pub, isArchived: true })).toBe(false);
    expect(can(member, 'channel.post', { ...pub, isAnnouncement: true })).toBe(false);
    expect(
      can({ ...member }, 'channel.post', { ...pub, channelRole: 'owner', isAnnouncement: true }),
    ).toBe(true);
    expect(can(admin, 'channel.post', { ...pub, isAnnouncement: true })).toBe(true);
    expect(can(admin, 'channel.post', { channelType: 'public', channelRole: null })).toBe(false);
    expect(can(member, 'channel.archive', pub)).toBe(false);
    expect(can(member, 'channel.archive', { ...pub, channelRole: 'owner' })).toBe(true);
    expect(can(admin, 'channel.archive', { channelType: 'private', channelRole: null })).toBe(true);
    expect(can({ ...member }, 'channel.delete', { ...pub, channelRole: 'owner' })).toBe(false);
    expect(can(admin, 'channel.delete', { channelType: 'private', channelRole: null })).toBe(true);
    expect(can(admin, 'channel.delete', { channelType: 'dm', channelRole: 'member' })).toBe(false);
    expect(can(member, 'message.deleteAny', { ...pub, channelRole: 'owner' })).toBe(true);
    expect(can(admin, 'message.deleteAny', { channelType: 'private', channelRole: null })).toBe(
      false,
    );
    expect(can(admin, 'message.deleteAny', { channelType: 'dm', channelRole: 'member' })).toBe(
      false,
    );
    expect(can(member, 'message.editOwn', { ...pub, isAuthor: true })).toBe(true);
    expect(can(member, 'message.editOwn', { ...pub, isAuthor: false })).toBe(false);
  });
});

describe('presence and status', () => {
  it('reports offline for people with no connection and applies do-not-disturb', async () => {
    const res = await api('ann', 'GET', `/presence?ids=${u.bob!.id},${crypto.randomUUID()}`);
    expect(res.json().people).toEqual([{ id: u.bob!.id, state: 'offline', status: null, checkin: null }]);
    expect((await api('bob', 'PUT', '/me/dnd', { minutes: 30 })).json().until).toBeTruthy();
    expect((await api('bob', 'PUT', '/me/dnd', { minutes: null })).json().until).toBeNull();
  });

  it('stores a custom status and hides it once expired', async () => {
    await api('bob', 'PUT', '/me/status', { emoji: '🌴', text: 'On holiday' });
    let person = (await api('ann', 'GET', `/presence?ids=${u.bob!.id}`)).json().people[0];
    expect(person.status).toMatchObject({ emoji: '🌴', text: 'On holiday' });
    await api('bob', 'PUT', '/me/status', {
      emoji: '🌴',
      text: 'Gone',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    person = (await api('ann', 'GET', `/presence?ids=${u.bob!.id}`)).json().people[0];
    expect(person.status).toBeNull();
  });
});
