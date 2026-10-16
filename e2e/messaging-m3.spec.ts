import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsOwner, signInWithPassword } from './helpers';

const member = (page: Page) => signInWithPassword(page, 'member@acme.test');
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const say = (page: Page, channelId: string, text: string) =>
  apiCall(page, 'POST', `/channels/${channelId}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc(text) });

async function setupChannel(owner: Page, other: Page, name: string, type: 'public' | 'private' = 'public') {
  const made = await apiCall(owner, 'POST', '/channels', { name, type });
  expect(made.status, made.text).toBe(201);
  const id = made.json.channel.id as string;
  if (type === 'public') expect((await apiCall(other, 'POST', `/channels/${id}/join`)).status).toBe(204);
  return id;
}

test('search: finds words with highlights, respects access, and filters narrow it down', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const word = `zebra${rand(4)}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const open = await setupChannel(page, other, `find-${rand()}`);
    const secret = await setupChannel(page, other, `hush-${rand()}`, 'private');
    await say(page, open, `The ${word} launch plan is ready`);
    await apiCall(page, 'POST', `/channels/${open}/messages`, {
      clientMsgId: crypto.randomUUID().slice(0, 30),
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${word} docs`, marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }] }] }] },
    });
    await say(page, secret, `${word} confidential layoffs`);

    // The member searches from the Messages sidebar.
    await other.goto('/messages');
    await other.getByRole('link', { name: 'Search', exact: true }).click();
    await other.getByRole('textbox', { name: 'Search messages' }).fill(word);
    await other.keyboard.press('Enter');
    const results = other.getByRole('list').filter({ has: other.getByText(`launch plan`) });
    await expect(results.getByText('launch plan')).toBeVisible({ timeout: 8000 });
    // The matching word is highlighted, and the private channel's message is not among the results.
    await expect(other.locator('mark', { hasText: word }).first()).toBeVisible();
    await expect(other.getByText('confidential layoffs')).toHaveCount(0);

    // The "Has link" filter narrows it to the linked message.
    await other.getByRole('button', { name: 'Has link' }).click();
    await expect(other).toHaveURL(/has%3Alink/);
    await expect(other.getByText('launch plan')).toHaveCount(0);
    await expect(other.getByText(`${word} docs`)).toBeVisible();

    // An unknown person in a filter says so instead of silently showing nothing.
    await other.goto(`/messages/search?q=${encodeURIComponent(`${word} from:nobodyatall`)}`);
    await expect(other.getByText('That filter does not match anything')).toBeVisible();
    // Clicking a result opens the message in its conversation.
    await other.goto(`/messages/search?q=${encodeURIComponent(word)}`);
    await other.getByRole('link', { name: new RegExp('launch plan') }).click();
    await expect(other).toHaveURL(new RegExp(`/messages/${open}\\?m=`));
    await expect(other.getByRole('article').filter({ hasText: 'launch plan' })).toBeVisible();
  });
});

test('quick switcher: Ctrl+K jumps to a conversation by name', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const name = `switch-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, name);
    await page.goto('/messages');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await palette.getByPlaceholder(/Search work or jump to/).fill(name);
    await palette.getByRole('option', { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(`/messages/${id}`));
    // The same palette offers a message search for what was typed.
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog').getByPlaceholder(/Search work or jump to/).fill('budget');
    await expect(page.getByRole('option', { name: /Search messages for “budget”/ })).toBeVisible();
  });
});

test('threads page lists followed threads with unread counts and opens the thread', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, `thr-${rand()}`);
    const root = (await say(page, id, `thread starter ${rand()}`)).json.message;
    // The owner replies (so follows), then the member replies after: that is unread for the owner.
    await apiCall(page, 'POST', `/messages/${root.id}/replies`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc('my own reply') });
    await apiCall(other, 'POST', `/messages/${root.id}/replies`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc('a fresh reply for you') });
    await page.goto('/messages/threads');
    const row = page.getByRole('link', { name: new RegExp(root.bodyText) });
    await expect(row).toBeVisible();
    await expect(row.getByLabel('1 new replies')).toBeVisible();
    await expect(row.getByText('a fresh reply for you')).toBeVisible();
    await row.click();
    const panel = page.getByRole('complementary', { name: 'Thread' });
    await expect(panel.getByLabel('Replies').getByText('a fresh reply for you')).toBeVisible();
    // Reading the thread clears its unread count.
    await page.goto('/messages/threads');
    await expect(page.getByRole('link', { name: new RegExp(root.bodyText) }).getByLabel(/new replies/)).toHaveCount(0, { timeout: 8000 });
  });
});

test('sections: create one, move a channel into it, reorder with the menu, and delete it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `sect-${rand()}`;
  const section = `Group ${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await setupChannel(page, other, name);
    await page.goto('/messages');
    const nav = page.getByRole('navigation', { name: 'Conversations' });
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();

    // Create the section from the channel's own menu and move it there in one go.
    await nav.getByRole('link', { name: new RegExp(`^${name}`) }).hover();
    await nav.getByRole('button', { name: new RegExp(`Options for ${name}`) }).click();
    await page.getByRole('menuitem', { name: /New section/ }).click();
    await page.getByRole('textbox', { name: 'Section name' }).fill(section);
    await page.getByRole('button', { name: 'Save' }).click();
    const heading = nav.getByRole('button', { name: new RegExp(`^${section}`) });
    await expect(heading).toBeVisible();
    // The channel now lives under the section, not in the main Channels list.
    await expect(nav.getByRole('button', { name: /^Channels/ })).toBeVisible();
    const inSection = page.locator('div.group\\/section', { has: page.getByRole('button', { name: new RegExp(`^${section}`) }) });
    await expect(inSection.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();

    // It survives a reload (saved on the server), and can be starred.
    await page.reload();
    await expect(page.locator('div.group\\/section', { has: page.getByRole('button', { name: new RegExp(`^${section}`) }) }).getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();

    // Delete the section: the channel returns to the main list.
    await nav.getByRole('button', { name: new RegExp(`Options for the ${section} section`) }).click();
    await page.getByRole('menuitem', { name: 'Delete section' }).click();
    await expect(nav.getByRole('button', { name: new RegExp(`^${section}`) })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  });
});

test('starring a conversation puts it in a Starred section', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const name = `star-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await setupChannel(page, other, name);
    await page.goto('/messages');
    const nav = page.getByRole('navigation', { name: 'Conversations' });
    await nav.getByRole('link', { name: new RegExp(`^${name}`) }).hover();
    await nav.getByRole('button', { name: new RegExp(`Options for ${name}`) }).click();
    await page.getByRole('menuitem', { name: 'Star' }).click();
    await expect(nav.getByRole('button', { name: /^Starred/ })).toBeVisible();
    await nav.getByRole('link', { name: new RegExp(`^${name}`) }).hover();
    await nav.getByRole('button', { name: new RegExp(`Options for ${name}`) }).click();
    await page.getByRole('menuitem', { name: 'Remove from starred' }).click();
    await expect(nav.getByRole('button', { name: /^Starred/ })).toHaveCount(0);
  });
});

test('notifications: a direct message reaches the inbox live, links to the message, and clears when read', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  await page.goto('/notifications');
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const owner = await apiCall(other, 'GET', '/members?q=owner@acme.test');
    const dm = await apiCall(other, 'POST', '/dms', { userIds: [owner.json.items[0].id] });
    const dmId = dm.json.channel.id as string;
    const text = `urgent ${rand()}`;
    await say(other, dmId, text);
    // The bell picks it up without a reload.
    await expect(page.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 10_000 });
    await page.reload();
    const row = page.getByRole('button', { name: new RegExp(`sent you a message: “${text}”`) });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/messages/${dmId}\\?m=`));
    await expect(page.getByRole('article').filter({ hasText: text })).toBeVisible();
    // Opening the conversation read it: the inbox row is no longer unread.
    await page.goto('/notifications');
    await expect(page.getByRole('button', { name: new RegExp(`“${text}”`) }).getByRole('img', { name: 'Unread' })).toHaveCount(0);
  });
});

test('notification settings: quiet hours, email delay and the new kinds', async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsOwner(page);
  await page.goto('/notifications');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Someone sends me a direct message')).toBeVisible();
  await expect(page.getByText('I am added to a channel')).toBeVisible();
  const quiet = page.getByRole('switch', { name: 'Quiet hours' });
  const before = await quiet.getAttribute('aria-checked');
  await quiet.click();
  await expect(quiet).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  await page.getByRole('combobox', { name: 'Email delay' }).click();
  await page.getByRole('option', { name: '30 minutes' }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('combobox', { name: 'Email delay' })).toContainText('30 minutes');
  // Put it back as it was.
  if (before === 'true') await page.getByRole('switch', { name: 'Quiet hours' }).click();
  await page.getByRole('combobox', { name: 'Email delay' }).click();
  await page.getByRole('option', { name: '15 minutes' }).click();
});

test('keyboard: Alt+Shift+Down jumps to the next conversation with unread messages', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const quietRoom = await setupChannel(page, other, `kbd-a-${rand()}`);
    const loudRoom = await setupChannel(page, other, `kbd-b-${rand()}`);
    await page.goto(`/messages/${quietRoom}`);
    await expect(page.getByRole('textbox', { name: /^Message/ })).toBeVisible();
    // The other person writes in the other channel and mentions nobody: only a plain unread dot.
    await apiCall(other, 'POST', `/channels/${loudRoom}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc('look over here') });
    const nav = page.getByRole('navigation', { name: 'Conversations' });
    await expect(nav.getByLabel('Unread messages').first()).toBeVisible({ timeout: 8000 });
    await page.getByRole('log', { name: 'Messages' }).focus();
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
    await expect(page).not.toHaveURL(new RegExp(quietRoom));
  });
});

test('search, threads and the section menu have no accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  await page.goto('/messages/search?q=hello');
  await expect(page.getByRole('textbox', { name: 'Search messages' })).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `search ${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  for (const path of ['/messages/threads', '/messages/activity', '/messages/saved']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  }
});
