import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryEventSink } from '../src/messaging/events.js';
import { purgeExpired } from '../src/messaging/retention.js';
import { adminDb, caller, createOrg, ensureUser, makeApp, signInAs, uniqueEmail } from './helpers.js';

const events = new MemoryEventSink();
const pending: Promise<unknown>[] = [];
const t = makeApp({
  events,
  messageLimits: { userMax: 10_000, orgMax: 100_000, windowMs: 10_000 },
  deferMessaging: (work) =>
    void pending.push(work().catch((e) => console.error('follow-up failed', e))),
});
const call = caller(t.app);
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
const raw = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { 'content-type': 'application/json', ...headers },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
let n = 0;
const cid = () => `m5-${Date.now()}-${n++}`;
const say = (s: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }],
});
const post = (who: string, channelId: string, text: string, extra: Json = {}) =>
  api(who, 'POST', `/channels/${channelId}/messages`, { clientMsgId: cid(), body: say(text), ...extra });
const mk = async (who: string, name: string, type: 'public' | 'private' = 'public', memberIds: string[] = []) => {
  const res = await api(who, 'POST', '/channels', { name, type, memberIds });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().channel.id as string;
};
const defaults = {
  channelCreation: 'all',
  broadcastLimit: 50,
  defaultChannelIds: [] as string[],
  retentionDays: null as number | null,
  spaceChannels: true,
  announcementDefault: false,
  leaveSetsDnd: false,
};
const setRules = async (patch: Json = {}) => {
  const res = await api('owner', 'PUT', '/admin/messaging-settings', { ...defaults, ...patch });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const orgPlan = async (planKey: string | null, limitOverrides: Json = {}) => {
  const admin = adminDb();
  try {
    await admin.db.global.organizations.updateOne(
      { id: orgId },
      { planKey, onTrial: false, trialEndsAt: null, limitOverrides: limitOverrides as Record<string, number> },
    );
  } finally {
    await admin.close();
  }
};
const aged = async (messageId: string, days: number) => {
  const at = new Date(Date.now() - days * 86_400_000);
  await t.db.tenant(orgId).messages.updateOne({ id: messageId }, { createdAt: at });
};
const ctx = () => ({ db: t.db, events });
const rnd = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  await t.app.ready();
  const org = await createOrg('m5');
  slug = org.slug;
  orgId = org.org.id;
  u.owner = org.owner;
  c.owner = await signInAs(t.app, slug, u.owner);
  for (const [name, role] of [
    ['adm', 'admin'],
    ['ann', 'member'],
    ['bob', 'member'],
    ['cy', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId, email: uniqueEmail(`m5-${name}`, `${slug}.test`), role });
    c[name] = await signInAs(t.app, slug, u[name]);
    await api(name, 'GET', '/channels');
  }
  await api('owner', 'GET', '/channels');
});

describe('messaging settings', () => {
  it('reads defaults, and only the owner reads or changes them', async () => {
    const got = await api('owner', 'GET', '/admin/messaging-settings');
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ channelCreation: 'all', broadcastLimit: 50, retentionDays: null, spaceChannels: true });
    for (const who of ['adm', 'ann']) {
      expect((await api(who, 'GET', '/admin/messaging-settings')).statusCode).toBe(403);
      expect((await api(who, 'PUT', '/admin/messaging-settings', defaults)).statusCode).toBe(403);
    }
  });

  it('validates, saves and audits a change, and refuses unknown default channels', async () => {
    const general = ((await api('ann', 'GET', '/channels')).json().channels as Json[]).find((x) => x.name === 'general')!.id;
    const saved = await setRules({ retentionDays: 365, defaultChannelIds: [general] });
    expect(saved.retentionDays).toBe(365);
    expect(saved.defaultChannels).toEqual([{ id: general, name: 'general' }]);
    expect((await api('owner', 'GET', '/admin/messaging-settings')).json().retentionDays).toBe(365);
    const audit = await t.db.tenant(orgId).auditLogs.find({ action: 'messaging.settings_changed' });
    expect(audit.length).toBeGreaterThan(0);
    expect((audit.at(-1)!.before as Json).retentionDays).toBeNull();

    expect((await api('owner', 'PUT', '/admin/messaging-settings', { ...defaults, retentionDays: 0 })).statusCode).toBe(400);
    expect((await api('owner', 'PUT', '/admin/messaging-settings', { ...defaults, channelCreation: 'nobody' })).statusCode).toBe(400);
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id;
    const bad = await api('owner', 'PUT', '/admin/messaging-settings', { ...defaults, defaultChannelIds: [dm] });
    expect(bad.statusCode).toBe(422);
    await setRules();
  });

  it('limits who can create channels, and makes new ones announcement-only when asked', async () => {
    await setRules({ channelCreation: 'admins' });
    expect((await api('ann', 'POST', '/channels', { name: `blocked-${rnd()}`, type: 'public' })).statusCode).toBe(403);
    const byAdmin = await api('adm', 'POST', '/channels', { name: `allowed-${rnd()}`, type: 'public' });
    expect(byAdmin.statusCode).toBe(201);
    await setRules({ announcementDefault: true });
    const id = await mk('ann', `news-${rnd()}`);
    expect((await api('ann', 'GET', `/channels/${id}`)).json().channel.isAnnouncement).toBe(true);
    await setRules();
  });

  it('applies the @channel threshold from the settings', async () => {
    const big = await mk('adm', `big-${rnd()}`, 'public', [u.ann!.id, u.bob!.id, u.cy!.id]);
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'channel', label: 'channel', kind: 'channel' } }, { type: 'text', text: ' hi' }] }],
    };
    const send = (who: string) => api(who, 'POST', `/channels/${big}/messages`, { clientMsgId: cid(), body });
    expect((await send('ann')).statusCode).toBe(201); // 4 members: under the default threshold
    await setRules({ broadcastLimit: 2 });
    expect((await send('ann')).statusCode).toBe(403);
    expect((await send('adm')).statusCode).toBe(201);
    await setRules();
  });

  it('puts new members in the default channels, and can switch space channels off', async () => {
    const room = await mk('adm', `welcome-${rnd()}`);
    await setRules({ defaultChannelIds: [room] });
    const fresh = await ensureUser({ orgId, email: uniqueEmail('m5-new', `${slug}.test`), role: 'member' });
    c.fresh = await signInAs(t.app, slug, fresh);
    const mine = (await api('fresh', 'GET', '/channels')).json().channels as Json[];
    expect(mine.map((x) => x.id)).toContain(room);
    await setRules();

    await setRules({ spaceChannels: false });
    const space = await api('owner', 'POST', '/spaces', { key: `OFF${rnd().slice(0, 5)}`.toUpperCase(), name: 'No chat' });
    await flush();
    expect((await api('owner', 'GET', `/spaces/${space.json().id}/channel`)).statusCode).toBe(404);
    await setRules({ spaceChannels: true });
    expect((await api('owner', 'GET', `/spaces/${space.json().id}/channel`)).statusCode).toBe(200);
  });

  it('does not notify while on leave when the workspace says leave is do not disturb', async () => {
    // The badge itself is covered by the M4 tests; here the setting is saved and read back.
    const saved = await setRules({ leaveSetsDnd: true });
    expect(saved.leaveSetsDnd).toBe(true);
    await setRules();
  });
});

describe('plan limits', () => {
  it('stops a workspace at its channel limit, never counting direct messages or space channels', async () => {
    const before = await t.db.tenant(orgId).channels.count({ type: { $in: ['public', 'private'] }, spaceId: null });
    await orgPlan('free', { channels: before + 1 });
    try {
      await mk('ann', `last-${rnd()}`);
      const over = await api('ann', 'POST', '/channels', { name: `over-${rnd()}`, type: 'public' });
      expect(over.statusCode).toBe(402);
      expect(over.json().code).toBe('plan_limit');
      expect((await api('ann', 'POST', '/dms', { userIds: [u.cy!.id] })).statusCode).toBeLessThan(300);
      const s = await api('owner', 'POST', '/spaces', { key: `LIM${rnd().slice(0, 5)}`.toUpperCase(), name: 'Limits', visibility: 'open' });
      expect(s.statusCode, s.body).toBe(200);
      await flush();
      expect((await api('owner', 'GET', `/spaces/${s.json().id}/channel`)).statusCode).toBe(200);
    } finally {
      await orgPlan(null);
    }
  });

  it('hides messages older than the plan history window from the list and from search', async () => {
    const ch = await mk('ann', `window-${rnd()}`);
    const word = `windowword${rnd()}`;
    const old = (await post('ann', ch, `${word} old`)).json().message.id as string;
    await post('ann', ch, `${word} new`);
    await aged(old, 120);
    await orgPlan('free', { message_history_days: 90 });
    try {
      const list = (await api('ann', 'GET', `/channels/${ch}/messages`)).json();
      const texts = (list.messages as Json[]).map((m) => m.bodyText);
      expect(texts).toContain(`${word} new`);
      expect(texts).not.toContain(`${word} old`);
      expect(list.historyLimited).toBe(true);
      const found = (await api('ann', 'GET', `/search/messages?q=${word}`)).json().hits as Json[];
      expect(found.map((h) => h.message.bodyText)).toEqual([`${word} new`]);
    } finally {
      await orgPlan(null);
    }
    const all = (await api('ann', 'GET', `/channels/${ch}/messages`)).json();
    expect((all.messages as Json[]).map((m) => m.bodyText)).toContain(`${word} old`);
    expect(all.historyLimited).toBe(false);
  });
});

describe('retention', () => {
  it('purges what is older than the workspace window, keeps live threads whole, and audits it', async () => {
    const ch = await mk('ann', `ret-${rnd()}`, 'public', [u.bob!.id]);
    const oldRoot = (await post('ann', ch, 'ancient')).json().message.id as string;
    const oldReply = (await api('bob', 'POST', `/messages/${oldRoot}/replies`, { clientMsgId: cid(), body: say('ancient reply') })).json().message.id as string;
    const liveRoot = (await post('ann', ch, 'old root with a fresh reply')).json().message.id as string;
    await api('bob', 'POST', `/messages/${liveRoot}/replies`, { clientMsgId: cid(), body: say('fresh reply') });
    const fresh = (await post('ann', ch, 'recent')).json().message.id as string;
    await api('ann', 'POST', `/messages/${oldRoot}/reactions`, { emoji: '👍' });
    await aged(oldRoot, 40);
    await aged(oldReply, 40);
    // Its last reply is as old as the thread, so nothing in it is still alive.
    await t.db.tenant(orgId).messages.updateOne({ id: oldRoot }, { lastReplyAt: new Date(Date.now() - 40 * 86_400_000) });
    await aged(liveRoot, 40); // its reply is new, so the whole thread stays

    await setRules({ retentionDays: 30 });
    const result = await purgeExpired(ctx(), orgId);
    expect(result.messages).toBeGreaterThanOrEqual(2);
    const tdb = t.db.tenant(orgId);
    expect(await tdb.messages.exists({ id: oldRoot })).toBe(false);
    expect(await tdb.messages.exists({ id: oldReply })).toBe(false);
    expect(await tdb.messageReactions.exists({ messageId: oldRoot })).toBe(false);
    expect(await tdb.messages.exists({ id: liveRoot })).toBe(true);
    expect(await tdb.messages.exists({ id: fresh })).toBe(true);
    const audit = await tdb.auditLogs.find({ targetId: ch, action: 'channel.retention_purged' });
    expect(audit).toHaveLength(1);
    expect((audit[0]!.after as Json).messages).toBe(2);
    // The list still works and shows the rest.
    const texts = ((await api('ann', 'GET', `/channels/${ch}/messages`)).json().messages as Json[]).map((m) => m.bodyText);
    expect(texts).toEqual(expect.arrayContaining(['old root with a fresh reply', 'recent']));
    await setRules();
  });

  it('lets a channel have its own window, longer or shorter than the default, set by the owner only', async () => {
    const keep = await mk('ann', `keep-${rnd()}`);
    const trim = await mk('ann', `trim-${rnd()}`);
    const a = (await post('ann', keep, 'keeper')).json().message.id as string;
    const b = (await post('ann', trim, 'trimmed')).json().message.id as string;
    await aged(a, 100);
    await aged(b, 10);
    expect((await api('adm', 'PUT', `/admin/channels/${keep}/retention`, { days: 365 })).statusCode).toBe(403);
    expect((await api('owner', 'PUT', `/admin/channels/${keep}/retention`, { days: 365 })).statusCode).toBe(200);
    expect((await api('owner', 'PUT', `/admin/channels/${trim}/retention`, { days: 5 })).statusCode).toBe(200);
    expect((await api('owner', 'PUT', `/admin/channels/${trim}/retention`, { days: 0 })).statusCode).toBe(422);
    await setRules({ retentionDays: 30 });
    await purgeExpired(ctx(), orgId);
    const tdb = t.db.tenant(orgId);
    expect(await tdb.messages.exists({ id: a })).toBe(true); // 100 days old, kept: the channel keeps a year
    expect(await tdb.messages.exists({ id: b })).toBe(false); // 10 days old, purged: the channel keeps 5
    const list = (await api('owner', 'GET', '/admin/retention')).json().channels as Json[];
    expect(list.map((x) => x.channelId)).toEqual(expect.arrayContaining([keep, trim]));
    expect((await api('ann', 'GET', `/channels/${keep}`)).json().channel.retentionDays).toBe(365);
    await api('owner', 'PUT', `/admin/channels/${keep}/retention`, { days: null });
    await api('owner', 'PUT', `/admin/channels/${trim}/retention`, { days: null });
    await setRules();
  });

  it('does nothing when no window is set', async () => {
    const ch = await mk('ann', `forever-${rnd()}`);
    const id = (await post('ann', ch, 'old but kept')).json().message.id as string;
    await aged(id, 2000);
    await purgeExpired(ctx(), orgId);
    expect(await t.db.tenant(orgId).messages.exists({ id })).toBe(true);
  });
});

describe('export', () => {
  it('makes a copy of the public channels only, for the owner only', async () => {
    const pub = await mk('ann', `exp-pub-${rnd()}`);
    const priv = await mk('ann', `exp-priv-${rnd()}`, 'private');
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id as string;
    await post('ann', pub, 'public words for the export');
    await post('ann', priv, 'private words stay private');
    await post('ann', dm, 'direct words stay direct');

    expect((await api('adm', 'POST', '/admin/export')).statusCode).toBe(403);
    expect((await api('ann', 'GET', '/admin/export')).statusCode).toBe(403);
    const asked = await api('owner', 'POST', '/admin/export');
    expect(asked.statusCode, asked.body).toBe(202);
    const id = asked.json().export.id as string;
    expect((await api('owner', 'POST', '/admin/export')).statusCode).toBe(409); // one at a time
    await flush();
    const done = (await api('owner', 'GET', `/admin/export/${id}`)).json().export;
    expect(done.status, JSON.stringify(done)).toBe('done');
    expect(done.counts.messages).toBeGreaterThan(0);

    expect((await api('adm', 'GET', `/admin/export/${id}/file`)).statusCode).toBe(403);
    const file = await api('owner', 'GET', `/admin/export/${id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/gzip');
    const text = gunzipSync(file.rawPayload).toString('utf8');
    const lines = text.trim().split('\n').map((l) => JSON.parse(l) as Json);
    expect(lines[0]).toMatchObject({ type: 'export', version: 1 });
    const messages = lines.filter((l) => l.type === 'message').map((l) => l.text);
    expect(messages).toContain('public words for the export');
    expect(messages).not.toContain('private words stay private');
    expect(messages).not.toContain('direct words stay direct');
    expect(lines.some((l) => l.type === 'channel' && l.id === pub)).toBe(true);
    expect(lines.some((l) => l.type === 'channel' && (l.id === priv || l.id === dm))).toBe(false);
    expect(lines.some((l) => l.type === 'person' && l.email === u.ann!.email)).toBe(true);
    const audit = await t.db.tenant(orgId).auditLogs.find({ action: 'messaging.export_requested' });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('refuses an expired export', async () => {
    const id = ((await api('owner', 'GET', '/admin/export')).json().exports as Json[])[0]!.id;
    await t.db.tenant(orgId).chatExports.updateOne({ id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await api('owner', 'GET', `/admin/export/${id}/file`)).statusCode).toBe(410);
  });
});

describe('incoming webhooks', () => {
  it('lets admins make one, shows the secret once, and posts as a bot with no session', async () => {
    const ch = await mk('adm', `hook-${rnd()}`);
    expect((await api('ann', 'POST', `/channels/${ch}/webhooks`, { name: 'CI' })).statusCode).toBe(403);
    const made = await api('adm', 'POST', `/channels/${ch}/webhooks`, { name: 'Build bot' });
    expect(made.statusCode, made.body).toBe(201);
    const token = made.json().token as string;
    expect(token).toMatch(/^whk_[A-Za-z0-9_-]{43}$/);
    // Only the hash is kept, and the list never shows the secret.
    const stored = await t.db.tenant(orgId).incomingWebhooks.find({ channelId: ch });
    expect(JSON.stringify(stored)).not.toContain(token);
    const listed = await api('adm', 'GET', `/channels/${ch}/webhooks`);
    expect(listed.body).not.toContain(token);
    expect(listed.json().webhooks[0]).toMatchObject({ name: 'Build bot', channelId: ch });
    expect((await api('ann', 'GET', `/channels/${ch}/webhooks`)).statusCode).toBe(403);

    const posted = await raw('POST', `/hooks/${token}`, { text: 'Build 42 passed ✅' });
    expect(posted.statusCode, posted.body).toBe(201);
    const msgs = (await api('ann', 'GET', `/channels/${ch}/messages`)).json().messages as Json[];
    const bot = msgs.find((m) => m.kind === 'bot')!;
    expect(bot).toMatchObject({ bodyText: 'Build 42 passed ✅', bot: { name: 'Build bot' }, authorId: null });
    expect((await api('adm', 'GET', `/channels/${ch}/webhooks`)).json().webhooks[0].lastUsedAt).not.toBeNull();
    // Text from outside never turns into mentions or cards.
    await raw('POST', `/hooks/${token}`, { text: '@channel look at ENG-1' });
    const again = ((await api('ann', 'GET', `/channels/${ch}/messages`)).json().messages as Json[]).filter((m) => m.kind === 'bot');
    expect(again.at(-1)!.mentions).toEqual([]);
    expect(again.at(-1)!.workItems).toEqual([]);
  });

  it('refuses bad secrets, bad bodies, revoked webhooks and archived channels the same cautious way', async () => {
    const ch = await mk('adm', `hook2-${rnd()}`);
    const made = (await api('adm', 'POST', `/channels/${ch}/webhooks`, { name: 'Alerts' })).json();
    const token = made.token as string;
    expect((await raw('POST', '/hooks/whk_nope', { text: 'x' })).statusCode).toBe(404);
    expect((await raw('POST', `/hooks/whk_${'A'.repeat(43)}`, { text: 'x' })).statusCode).toBe(404);
    expect((await raw('POST', `/hooks/${token}`, { text: '' })).statusCode).toBe(422);
    expect((await raw('POST', `/hooks/${token}`, { nothing: true })).statusCode).toBe(422);
    expect((await raw('POST', `/hooks/${token}`, { text: 'x'.repeat(4001) })).statusCode).toBe(422);
    const notJson = await t.app.inject({ method: 'POST', url: `/api/v1/hooks/${token}`, headers: { 'content-type': 'text/plain' }, payload: 'hello' });
    expect(notJson.statusCode, notJson.body).toBe(415);
    const big = await raw('POST', `/hooks/${token}`, { text: 'y'.repeat(20_000) });
    expect(big.statusCode).toBe(413);

    // Archived channel.
    await api('adm', 'POST', `/channels/${ch}/archive`);
    expect((await raw('POST', `/hooks/${token}`, { text: 'late' })).statusCode).toBe(409);
    await api('adm', 'POST', `/channels/${ch}/unarchive`);
    expect((await raw('POST', `/hooks/${token}`, { text: 'back' })).statusCode).toBe(201);

    // Revoked at once.
    const hookId = (await api('adm', 'GET', `/channels/${ch}/webhooks`)).json().webhooks[0].id;
    expect((await api('ann', 'DELETE', `/webhooks/${hookId}`)).statusCode).toBe(403);
    expect((await api('adm', 'DELETE', `/webhooks/${hookId}`)).statusCode).toBe(204);
    expect((await raw('POST', `/hooks/${token}`, { text: 'after revoke' })).statusCode).toBe(404);
    expect((await api('adm', 'GET', `/channels/${ch}/webhooks`)).json().webhooks).toEqual([]);
    const audit = await t.db.tenant(orgId).auditLogs.find({ targetId: ch, action: { $in: ['webhook.created', 'webhook.revoked'] } });
    expect(audit.map((a) => a.action).sort()).toEqual(['webhook.created', 'webhook.revoked']);
  });

  it('is limited per workspace, and cannot post into direct messages or other workspaces', async () => {
    const dm = (await api('ann', 'POST', '/dms', { userIds: [u.bob!.id] })).json().channel.id as string;
    expect((await api('owner', 'POST', `/channels/${dm}/webhooks`, { name: 'x' })).statusCode).toBe(404);
    const priv = await mk('ann', `hook-priv-${rnd()}`, 'private');
    // Admins cannot reach a private channel they are not in, so they cannot hook into it either.
    expect((await api('adm', 'POST', `/channels/${priv}/webhooks`, { name: 'x' })).statusCode).toBe(404);
    const other = await createOrg('m5x');
    const oc = await signInAs(t.app, other.slug, other.owner);
    const cross = await call({ method: 'POST', url: `/channels/${priv}/webhooks`, slug: other.slug, cookie: oc, payload: { name: 'x' } });
    expect(cross.statusCode).toBe(404);
  });
});

describe('open a channel from CRM', () => {
  it('makes one private channel per deal that hears about stage changes and activities', async () => {
    const deal = (await api('owner', 'POST', '/crm/deals', { title: 'Big renewal', value: 5000 })).json();
    // A member without CRM access cannot open one.
    await t.db.tenant(orgId).memberships.updateOne({ userId: u.ann!.id }, { crmRole: 'none' });
    expect((await api('ann', 'POST', `/crm/deals/${deal.id}/channel`)).statusCode).toBe(403);
    const made = await api('owner', 'POST', `/crm/deals/${deal.id}/channel`);
    expect(made.statusCode, made.body).toBe(200);
    const ch = made.json().channel;
    expect(ch).toMatchObject({ type: 'private', crm: { type: 'deal', id: deal.id } });
    expect(ch.name).toMatch(/^deal-big-renewal-/);
    expect((await api('owner', 'POST', `/crm/deals/${deal.id}/channel`)).json().channel.id).toBe(ch.id);
    expect((await api('ann', 'GET', `/channels/${ch.id}`)).statusCode).toBe(404); // private

    const stages = (await api('owner', 'GET', '/crm/pipelines')).json().items[0].stages as Json[];
    const next = stages.find((s) => s.id !== deal.stageId && !s.isWon && !s.isLost)!;
    const moved = await api('owner', 'POST', `/crm/deals/${deal.id}/move`, { stageId: next.id });
    expect(moved.statusCode, moved.body).toBe(200);
    const won = stages.find((s) => s.isWon)!;
    await api('owner', 'POST', `/crm/deals/${deal.id}/move`, { stageId: won.id });
    await api('owner', 'POST', '/crm/activities', { type: 'call', subject: 'Renewal call', linkedType: 'deal', linkedId: deal.id });
    await api('owner', 'POST', '/crm/notes', { body: 'Customer is happy', linkedType: 'deal', linkedId: deal.id });
    await flush();

    const msgs = ((await api('owner', 'GET', `/channels/${ch.id}/messages`)).json().messages as Json[]).filter((m) => m.kind === 'bot');
    const text = msgs.map((m) => m.bodyText as string);
    expect(text.some((x) => x.includes('Big renewal') && x.includes(next.name))).toBe(true);
    expect(text.some((x) => x.includes('The deal is won'))).toBe(true);
    expect(text.some((x) => x.includes('logged a call: Renewal call'))).toBe(true);
    expect(text.some((x) => x.includes('added a note'))).toBe(true);
    expect(text.join(' ')).not.toContain('Customer is happy'); // the note text is not copied
    expect(msgs[0]!.bot).toMatchObject({ name: 'CRM' });

    // An admin with CRM access is put in the same channel when they open it.
    const joined = await api('adm', 'POST', `/crm/deals/${deal.id}/channel`);
    expect(joined.json().channel.id).toBe(ch.id);
    expect((await api('adm', 'GET', `/channels/${ch.id}`)).statusCode).toBe(200);
  });

  it('also works for a company, and for nothing that does not exist', async () => {
    const co = (await api('owner', 'POST', '/crm/companies', { name: 'Acme Widgets' })).json();
    const made = await api('owner', 'POST', `/crm/companies/${co.id}/channel`);
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json().channel).toMatchObject({ crm: { type: 'company', id: co.id } });
    const gone = await api('owner', 'POST', `/crm/deals/${crypto.randomUUID()}/channel`);
    expect(gone.statusCode).toBe(404);
  });
});
