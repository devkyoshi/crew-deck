import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsOwner, signInWithPassword } from './helpers';

const member = (page: Page) => signInWithPassword(page, 'member@acme.test');
const composer = (page: Page) => page.getByRole('textbox', { name: /^Message / });
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** A fresh space owned by the owner, with the seeded member added, and one task in it. */
async function setupSpace(owner: Page, memberRole: 'member' | 'viewer' = 'member') {
  const key = `Q${rand(3).toUpperCase()}`.slice(0, 6);
  const made = await apiCall(owner, 'POST', '/spaces', { key, name: `Chat ${key}`, visibility: 'open' });
  expect(made.status, made.text).toBe(200);
  const spaceId = made.json.id as string;
  const who = await apiCall(owner, 'GET', '/members?q=member@acme.test');
  const added = await apiCall(owner, 'POST', `/spaces/${spaceId}/members`, {
    members: [{ type: 'user', id: who.json.items[0].id, role: memberRole }],
  });
  expect(added.status, added.text).toBeLessThan(300);
  const item = await apiCall(owner, 'POST', `/spaces/${spaceId}/items`, { type: 'task', title: `Fix it ${key}` });
  expect(item.status, item.text).toBeLessThan(300);
  // The channel is made and filled in the background; asking for it settles it.
  let channelId = '';
  await expect
    .poll(async () => {
      const res = await apiCall(owner, 'GET', `/spaces/${spaceId}/channel`);
      channelId = res.json?.channel?.id ?? '';
      return channelId;
    })
    .not.toBe('');
  return { key, spaceId, channelId, item: item.json as { id: string; key: string; title: string } };
}

test('a space has a channel: members get it on their own, viewers can read but not post', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await other.goto('/messages');
    // Created after the member opened Messages: it shows up without a reload.
    const s = await setupSpace(page);
    const row = other.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: new RegExp(s.key.toLowerCase()) });
    // The server side first (the channel exists for them), then that it appears on its own.
    await expect
      .poll(async () => ((await apiCall(other, 'GET', '/channels')).json.channels as { id: string }[]).some((c) => c.id === s.channelId), { timeout: 10_000 })
      .toBe(true);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(other.getByRole('heading', { level: 1, name: s.key.toLowerCase() })).toBeVisible();
    await expect(composer(other)).toBeVisible();

    // Demoted to viewer: the composer is replaced by a note.
    const rows = await apiCall(page, 'GET', `/spaces/${s.spaceId}/members?pageSize=100`);
    const mia = (rows.json.items as { id: string; name: string }[]).find((m) => /Mia/.test(m.name ?? ''))!;
    const changed = await apiCall(page, 'PATCH', `/spaces/${s.spaceId}/members/${mia.id}`, { role: 'viewer' });
    expect(changed.status, changed.text).toBeLessThan(300);
    await other.reload();
    await expect(other.getByText(/Only people with member access to the space can post/)).toBeVisible({ timeout: 10_000 });
    await expect(composer(other)).toHaveCount(0);

    // Taken out of the space: the channel goes away from their list at once.
    const removed = await apiCall(page, 'POST', `/spaces/${s.spaceId}/archive`);
    expect(removed.status).toBeLessThan(300);
  });
});

test('a work item key becomes a live card, and "no access" for people outside the space', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const s = await setupSpace(page);
  const sent = await apiCall(page, 'POST', `/channels/${s.channelId}/messages`, {
    clientMsgId: crypto.randomUUID().slice(0, 30),
    body: doc(`Can someone look at ${s.item.key}?`),
  });
  expect(sent.status, sent.text).toBe(201);
  await page.goto(`/messages/${s.channelId}`);
  const card = page.getByRole('link', { name: new RegExp(s.item.key) }).filter({ hasText: s.item.title });
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card).toHaveAttribute('href', `/spaces/${s.key}/items/${s.item.key}`);

  // A private space: someone without a role sees a neutral card with no title.
  const secret = await apiCall(page, 'POST', '/spaces', { key: `S${rand(3).toUpperCase()}`.slice(0, 6), name: 'Hidden', visibility: 'private' });
  const hiddenItem = await apiCall(page, 'POST', `/spaces/${secret.json.id}/items`, { type: 'task', title: 'Top secret plan' });
  await apiCall(page, 'POST', `/channels/${s.channelId}/messages`, {
    clientMsgId: crypto.randomUUID().slice(0, 30),
    body: doc(`Mentioning ${hiddenItem.json.key} here`),
  });
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await other.goto(`/messages/${s.channelId}`);
    await expect(other.getByText(`${hiddenItem.json.key}`).first()).toBeVisible({ timeout: 8000 });
    await expect(other.getByText('You do not have access to this work item')).toBeVisible();
    await expect(other.getByText('Top secret plan')).toHaveCount(0);
  });
});

test('create a work item from a message: prefilled dialog, bot reply with the card in the thread', async ({ page }) => {
  test.setTimeout(120_000);
  const text = `Checkout button fails on Safari ${rand()}`;
  await signInAsOwner(page);
  const s = await setupSpace(page);
  await apiCall(page, 'POST', `/channels/${s.channelId}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc(text) });
  await page.goto(`/messages/${s.channelId}`);
  const msg = page.getByRole('article').filter({ hasText: text });
  await msg.hover();
  await msg.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Create work item' }).click();

  const dialog = page.getByRole('dialog', { name: 'Create work item' });
  await expect(dialog.getByLabel('Title')).toHaveValue(text);
  // The channel's space is already chosen.
  await expect(dialog.getByRole('combobox', { name: 'Space' })).toContainText(s.key);
  await expect(dialog.getByLabel('Description')).toHaveValue(new RegExp('From chat: .*/messages/'));
  await dialog.getByRole('button', { name: 'Create work item' }).click();
  await expect(page.getByText(/^Created /)).toBeVisible({ timeout: 8000 });

  // The Tasks bot answered in the thread.
  await msg.getByRole('button', { name: /1 repl/ }).click();
  const panel = page.getByRole('complementary');
  await expect(panel.getByText('Tasks').first()).toBeVisible({ timeout: 8000 });
  await expect(panel.getByRole('link', { name: new RegExp(`${s.key}-\\d+`) }).first()).toBeVisible();
});

test('slash commands: the menu lists them, /task mine answers only to you, /dnd works', async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsOwner(page);
  const s = await setupSpace(page);
  await apiCall(page, 'POST', `/spaces/${s.spaceId}/items`, { type: 'task', title: `Mine ${rand()}`, assigneeId: (await apiCall(page, 'GET', '/me')).json.user?.id });
  await page.goto(`/messages/${s.channelId}`);
  await composer(page).click();
  await page.keyboard.type('/');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu.getByRole('option', { name: /\/task/ })).toBeVisible();
  await expect(menu.getByRole('option', { name: /\/status/ })).toBeVisible();
  await expect(menu.getByRole('option', { name: /\/dnd/ })).toBeVisible();
  await page.keyboard.type('task');
  await page.keyboard.press('Tab');
  await page.keyboard.type('mine');
  await page.keyboard.press('Enter');
  const reply = page.getByRole('list', { name: 'Only visible to you' });
  await expect(reply).toBeVisible({ timeout: 8000 });
  // Nothing was posted to the channel.
  await expect(page.getByRole('article').filter({ hasText: '/task' })).toHaveCount(0);

  await composer(page).click();
  await page.keyboard.type('/dnd 15m');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Do not disturb until/)).toBeVisible({ timeout: 8000 });
  await apiCall(page, 'PUT', '/me/dnd', { minutes: null });

  // /task create opens the dialog with the space of this channel.
  await composer(page).click();
  await page.keyboard.type('/task create Write the release notes');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create work item' });
  await expect(dialog.getByLabel('Title')).toHaveValue('Write the release notes');
  await expect(dialog.getByRole('combobox', { name: 'Space' })).toContainText(s.key);
});

test('docked chat on the board, profile popover, and the activity settings', async ({ page }) => {
  test.setTimeout(120_000);
  const hello = `board chat ${rand()}`;
  await signInAsOwner(page);
  const s = await setupSpace(page);
  await page.goto(`/spaces/${s.key}/board`);
  await page.getByRole('button', { name: /^Chat/ }).click();
  const dock = page.getByRole('complementary', { name: new RegExp(`Chat ${s.key} chat`) });
  await expect(dock).toBeVisible({ timeout: 8000 });
  await dock.getByRole('textbox', { name: /^Message / }).click();
  await page.keyboard.type(hello);
  await page.keyboard.press('Enter');
  const posted = dock.getByRole('article').filter({ hasText: hello });
  await expect(posted).toBeVisible({ timeout: 8000 });

  // A name opens the person's card with actions.
  await posted.getByRole('button', { name: /^Owner|Olivia|Alice|Acme/ }).first().click();
  const pop = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'View profile' }).or(page.getByRole('link', { name: 'View profile' })) });
  await expect(pop.getByRole('link', { name: 'View profile' })).toBeVisible({ timeout: 8000 });
  await page.keyboard.press('Escape');

  // The panel stays open when moving around the space, and closes on request.
  await dock.getByRole('button', { name: 'Close chat' }).click();
  await expect(dock).toHaveCount(0);

  // Activity settings live in the channel details, for space admins.
  await page.goto(`/messages/${s.channelId}`);
  await page.getByRole('button', { name: 'Channel details' }).click();
  const details = page.getByRole('complementary').last();
  await expect(details.getByText('Space channel')).toBeVisible({ timeout: 8000 });
  const created = details.getByRole('checkbox', { name: 'A work item is created' });
  await expect(created).toBeChecked();
  const comment = details.getByRole('checkbox', { name: 'Someone comments on a work item' });
  await expect(comment).not.toBeChecked();
  await comment.click();
  await expect(comment).toBeChecked();
  // Leaving is not offered for a space's channel.
  await expect(details.getByRole('button', { name: /Leave channel/ })).toHaveCount(0);
});

test('space chat screens have no accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const s = await setupSpace(page);
  await apiCall(page, 'POST', `/channels/${s.channelId}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc(`Look at ${s.item.key}`) });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/messages/${s.channelId}`);
    await expect(page.getByRole('link', { name: new RegExp(s.item.key) }).first()).toBeVisible({ timeout: 8000 });
    // The panel remembers whether it was open, so only open it when it is closed.
    const toggle = page.getByRole('button', { name: 'Channel details' });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(page.getByText('Space channel', { exact: true })).toBeVisible();
    const a = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-nextjs-dev-tools-button]').analyze();
    expect(a.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `chat (${theme})`).toEqual([]);

    await page.goto(`/spaces/${s.key}/board`);
    await page.getByRole('button', { name: /^Chat/ }).click();
    await expect(page.getByRole('complementary', { name: /chat$/ })).toBeVisible({ timeout: 8000 });
    const b = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-nextjs-dev-tools-button]').analyze();
    expect(b.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `docked (${theme})`).toEqual([]);
    await page.getByRole('button', { name: 'Close chat' }).click();
  }
});
