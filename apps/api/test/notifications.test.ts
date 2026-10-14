import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flushEmailBatches, remindDueSoon } from '../src/work/notify-jobs.js';
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

const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json, slug = 'acme') =>
  call({ method, url, slug, cookie, payload });
const doc = (...parts: Json[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: parts }] });
const text = (s: string) => ({ type: 'text', text: s });
const mention = (id: string) => ({ type: 'mention', attrs: { id, label: 'x' } });

const inbox = async (who: string): Promise<Json[]> => {
  const res = await send('GET', '/notifications', c[who]!);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().items;
};
const mkItem = async (cookie: string, body: Json = {}) => {
  const res = await send('POST', `/spaces/${space.id}/items`, cookie, { type: 'task', title: 'Notify me', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
};
const patch = (item: Json, cookie: string, payload: Json) =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/v1/items/${item.id}`,
    headers: { host: 'acme.localhost:3000', 'if-match': item.updatedAt },
    cookies: { cd_session: cookie },
    payload,
  });

beforeAll(async () => {
  ids = await tenantIds();
  for (const name of ['lead', 'dev', 'qa', 'viewer', 'outsider']) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`nt-${name}`), role: 'member' });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
  u.gx = await ensureUser({ orgId: ids.globex, email: uniqueEmail('nt-gx', 'globex.test'), role: 'owner' });
  c.gx = await signInAs(t.app, 'globex', u.gx);
  const res = await send('POST', '/spaces', c.lead!, {
    key: `N${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    name: 'Notify',
    visibility: 'private',
    members: [
      { type: 'user', id: u.dev!.id, role: 'member' },
      { type: 'user', id: u.qa!.id, role: 'member' },
      { type: 'user', id: u.viewer!.id, role: 'viewer' },
    ],
  });
  expect(res.statusCode, res.body).toBe(200);
  space = res.json();
});

describe('who hears about what', () => {
  it('tells the assignee, never the person who made the change', async () => {
    const item = await mkItem(c.lead!, { title: 'Wire the panel', assigneeId: u.dev!.id });
    const [n] = await inbox('dev');
    expect(n).toMatchObject({ type: 'assigned', data: { key: item.key, title: 'Wire the panel' }, actor: { id: u.lead!.id } });
    expect(n!.text).toContain(`assigned ${item.key} Wire the panel to you`);
    expect((await inbox('lead')).some((x) => x.data.key === item.key)).toBe(false);

    // Assigning yourself notifies nobody.
    await mkItem(c.qa!, { title: 'Mine', assigneeId: u.qa!.id });
    expect((await inbox('qa')).some((x) => x.data.title === 'Mine')).toBe(false);
  });

  it('notifies mentions once, and other watchers about the comment', async () => {
    const item = await mkItem(c.lead!, { title: 'Pick tiles', assigneeId: u.dev!.id });
    // The viewer watches; qa will be mentioned.
    await send('PUT', `/items/${item.id}/watch`, c.viewer!);
    const res = await send('POST', `/items/${item.id}/comments`, c.dev!, { body: doc(text('Can you check, '), mention(u.qa!.id)) });
    expect(res.statusCode, res.body).toBe(200);

    const qa = (await inbox('qa')).filter((x) => x.data.key === item.key);
    expect(qa.map((x) => x.type)).toEqual(['mentioned']);
    const viewer = (await inbox('viewer')).filter((x) => x.data.key === item.key);
    expect(viewer.map((x) => x.type)).toEqual(['commented']);
    expect(viewer[0]!.data.excerpt).toContain('Can you check');
    // The reporter (lead) watches automatically; the commenter (dev) hears nothing about their own comment.
    expect((await inbox('lead')).filter((x) => x.data.key === item.key).map((x) => x.type)).toEqual(['commented']);
    expect((await inbox('dev')).filter((x) => x.data.key === item.key && x.type === 'commented')).toEqual([]);
  });

  it('tells the reporter and the assignee when the status changes', async () => {
    const item = await mkItem(c.lead!, { assigneeId: u.dev!.id });
    const statuses = (await send('GET', `/spaces/${space.id}/statuses`, c.lead!)).json().items as Json[];
    const doing = statuses.find((s) => s.category === 'in_progress')!;
    const res = await patch(item, c.qa!, { statusId: doing.id });
    expect(res.statusCode, res.body).toBe(200);
    for (const who of ['lead', 'dev']) {
      const n = (await inbox(who)).find((x) => x.data.key === item.key && x.type === 'status_changed');
      expect(n, who).toMatchObject({ data: { from: 'To Do', to: doing.name } });
    }
  });

  it('drops a notification for someone who can no longer open the space', async () => {
    const item = await mkItem(c.lead!);
    await send('PUT', `/items/${item.id}/watch`, c.outsider!).then((r) => expect(r.statusCode).toBe(404));
    // The viewer watches, then loses access before the comment.
    await send('PUT', `/items/${item.id}/watch`, c.viewer!);
    const members = (await send('GET', `/spaces/${space.id}/members`, c.lead!)).json().items as Json[];
    const entry = members.find((m) => m.principalId === u.viewer!.id)!;
    expect((await send('DELETE', `/spaces/${space.id}/members/${entry.id}`, c.lead!)).statusCode).toBe(200);
    await send('POST', `/items/${item.id}/comments`, c.dev!, { body: doc(text('After the change')) });
    expect((await inbox('viewer')).some((x) => x.data.key === item.key && x.type === 'commented')).toBe(false);
    // Put them back for the other tests.
    await send('POST', `/spaces/${space.id}/members`, c.lead!, { members: [{ type: 'user', id: u.viewer!.id, role: 'viewer' }] });
  });
});

describe('reading and preferences', () => {
  it('counts unread, marks some or all as read, and keeps other people and workspaces out', async () => {
    await mkItem(c.lead!, { title: 'One', assigneeId: u.qa!.id });
    await mkItem(c.lead!, { title: 'Two', assigneeId: u.qa!.id });
    const before = (await send('GET', '/notifications/count', c.qa!)).json().unread as number;
    expect(before).toBeGreaterThanOrEqual(2);
    const [first] = await inbox('qa');
    expect((await send('POST', '/notifications/read', c.qa!, { ids: [first!.id] })).json().updated).toBe(1);
    expect((await send('GET', '/notifications/count', c.qa!)).json().unread).toBe(before - 1);
    // Someone else cannot mark qa's notifications.
    expect((await send('POST', '/notifications/read', c.dev!, { ids: [first!.id] })).json().updated).toBe(0);
    expect((await send('GET', '/notifications?unread=1', c.gx!, undefined, 'globex')).json().items.some((x: Json) => x.id === first!.id)).toBe(false);
    await send('POST', '/notifications/read', c.qa!, { all: true });
    expect((await send('GET', '/notifications/count', c.qa!)).json().unread).toBe(0);
  });

  it('follows each person’s channels', async () => {
    const res = await send('PUT', '/me/notification-preferences', c.dev!, {
      preferences: { assigned: { inApp: false, email: false } },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().preferences.assigned).toEqual({ inApp: false, email: false });
    expect(res.json().preferences.mentioned).toEqual({ inApp: true, email: true });
    await mkItem(c.lead!, { title: 'Quiet', assigneeId: u.dev!.id });
    expect((await inbox('dev')).some((x) => x.data.title === 'Quiet')).toBe(false);
    await send('PUT', '/me/notification-preferences', c.dev!, { preferences: { assigned: { inApp: true, email: true } } });
  });
});

describe('emails', () => {
  it('collects a person’s notifications into one email a few minutes later', async () => {
    const who = await ensureUser({ orgId: ids.acme, email: uniqueEmail('nt-mail'), role: 'member' });
    const added = await send('POST', `/spaces/${space.id}/members`, c.lead!, { members: [{ type: 'user', id: who.id, role: 'member' }] });
    expect(added.statusCode, added.body).toBe(200);
    await mkItem(c.lead!, { title: 'First job', assigneeId: who.id });
    await mkItem(c.lead!, { title: 'Second job', assigneeId: who.id });

    const sent: { to: string; subject: string; text: string; html: string }[] = [];
    const cfg = { TENANT_ORIGIN_TEMPLATE: 'http://{slug}.localhost:3000' };
    // Nothing is due yet.
    await flushEmailBatches(t.db, cfg, (m) => void sent.push(m));
    expect(sent.filter((m) => m.to === who.email)).toEqual([]);
    // Six minutes later, one email with both.
    await flushEmailBatches(t.db, cfg, (m) => void sent.push(m), new Date(Date.now() + 6 * 60_000));
    const mine = sent.filter((m) => m.to === who.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe('2 updates in Acme Inc');
    expect(mine[0]!.text).toContain('First job');
    expect(mine[0]!.text).toContain('Second job');
    expect(mine[0]!.text).toContain('http://acme.localhost:3000/spaces/');
    // It is not sent twice.
    await flushEmailBatches(t.db, cfg, (m) => void sent.push(m), new Date(Date.now() + 7 * 60_000));
    expect(sent.filter((m) => m.to === who.email)).toHaveLength(1);
  });
});

describe('due-date reminders', () => {
  it('reminds the assignee of work due today or tomorrow, once a day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const item = await mkItem(c.lead!, { title: 'Due now', assigneeId: u.qa!.id, dueDate: today });
    await remindDueSoon(t.db);
    await remindDueSoon(t.db);
    const reminders = (await inbox('qa')).filter((x) => x.type === 'due_soon' && x.data.key === item.key);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.text).toBe(`${item.key} Due now is due today`);
  });
});
