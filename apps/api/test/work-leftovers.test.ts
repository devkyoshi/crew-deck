import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextDigestTime } from '../src/work/notify.js';
import { S3Driver, type S3Like } from '../src/storage/index.js';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json) =>
  call({ method, url, slug: 'acme', cookie, payload });

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['member', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`lo-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
});

const key = () => `L${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
async function space(boardType: 'kanban' | 'scrum') {
  const res = await send('POST', '/spaces', c.owner!, {
    key: key(),
    name: 'Leftovers',
    boardType,
    members: [{ type: 'user', id: u.member!.id, role: 'member' }],
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
}
const item = async (sp: Json, body: Json = {}) => {
  const res = await send('POST', `/spaces/${sp.id}/items`, c.member!, { type: 'story', title: 'Story', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};

describe('backlog order', () => {
  it('saves a hand-made order inside the backlog and a sprint, and refuses strangers', async () => {
    const sp = await space('scrum');
    const [a, b, d] = [await item(sp, { title: 'A' }), await item(sp, { title: 'B' }), await item(sp, { title: 'D' })];
    const titles = async () =>
      ((await send('GET', `/spaces/${sp.id}/backlog`, c.member!)).json().backlog.items as Json[]).map((i) => i.title);
    expect(await titles()).toEqual(['A', 'B', 'D']);

    const put = (sprintId: string | null, order: string[]) =>
      send('PUT', `/spaces/${sp.id}/backlog/order`, c.member!, { sprintId, ids: order });
    expect((await put(null, [d.id, a.id, b.id])).statusCode).toBe(200);
    expect(await titles()).toEqual(['D', 'A', 'B']);

    // A new item joins at the end, after the hand-ordered ones.
    await item(sp, { title: 'E' });
    expect(await titles()).toEqual(['D', 'A', 'B', 'E']);

    // Items that are not in that list are refused.
    const sprint = (await send('POST', `/spaces/${sp.id}/sprints`, c.member!, {})).json();
    expect((await put(sprint.id, [a.id])).statusCode).toBe(422);
    // Kanban spaces have no backlog to order.
    const kanban = await space('kanban');
    const k = await item(kanban);
    const res = await send('PUT', `/spaces/${kanban.id}/backlog/order`, c.member!, { sprintId: null, ids: [k.id] });
    expect(res.statusCode).toBe(422);
  });
});

describe('search', () => {
  it('finds an item by what its comments say, and forgets deleted comments', async () => {
    const sp = await space('kanban');
    const it = await item(sp, { title: 'Quiet item' });
    const find = async (q: string) =>
      ((await send('GET', `/search?q=${encodeURIComponent(q)}`, c.member!)).json().items as Json[]).map((i) => i.key);
    expect(await find('pomegranate')).not.toContain(it.key);
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We should buy a pomegranate' }] }] };
    const comment = await send('POST', `/items/${it.id}/comments`, c.member!, { body: doc });
    expect(comment.statusCode, comment.body).toBe(200);
    expect(await find('pomegranate')).toContain(it.key);
    expect((await send('DELETE', `/comments/${comment.json().id}`, c.member!)).statusCode).toBe(200);
    expect(await find('pomegranate')).not.toContain(it.key);
  });
});

describe('moved items', () => {
  it('keep answering to their old key', async () => {
    const from = await space('kanban');
    const to = await space('kanban');
    const it = await item(from);
    const moved = (await send('POST', `/items/${it.id}/transfer`, c.member!, { spaceId: to.id })).json();
    const old = await send('GET', `/items/${it.key}`, c.member!);
    expect(old.statusCode).toBe(200);
    expect(old.json()).toMatchObject({ id: it.id, key: moved.key });
  });
});

describe('daily summary', () => {
  it('is a saved preference and sets the next send time to the morning in the person timezone', async () => {
    const before = (await send('GET', '/me/notification-preferences', c.member!)).json();
    expect(before.digest).toBe(false);
    const on = await send('PUT', '/me/notification-preferences', c.member!, { digest: true });
    expect(on.json().digest).toBe(true);
    // Changing a channel keeps the summary on.
    const kept = await send('PUT', '/me/notification-preferences', c.member!, {
      preferences: { commented: { inApp: true, email: true } },
    });
    expect(kept.json().digest).toBe(true);

    // 08:00 in Colombo (UTC+5:30) is 02:30 UTC. Before that time it is the same day, after it the next day.
    expect(nextDigestTime(new Date('2026-03-10T01:30:00Z'), 'Asia/Colombo').toISOString()).toBe('2026-03-10T02:30:00.000Z');
    expect(nextDigestTime(new Date('2026-03-10T04:00:00Z'), 'Asia/Colombo').toISOString()).toBe('2026-03-11T02:30:00.000Z');
  });
});

describe('S3 driver', () => {
  const part = () => '00000000-0000-0000-0000-000000000000';
  const KEY = [part(), part(), part(), part()].join('/');
  function fake() {
    const store = new Map<string, Buffer>();
    const client: S3Like = {
      async upload({ Key, Body }) {
        const chunks: Buffer[] = [];
        for await (const chunk of Body) chunks.push(Buffer.from(chunk));
        store.set(Key, Buffer.concat(chunks));
      },
      async download({ Key }) {
        const b = store.get(Key);
        if (!b) throw new Error('NoSuchKey');
        return Readable.from([b]);
      },
      async remove({ Key }) {
        store.delete(Key);
      },
    };
    return { store, client };
  }

  it('writes, reads and deletes under the prefix, and counts the bytes', async () => {
    const { store, client } = fake();
    const driver = new S3Driver(client, 'bucket', 'files/');
    const bytes = await driver.put(KEY, Readable.from([Buffer.from('hello '), Buffer.from('world')]));
    expect(bytes).toBe(11);
    expect([...store.keys()]).toEqual([`files/${KEY}`]);
    const out: Buffer[] = [];
    for await (const chunk of driver.get(KEY)) out.push(Buffer.from(chunk));
    expect(Buffer.concat(out).toString()).toBe('hello world');
    await driver.delete(KEY);
    expect(store.size).toBe(0);
  });

  it('refuses odd keys and surfaces a failed read', async () => {
    const { client } = fake();
    const driver = new S3Driver(client, 'bucket');
    await expect(driver.put('../../etc/passwd', Readable.from(['x']))).rejects.toThrow('invalid key');
    await expect(
      (async () => {
        for await (const chunk of driver.get(KEY)) void chunk;
      })(),
    ).rejects.toThrow('NoSuchKey');
  });
});
