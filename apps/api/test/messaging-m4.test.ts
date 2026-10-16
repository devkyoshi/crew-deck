import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../src/messaging/events.js';
import { describeGroup, flushActivity } from '../src/messaging/activity-bot.js';
import { parseDuration } from '../src/messaging/commands.js';
import { itemKeysIn } from '../src/messaging/item-links.js';
import { reconcileOrg } from '../src/messaging/space-channels.js';
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
/** Waits for the background syncs and follow-ups started so far. */
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
let n = 0;
const cid = () => `m4-${Date.now()}-${n++}`;
const say = (s: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }],
});
const post = (who: string, channelId: string, text: string) =>
  api(who, 'POST', `/channels/${channelId}/messages`, { clientMsgId: cid(), body: say(text) });

let keySeq = 0;
const spaceKey = () => `X${(Date.now() % 100000).toString(36).toUpperCase()}${keySeq++}`.slice(0, 10);
const mkSpace = async (
  who: string,
  extra: Json = {},
): Promise<{ id: string; key: string }> => {
  const key = spaceKey();
  const res = await api(who, 'POST', '/spaces', { key, name: `Space ${key}`, ...extra });
  expect(res.statusCode, res.body).toBe(200);
  await flush();
  return { id: res.json().id as string, key };
};
const spaceChannel = async (who: string, space: { id: string }) => {
  const res = await api(who, 'GET', `/spaces/${space.id}/channel`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().channel as Json;
};
const memberIds = async (who: string, channelId: string) =>
  ((await api(who, 'GET', `/channels/${channelId}/members`)).json().members as Json[]).map(
    (m) => m.userId as string,
  );
const addToSpace = async (
  who: string,
  space: { id: string },
  type: 'user' | 'group',
  id: string,
  role: 'admin' | 'member' | 'viewer',
) => {
  const res = await api(who, 'POST', `/spaces/${space.id}/members`, { members: [{ type, id, role }] });
  expect(res.statusCode, res.body).toBeLessThan(300);
  await flush();
};
const spaceRow = async (who: string, space: { id: string }, principalId: string) =>
  ((await api(who, 'GET', `/spaces/${space.id}/members?pageSize=100`)).json().items as Json[]).find(
    (m) => m.principalId === principalId,
  );

beforeAll(async () => {
  await t.app.ready();
  const org = await createOrg('m4');
  slug = org.slug;
  orgId = org.org.id;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const name of ['ann', 'bob', 'cy', 'dee']) {
    u[name] = await ensureUser({
      orgId,
      email: uniqueEmail(`m4-${name}`, `${slug}.test`),
      role: 'member',
    });
    c[name] = await signInAs(t.app, slug, u[name]);
    await api(name, 'GET', '/channels');
  }
  await api('owner', 'GET', '/channels');
});

describe('space channels', () => {
  it('creates one channel per space, named after its key, public for open spaces', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    expect(ch.name).toBe(s.key.toLowerCase());
    expect(ch.type).toBe('public');
    expect(ch.spaceId).toBe(s.id);
    const again = await spaceChannel('ann', s);
    expect(again.id).toBe(ch.id);
    // The space can be addressed by its key as well as its id (the web app uses the key).
    const byKey = await api('ann', 'GET', `/spaces/${s.key}/channel`);
    expect(byKey.json().channel.id).toBe(ch.id);
    // The creator is a space admin, so they own the channel.
    const mine = (await api('ann', 'GET', '/channels')).json().channels as Json[];
    expect(mine.find((x) => x.id === ch.id)?.role).toBe('owner');
  });

  it('puts people in as they are added to the space, and takes them out when removed', async () => {
    const s = await mkSpace('ann', { visibility: 'private' });
    const ch = await spaceChannel('ann', s);
    expect(ch.type).toBe('private');
    // Bob cannot even see a private space's channel.
    expect((await api('bob', 'GET', `/spaces/${s.id}/channel`)).statusCode).toBe(404);
    expect((await api('bob', 'GET', `/channels/${ch.id}`)).statusCode).toBe(404);

    await addToSpace('ann', s, 'user', u.bob!.id, 'member');
    expect(await memberIds('ann', ch.id)).toContain(u.bob!.id);
    expect((await api('bob', 'GET', `/channels/${ch.id}`)).statusCode).toBe(200);
    expect((await post('bob', ch.id, 'hello space')).statusCode).toBe(201);

    const row = await spaceRow('ann', s, u.bob!.id);
    const del = await api('ann', 'DELETE', `/spaces/${s.id}/members/${row!.id}`);
    expect(del.statusCode, del.body).toBeLessThan(300);
    await flush();
    expect(await memberIds('ann', ch.id)).not.toContain(u.bob!.id);
    // Access is gone at once: the channel is not there for them any more.
    expect((await api('bob', 'GET', `/channels/${ch.id}`)).statusCode).toBe(404);
    expect((await post('bob', ch.id, 'still here?')).statusCode).toBe(404);
  });

  it('follows groups: joining or leaving the group changes the channel', async () => {
    const s = await mkSpace('ann', { visibility: 'private' });
    const ch = await spaceChannel('ann', s);
    const g = (await api('owner', 'POST', '/groups', { name: `G ${s.key}` })).json();
    await api('owner', 'PUT', `/groups/${g.id}/members`, { userIds: [u.cy!.id] });
    await addToSpace('ann', s, 'group', g.id, 'member');
    expect(await memberIds('ann', ch.id)).toContain(u.cy!.id);

    await api('owner', 'PUT', `/groups/${g.id}/members`, { userIds: [u.cy!.id, u.dee!.id] });
    await flush();
    expect(await memberIds('ann', ch.id)).toContain(u.dee!.id);

    await api('owner', 'PUT', `/groups/${g.id}/members`, { userIds: [u.dee!.id] });
    await flush();
    const ids = await memberIds('ann', ch.id);
    expect(ids).toContain(u.dee!.id);
    expect(ids).not.toContain(u.cy!.id);

    // Someone with a direct role who is also in the group stays when the group goes.
    await addToSpace('ann', s, 'user', u.dee!.id, 'member');
    await api('owner', 'DELETE', `/groups/${g.id}`);
    await flush();
    expect(await memberIds('ann', ch.id)).toContain(u.dee!.id);
  });

  it('lets viewers read but not post or reply, and admins own the channel', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    await addToSpace('ann', s, 'user', u.bob!.id, 'viewer');
    await addToSpace('ann', s, 'user', u.cy!.id, 'member');
    const first = await post('cy', ch.id, 'status update');
    expect(first.statusCode).toBe(201);

    const read = await api('bob', 'GET', `/channels/${ch.id}/messages`);
    expect(read.statusCode).toBe(200);
    expect(read.json().messages.length).toBeGreaterThan(0);
    const denied = await post('bob', ch.id, 'can I talk?');
    expect(denied.statusCode).toBe(403);
    const rootId = first.json().message.id as string;
    const reply = await api('bob', 'POST', `/messages/${rootId}/replies`, {
      clientMsgId: cid(),
      body: say('nope'),
    });
    expect(reply.statusCode).toBe(403);
    expect((await api('bob', 'GET', `/channels/${ch.id}`)).json().channel.readOnly).toBe(true);
    expect((await api('cy', 'GET', `/channels/${ch.id}`)).json().channel.readOnly).toBe(false);

    // Promoting the viewer lets them post.
    const row = await spaceRow('ann', s, u.bob!.id);
    await api('ann', 'PATCH', `/spaces/${s.id}/members/${row!.id}`, { role: 'member' });
    await flush();
    expect((await post('bob', ch.id, 'now I can')).statusCode).toBe(201);
  });

  it('cannot be left, edited by hand, renamed or archived on its own', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    await addToSpace('ann', s, 'user', u.cy!.id, 'member');
    const leave = await api('cy', 'DELETE', `/channels/${ch.id}/members/${u.cy!.id}`);
    expect(leave.statusCode).toBe(409);
    expect(leave.json().error?.code ?? leave.json().code).toBe('space_channel');
    expect((await api('ann', 'POST', `/channels/${ch.id}/members`, { userIds: [u.dee!.id] })).statusCode).toBe(409);
    expect((await api('ann', 'PATCH', `/channels/${ch.id}`, { name: 'renamed' })).statusCode).toBe(409);
    expect((await api('ann', 'POST', `/channels/${ch.id}/archive`)).statusCode).toBe(409);
    // They can mute it instead.
    expect(
      (await api('cy', 'PATCH', `/channels/${ch.id}/me`, { notificationLevel: 'none' })).statusCode,
    ).toBeLessThan(300);
  });

  it('follows the space: visibility and archiving', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    expect(ch.type).toBe('public');
    await addToSpace('ann', s, 'user', u.cy!.id, 'member');

    const priv = await api('ann', 'PATCH', `/spaces/${s.id}`, { visibility: 'private' });
    expect(priv.statusCode, priv.body).toBeLessThan(300);
    await flush();
    expect((await spaceChannel('ann', s)).type).toBe('private');
    // Bob has no role: the private channel disappears for him.
    expect((await api('bob', 'GET', `/channels/${ch.id}`)).statusCode).toBe(404);

    const arch = await api('ann', 'POST', `/spaces/${s.id}/archive`);
    expect(arch.statusCode, arch.body).toBeLessThan(300);
    await flush();
    expect((await spaceChannel('ann', s)).isArchived).toBe(true);
    expect((await post('cy', ch.id, 'late')).statusCode).toBe(409);
    // Still readable and still has its members.
    expect((await api('cy', 'GET', `/channels/${ch.id}/messages`)).statusCode).toBe(200);
    expect(await memberIds('ann', ch.id)).toContain(u.cy!.id);

    await api('ann', 'POST', `/spaces/${s.id}/restore`);
    await flush();
    expect((await spaceChannel('ann', s)).isArchived).toBe(false);
  });

  it('writes audit entries for sync-driven changes with the space as the cause', async () => {
    const s = await mkSpace('ann', { visibility: 'private' });
    const ch = await spaceChannel('ann', s);
    await addToSpace('ann', s, 'user', u.dee!.id, 'member');
    const rows = await t.db
      .tenant(orgId)
      .auditLogs.find({ targetId: ch.id, action: 'channel.member_added' });
    const dee = rows.find((r) => (r.after as Json)?.userId === u.dee!.id);
    expect(dee).toBeTruthy();
    expect((dee!.after as Json).cause).toMatchObject({ type: 'space', id: s.id });
    expect(dee!.actorId).toBeNull();
  });

  it('the nightly repair fixes drift without any event', async () => {
    const s = await mkSpace('ann', { visibility: 'private' });
    const ch = await spaceChannel('ann', s);
    // Change the space behind the app's back: one person added, one channel member who has no role.
    const tdb = t.db.tenant(orgId);
    await tdb.spaceMembers.insert({
      spaceId: s.id,
      principalType: 'user',
      principalId: u.cy!.id,
      spaceRole: 'member',
    });
    await tdb.channelMembers.insert({ channelId: ch.id, userId: u.dee!.id, role: 'member' });
    const result = await reconcileOrg({ db: t.db, events }, orgId);
    expect(result.added).toBeGreaterThanOrEqual(1);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    const ids = await memberIds('ann', ch.id);
    expect(ids).toContain(u.cy!.id);
    expect(ids).not.toContain(u.dee!.id);
    // Running it again changes nothing.
    const again = await reconcileOrg({ db: t.db, events }, orgId);
    expect(again.added + again.removed).toBe(0);
  });

  it("does not leak: another workspace's users and spaces are unreachable", async () => {
    const other = await createOrg('m4x');
    const oc = await signInAs(t.app, other.slug, other.owner);
    const s = await mkSpace('ann');
    const res = await call({ method: 'GET', url: `/spaces/${s.id}/channel`, slug: other.slug, cookie: oc });
    expect(res.statusCode).toBe(404);
  });
});

// ---- Work item cards, create from a message, activity bot, slash commands ---------------------------------

/** PATCH an item with its current update time as If-Match. */
const patchItem = async (who: string, item: Json, payload: Json) => {
  const current = (await api(who, 'GET', `/items/${item.id}`)).json();
  return t.app.inject({
    method: 'PATCH',
    url: `/api/v1/items/${item.id}`,
    headers: { host: `${slug}.localhost:3000`, 'if-match': current.updatedAt },
    cookies: { cd_session: c[who]! },
    payload,
  });
};
const mkItem = async (who: string, space: { id: string }, title: string, extra: Json = {}) => {
  const res = await api(who, 'POST', `/spaces/${space.id}/items`, { type: 'task', title, ...extra });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json() as Json;
};
const inChannel = async (who: string, channelId: string) =>
  (await api(who, 'GET', `/channels/${channelId}/messages`)).json().messages as Json[];

describe('item keys in messages', () => {
  it('finds keys in text and in links, without repeats, and ignores the rest', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'text',
              text: 'this',
              marks: [{ type: 'link', attrs: { href: 'https://x.test/spaces/ENG/items/ENG-7' } }],
            },
          ],
        },
      ],
    };
    expect(itemKeysIn(doc, 'see ENG-142 and eng-9 and ENG-142 again, UTF-8 too')).toEqual([
      'ENG-142',
      'UTF-8',
      'ENG-7',
    ]);
    expect(itemKeysIn(null, 'no keys here')).toEqual([]);
  });
});

describe('work item cards', () => {
  it('shows a live card, and a neutral card to people without access', async () => {
    const s = await mkSpace('ann', { visibility: 'private' });
    const ch = await spaceChannel('ann', s);
    const item = await mkItem('ann', s, 'Fix the login page');
    const sent = await post('ann', ch.id, `please look at ${item.key}`);
    expect(sent.statusCode).toBe(201);
    expect(sent.json().message.workItems).toEqual([{ id: item.id, key: item.key }]);

    const card = await api('ann', 'GET', `/items/${item.key}/card`);
    expect(card.json().card).toMatchObject({
      access: true,
      key: item.key,
      title: 'Fix the login page',
      href: `/spaces/${s.key}/items/${item.key}`,
    });
    // Bob has no role in the private space: no title, no details, same as an item that does not exist.
    const hidden = await api('bob', 'GET', `/items/${item.key}/card`);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().card).toEqual({ access: false, key: item.key });
    const missing = await api('bob', 'GET', `/items/${s.key}-9999/card`);
    expect(missing.json().card).toEqual({ access: false, key: `${s.key}-9999` });

    // The card is live: after the item changes, the card says so.
    await patchItem('ann', item, { title: 'Fix login' });
    expect((await api('ann', 'GET', `/items/${item.key}/card`)).json().card.title).toBe('Fix login');
  });

  it('keeps the links in step with edits and drops them with the message', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    const a = await mkItem('ann', s, 'First');
    const b = await mkItem('ann', s, 'Second');
    const sent = await post('ann', ch.id, `${a.key} first`);
    const id = sent.json().message.id as string;
    const edited = await api('ann', 'PATCH', `/messages/${id}`, { body: say(`${b.key} instead`) });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().message.workItems.map((w: Json) => w.key)).toEqual([b.key]);
    await api('ann', 'DELETE', `/messages/${id}`);
    const rows = await t.db.tenant(orgId).messageLinks.find({ messageId: id });
    expect(rows.length).toBe(0);
  });
});

describe('create a work item from a message', () => {
  it('links the new item to the message and the bot answers in the thread with its card', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    await addToSpace('ann', s, 'user', u.cy!.id, 'member');
    const msg = await post('cy', ch.id, 'The export button is broken on Safari');
    const messageId = msg.json().message.id as string;
    // The client creates the item through the normal dialog, then ties it back to the message.
    const item = await mkItem('cy', s, 'The export button is broken on Safari');
    const linked = await api('cy', 'POST', `/messages/${messageId}/create-work-item`, {
      itemId: item.id,
    });
    expect(linked.statusCode, linked.body).toBe(201);
    expect(linked.json().item.key).toBe(item.key);

    const thread = await api('cy', 'GET', `/messages/${messageId}/replies`);
    const reply = (thread.json().replies as Json[]).find((m) => m.id === linked.json().replyId)!;
    expect(reply.kind).toBe('bot');
    expect(reply.bot).toMatchObject({ id: 'tasks' });
    expect(reply.workItems.map((w: Json) => w.key)).toEqual([item.key]);
    // The bot's words do not repeat the title, so people without access learn nothing from it.
    expect(reply.bodyText).not.toContain('export button');

    // The item remembers where it came from, for people who can open the conversation.
    const detail = await api('cy', 'GET', `/items/${item.id}`);
    expect(detail.json().createdFromMessage.href).toContain(`/messages/${ch.id}?m=`);

    // Only once, and only for your own item.
    expect(
      (await api('cy', 'POST', `/messages/${messageId}/create-work-item`, { itemId: item.id }))
        .statusCode,
    ).toBe(409);
    const other = await mkItem('ann', s, 'Not cy item');
    expect(
      (await api('cy', 'POST', `/messages/${messageId}/create-work-item`, { itemId: other.id }))
        .statusCode,
    ).toBe(403);
  });

  it('refuses a message the person cannot see', async () => {
    const priv = await mkSpace('ann', { visibility: 'private' });
    const privCh = await spaceChannel('ann', priv);
    const secret = await post('ann', privCh.id, 'secret');
    const open = await mkSpace('bob');
    const mine = await mkItem('bob', open, 'Bob item');
    const res = await api('bob', 'POST', `/messages/${secret.json().message.id}/create-work-item`, {
      itemId: mine.id,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('activity bot', () => {
  const later = () => new Date(Date.now() + 5 * 60_000);

  it('posts conservative defaults, coalesces a burst, and keeps comments off', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    const rules = await api('ann', 'GET', `/channels/${ch.id}/activity-rules`);
    expect(rules.json().eventTypes).toEqual(['item_created', 'item_done']);

    const items: Json[] = [];
    for (const n of [1, 2, 3, 4]) items.push(await mkItem('ann', s, `Burst ${n}`));
    const done = (
      (await api('ann', 'GET', `/spaces/${s.id}/statuses`)).json().items as Json[]
    ).find((x) => x.category === 'done')!;
    for (const it of items) {
      const moved = await patchItem('ann', it, { statusId: done.id });
      expect(moved.statusCode, moved.body).toBeLessThan(300);
    }
    await api('ann', 'POST', `/items/${items[0]!.id}/comments`, { body: say('a comment') });

    // Inside the 60 second window nothing is posted yet.
    expect(await flushActivity({ db: t.db, events }, orgId)).toBe(0);
    const posted = await flushActivity({ db: t.db, events }, orgId, later());
    expect(posted).toBeGreaterThanOrEqual(2);
    const bots = (await inChannel('ann', ch.id)).filter((m) => m.kind === 'bot');
    const text = bots.map((m) => m.bodyText as string);
    expect(text.some((x) => x.includes('created 4 work items'))).toBe(true);
    expect(text.some((x) => x.startsWith('4 items moved to Done'))).toBe(true);
    expect(text.join(' ')).not.toContain('commented');
    expect(bots[0]!.workItems.length).toBeGreaterThan(0);
    // Posted once only.
    expect(await flushActivity({ db: t.db, events }, orgId, later())).toBe(0);
  });

  it('only space admins change the rules, and a changed rule is used', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    await addToSpace('ann', s, 'user', u.bob!.id, 'member');
    const denied = await api('bob', 'PUT', `/channels/${ch.id}/activity-rules`, {
      eventTypes: ['item_created'],
    });
    expect(denied.statusCode).toBe(403);
    const bad = await api('ann', 'PUT', `/channels/${ch.id}/activity-rules`, {
      eventTypes: ['nonsense'],
    });
    expect(bad.statusCode).toBe(422);
    const ok = await api('ann', 'PUT', `/channels/${ch.id}/activity-rules`, {
      eventTypes: ['comment_added'],
    });
    expect(ok.json().eventTypes).toEqual(['comment_added']);

    const it = await mkItem('ann', s, 'Quiet creation');
    await api('ann', 'POST', `/items/${it.id}/comments`, { body: say('hello') });
    await flushActivity({ db: t.db, events }, orgId, later());
    const text = (await inChannel('ann', ch.id))
      .filter((m) => m.kind === 'bot')
      .map((m) => m.bodyText as string);
    expect(text.some((x) => x.includes('commented on'))).toBe(true);
    expect(text.some((x) => x.includes('created'))).toBe(false);
  });

  it('never posts in an archived channel and is only for space channels', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    await mkItem('ann', s, 'Before archive');
    await api('ann', 'POST', `/spaces/${s.id}/archive`);
    await flush();
    expect(await flushActivity({ db: t.db, events }, orgId, later())).toBe(0);
    const general = ((await api('ann', 'GET', '/channels')).json().channels as Json[]).find(
      (c) => c.name === 'general',
    )!;
    expect((await api('ann', 'GET', `/channels/${general.id}/activity-rules`)).statusCode).toBe(409);
    expect(describeGroup('item_done', [{ itemKey: 'A-1', detail: {} }], null)).toBe(
      'A-1 moved to Done.',
    );
    expect((await inChannel('ann', ch.id)).filter((m) => m.kind === 'bot').length).toBe(0);
  });
});

describe('slash commands', () => {
  const run = (who: string, name: string, args = '', channelId?: string) =>
    api(who, 'POST', '/commands/execute', { name, args, channelId });

  it('lists the commands and refuses unknown ones', async () => {
    const res = await api('ann', 'GET', '/commands');
    const names = (res.json().commands as Json[]).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['task', 'status', 'dnd']));
    expect((await run('ann', 'nope')).statusCode).toBe(404);
  });

  it('/task create opens the dialog prefilled, with the space of a space channel', async () => {
    const s = await mkSpace('ann');
    const ch = await spaceChannel('ann', s);
    const res = await run('ann', 'task', 'create Fix the thing', ch.id);
    expect(res.json().result).toEqual({ kind: 'open_create', title: 'Fix the thing', spaceId: s.id });
    expect((await run('ann', 'task', 'create')).statusCode).toBe(422);
  });

  it('/task KEY shows the card and respects access; /task mine lists open work', async () => {
    const s = await mkSpace('ann', { visibility: 'private' });
    const item = await mkItem('ann', s, 'Mine to do', { assigneeId: u.ann!.id });
    const shown = (await run('ann', 'task', item.key)).json().result;
    expect(shown.kind).toBe('ephemeral');
    expect(shown.card.title).toBe('Mine to do');
    const denied = (await run('bob', 'task', item.key)).json().result;
    expect(denied.card).toBeUndefined();
    expect(denied.text).not.toContain('Mine to do');
    const mine = (await run('ann', 'task', 'mine')).json().result;
    expect(mine.cards.map((c: Json) => c.key)).toContain(item.key);
    expect((await run('dee', 'task', 'mine')).json().result.text).toContain('no open');
  });

  it('/status and /dnd change my status and do-not-disturb', async () => {
    const st = await run('dee', 'status', '🎧 Heads down');
    expect(st.statusCode, st.body).toBe(200);
    const row = await t.db.tenant(orgId).userStatuses.findOne({ userId: u.dee!.id });
    expect(row).toMatchObject({ emoji: '🎧', text: 'Heads down' });
    await run('dee', 'status', 'clear');
    expect(
      (await t.db.tenant(orgId).userStatuses.findOne({ userId: u.dee!.id }))?.text ?? null,
    ).toBeNull();
    const dnd = await run('dee', 'dnd', '30m');
    expect(dnd.statusCode, dnd.body).toBe(200);
    expect((await run('dee', 'dnd', 'soon')).statusCode).toBe(422);
    expect((await run('dee', 'dnd', 'off')).statusCode).toBe(200);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1d')).toBe(1440);
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('9999d')).toBeNull();
  });

  it('/checkin and /checkout are offered only when check-in is on, and hand the request to the client', async () => {
    const tdb = t.db.tenant(orgId);
    const before = (await api('ann', 'GET', '/commands')).json().commands.map((c: Json) => c.name);
    expect(before).not.toContain('checkin');
    await tdb.tenantSettings.upsert({}, { checkinEnabled: true } as never);
    const names = (await api('ann', 'GET', '/commands')).json().commands.map((c: Json) => c.name);
    expect(names).toEqual(expect.arrayContaining(['checkin', 'checkout']));
    const res = (await run('ann', 'checkin', 'remote Working from home')).json().result;
    expect(res).toMatchObject({
      kind: 'call',
      path: '/checkin',
      body: { locationType: 'remote', note: 'Working from home' },
    });
    expect((await run('ann', 'checkin', 'moon')).statusCode).toBe(422);
  });
});

describe('check-in badges and the profile card', () => {
  it('shows where people work today as a status, never times', async () => {
    const tdb = t.db.tenant(orgId);
    await tdb.tenantSettings.upsert({}, { checkinEnabled: true } as never);
    const out = await api('cy', 'POST', '/checkin', { locationType: 'remote', note: 'WFH' });
    expect(out.statusCode, out.body).toBeLessThan(300);

    const presence = await api('bob', 'GET', `/presence?ids=${u.cy!.id},${u.bob!.id}`);
    const people = presence.json().people as Json[];
    expect(people.find((p) => p.id === u.cy!.id)?.checkin).toBe('remote');
    expect(people.find((p) => p.id === u.bob!.id)?.checkin).toBeNull();
    expect(presence.body).not.toMatch(/checkinAt|checkoutAt|T\d\d:\d\d/);

    const card = await api('bob', 'GET', `/people/${u.cy!.id}/card`);
    expect(card.statusCode, card.body).toBe(200);
    const person = card.json().person as Json;
    expect(person.checkin).toBe('remote');
    expect(person).toMatchObject({ id: u.cy!.id, email: u.cy!.email });
    expect(Object.keys(person)).toEqual(
      expect.arrayContaining(['name', 'jobTitle', 'timezone', 'groups', 'status', 'presence', 'openItems']),
    );
    expect(card.body).not.toMatch(/checkinAt|checkoutAt|note/);

    await api('cy', 'POST', '/checkout', {});
    const after = await api('bob', 'GET', `/presence?ids=${u.cy!.id}`);
    expect((after.json().people as Json[])[0]!.checkin).toBeNull();
  });

  it('shows nothing when the check-in module is off', async () => {
    const tdb = t.db.tenant(orgId);
    await api('cy', 'POST', '/checkin', { locationType: 'onsite' });
    await tdb.tenantSettings.upsert({}, { checkinEnabled: false } as never);
    const presence = await api('bob', 'GET', `/presence?ids=${u.cy!.id}`);
    expect((presence.json().people as Json[])[0]!.checkin).toBeNull();
    await tdb.tenantSettings.upsert({}, { checkinEnabled: true } as never);
    await api('cy', 'POST', '/checkout', {});
  });

  it("counts open work only in spaces the viewer can see and finds nobody in another workspace", async () => {
    const count = async (viewer: string) =>
      (await api(viewer, 'GET', `/people/${u.ann!.id}/card`)).json().person.openItems as number;
    const [annBefore, bobBefore] = [await count('ann'), await count('bob')];
    const s = await mkSpace('ann', { visibility: 'private' });
    await mkItem('ann', s, 'Ann only', { assigneeId: u.ann!.id });
    expect(await count('ann')).toBe(annBefore + 1);
    expect(await count('bob')).toBe(bobBefore);

    const other = await createOrg('m4y');
    const oc = await signInAs(t.app, other.slug, other.owner);
    const cross = await call({
      method: 'GET',
      url: `/people/${u.ann!.id}/card`,
      slug: other.slug,
      cookie: oc,
    });
    expect(cross.statusCode).toBe(404);
  });
});
