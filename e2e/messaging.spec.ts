import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, asAnotherPerson, createMember, rand, signInAsOwner, signInWithPassword } from './helpers';

const member = (page: Page) => signInWithPassword(page, 'member@acme.test');

/** Opens a channel from the conversation list. */
async function openChannel(page: Page, name: string) {
  await page.goto('/messages');
  await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const composer = (page: Page) => page.getByRole('textbox', { name: /^Message / });

test('two browsers chat in real time and see each other’s typing', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const hello = `hello ${rand()}`;
  const reply = `reply ${rand()}`;
  await signInAsOwner(page);
  await openChannel(page, 'general');

  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await openChannel(other, 'general');

    await composer(page).click();
    await page.keyboard.type(hello);
    // The other person sees the typing signal before the message is sent.
    await expect(other.getByText(/is typing/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Enter');
    await expect(other.getByRole('article').filter({ hasText: hello })).toBeVisible({ timeout: 5000 });

    await composer(other).click();
    await other.keyboard.type(reply);
    await other.keyboard.press('Enter');
    await expect(page.getByRole('article').filter({ hasText: reply })).toBeVisible({ timeout: 5000 });
    // Sent messages are not left looking pending.
    await expect(page.getByRole('article', { name: 'Sending message' })).toHaveCount(0);
  });
});

test('Shift+Enter adds a line, formatting is kept, and an edit shows as edited', async ({ page }) => {
  const word = `fmt${rand()}`;
  await signInAsOwner(page);
  await openChannel(page, 'general');
  await composer(page).click();
  await page.keyboard.press('Control+b');
  await page.keyboard.type(word);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  await page.keyboard.press('Enter');
  const sent = page.getByRole('article').filter({ hasText: word });
  await expect(sent.locator('strong', { hasText: word })).toBeVisible();
  await expect(sent.getByText('second line')).toBeVisible();

  // Up in an empty composer edits the last message.
  await composer(page).click();
  await page.keyboard.press('ArrowUp');
  const editor = sent.getByRole('textbox');
  await expect(editor).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type(' (fixed)');
  await sent.getByRole('button', { name: 'Save changes' }).click();
  await expect(sent.getByText('(edited)')).toBeVisible();
  await expect(sent.getByText('(fixed)')).toBeVisible();
});

test('a direct message shows an unread badge until it is opened', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const person = await createMember(`Dm Friend ${rand()}`);
  const text = `dm ${rand()}`;
  await signInAsOwner(page);
  await page.goto('/messages');

  await asAnotherPerson(browser, async (other) => {
    await signInWithPassword(other, person.email).catch(async () => {
      // Created without a password: use the development sign-in box instead.
      await other.goto('/sign-in');
      await other.getByLabel('Dev login email').fill(person.email);
      await other.getByRole('button', { name: 'Dev sign in' }).click();
      await expect(other.getByRole('heading', { name: /Hello/ })).toBeVisible();
    });
    const owner = await apiCall(other, 'GET', '/members?q=owner@acme.test');
    const ownerId = owner.json.items[0].id as string;
    const dm = await apiCall(other, 'POST', '/dms', { userIds: [ownerId] });
    expect(dm.status, dm.text).toBe(200);
    await other.goto(`/messages/${dm.json.channel.id}`);
    await composer(other).click();
    await other.keyboard.type(text);
    await other.keyboard.press('Enter');
    await expect(other.getByRole('article').filter({ hasText: text })).toBeVisible();
  });

  // The owner never reloaded: the DM and its badge arrive on their own.
  const nav = page.getByRole('navigation', { name: 'Conversations' });
  const row = nav.getByRole('link', { name: person.name });
  await expect(row.getByLabel(/1 unread/)).toBeVisible({ timeout: 8000 });
  await row.click();
  await expect(page.getByRole('article').filter({ hasText: text })).toBeVisible();
  await expect(row.getByLabel(/unread/)).toHaveCount(0);
});

test('a missed message appears after the connection comes back', async ({ page, browser, context }) => {
  test.setTimeout(120_000);
  const text = `while away ${rand()}`;
  await signInAsOwner(page);
  await openChannel(page, 'general');
  await page.waitForTimeout(800);

  await context.setOffline(true);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await openChannel(other, 'general');
    await composer(other).click();
    await other.keyboard.type(text);
    await other.keyboard.press('Enter');
    await expect(other.getByRole('article').filter({ hasText: text })).toBeVisible();
  });
  await context.setOffline(false);
  await expect(page.getByRole('article').filter({ hasText: text })).toBeVisible({ timeout: 20_000 });
  // Exactly once: no duplicate from the live push and the catch-up.
  await expect(page.getByRole('article').filter({ hasText: text })).toHaveCount(1);
});

test('creating a channel walks through the steps and opens it', async ({ page }) => {
  const name = `proj-${rand()}`;
  await signInAsOwner(page);
  await page.goto('/messages');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Create a channel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a channel' });
  await dialog.getByLabel('Name').fill(name.toUpperCase().replace('-', ' '));
  await expect(dialog.getByLabel('Name')).toHaveValue(name);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByLabel('Topic (optional)').fill('Launch planning');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText(`#${name}`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText(`Nothing in #${name} yet`)).toBeVisible();
  // A second channel with the same name is refused with a clear message.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Create a channel' }).click();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  await expect(dialog.getByText('A channel with that name already exists.')).toBeVisible();
});

test('a person outside the channel cannot open a private channel', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const name = `secret-${rand()}`;
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name, type: 'private' });
  expect(made.status, made.text).toBe(201);
  await asAnotherPerson(browser, async (other) => {
    await member(other);
    await other.goto(`/messages/${made.json.channel.id}`);
    await expect(other.getByText('Conversation not found')).toBeVisible();
    await other.goto('/messages');
    await expect(other.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
  });
});

test('the messages screen has no accessibility violations', async ({ page }) => {
  await signInAsOwner(page);
  await openChannel(page, 'general');
  await expect(composer(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
});
