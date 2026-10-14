import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDb, caller, createOrg, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Space = { id: string; key: string };

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
let priv: Space;
let open: Space;
// A word nobody else's test data contains, so searches only see this file's items.
const WORD = `zebra${Math.random().toString(36).slice(2, 8)}`;

const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });

let seq = 0;
async function mkSpace(cookie: string, extra: Json = {}, slug = 'acme'): Promise<Space> {
  const key = `S${Math.random().toString(36).slice(2, 6).toUpperCase()}${seq++ % 10}`;
  const res = await send('POST', '/spaces', cookie, { key, name: 'Find', ...extra }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}
const mkItem = async (sp: Space, cookie: string, body: Json = {}, slug = 'acme') => {
  const res = await send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'task', title: 'Item', ...body }, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const search = async (q: string, cookie: string, slug = 'acme') => {
  const res = await send('GET', `/search?q=${encodeURIComponent(q)}`, cookie, undefined, slug);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items as Json[];
};

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['admin', 'admin'],
    ['member', 'member'],
    ['viewer', 'member'],
    ['outsider', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`wf-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.globex = await ensureUser({ orgId: ids.globex, email: uniqueEmail('wf-gx', 'globex.test'), role: 'owner' });
  c.globex = await signInAs(t.app, 'globex', u.globex);
  priv = await mkSpace(c.owner!, {
    visibility: 'private',
    members: [
      { type: 'user', id: u.member!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
  open = await mkSpace(c.owner!, { members: [{ type: 'user', id: u.member!.id, role: 'member' }] });
});

describe('search', () => {
  it('finds by key, by words in the title and the description, and by partial title', async () => {
    const a = await mkItem(priv, c.member!, { title: `Pour the ${WORD} slab` });
    const b = await mkItem(priv, c.member!, { title: 'Order steel', description: `Ask the ${WORD} supplier first` });
    expect((await search(a.key, c.member!)).map((i) => i.key)).toEqual([a.key]);
    expect((await search(a.key.replace('-', ' ').toLowerCase(), c.member!))[0].key).toBe(a.key);
    const words = await search(WORD, c.member!);
    expect(words.map((i) => i.key)).toEqual(expect.arrayContaining([a.key, b.key]));
    expect(words[0].key).toBe(a.key); // a title match ranks above a description match
    expect(words[0].spaceName).toBe('Find');
    const partial = await search(WORD.slice(0, 7), c.member!);
    expect(partial.map((i) => i.key)).toContain(a.key);
  });

  it('never returns other workspaces, hidden private spaces or deleted items', async () => {
    const hidden = await mkItem(priv, c.member!, { title: `Secret ${WORD} plan` });
    const visible = await mkItem(open, c.member!, { title: `Public ${WORD} plan` });
    const gone = await mkItem(open, c.member!, { title: `Deleted ${WORD} plan` });
    expect((await send('DELETE', `/items/${gone.id}`, c.member!)).statusCode).toBe(200);
    const gx = await mkItem(await mkSpace(c.globex!, {}, 'globex'), c.globex!, { title: `Globex ${WORD} plan` }, 'globex');

    const keys = async (cookie: string, slug = 'acme') => (await search(`${WORD} plan`, cookie, slug)).map((i) => i.key);
    const forOutsider = await keys(c.outsider!);
    expect(forOutsider).toContain(visible.key);
    expect(forOutsider).not.toContain(hidden.key);
    expect(forOutsider).not.toContain(gone.key);
    expect(forOutsider).not.toContain(gx.key);
    expect(await search(hidden.key, c.outsider!)).toEqual([]);

    expect(await keys(c.viewer!)).toEqual(expect.arrayContaining([hidden.key, visible.key]));
    expect(await keys(c.admin!)).toContain(hidden.key); // workspace admins see every space
    const fromGlobex = await keys(c.globex!, 'globex');
    expect(fromGlobex).toEqual([gx.key]);
  });

  it('treats a word ending in digits as a word unless a space has that key', async () => {
    const item = await mkItem(open, c.member!, { title: 'Fix the gate', description: `Part ${WORD}7 is loose` });
    expect((await search(`${WORD}7`, c.member!)).map((i) => i.key)).toContain(item.key);
  });

  it('can be narrowed to one space and one type', async () => {
    const bug = await mkItem(open, c.member!, { type: 'bug', title: `Broken ${WORD} hinge` });
    await mkItem(priv, c.member!, { type: 'bug', title: `Broken ${WORD} latch` });
    const res = await send('GET', `/search?q=${WORD}&space=${open.key}&type=bug`, c.member!);
    expect(res.json().items.map((i: Json) => i.key)).toEqual([bug.key]);
  });
});

describe('my work', () => {
  it('lists open items assigned to me across spaces, and what I reported or watch', async () => {
    const me = await ensureUser({ orgId: ids.acme, email: uniqueEmail('wf-me'), role: 'member' });
    const cookie = await signInAs(t.app, 'acme', me);
    const sp = await mkSpace(c.owner!, { members: [{ type: 'user', id: me.id, role: 'member' }] });
    const mine = await mkItem(sp, c.owner!, { title: 'Mine', assigneeId: me.id, dueDate: '2030-01-02' });
    const soon = await mkItem(sp, c.owner!, { title: 'Sooner', assigneeId: me.id, dueDate: '2030-01-01' });
    const reported = await mkItem(sp, cookie, { title: 'Reported by me' });
    await send('PUT', `/items/${reported.id}/watch`, cookie);

    const assigned = (await send('GET', '/me/items', cookie)).json().items as Json[];
    expect(assigned.map((i) => i.key)).toEqual([soon.key, mine.key]);
    const rep = (await send('GET', '/me/items?role=reported', cookie)).json().items as Json[];
    expect(rep.map((i) => i.key)).toEqual([reported.key]);
    const watching = (await send('GET', '/me/items?role=watching', cookie)).json().items as Json[];
    expect(watching.map((i) => i.key)).toContain(reported.key);
  });
});

describe('saved filters', () => {
  it('keeps personal filters private and shows shared ones to people who can open the space', async () => {
    const mine = await send('POST', '/filters', c.member!, { name: 'My bugs', query: 'type=bug&mine=1', spaceId: priv.id });
    expect(mine.statusCode, mine.body).toBe(200);
    const shared = await send('POST', '/filters', c.member!, { name: 'Team high', query: 'priority=high,highest', spaceId: priv.id, shared: true });
    expect(shared.statusCode, shared.body).toBe(200);

    const forViewer = (await send('GET', `/filters?space=${priv.key}`, c.viewer!)).json().items as Json[];
    expect(forViewer.map((f) => f.name)).toContain('Team high');
    expect(forViewer.map((f) => f.name)).not.toContain('My bugs');
    expect(forViewer.find((f) => f.name === 'Team high').canEdit).toBe(false);
    // The outsider cannot open the private space at all.
    expect((await send('GET', `/filters?space=${priv.key}`, c.outsider!)).statusCode).toBe(404);
    const anywhere = (await send('GET', '/filters', c.outsider!)).json().items as Json[];
    expect(anywhere.map((f) => f.name)).not.toContain('Team high');
    // Another workspace never sees them.
    const gx = (await send('GET', '/filters', c.globex!, undefined, 'globex')).json().items as Json[];
    expect(gx.map((f) => f.name)).not.toContain('Team high');
    expect((await send('DELETE', `/filters/${shared.json().id}`, c.globex!, undefined, 'globex')).statusCode).toBe(404);

    // Viewers keep personal filters but cannot share.
    expect((await send('POST', '/filters', c.viewer!, { name: 'v', query: '', spaceId: priv.id })).statusCode).toBe(200);
    expect((await send('POST', '/filters', c.viewer!, { name: 'v2', query: '', spaceId: priv.id, shared: true })).statusCode).toBe(403);
    // Only the owner (or an admin) changes a shared filter.
    expect((await send('DELETE', `/filters/${shared.json().id}`, c.viewer!)).statusCode).toBe(403);
    expect((await send('PATCH', `/filters/${shared.json().id}`, c.admin!, { name: 'Renamed' })).json().name).toBe('Renamed');
  });

  it('keeps only real filter keys and refuses bad values', async () => {
    const res = await send('POST', '/filters', c.member!, { name: 'x', query: 'type=bug&evil=1&q=gate' });
    expect(res.json().query).toBe('q=gate&type=bug');
    expect((await send('POST', '/filters', c.member!, { name: 'x', query: 'type=dragon' })).statusCode).toBe(422);
  });

  it('needs the shared filters plan feature to share', async () => {
    const { org, slug, owner } = await createOrg('flt');
    const admin = adminDb();
    try {
      await admin.db.global.organizations.updateOne({ id: org.id }, { planKey: 'free' });
    } finally {
      await admin.close();
    }
    const cookie = await signInAs(t.app, slug, owner);
    expect((await send('POST', '/filters', cookie, { name: 'a', query: '' }, slug)).statusCode).toBe(200);
    const locked = await send('POST', '/filters', cookie, { name: 'b', query: '', shared: true }, slug);
    expect(locked.statusCode).toBe(402);
    expect((await send('GET', '/filters', cookie, undefined, slug)).json().canShare).toBe(false);
  });
});

describe('epics', () => {
  it('lists epics with progress by count and by points', async () => {
    const sp = await mkSpace(c.owner!);
    const epic = await mkItem(sp, c.owner!, { type: 'epic', title: 'Phase 1' });
    const statuses = (await send('GET', `/spaces/${sp.id}/statuses`, c.owner!)).json().items as Json[];
    const done = statuses.find((s) => s.category === 'done')!;
    await mkItem(sp, c.owner!, { type: 'story', parentId: epic.id, estimate: 3, statusId: done.id });
    await mkItem(sp, c.owner!, { type: 'story', parentId: epic.id, estimate: 5 });
    const res = (await send('GET', `/spaces/${sp.id}/epics`, c.owner!)).json();
    expect(res.items[0]).toMatchObject({ key: epic.key, progress: { total: 2, done: 1, points: 8, donePoints: 3 } });
    expect(res.permissions.create).toBe(true);
    expect((await send('GET', `/spaces/${priv.id}/epics`, c.outsider!)).statusCode).toBe(404);
  });
});

describe('list view', () => {
  it('sorts by priority order and status order, filters, pages, and exports safe CSV', async () => {
    const sp = await mkSpace(c.owner!);
    await mkItem(sp, c.owner!, { title: 'Low one', priority: 'low' });
    await mkItem(sp, c.owner!, { title: '=HYPERLINK("http://evil")', priority: 'highest' });
    await mkItem(sp, c.owner!, { title: 'High one', priority: 'high', type: 'bug' });

    const byPriority = (await send('GET', `/spaces/${sp.id}/list?sort=priority&dir=asc`, c.owner!)).json();
    expect(byPriority.items.map((i: Json) => i.priority)).toEqual(['highest', 'high', 'low']);
    expect(byPriority.total).toBe(3);
    const bugs = (await send('GET', `/spaces/${sp.id}/list?type=bug`, c.owner!)).json();
    expect(bugs.items.map((i: Json) => i.title)).toEqual(['High one']);
    const page = (await send('GET', `/spaces/${sp.id}/list?limit=2`, c.owner!)).json();
    expect(page.items).toHaveLength(2);
    expect(page.nextOffset).toBe(2);

    const csv = await send('GET', `/spaces/${sp.id}/items.csv?sort=key&dir=asc`, c.owner!);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    // trim() also drops the byte-order mark at the start.
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toMatch(/^Key,Type,Title,Status/);
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect((await send('GET', `/spaces/${priv.id}/items.csv`, c.outsider!)).statusCode).toBe(404);
  });
});
