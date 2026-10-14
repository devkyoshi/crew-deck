import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caller, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Space = { id: string; key: string };

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
let space: Space;
let openSpace: Space;

let seq = 0;
const newKey = () => `D${Math.random().toString(36).slice(2, 6).toUpperCase()}${seq++ % 10}`;

const send = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie: string,
  payload?: Json,
  slug = 'acme',
) => call({ method, url, slug, cookie, payload });

async function mkSpace(extra: Json = {}, cookie = c.owner!, slug = 'acme'): Promise<Space> {
  const res = await send('POST', '/spaces', cookie, { key: newKey(), name: 'Depth', ...extra }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const mkItem = async (sp: Space, cookie = c.owner!, body: Json = {}, slug = 'acme') => {
  const res = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'Do it', ...body }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};

const patchItem = (item: Json, cookie: string, payload: Json) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/v1/items/${item.id}`,
    headers: { host: 'acme.localhost:3000', 'if-match': item.updatedAt },
    cookies: { cd_session: cookie },
    payload,
  });

const doc = (...parts: Json[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: parts }] });
const text = (s: string) => ({ type: 'text', text: s });
const mention = (id: string, label = 'someone') => ({ type: 'mention', attrs: { id, label } });

const activity = async (item: Json, cookie = c.owner!): Promise<Json[]> => {
  const res = await send('GET', `/items/${item.id}/activity`, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items;
};

beforeAll(async () => {
  ids = await tenantIds();
  const mk = (name: string, role: 'owner' | 'admin' | 'member' = 'member') =>
    ensureUser({ orgId: ids.acme, email: uniqueEmail(`wd-${name}`), role });
  for (const [name, role] of [
    ['owner', 'owner'],
    ['sadmin', 'member'],
    ['member', 'member'],
    ['other', 'member'],
    ['viewer', 'member'],
    ['outsider', 'member'],
  ] as const) {
    u[name] = await mk(name, role);
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.globex = await ensureUser({ orgId: ids.globex, email: uniqueEmail('wd-gx', 'globex.test'), role: 'owner' });
  c.globex = await signInAs(t.app, 'globex', u.globex);
  space = await mkSpace({
    visibility: 'private',
    members: [
      { type: 'user', id: u.sadmin!.id, role: 'admin' },
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.other!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
  // Open to everyone; the outsider works here but not in the private space.
  openSpace = await mkSpace({
    members: [
      { type: 'user', id: u.outsider!.id, role: 'member' },
      { type: 'user', id: u.member!.id, role: 'member' },
    ],
  });
});

describe('comments', () => {
  it('members comment, everyone who can see the item reads them, oldest first', async () => {
    const item = await mkItem(space);
    const a = await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(text('First')) });
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json().author.id).toBe(u.member!.id);
    expect(a.json().permissions).toEqual({ edit: true, delete: true });
    await send('POST', `/items/${item.key}/comments`, c.sadmin!, { body: doc(text('Second')) });

    const list = await send('GET', `/items/${item.id}/comments`, c.viewer!);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((x: Json) => x.body.content[0].content[0].text)).toEqual(['First', 'Second']);
    expect(list.json().permissions.create).toBe(false);
    expect(list.json().items[0].permissions).toEqual({ edit: false, delete: false });
  });

  it('viewers cannot comment and people outside a private space get a 404', async () => {
    const item = await mkItem(space);
    expect((await send('POST', `/items/${item.id}/comments`, c.viewer!, { body: doc(text('x')) })).statusCode).toBe(403);
    expect((await send('POST', `/items/${item.id}/comments`, c.outsider!, { body: doc(text('x')) })).statusCode).toBe(404);
    expect((await send('GET', `/items/${item.id}/comments`, c.outsider!)).statusCode).toBe(404);
    expect((await send('GET', `/items/${item.id}/comments`, c.globex!, undefined, 'globex')).statusCode).toBe(404);
  });

  it('only the author edits; the author or a space admin deletes, leaving a marker', async () => {
    const item = await mkItem(space);
    const made = (await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(text('Draft')) })).json();
    expect((await send('PATCH', `/comments/${made.id}`, c.other!, { body: doc(text('Hijack')) })).statusCode).toBe(403);
    expect((await send('PATCH', `/comments/${made.id}`, c.sadmin!, { body: doc(text('Hijack')) })).statusCode).toBe(403);
    const edited = await send('PATCH', `/comments/${made.id}`, c.member!, { body: doc(text('Final')) });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().editedAt).not.toBeNull();

    expect((await send('DELETE', `/comments/${made.id}`, c.other!)).statusCode).toBe(403);
    expect((await send('DELETE', `/comments/${made.id}`, c.sadmin!)).statusCode).toBe(200);
    const [gone] = (await send('GET', `/items/${item.id}/comments`, c.member!)).json().items;
    expect(gone).toMatchObject({ deleted: true, body: null });
    expect((await send('DELETE', `/comments/${made.id}`, c.member!)).statusCode).toBe(404);
  });

  it('comments of another workspace are invisible', async () => {
    const item = await mkItem(space);
    const made = (await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(text('Ours')) })).json();
    expect((await send('PATCH', `/comments/${made.id}`, c.globex!, { body: doc(text('x')) }, 'globex')).statusCode).toBe(404);
    expect((await send('DELETE', `/comments/${made.id}`, c.globex!, undefined, 'globex')).statusCode).toBe(404);
  });

  it('rebuilds rich text from an allow-list and refuses empty or unknown content', async () => {
    const item = await mkItem(space);
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)' },
          content: [
            { type: 'text', text: 'safe', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
      ],
    };
    const res = await send('POST', `/items/${item.id}/comments`, c.member!, { body });
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json().body.content[0];
    expect(p.attrs).toBeUndefined();
    expect(p.content[1].marks).toBeUndefined();
    expect(p.content[0].marks).toEqual([{ type: 'bold' }]);

    const bad = await send('POST', `/items/${item.id}/comments`, c.member!, {
      body: { type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://evil.test' } }] },
    });
    expect(bad.statusCode).toBe(422);
    const empty = await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc() });
    expect(empty.statusCode).toBe(422);
  });

  it('mentions only people who can open the space, and makes them watchers', async () => {
    const item = await mkItem(space, c.member!);
    const no = await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(text('hi '), mention(u.outsider!.id)) });
    expect(no.statusCode).toBe(422);
    expect(no.json().code).toBe('invalid_mention');
    const gx = await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(mention(u.globex!.id)) });
    expect(gx.statusCode).toBe(422);

    const ok = await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(text('hi '), mention(u.viewer!.id)) });
    expect(ok.statusCode, ok.body).toBe(200);
    const w = (await send('GET', `/items/${item.id}/watchers`, c.viewer!)).json();
    expect(w.watching).toBe(true);
    expect(w.items.map((p: Json) => p.id)).toEqual(expect.arrayContaining([u.member!.id, u.viewer!.id]));
  });
});

describe('watchers', () => {
  it('the reporter and assignee watch automatically; anyone who can see the item can watch or stop', async () => {
    const item = await mkItem(space, c.member!, { assigneeId: u.other!.id });
    let w = (await send('GET', `/items/${item.id}/watchers`, c.owner!)).json();
    expect(w.items.map((p: Json) => p.id).sort()).toEqual([u.member!.id, u.other!.id].sort());
    expect(w.watching).toBe(false);

    expect((await send('PUT', `/items/${item.id}/watch`, c.viewer!)).json()).toEqual({ watching: true });
    expect((await send('PUT', `/items/${item.id}/watch`, c.viewer!)).statusCode).toBe(200);
    w = (await send('GET', `/items/${item.id}/watchers`, c.viewer!)).json();
    expect(w.watching).toBe(true);
    expect(w.items).toHaveLength(3);
    expect((await send('DELETE', `/items/${item.id}/watch`, c.viewer!)).json()).toEqual({ watching: false });
    expect((await send('PUT', `/items/${item.id}/watch`, c.outsider!)).statusCode).toBe(404);

    // Assigning someone later makes them a watcher too.
    const res = await patchItem(item, c.member!, { assigneeId: u.sadmin!.id });
    expect(res.statusCode, res.body).toBe(200);
    w = (await send('GET', `/items/${item.id}/watchers`, c.owner!)).json();
    expect(w.items.map((p: Json) => p.id)).toContain(u.sadmin!.id);
  });
});

describe('links', () => {
  it('links two items, shows both ends, refuses duplicates and self links, and unlinks', async () => {
    const a = await mkItem(space, c.member!, { title: 'A' });
    const b = await mkItem(space, c.member!, { title: 'B' });
    const res = await send('POST', `/items/${a.id}/links`, c.member!, { target: b.key, linkType: 'blocks' });
    expect(res.statusCode, res.body).toBe(200);

    const fromA = (await send('GET', `/items/${a.id}/links`, c.viewer!)).json();
    expect(fromA.items).toEqual([expect.objectContaining({ label: 'blocks', direction: 'outward', item: expect.objectContaining({ key: b.key }) })]);
    expect(fromA.permissions.create).toBe(false);
    const fromB = (await send('GET', `/items/${b.id}/links`, c.member!)).json();
    expect(fromB.items[0]).toMatchObject({ label: 'is blocked by', direction: 'inward' });

    expect((await send('POST', `/items/${a.id}/links`, c.member!, { target: b.id, linkType: 'blocks' })).statusCode).toBe(409);
    expect((await send('POST', `/items/${a.id}/links`, c.member!, { target: a.id, linkType: 'relates_to' })).statusCode).toBe(422);
    await send('POST', `/items/${a.id}/links`, c.member!, { target: b.id, linkType: 'relates_to' });
    expect((await send('POST', `/items/${b.id}/links`, c.member!, { target: a.id, linkType: 'relates_to' })).statusCode).toBe(409);

    expect((await send('POST', `/items/${a.id}/links`, c.viewer!, { target: b.id, linkType: 'duplicates' })).statusCode).toBe(403);
    expect((await send('DELETE', `/links/${res.json().id}`, c.viewer!)).statusCode).toBe(403);
    expect((await send('DELETE', `/links/${res.json().id}`, c.outsider!)).statusCode).toBe(404);
    expect((await send('DELETE', `/links/${res.json().id}`, c.member!)).statusCode).toBe(200);
    expect((await send('GET', `/items/${a.id}/links`, c.member!)).json().items).toHaveLength(1);
  });

  it('cannot reach items in another workspace or spaces the caller cannot open, and hides them in lists', async () => {
    const mine = await mkItem(openSpace, c.outsider!);
    const hidden = await mkItem(space, c.member!);
    const gx = await mkItem(await mkSpace({}, c.globex!, 'globex'), c.globex!, {}, 'globex');
    expect((await send('POST', `/items/${mine.id}/links`, c.outsider!, { target: hidden.id, linkType: 'relates_to' })).statusCode).toBe(422);
    expect((await send('POST', `/items/${mine.id}/links`, c.outsider!, { target: gx.id, linkType: 'relates_to' })).statusCode).toBe(422);

    // A member of both spaces links them; the outsider sees the open end without the hidden item.
    expect((await send('POST', `/items/${hidden.id}/links`, c.member!, { target: mine.id, linkType: 'relates_to' })).statusCode).toBe(200);
    expect((await send('GET', `/items/${mine.id}/links`, c.outsider!)).json().items).toEqual([]);
    expect((await send('GET', `/items/${mine.id}/links`, c.member!)).json().items).toHaveLength(1);
  });
});

describe('activity', () => {
  it('records creation, each changed field, moves, comments and links, newest first', async () => {
    const item = await mkItem(space, c.member!, { title: 'Original' });
    const statuses = (await send('GET', `/spaces/${space.id}/statuses`, c.owner!)).json().items as Json[];
    const doing = statuses.find((s) => s.name === 'In Progress')!;
    const patched = await patchItem(item, c.member!, { title: 'Renamed', priority: 'high' });
    expect(patched.statusCode, patched.body).toBe(200);
    const moved = await t.app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/move`,
      headers: { host: 'acme.localhost:3000', 'if-match': patched.json().updatedAt },
      cookies: { cd_session: c.member! },
      payload: { statusId: doing.id },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    await send('POST', `/items/${item.id}/comments`, c.member!, { body: doc(text('Looks good')) });

    const events = await activity(item, c.viewer!);
    const summary = events.map((e) => [e.kind, e.field]);
    expect(summary).toEqual(
      expect.arrayContaining([
        ['created', null],
        ['updated', 'title'],
        ['updated', 'priority'],
        ['moved', 'status'],
        ['commented', null],
      ]),
    );
    expect(summary[0]).toEqual(['commented', null]);
    expect(summary.at(-1)).toEqual(['created', null]);
    const title = events.find((e) => e.field === 'title')!;
    expect(title).toMatchObject({ oldValue: 'Original', newValue: 'Renamed', actor: { id: u.member!.id } });
    expect(events.find((e) => e.kind === 'moved')!.newValue).toMatchObject({ name: 'In Progress' });
  });

  it('records bulk changes and is hidden from people who cannot see the item', async () => {
    const item = await mkItem(space, c.member!);
    const res = await send('POST', '/items/bulk', c.member!, { action: 'assign', ids: [item.id], assigneeId: u.other!.id });
    expect(res.statusCode, res.body).toBe(200);
    const events = await activity(item);
    expect(events[0]).toMatchObject({ kind: 'updated', field: 'assignee', newValue: { id: u.other!.id } });
    expect((await send('GET', `/items/${item.id}/activity`, c.outsider!)).statusCode).toBe(404);
    expect((await send('GET', `/items/${item.id}/activity`, c.globex!, undefined, 'globex')).statusCode).toBe(404);
  });

  it('pages with a cursor', async () => {
    const item = await mkItem(space, c.member!);
    for (const p of ['high', 'low', 'highest'] as const) {
      const fresh = (await send('GET', `/items/${item.id}`, c.member!)).json();
      expect((await patchItem(fresh, c.member!, { priority: p })).statusCode).toBe(200);
    }
    const first = (await send('GET', `/items/${item.id}/activity?limit=2`, c.member!)).json();
    expect(first.items).toHaveLength(2);
    const next = (await send('GET', `/items/${item.id}/activity?limit=2&cursor=${first.nextCursor}`, c.member!)).json();
    expect(next.items).toHaveLength(2);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map((e: Json) => e.id)).size).toBe(4);
  });
});

describe('rich descriptions', () => {
  it('accepts a document, returns it with the plain text, and validates mentions in it', async () => {
    const item = await mkItem(space, c.member!, {
      descriptionDoc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [text('Scope')] }] },
    });
    expect(item.description).toBe('Scope');
    expect(item.descriptionDoc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });

    const bad = await patchItem(item, c.member!, { descriptionDoc: doc(mention(u.outsider!.id)) });
    expect(bad.statusCode).toBe(422);
    const ok = await patchItem(item, c.member!, { descriptionDoc: doc(text('Ask '), mention(u.viewer!.id, 'Viewer')) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().description).toBe('Ask @Viewer');
    const w = (await send('GET', `/items/${item.id}/watchers`, c.viewer!)).json();
    expect(w.watching).toBe(true);

    // Plain text still works for older clients.
    const plain = await patchItem(ok.json(), c.member!, { description: 'Line one\nLine two' });
    expect(plain.json().descriptionDoc.content).toHaveLength(2);
  });
});
