import { createRequire } from 'node:module';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsOwner, signInWithPassword } from './helpers';

// socket.io-client lives in the web app's dependencies, not the repository root's.
const webRequire = createRequire(path.resolve(process.cwd(), 'apps/web/package.json'));
const { io } = webRequire('socket.io-client') as typeof import('socket.io-client');

const member = (page: Page) => signInWithPassword(page, 'member@acme.test');
const composer = (page: Page) => page.getByRole('textbox', { name: /^Message / });
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const say = (page: Page, channelId: string, text: string) =>
  apiCall(page, 'POST', `/channels/${channelId}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc(text) });

/** The session cookie of a signed-in page, for a socket made by a script rather than the browser. */
async function sessionOf(page: Page) {
  const cookies = await page.context().cookies();
  const c = cookies.find((x) => x.name === 'cd_session');
  if (!c) throw new Error('no session cookie');
  return c.value;
}

const gateway = 'http://127.0.0.1:4100';
const connectAs = (host: string, sid: string) =>
  io(gateway, {
    path: '/realtime/socket.io',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { 'x-forwarded-host': host, cookie: `cd_session=${sid}` },
  });

test('a cross-workspace socket attack gets nothing: wrong host, someone else’s channel, and their events', async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Globex (another workspace) has a channel with something worth stealing in it.
  const gx = await browser.newContext({ baseURL: 'http://globex.localhost:3000' });
  const g = await gx.newPage();
  await signInWithPassword(g, 'owner@globex.test');
  const secretChannel = (await apiCall(g, 'POST', '/channels', { name: `secret-${rand()}`, type: 'private' })).json.channel.id as string;
  expect((await say(g, secretChannel, 'globex plans')).status).toBe(201);
  const globexSid = await sessionOf(g);

  await signInAsOwner(page);
  const acmeSid = await sessionOf(page);
  const sockets: ReturnType<typeof connectAs>[] = [];
  try {
    // 1. Acme's session shown at Globex's address finds no session there.
    const wrongHost = connectAs('globex.localhost:3000', acmeSid);
    sockets.push(wrongHost);
    const refused = await new Promise<string>((resolve) => {
      wrongHost.on('connect', () => resolve('connected'));
      wrongHost.on('connect_error', (e: Error) => resolve(e.message));
    });
    expect(refused).toBe('UNAUTHENTICATED');

    // 2. Acme's own socket cannot write to, read from or sync Globex's channel.
    const mine = connectAs('acme.localhost:3000', acmeSid);
    sockets.push(mine);
    await new Promise<void>((resolve, reject) => {
      mine.on('connect', () => resolve());
      mine.on('connect_error', (e: Error) => reject(e));
    });
    const heard: unknown[] = [];
    mine.onAny((event: string, payload: unknown) => {
      if (JSON.stringify(payload ?? '').includes('globex')) heard.push([event, payload]);
    });
    const ack = <T>(event: string, payload: unknown) =>
      new Promise<{ ok: boolean; code?: string; data?: T }>((resolve) => mine.emit(event, payload, resolve));
    const sent = await ack('message:send', { channelId: secretChannel, clientMsgId: `attack-${rand(6)}`, body: doc('hello from acme') });
    expect(sent.ok).toBe(false);
    expect(sent.code).toBe('FORBIDDEN');
    const synced = await ack<{ channelId: string; messages: unknown[] }[]>('sync', { channels: [{ channelId: secretChannel, lastSeq: 0 }] });
    expect(JSON.stringify(synced)).not.toContain('globex plans');
    mine.emit('typing:start', { channelId: secretChannel });
    const read = await ack('read:update', { channelId: secretChannel, seq: 1 });
    expect(read.ok).toBe(false);

    // 3. While Globex talks, Acme's socket hears none of it.
    const globexSocket = connectAs('globex.localhost:3000', globexSid);
    sockets.push(globexSocket);
    await new Promise<void>((resolve) => globexSocket.on('connect', () => resolve()));
    await new Promise<void>((resolve) =>
      globexSocket.emit('message:send', { channelId: secretChannel, clientMsgId: `live-${rand(6)}`, body: doc('globex live secret') }, () => resolve()),
    );
    await page.waitForTimeout(800);
    expect(heard).toEqual([]);
    // And nothing was written into Globex's channel by Acme.
    const history = await apiCall(g, 'GET', `/channels/${secretChannel}/messages`);
    expect(JSON.stringify(history.json)).not.toContain('hello from acme');
  } finally {
    for (const s of sockets) s.disconnect();
    await gx.close();
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const noSideScroll = async (page: Page, what: string) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${what} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  };

  test('the conversation list and a conversation fit the screen, and everything can be reached', async ({ page }) => {
    test.setTimeout(120_000);
    const name = `phone-${rand()}`;
    await signInAsOwner(page);
    const made = await apiCall(page, 'POST', '/channels', { name, type: 'public' });
    const channelId = made.json.channel.id as string;
    await say(page, channelId, 'a message on a small screen with a long enough line that it has to wrap onto another line');

    await page.goto('/messages');
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible({ timeout: 10_000 });
    await noSideScroll(page, 'the list');
    // Open the conversation from the list (channels have their own tab).
    await page.getByRole('tab', { name: /^Channels/ }).click();
    await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await noSideScroll(page, 'the conversation');
    const msg = page.getByRole('article').filter({ hasText: 'a message on a small screen' });
    await expect(msg).toBeVisible();
    // Touch devices show the message actions without hovering.
    await expect(msg.getByRole('button', { name: 'Reply in thread' })).toBeVisible();

    // Write and send with the on-screen composer.
    await composer(page).click();
    await page.keyboard.type('sent from a phone');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('article').filter({ hasText: 'sent from a phone' })).toBeVisible();

    // Details open as a panel over the conversation and close again.
    await page.getByRole('button', { name: 'Channel details' }).click();
    const sheet = page.getByRole('dialog', { name: 'Channel details' });
    await expect(sheet.getByText('Members ·')).toBeVisible();
    await noSideScroll(page, 'the details sheet');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);

    // Back to the list.
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await expect(page).toHaveURL(/\/messages$/);
  });

  test('the thread panel, the slash menu and the docked chat stay on screen', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAsOwner(page);
    const key = `P${rand(3).toUpperCase()}`.slice(0, 6);
    const space = await apiCall(page, 'POST', '/spaces', { key, name: `Phone ${key}`, visibility: 'open' });
    let channelId = '';
    await expect
      .poll(async () => {
        channelId = (await apiCall(page, 'GET', `/spaces/${space.json.id}/channel`)).json?.channel?.id ?? '';
        return channelId;
      })
      .not.toBe('');
    await say(page, channelId, 'root of a thread');
    await page.goto(`/messages/${channelId}`);
    const root = page.getByRole('article').filter({ hasText: 'root of a thread' });
    await root.getByRole('button', { name: 'Reply in thread' }).click();
    await expect(page.getByRole('dialog', { name: 'Thread' })).toBeVisible({ timeout: 8000 });
    await noSideScroll(page, 'the thread sheet');
    await page.keyboard.press('Escape');

    await composer(page).click();
    await page.keyboard.type('/');
    const menu = page.getByRole('listbox', { name: 'Commands' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.keyboard.press('Escape');

    await page.goto(`/spaces/${key}/board`);
    await page.getByRole('button', { name: /^Chat/ }).click();
    const dock = page.getByRole('complementary', { name: /chat$/ });
    await expect(dock).toBeVisible({ timeout: 8000 });
    const dockBox = await dock.boundingBox();
    expect(dockBox && dockBox.x >= 0 && dockBox.x + dockBox.width <= 391).toBe(true);
    await dock.getByRole('button', { name: 'Close chat' }).click();
  });

  test('the phone layout has no accessibility violations in either theme', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAsOwner(page);
    const made = await apiCall(page, 'POST', '/channels', { name: `phone-a11y-${rand()}`, type: 'public' });
    const channelId = made.json.channel.id as string;
    await say(page, channelId, 'accessible on a phone');
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const url of ['/messages', `/messages/${channelId}`, '/messages/search?q=phone', '/messages/threads']) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        const a = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-nextjs-dev-tools-button]').analyze();
        expect(a.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `${url} (${theme})`).toEqual([]);
      }
    }
  });
});

test('the keyboard alone: write, send, reach a message’s actions, open and close a thread, jump with Ctrl+K', async ({ page }) => {
  test.setTimeout(120_000);
  const name = `keys-${rand()}`;
  const text = `typed by keys ${rand()}`;
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name, type: 'public' });
  const channelId = made.json.channel.id as string;
  await page.goto(`/messages/${channelId}`);
  await composer(page).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  const msg = page.getByRole('article').filter({ hasText: text });
  await expect(msg).toBeVisible();

  // Shift+Tab from the composer reaches the message's toolbar (it appears while focus is inside the row).
  await msg.getByRole('button', { name: 'More actions' }).focus();
  await expect(msg.getByRole('button', { name: 'More actions' })).toBeFocused();
  await page.keyboard.press('Enter');
  const menuItem = page.getByRole('menuitem', { name: 'Reply in thread' });
  await expect(menuItem).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuItem).toHaveCount(0);
  await expect(msg.getByRole('button', { name: 'More actions' })).toBeFocused();

  // Reply in thread with Enter, close the panel with Escape, and land back where we were.
  await msg.getByRole('button', { name: 'Reply in thread' }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Thread' });
  await expect(panel).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Ctrl+K and the Enter key take us to another conversation without the mouse.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await palette.getByPlaceholder(/Search work or jump to/).fill('general');
  await palette.getByRole('option', { name: /general/ }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
  await expect(page).not.toHaveURL(new RegExp(channelId));
});

test('when the server fails, each message screen says so and recovers on Try again', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name: `errors-${rand()}`, type: 'public' });
  const channelId = made.json.channel.id as string;
  await say(page, channelId, 'there once was a message');

  // The conversation list.
  let failing = true;
  await page.route('**/api/v1/channels', (route) => (failing && route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '{"code":"internal","message":"boom"}', contentType: 'application/json' }) : route.continue()));
  await page.goto('/messages');
  await expect(page.getByText('Could not load your conversations.')).toBeVisible({ timeout: 10_000 });
  failing = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('navigation', { name: 'Conversations' }).getByRole('link').first()).toBeVisible({ timeout: 10_000 });
  await page.unroute('**/api/v1/channels');

  // The messages of one conversation.
  let failMessages = true;
  await page.route(`**/api/v1/channels/${channelId}/messages*`, (route) => (failMessages && route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '{"code":"internal","message":"boom"}', contentType: 'application/json' }) : route.continue()));
  await page.goto(`/messages/${channelId}`);
  await expect(page.getByText(/Could not load the messages/i)).toBeVisible({ timeout: 10_000 });
  failMessages = false;
  await page.getByRole('button', { name: /Try again|Retry/ }).first().click();
  await expect(page.getByRole('article').filter({ hasText: 'there once was a message' })).toBeVisible({ timeout: 10_000 });

  // Threads and search.
  await page.route('**/api/v1/threads*', (route) => route.fulfill({ status: 500, body: '{"code":"internal","message":"boom"}', contentType: 'application/json' }));
  await page.goto('/messages/threads');
  await expect(page.getByText(/Could not load your threads/i)).toBeVisible({ timeout: 10_000 });
});

test('a message sent while the server is unreachable shows as failed and can be retried', async ({ page }) => {
  test.setTimeout(120_000);
  const text = `will fail first ${rand()}`;
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name: `retry-${rand()}`, type: 'public' });
  const channelId = made.json.channel.id as string;
  await page.goto(`/messages/${channelId}`);
  await expect(composer(page)).toBeVisible();
  await page.waitForTimeout(1000);
  await page.context().setOffline(true);
  await composer(page).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  const row = page.getByRole('article').filter({ hasText: text });
  await expect(row).toBeVisible();
  // It could not be sent: the row says so and offers Retry.
  const failed = page.getByRole('article', { name: 'Message not sent' }).filter({ hasText: text });
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await page.context().setOffline(false);
  await page.waitForTimeout(1500);
  await failed.getByRole('button', { name: 'Retry' }).click();
  // Sent once, and the failed row is gone.
  await expect(page.getByRole('article', { name: 'Message not sent' })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('article').filter({ hasText: text })).toHaveCount(1);
  const list = await apiCall(page, 'GET', `/channels/${channelId}/messages`);
  expect((list.json.messages as { bodyText: string }[]).filter((m) => m.bodyText === text)).toHaveLength(1);
});

test('two people in one conversation: nothing is shown twice and everything arrives in order', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `order-${rand()}`;
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name, type: 'public' });
  const channelId = made.json.channel.id as string;
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await apiCall(other, 'POST', `/channels/${channelId}/join`);
    await page.goto(`/messages/${channelId}`);
    await other.goto(`/messages/${channelId}`);
    await expect(composer(page)).toBeVisible();
    await expect(composer(other)).toBeVisible();
    for (let i = 1; i <= 5; i++) {
      await composer(i % 2 ? page : other).click();
      await (i % 2 ? page : other).keyboard.type(`line ${i}`);
      await (i % 2 ? page : other).keyboard.press('Enter');
    }
    for (const p of [page, other]) {
      await expect(p.getByRole('article').filter({ hasText: /^.*line \d$/ })).toHaveCount(5, { timeout: 10_000 });
      const texts = await p.getByRole('article').filter({ hasText: /line \d/ }).allInnerTexts();
      const order = texts.map((t) => Number(/line (\d)/.exec(t)![1]));
      expect(order).toEqual([1, 2, 3, 4, 5]);
    }
  });
});

test('a channel with 10,000 messages opens quickly, scrolls smoothly, and a link can jump to the very first one', async ({ page }) => {
  test.setTimeout(180_000);
  const { randomUUID } = await import('node:crypto');
  const { withDb, orgIdOf } = await import('./db');
  await signInAsOwner(page);
  const name = `huge-${rand()}`;
  const made = await apiCall(page, 'POST', '/channels', { name, type: 'public' });
  const channelId = made.json.channel.id as string;
  const me = (await apiCall(page, 'GET', '/me')).json.user.id as string;
  const COUNT = 10_000;
  await withDb(async (db) => {
    const orgId = await orgIdOf(db, 'acme');
    const start = Date.now() - COUNT * 60_000;
    const docs = Array.from({ length: COUNT }, (_, i) => {
      const text = `bulk message ${i + 1}`;
      return {
        id: randomUUID(),
        orgId,
        channelId,
        seq: i + 1,
        kind: 'user',
        authorId: me,
        botId: null,
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        bodyText: text,
        threadRootId: null,
        alsoInChannel: false,
        replyCount: 0,
        lastReplyAt: null,
        hasLink: false,
        replyAuthors: [],
        clientMsgId: null,
        metadata: {},
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(start + i * 60_000),
      };
    });
    await db.collection('messages').insertMany(docs);
    await db.collection('channels').updateOne({ id: channelId }, { $set: { lastSeq: COUNT, lastMessageAt: new Date() } });
    await db.collection('read_cursors').updateOne({ channelId, userId: me }, { $set: { lastReadSeq: COUNT, lastReadAt: new Date() } }, { upsert: true });
  });

  const opened = Date.now();
  await page.goto(`/messages/${channelId}`);
  await expect(page.getByRole('article').filter({ hasText: `bulk message ${COUNT}` })).toBeVisible({ timeout: 20_000 });
  const openMs = Date.now() - opened;
  // The list only draws what is on screen.
  const drawn = await page.getByRole('article').count();
  expect(drawn, `${drawn} messages in the page`).toBeLessThan(150);

  // Scroll up through several pages of history, sampling how long each frame takes.
  const frames = await page.evaluate(async () => {
    const log = document.querySelector('[role="log"]') as HTMLElement | null;
    if (!log) return { worst: -1, p95: -1, frames: 0 };
    const gaps: number[] = [];
    let last = performance.now();
    let running = true;
    const tick = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    for (let i = 0; i < 25; i++) {
      log.scrollTop = Math.max(0, log.scrollTop - log.clientHeight * 3);
      await new Promise((r) => setTimeout(r, 120));
    }
    running = false;
    gaps.sort((a, b) => a - b);
    return { worst: Math.round(gaps.at(-1) ?? 0), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), frames: gaps.length };
  });
  expect(frames.frames).toBeGreaterThan(20);
  // Generous: this runs against the development server on a shared machine.
  expect(frames.p95, `frame times: ${JSON.stringify(frames)}`).toBeLessThan(250);
  expect(await page.getByRole('article').count()).toBeLessThan(250);

  // A link to the first message loads the window around it and shows it.
  await page.goto(`/messages/${channelId}?m=1`);
  await expect(page.getByRole('article').filter({ hasText: /^.*bulk message 1$/ }).first()).toBeVisible({ timeout: 20_000 });
  expect(await page.getByRole('article').count()).toBeLessThan(150);
  console.log(`10,000 messages: opened in ${openMs} ms, frame times ${JSON.stringify(frames)}`);

  await apiCall(page, 'DELETE', `/channels/${channelId}`);
});
