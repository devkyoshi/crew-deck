import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GuardedEventSink, MemoryEventSink, type EventSink } from '../src/messaging/events.js';
import { caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** A sink whose publishing is broken, as when Redis is restarting. */
class BrokenSink extends MemoryEventSink implements EventSink {
  failing = true;
  leaveAttempts = 0;
  toChannel(orgId: string, channelId: string, event: string, payload: unknown) {
    if (this.failing) throw new Error('redis is restarting');
    super.toChannel(orgId, channelId, event, payload);
  }
  toUser(orgId: string, userId: string, event: string, payload: unknown) {
    if (this.failing) throw new Error('redis is restarting');
    super.toUser(orgId, userId, event, payload);
  }
  toOrg(orgId: string, event: string, payload: unknown) {
    if (this.failing) throw new Error('redis is restarting');
    super.toOrg(orgId, event, payload);
  }
  leaveChannel(orgId: string, userId: string, channelId: string) {
    this.leaveAttempts++;
    if (this.failing) throw new Error('redis is restarting');
    super.leaveChannel(orgId, userId, channelId);
  }
}

describe('a guarded event sink', () => {
  it('drops a failed publish quietly but keeps retrying the calls that take access away', async () => {
    const inner = new BrokenSink();
    const logged: string[] = [];
    const sink = new GuardedEventSink(inner, { log: (m) => logged.push(m), retryDelaysMs: [5, 5, 5, 5] });
    expect(() => sink.toChannel('o', 'c', 'message:new', {})).not.toThrow();
    expect(() => sink.toUser('o', 'u', 'x', {})).not.toThrow();
    expect(logged.length).toBe(2);
    expect(inner.log).toEqual([]);

    // A removal that fails at first still happens once Redis is back.
    sink.leaveChannel('o', 'u', 'c');
    setTimeout(() => (inner.failing = false), 12);
    await vi.waitFor(() => expect(inner.log.some((l) => l.kind === 'leave')).toBe(true), { timeout: 2000 });
    expect(inner.leaveAttempts).toBeGreaterThan(1);

    // And gives up loudly, not silently, when it never recovers.
    const stuck = new BrokenSink();
    const msgs: string[] = [];
    const guard = new GuardedEventSink(stuck, { log: (m) => msgs.push(m), retryDelaysMs: [2, 2] });
    guard.leaveChannel('o', 'u', 'c');
    await vi.waitFor(() => expect(msgs.some((m) => m.includes('failed for good'))).toBe(true), { timeout: 2000 });
    expect(stuck.leaveAttempts).toBe(3);
  });
});

const broken = new BrokenSink();
const t = makeApp({
  events: new GuardedEventSink(broken, { log: () => undefined, retryDelaysMs: [1000] }),
  messageLimits: { userMax: 10_000, orgMax: 100_000, windowMs: 10_000 },
});
const call = caller(t.app);
afterAll(() => t.close());

let slug: string;
const c: Record<string, string> = {};
const u: Record<string, { id: string; email: string }> = {};
const api = (who: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Json) =>
  call({ method, url, slug, cookie: c[who], payload });
const doc = (s: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] });
let n = 0;
const cid = () => `m6-${Date.now()}-${n++}-abcdef`;

beforeAll(async () => {
  await t.app.ready();
  const org = await createOrg('m6');
  slug = org.slug;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const name of ['ann', 'bob']) {
    u[name] = await ensureUser({ orgId: org.org.id, email: uniqueEmail(`m6-${name}`, `${slug}.test`), role: 'member' });
    c[name] = await signInAs(t.app, slug, u[name]);
    await api(name, 'GET', '/channels');
  }
  await api('owner', 'GET', '/channels');
});

describe('when publishing fails after a change was stored', () => {
  it('still answers success, keeps the message, and lets a reconnecting client catch up', async () => {
    const general = ((await api('ann', 'GET', '/channels')).json().channels as Json[]).find((x) => x.name === 'general')!;
    broken.failing = true;
    const sent = await api('ann', 'POST', `/channels/${general.id}/messages`, { clientMsgId: cid(), body: doc('sent while the broker was down') });
    expect(sent.statusCode, sent.body).toBe(201);
    const id = sent.json().message.id as string;
    const edit = await api('ann', 'PATCH', `/messages/${id}`, { body: doc('edited while the broker was down') });
    expect(edit.statusCode, edit.body).toBe(200);
    const react = await api('bob', 'PUT', `/messages/${id}/reactions/${encodeURIComponent('👍')}`);
    expect(react.statusCode, react.body).toBeLessThan(300);
    // Nothing was published, but everything is stored, so history and the reconnect sync have it.
    expect(broken.log.filter((l) => l.event === 'message:new')).toEqual([]);
    const history = (await api('bob', 'GET', `/channels/${general.id}/messages`)).json();
    const mine = (history.messages as Json[]).find((m) => m.id === id)!;
    expect(mine.bodyText).toBe('edited while the broker was down');
    expect(mine.reactions[0]).toMatchObject({ emoji: '👍', count: 1 });
    broken.failing = false;
  });

  it('keeps a retried send safe: the same client id is one message, even all at once', async () => {
    const ch = (await api('ann', 'POST', '/channels', { name: `dupes-${Date.now().toString(36)}`, type: 'public' })).json().channel.id as string;
    const clientMsgId = cid();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api('ann', 'POST', `/channels/${ch}/messages`, { clientMsgId, body: doc('exactly once') })),
    );
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 201), results.map((r) => r.statusCode).join()).toBe(true);
    const ids = new Set(results.map((r) => r.json().message.id));
    expect(ids.size).toBe(1);
    const list = (await api('ann', 'GET', `/channels/${ch}/messages`)).json().messages as Json[];
    expect(list.filter((m) => m.bodyText === 'exactly once')).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
  });

  it('numbers concurrent messages from many senders without gaps or repeats', async () => {
    const ch = (await api('ann', 'POST', '/channels', { name: `race-${Date.now().toString(36)}`, type: 'public', memberIds: [u.bob!.id] })).json().channel.id as string;
    const res = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        api(i % 2 ? 'ann' : 'bob', 'POST', `/channels/${ch}/messages`, { clientMsgId: cid(), body: doc(`race ${i}`) }),
      ),
    );
    expect(res.every((r) => r.statusCode === 201)).toBe(true);
    const seqs = (res.map((r) => r.json().message.seq as number)).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 30 }, (_, i) => seqs[0]! + i));
  });
});
