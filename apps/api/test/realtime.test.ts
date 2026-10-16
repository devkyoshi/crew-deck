import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOCKET_PATH } from '@crew-deck/shared';
// The gateway is its own app (apps/realtime); its tests live here because this package owns the test database.
import { createGateway } from '../../realtime/src/gateway.js';
import { SessionStore } from '../src/auth/sessions.js';
import { RedisEventSink } from '../src/messaging/events.js';
import { Presence } from '../src/messaging/presence.js';
import { RateLimiter } from '../src/messaging/rate-limit.js';
import { caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const t = makeApp({ messageLimits: { userMax: 10_000, orgMax: 100_000, windowMs: 10_000 } });
const call = caller(t.app);

let http: Server;
let gateway: ReturnType<typeof createGateway>;
let port: number;
const open: Socket[] = [];

let slug: string;
let orgId: string;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
let general: string;

const doc = (s: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }],
});
let n = 0;
const msgId = () => `rt-msg-${Date.now()}-${n++}`;

/** Connects a client the way a browser tab would: the tenant host and the session cookie. */
function client(
  slugOf: string,
  cookie: string | undefined,
  opts: { connect?: boolean } = {},
): Socket {
  const s = connect(`http://127.0.0.1:${port}`, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: opts.connect !== false,
    extraHeaders: {
      'x-forwarded-host': `${slugOf}.localhost:3000`,
      ...(cookie ? { cookie: `cd_session=${cookie}` } : {}),
    },
  });
  open.push(s);
  return s;
}

const ready = (s: Socket) =>
  new Promise<Socket>((resolve, reject) => {
    if (s.connected) return resolve(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(e));
  });

const next = <T = Json>(s: Socket, event: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(timer);
      resolve(p);
    });
  });

/** Records everything of one kind so a test can prove something did not arrive. */
const record = (s: Socket, event: string) => {
  const seen: Json[] = [];
  s.on(event, (p: Json) => seen.push(p));
  return seen;
};
const quiet = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const emit = <T = Json>(s: Socket, event: string, payload: unknown) =>
  new Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 4000);
      s.emit(event, payload, (a: never) => {
        clearTimeout(timer);
        resolve(a);
      });
    },
  );

const rest = (
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: Json,
) => call({ method, url, slug, cookie: c[who], payload });

const send = (s: Socket, channelId: string, text: string, clientMsgId = msgId()) =>
  emit(s, 'message:send', { channelId, clientMsgId, body: doc(text) });

beforeAll(async () => {
  await t.app.ready();
  const sessions = new SessionStore(t.redis, t.config.SESSION_TTL_SECONDS);
  http = createServer();
  gateway = createGateway(http, {
    db: t.db,
    config: t.config,
    redis: t.redis,
    sessions,
    messaging: {
      db: t.db,
      events: new RedisEventSink(t.redis),
      limiter: new RateLimiter(t.redis, { userMax: 30, orgMax: 100_000, windowMs: 60_000 }),
      presence: new Presence(t.redis),
    },
    presence: new Presence(t.redis),
    limiter: new RateLimiter(t.redis),
    recheckMs: 60_000,
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  port = (http.address() as AddressInfo).port;

  const org = await createOrg('rt');
  slug = org.slug;
  orgId = org.org.id;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const name of ['ann', 'bob', 'cy']) {
    u[name] = await ensureUser({
      orgId,
      email: uniqueEmail(`rt-${name}`, `${slug}.test`),
      role: 'member',
    });
    c[name] = await signInAs(t.app, slug, u[name]);
  }
  // Opening Messages creates #general and puts each person in it.
  for (const who of ['owner', 'ann', 'bob', 'cy']) await rest(who, 'GET', '/channels');
  general = ((await rest('ann', 'GET', '/channels')).json().channels as Json[]).find(
    (x) => x.name === 'general',
  )!.id;
});

afterAll(async () => {
  for (const s of open) s.disconnect();
  await quiet(500); // let the gateway finish its disconnect bookkeeping before Redis closes
  await gateway?.close();
  await new Promise((r) => http?.close(r));
  await t.close();
});

describe('handshake', () => {
  it('refuses a connection without a session, or with a session from another workspace', async () => {
    const anon = client(slug, undefined);
    await expect(ready(anon)).rejects.toThrow('UNAUTHENTICATED');
    const other = await createOrg('rtx');
    const otherCookie = await signInAs(t.app, other.slug, other.owner);
    // A cookie from workspace X replayed against workspace A's host finds no session.
    const replay = client(slug, otherCookie);
    await expect(ready(replay)).rejects.toThrow('UNAUTHENTICATED');
    const forged = client(slug, 'not-a-real-session');
    await expect(ready(forged)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('refuses a browser origin that does not match the host', async () => {
    const s = connect(`http://127.0.0.1:${port}`, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: {
        'x-forwarded-host': `${slug}.localhost:3000`,
        cookie: `cd_session=${c.ann}`,
        origin: 'http://evil.example',
      },
    });
    open.push(s);
    await expect(ready(s)).rejects.toThrow();
  });
});

describe('sending and delivery', () => {
  it('delivers a message to everyone in the channel, after storing it', async () => {
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const arrived = next(b, 'message:new');
    const ack = await send(a, general, 'hello bob');
    expect(ack.ok).toBe(true);
    const got = await arrived;
    expect(ack.ok && got.id === ack.data.message.id).toBe(true);
    expect(got).toMatchObject({ bodyText: 'hello bob', channelId: general });
    // It really is stored, with the seq everyone saw.
    const stored = await t.db.tenant(orgId).messages.findOne({ id: got.id });
    expect(stored?.seq).toBe(got.seq);
  });

  it('treats a retried send as the same message and fans out once', async () => {
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const seen = record(b, 'message:new');
    const id = msgId();
    const first = await send(a, general, 'only once', id);
    const second = await send(a, general, 'only once', id);
    await quiet();
    expect(first.ok && second.ok && first.data.message.id === second.data.message.id).toBe(true);
    expect(seen.filter((m) => m.bodyText === 'only once')).toHaveLength(1);
  });

  it("numbers messages in order and tells the sender's other tab the cursor moved", async () => {
    const a1 = await ready(client(slug, c.ann));
    const a2 = await ready(client(slug, c.ann));
    const synced = next(a2, 'read:synced');
    const one = await send(a1, general, 'first');
    const two = await send(a1, general, 'second');
    expect(one.ok && two.ok && two.data.message.seq === one.data.message.seq + 1).toBe(true);
    expect((await synced).channelId).toBe(general);
  });

  it('rejects bad payloads and enforces the rate limit with coded errors', async () => {
    const a = await ready(client(slug, c.cy));
    expect(await emit(a, 'message:send', { nonsense: true })).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    expect(await send(a, general, 'x'.repeat(4001))).toMatchObject({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
    });
    const codes: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await send(a, general, `flood ${i}`);
      codes.push(r.ok ? 'ok' : r.code);
    }
    expect(codes).toContain('RATE_LIMITED');
    expect(codes.indexOf('RATE_LIMITED')).toBeGreaterThan(0);
  });

  it('applies the announcement rule through the socket too', async () => {
    const ann = ((await rest('bob', 'GET', '/channels')).json().channels as Json[]).find(
      (x) => x.name === 'announcements',
    )!;
    const b = await ready(client(slug, c.bob));
    expect(await send(b, ann.id, 'nope')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const o = await ready(client(slug, c.owner));
    expect((await send(o, ann.id, 'official')).ok).toBe(true);
  });

  it('broadcasts edits and deletes', async () => {
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const sent = await send(a, general, 'draft');
    if (!sent.ok) throw new Error('send failed');
    const updated = next(b, 'message:updated');
    expect(
      (await emit(a, 'message:edit', { messageId: sent.data.message.id, body: doc('final') })).ok,
    ).toBe(true);
    expect((await updated).bodyText).toBe('final');
    const deleted = next(b, 'message:deleted');
    expect((await emit(a, 'message:delete', { messageId: sent.data.message.id })).ok).toBe(true);
    expect(await deleted).toMatchObject({ body: null, bodyText: null });
    expect(
      await emit(b, 'message:edit', { messageId: sent.data.message.id, body: doc('x') }),
    ).toMatchObject({ ok: false });
  });
});

describe('reconnecting', () => {
  it('returns exactly what was missed, with no duplicates and nothing lost', async () => {
    const a = await ready(client(slug, c.ann));
    let b = await ready(client(slug, c.bob));
    const live = record(b, 'message:new');
    const before = await send(a, general, 'before the drop');
    await quiet(200);
    expect(live.map((m) => m.id)).toContain(before.ok && before.data.message.id);
    const lastSeen = live.at(-1)!.seq as number;
    b.disconnect();

    const missed = [];
    for (const w of ['m-1', 'm-2', 'm-3']) missed.push(await send(a, general, w));

    b = await ready(client(slug, c.bob));
    const got = await emit<Json[]>(b, 'sync', {
      channels: [{ channelId: general, lastSeq: lastSeen }],
    });
    if (!got.ok) throw new Error('sync failed');
    const entry = got.data.find((x) => x.channelId === general)!;
    expect(entry.refetch).toBe(false);
    expect(entry.messages.map((m: Json) => m.bodyText)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(entry.messages.map((m: Json) => m.seq)).toEqual(
      missed.map((m) => (m.ok ? m.data.message.seq : -1)),
    );
    // Asking again from the new position returns nothing: no duplicates.
    const again = await emit<Json[]>(b, 'sync', {
      channels: [{ channelId: general, lastSeq: entry.lastSeq }],
    });
    expect(again.ok && again.data[0]!.messages).toEqual([]);
  });

  it('tells the client to refetch when it missed too much', async () => {
    const b = await ready(client(slug, c.bob));
    const room = (
      await rest('ann', 'POST', '/channels', {
        name: 'busy',
        type: 'public',
        memberIds: [u.bob!.id],
      })
    ).json().channel.id;
    const db = t.db.tenant(orgId);
    const ch = (await db.channels.get(room))!;
    const rows = Array.from({ length: 250 }, (_, i) => ({
      channelId: room,
      seq: ch.lastSeq + 1 + i,
      authorId: u.ann!.id,
      body: doc('bulk'),
      bodyText: 'bulk',
    }));
    await db.messages.insert(rows);
    await db.channels.updateOne({ id: room }, { lastSeq: ch.lastSeq + 250 });
    const got = await emit<Json[]>(b, 'sync', { channels: [{ channelId: room, lastSeq: 0 }] });
    expect(got.ok && got.data[0]).toMatchObject({ refetch: true, messages: [] });
  });

  it('never syncs channels the person is not in', async () => {
    const secret = (
      await rest('ann', 'POST', '/channels', { name: 'hush', type: 'private' })
    ).json().channel.id;
    await rest('ann', 'POST', `/channels/${secret}/messages`, {
      clientMsgId: msgId(),
      body: doc('classified'),
    });
    const c1 = await ready(client(slug, c.cy));
    const got = await emit<Json[]>(c1, 'sync', { channels: [{ channelId: secret, lastSeq: 0 }] });
    expect(got.ok && got.data).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it("answers FORBIDDEN to another workspace's channel id and never delivers its events", async () => {
    const other = await createOrg('rtb');
    const otherCookie = await signInAs(t.app, other.slug, other.owner);
    const intruder = await ready(client(other.slug, otherCookie));
    const victim = await ready(client(slug, c.ann));
    const heardByIntruder = [
      record(intruder, 'message:new'),
      record(intruder, 'typing'),
      record(intruder, 'message:updated'),
    ];
    // Writing into workspace A's channel from workspace B.
    expect(await send(intruder, general, 'cross-tenant write')).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await emit(intruder, 'read:update', { channelId: general, seq: 1 })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(
      await emit<Json[]>(intruder, 'sync', { channels: [{ channelId: general, lastSeq: 0 }] }),
    ).toMatchObject({ ok: true, data: [] });
    const err = next(intruder, 'error');
    intruder.emit('typing:start', { channelId: general });
    expect((await err).code).toBe('FORBIDDEN');
    // Workspace A keeps talking; the intruder hears none of it.
    await send(victim, general, 'private company news');
    victim.emit('typing:start', { channelId: general });
    await quiet(500);
    expect(heardByIntruder.flat()).toEqual([]);
    expect(await t.db.tenant(orgId).messages.count({ bodyText: 'cross-tenant write' })).toBe(0);
  });

  it('keeps presence changes inside the workspace', async () => {
    const other = await createOrg('rtp');
    const otherCookie = await signInAs(t.app, other.slug, other.owner);
    const watcher = await ready(client(other.slug, otherCookie));
    const seen = record(watcher, 'presence:changed');
    const stranger = await ensureUser({
      orgId,
      email: uniqueEmail('rt-pres', `${slug}.test`),
      role: 'member',
    });
    const a = await ready(client(slug, await signInAs(t.app, slug, stranger)));
    await quiet(300);
    a.disconnect();
    await quiet(500);
    expect(seen.filter((p) => p.userId === stranger.id)).toEqual([]);
  });
});

describe('membership changes take effect immediately', () => {
  it('starts delivering to a newly added member, and stops for a removed one, without reconnecting', async () => {
    const room = (
      await rest('ann', 'POST', '/channels', { name: 'live-rooms', type: 'private' })
    ).json().channel.id;
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const heard = record(b, 'message:new');
    await send(a, room, 'before bob was added');
    await quiet(300);
    expect(heard).toEqual([]);

    const membership = next(b, 'channel:membership');
    await rest('ann', 'POST', `/channels/${room}/members`, { userIds: [u.bob!.id] });
    expect(await membership).toMatchObject({ channelId: room, change: 'added' });
    await send(a, room, 'welcome bob');
    await quiet(300);
    expect(heard.map((m) => m.bodyText)).toContain('welcome bob');

    const removed = next(b, 'channel:membership');
    await rest('ann', 'DELETE', `/channels/${room}/members/${u.bob!.id}`);
    expect(await removed).toMatchObject({ channelId: room, change: 'removed' });
    heard.length = 0;
    await send(a, room, 'bob should not see this');
    await quiet(400);
    expect(
      heard.filter((m) => m.channelId === room && m.bodyText === 'bob should not see this'),
    ).toEqual([]);
    // And he cannot write there either.
    expect(await send(b, room, 'let me in')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it("disconnects a deactivated person's sockets", async () => {
    const gone = await ensureUser({
      orgId,
      email: uniqueEmail('rt-gone', `${slug}.test`),
      role: 'member',
    });
    c.gone = await signInAs(t.app, slug, gone);
    const s = await ready(client(slug, c.gone));
    const closed = new Promise((r) => s.once('disconnect', r));
    expect((await rest('owner', 'POST', `/members/${gone.id}/deactivate`)).statusCode).toBe(200);
    await closed;
    expect(s.connected).toBe(false);
    await expect(ready(client(slug, c.gone))).rejects.toThrow('UNAUTHENTICATED');
  });

  it('disconnects only the logged-out session', async () => {
    const user = await ensureUser({
      orgId,
      email: uniqueEmail('rt-two', `${slug}.test`),
      role: 'member',
    });
    const first = await signInAs(t.app, slug, user);
    const second = await signInAs(t.app, slug, user);
    const s1 = await ready(client(slug, first));
    const s2 = await ready(client(slug, second));
    const closed = new Promise((r) => s1.once('disconnect', r));
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { host: `${slug}.localhost:3000` },
      cookies: { cd_session: first },
    });
    await closed;
    await quiet(200);
    expect(s1.connected).toBe(false);
    expect(s2.connected).toBe(true);
  });
});

describe('typing, read state and presence', () => {
  it('shows typing to others only, throttled to one per few seconds', async () => {
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const seenByB = record(b, 'typing');
    const seenByA = record(a, 'typing');
    a.emit('typing:start', { channelId: general });
    a.emit('typing:start', { channelId: general });
    a.emit('typing:start', { channelId: general });
    await quiet(500);
    expect(seenByB).toEqual([{ channelId: general, userId: u.ann!.id }]);
    expect(seenByA).toEqual([]);
  });

  it("moves the read cursor and syncs it to the person's other tab", async () => {
    const msg = await rest('ann', 'POST', `/channels/${general}/messages`, {
      clientMsgId: msgId(),
      body: doc('for cursor'),
    });
    const seq = msg.json().message.seq;
    const tab1 = await ready(client(slug, c.bob));
    const tab2 = await ready(client(slug, c.bob));
    const synced = next(tab2, 'read:synced');
    const ack = await emit(tab1, 'read:update', { channelId: general, seq });
    expect(ack).toMatchObject({ ok: true, data: { lastReadSeq: seq } });
    expect(await synced).toEqual({ channelId: general, seq });
    const mine = ((await rest('bob', 'GET', '/channels')).json().channels as Json[]).find(
      (x) => x.id === general,
    )!;
    expect(mine.unread).toBe(0);
  });

  it('merges several tabs into one presence state', async () => {
    const pat = await ensureUser({
      orgId,
      email: uniqueEmail('rt-pat', `${slug}.test`),
      role: 'member',
    });
    const patCookie = await signInAs(t.app, slug, pat);
    const watcher = await ready(client(slug, c.owner));
    const seen = record(watcher, 'presence:changed');
    const mine = () => seen.filter((p) => p.userId === pat.id);
    const state = async () =>
      (await rest('owner', 'GET', `/presence?ids=${pat.id}`)).json().people[0].state;
    const tab1 = await ready(client(slug, patCookie));
    await quiet(300);
    const tab2 = await ready(client(slug, patCookie));
    await quiet(300);
    // Two tabs, one change: the second tab did not announce anything new.
    expect(mine()).toEqual([{ userId: pat.id, state: 'online' }]);
    expect(await state()).toBe('online');
    tab1.disconnect();
    await quiet(300);
    expect(await state()).toBe('online');
    expect(await emit(tab2, 'presence:update', { state: 'away' })).toMatchObject({
      ok: true,
      data: { state: 'away' },
    });
    expect(await state()).toBe('away');
    tab2.disconnect();
    await quiet(400);
    expect(await state()).toBe('offline');
    expect(mine().at(-1)).toEqual({ userId: pat.id, state: 'offline' });
  });
});

describe('threads and reactions over the socket', () => {
  it('delivers a thread reply and the updated thread summary to the channel', async () => {
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const root = await send(a, general, 'Thread starter');
    if (!root.ok) throw new Error('send failed');
    await quiet(300); // let the root message's own push arrive first
    const newMsg = next(b, 'message:new');
    const summary = next(b, 'thread:updated');
    const ack = await emit(a, 'message:send', {
      channelId: general,
      clientMsgId: msgId(),
      body: doc('First reply'),
      threadRootId: root.data.message.id,
    });
    expect(ack.ok).toBe(true);
    expect(await newMsg).toMatchObject({
      bodyText: 'First reply',
      threadRootId: root.data.message.id,
    });
    expect(await summary).toMatchObject({ rootId: root.data.message.id, replyCount: 1 });
    // Threads do not nest, over the socket either.
    const reply = ack.ok ? (ack.data as Json).message : null;
    expect(
      await emit(a, 'message:send', {
        channelId: general,
        clientMsgId: msgId(),
        body: doc('nested'),
        threadRootId: reply.id,
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('broadcasts reactions to the channel, and refuses people who are not in it', async () => {
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const m = await send(a, general, 'React to this');
    if (!m.ok) throw new Error('send failed');
    const heard = next(a, 'reaction:updated');
    const ack = await emit(b, 'reaction:toggle', { messageId: m.data.message.id, emoji: '🎉' });
    expect(ack).toMatchObject({ ok: true });
    expect(await heard).toMatchObject({
      messageId: m.data.message.id,
      reactions: [{ emoji: '🎉', count: 1 }],
    });
    // Toggling again removes it.
    const off = await emit<Json>(b, 'reaction:toggle', {
      messageId: m.data.message.id,
      emoji: '🎉',
    });
    expect(off.ok && off.data.reactions).toEqual([]);
    expect(
      await emit(b, 'reaction:toggle', { messageId: m.data.message.id, emoji: 'nope' }),
    ).toMatchObject({ ok: false, code: 'VALIDATION' });

    // Another workspace cannot react to this message, and never hears about reactions here.
    const other = await createOrg('rtr');
    const intruder = await ready(
      client(other.slug, await signInAs(t.app, other.slug, other.owner)),
    );
    const spy = record(intruder, 'reaction:updated');
    expect(
      await emit(intruder, 'reaction:toggle', { messageId: m.data.message.id, emoji: '👍' }),
    ).toMatchObject({ ok: false });
    await emit(a, 'reaction:toggle', { messageId: m.data.message.id, emoji: '👀' });
    await quiet(400);
    expect(spy).toEqual([]);
  });
});

describe('notifications over the socket', () => {
  const ofBob = async (channelId: string) =>
    t.db
      .tenant(orgId)
      .notifications.find({ userId: u.bob!.id, 'data.channelId': channelId } as never);

  it('pushes a notification to the person, and stops while their tab reports viewing that conversation', async () => {
    const dm = (await rest('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id;
    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));

    // Not viewing: the notification arrives live, silent=false.
    const pushed = next<Json>(b, 'notification:new');
    await send(a, dm, 'first ping');
    const ev = await pushed;
    expect(ev).toMatchObject({ type: 'dm', channelId: dm, silent: false });
    expect(ev.text).toMatch(/sent you a message/);

    // Viewing: nothing is created, nothing is pushed.
    expect(await emit(b, 'view:update', { channelId: dm })).toMatchObject({ ok: true });
    const spy = record(b, 'notification:new');
    const before = (await ofBob(dm)).length;
    await send(a, dm, 'second ping');
    await quiet(700);
    expect((await ofBob(dm)).length).toBe(before);
    expect(spy).toEqual([]);

    // Looking away brings them back.
    expect(await emit(b, 'view:update', { channelId: null })).toMatchObject({ ok: true });
    await send(a, dm, 'third ping');
    await quiet(700);
    expect((await ofBob(dm)).length).toBe(before + 1);
  });

  it('ignores a view report for a conversation the person is not in', async () => {
    const secret = (
      await rest('ann', 'POST', '/channels', {
        name: `view-${Date.now() % 100000}`,
        type: 'private',
      })
    ).json().channel.id;
    const b = await ready(client(slug, c.bob));
    const stranger = await emit(b, 'view:update', { channelId: secret });
    // Answered the same as a valid report, and nothing is recorded: no way to probe for channels.
    expect(stranger).toMatchObject({ ok: true });
    expect(await new Presence(t.redis).isViewing(orgId, u.bob!.id, secret)).toBe(false);
  });

  it('never delivers one workspace’s notifications to another', async () => {
    const other = await createOrg('rtn');
    const intruder = await ready(
      client(other.slug, await signInAs(t.app, other.slug, other.owner)),
    );
    const spy = record(intruder, 'notification:new');
    const dm = (await rest('ann', 'POST', '/dms', { userIds: [u.cy!.id] })).json().channel.id;
    const a = await ready(client(slug, c.ann));
    await send(a, dm, 'private to this workspace');
    await quiet(600);
    expect(spy).toEqual([]);
  });
});

describe('space channels over the socket', () => {
  it('adding someone to a space puts them in its channel at once, removing them takes it away', async () => {
    const key = `RT${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
    const made = await rest('ann', 'POST', '/spaces', { key, name: `Space ${key}`, visibility: 'private' });
    expect(made.statusCode, made.body).toBe(200);
    const spaceId = made.json().id as string;
    const channelId = (await rest('ann', 'GET', `/spaces/${spaceId}/channel`)).json().channel.id as string;

    const a = await ready(client(slug, c.ann));
    const b = await ready(client(slug, c.bob));
    const heard = record(b, 'message:new');
    // Bob is not in the private space: nothing reaches him and he cannot write there.
    await send(a, channelId, 'before bob');
    await quiet(300);
    expect(heard).toEqual([]);
    expect(await send(b, channelId, 'let me in')).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const added = next(b, 'channel:membership');
    const res = await rest('ann', 'POST', `/spaces/${spaceId}/members`, {
      members: [{ type: 'user', id: u.bob!.id, role: 'member' }],
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect(await added).toMatchObject({ channelId, change: 'added' });
    await send(a, channelId, 'welcome to the space');
    await quiet(300);
    expect(heard.map((m) => m.bodyText)).toContain('welcome to the space');
    expect(await send(b, channelId, 'thanks')).toMatchObject({ ok: true });

    const row = (
      (await rest('ann', 'GET', `/spaces/${spaceId}/members?pageSize=100`)).json().items as Json[]
    ).find((m) => m.principalId === u.bob!.id)!;
    const removed = next(b, 'channel:membership');
    await rest('ann', 'DELETE', `/spaces/${spaceId}/members/${row.id}`);
    expect(await removed).toMatchObject({ channelId, change: 'removed' });
    heard.length = 0;
    await send(a, channelId, 'bob is gone');
    await quiet(400);
    expect(heard.filter((m) => m.bodyText === 'bob is gone')).toEqual([]);
    expect(await send(b, channelId, 'still here?')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('a space viewer receives messages but cannot post or reply over the socket', async () => {
    const key = `RV${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
    const made = await rest('ann', 'POST', '/spaces', { key, name: `Space ${key}`, visibility: 'open' });
    const spaceId = made.json().id as string;
    const channelId = (await rest('ann', 'GET', `/spaces/${spaceId}/channel`)).json().channel.id as string;
    const cy = await ready(client(slug, c.cy));
    const a = await ready(client(slug, c.ann));
    const added = next(cy, 'channel:membership');
    await rest('ann', 'POST', `/spaces/${spaceId}/members`, {
      members: [{ type: 'user', id: u.cy!.id, role: 'viewer' }],
    });
    await added;
    const heard = record(cy, 'message:new');
    const sent = await send(a, channelId, 'for the viewers too');
    expect(sent).toMatchObject({ ok: true });
    await quiet(300);
    expect(heard.map((m) => m.bodyText)).toContain('for the viewers too');
    expect(await send(cy, channelId, 'can I?')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const rootId = (sent as { ok: true; data: Json }).data.message.id as string;
    const reply = await emit(cy, 'message:send', {
      channelId,
      clientMsgId: msgId(),
      body: doc('reply?'),
      threadRootId: rootId,
    });
    expect(reply).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
