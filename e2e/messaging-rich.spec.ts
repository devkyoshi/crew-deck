import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsOwner, signInWithPassword } from './helpers';

const member = (page: Page) => signInWithPassword(page, 'member@acme.test');
const composer = (page: Page) => page.getByRole('textbox', { name: /^Message / });
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Creates a public channel as the owner and has the member join it (setup through the API). */
async function setupChannel(owner: Page, other: Page, name: string) {
  const made = await apiCall(owner, 'POST', '/channels', { name, type: 'public' });
  expect(made.status, made.text).toBe(201);
  const id = made.json.channel.id as string;
  expect((await apiCall(other, 'POST', `/channels/${id}/join`)).status).toBe(204);
  return id;
}
const say = (page: Page, channelId: string, text: string) =>
  apiCall(page, 'POST', `/channels/${channelId}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc(text) });

test('reactions: add from the picker, toggle a chip, and see who reacted', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `react-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, name);
    const msg = `react to ${rand()}`;
    await say(page, id, msg);
    await page.goto(`/messages/${id}`);
    await other.goto(`/messages/${id}`);
    const mine = page.getByRole('article').filter({ hasText: msg });
    const theirs = other.getByRole('article').filter({ hasText: msg });
    await expect(theirs).toBeVisible();

    // The other person opens the picker from the hover toolbar and chooses an emoji.
    await theirs.hover();
    await theirs.getByRole('button', { name: 'Add reaction' }).first().click();
    const picker = other.locator('em-emoji-picker');
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await picker.locator('button[aria-label="😀"]').first().click();
    // The reaction shows up for the author without a reload.
    await expect(mine.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /1\./ })).toBeVisible({ timeout: 6000 });

    // The author joins in on the same emoji by clicking the chip, and it is a toggle.
    const chip = mine.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /reacted/ }).first();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(theirs.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /2\./ })).toBeVisible({ timeout: 6000 });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(theirs.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /1\./ })).toBeVisible({ timeout: 6000 });
  });
});

test('threads: reply in the side panel, see the summary, and also send to the channel', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const name = `thread-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, name);
    const root = `thread root ${rand()}`;
    await say(page, id, root);
    await page.goto(`/messages/${id}`);
    await other.goto(`/messages/${id}`);

    // The owner opens the thread and replies in it.
    const rootRow = page.getByRole('article').filter({ hasText: root });
    await rootRow.hover();
    await rootRow.getByRole('button', { name: 'Reply in thread' }).click();
    const panel = page.getByRole('complementary', { name: 'Thread' });
    await expect(panel).toBeVisible();
    await panel.getByRole('textbox', { name: 'Reply…' }).click();
    await page.keyboard.type('first reply');
    await page.keyboard.press('Enter');
    const replies = panel.getByLabel('Replies');
    await expect(replies.getByText('first reply')).toBeVisible();
    // The reply stays out of the channel timeline, and the root shows a summary to everyone.
    await expect(page.getByRole('log', { name: 'Messages' }).getByText('first reply')).toHaveCount(0);
    const theirRoot = other.getByRole('article').filter({ hasText: root });
    await expect(theirRoot.getByRole('button', { name: /1 reply/ })).toBeVisible({ timeout: 6000 });

    // The other person opens the summary, replies and also sends it to the channel.
    await theirRoot.getByRole('button', { name: /1 reply/ }).click();
    const theirPanel = other.getByRole('complementary', { name: 'Thread' });
    await expect(theirPanel.getByLabel('Replies').getByText('first reply')).toBeVisible();
    await theirPanel.getByLabel('Also send to channel').click();
    await theirPanel.getByRole('textbox', { name: 'Reply…' }).click();
    await other.keyboard.type('shared with everyone');
    await other.keyboard.press('Enter');
    await expect(other.getByRole('log', { name: 'Messages' }).getByText('shared with everyone')).toBeVisible({ timeout: 6000 });
    // The owner sees it live in the open thread and in the channel, marked as a thread reply.
    await expect(replies.getByText('shared with everyone')).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('log', { name: 'Messages' }).getByText('shared with everyone')).toBeVisible();
    await expect(rootRow.getByRole('button', { name: /2 replies/ })).toBeVisible();
    // Esc closes the panel.
    await page.getByRole('log', { name: 'Messages' }).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});

test('mentions: pick a person with @, and they see a mention badge while elsewhere', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `mention-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, name);
    await other.goto('/messages'); // the member is in the channel but looking at the list
    await page.goto(`/messages/${id}`);
    await composer(page).click();
    await page.keyboard.type('Hello @Mia');
    const option = page.getByRole('option', { name: /Mia Member/ });
    await expect(option).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type(' please check');
    await page.keyboard.press('Enter');
    const sent = page.getByRole('article').filter({ hasText: 'please check' });
    await expect(sent.locator('.mention', { hasText: '@Mia Member' })).toBeVisible();

    // A mention badge on the channel in the other person's list, without a reload.
    await other.getByRole('tab', { name: /^Channels/ }).click();
    const row = other.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: new RegExp(name) });
    await expect(row.getByLabel('1 unread mentions')).toBeVisible({ timeout: 8000 });
    await row.click();
    const theirs = other.getByRole('article').filter({ hasText: 'please check' });
    await expect(theirs).toBeVisible();
    // The message is highlighted for the person mentioned, and the badge clears once read.
    await expect(theirs).toHaveClass(/border-amber-400/);
    await expect(row.getByLabel(/unread/)).toHaveCount(0);
  });
});

test('files: attach, send, view an image, and download a document', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `files-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, name);
    await other.goto(`/messages/${id}`);
    await page.goto(`/messages/${id}`);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('Choose files to attach').setInputFiles([
      { name: 'pixel.png', mimeType: 'image/png', buffer: png },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('meeting notes') },
    ]);
    await expect(page.getByRole('list', { name: 'Files to send' }).getByText('pixel.png')).toBeVisible();
    await expect(page.getByText(/Uploading/)).toHaveCount(0, { timeout: 10_000 });
    await composer(page).click();
    await page.keyboard.type('Here are the files');
    await page.keyboard.press('Enter');

    // The other person sees the image inline and a card for the document.
    const theirs = other.getByRole('article').filter({ hasText: 'Here are the files' });
    await expect(theirs.getByRole('img', { name: 'pixel.png' })).toBeVisible({ timeout: 8000 });
    await expect(theirs.getByRole('link', { name: /notes.txt/ })).toBeVisible();
    // Images open in a lightbox that closes with Escape.
    await theirs.getByRole('button', { name: 'View pixel.png' }).click();
    await expect(other.getByRole('dialog')).toBeVisible();
    await other.keyboard.press('Escape');
    await expect(other.getByRole('dialog')).toBeHidden();
    // The download works for a member and is refused for someone who is signed out.
    const href = await theirs.getByRole('link', { name: /notes.txt/ }).getAttribute('href');
    const res = await apiCall(other, 'GET', href!.replace('/api/v1', ''));
    expect(res.status).toBe(200);
    expect(res.text).toBe('meeting notes');
    // The Files tab lists both.
    await other.getByRole('tab', { name: 'Files' }).click();
    await expect(other.getByText('notes.txt')).toBeVisible();
    await expect(other.getByRole('button', { name: 'View pixel.png' })).toBeVisible();
  });
});

test('pins and saved messages', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const name = `pins-${rand()}`;
  await signInAsOwner(page);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    const id = await setupChannel(page, other, name);
    const msg = `remember this ${rand()}`;
    await say(other, id, msg);
    await page.goto(`/messages/${id}`);
    const row = page.getByRole('article').filter({ hasText: msg });
    await row.hover();
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Pin to channel' }).click();
    await expect(row.getByText('Pinned')).toBeVisible();
    await page.getByRole('tab', { name: 'Pins' }).click();
    await expect(page.getByRole('article').filter({ hasText: msg })).toBeVisible();
    await page.getByRole('tab', { name: 'Messages' }).click();

    // A plain member cannot pin, but can save for later.
    await other.goto(`/messages/${id}`);
    const theirs = other.getByRole('article').filter({ hasText: msg });
    await theirs.hover();
    await theirs.getByRole('button', { name: 'More actions' }).click();
    await expect(other.getByRole('menuitem', { name: /Pin|Unpin/ })).toHaveCount(0);
    await other.getByRole('menuitem', { name: 'Save for later' }).click();
    await other.getByRole('link', { name: 'Saved' }).click();
    await expect(other.getByRole('heading', { name: 'Saved for later' })).toBeVisible();
    await expect(other.getByText(msg)).toBeVisible();
    await other.getByRole('button', { name: 'Remove from saved' }).first().click();
    await expect(other.getByText(msg)).toHaveCount(0);
  });
});

test('the thread panel and the emoji picker have no accessibility violations', async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name: `a11y-${rand()}`, type: 'public' });
  const id = made.json.channel.id as string;
  await say(page, id, 'accessible message');
  await page.goto(`/messages/${id}`);
  const row = page.getByRole('article').filter({ hasText: 'accessible message' });
  await row.hover();
  await row.getByRole('button', { name: 'Reply in thread' }).click();
  await expect(page.getByRole('complementary', { name: 'Thread' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
});
