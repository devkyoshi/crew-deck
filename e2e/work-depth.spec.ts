import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsOwner } from './helpers';

// A tiny real PNG (1x1), so the server recognises it as an image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('describe, discuss, attach, link and follow the history of a work item', async ({ page }) => {
  test.setTimeout(150_000);
  const key = `D${rand(2).toUpperCase()}`;
  await signInAsOwner(page);
  const space = await apiCall(page, 'POST', '/spaces', { key, name: `Depth ${key}` });
  expect(space.status, space.text).toBe(200);
  for (const title of ['Pour the foundation', 'Order concrete']) {
    const made = await apiCall(page, 'POST', `/spaces/${key}/items`, { type: 'task', title });
    expect(made.status, made.text).toBe(200);
  }

  await page.goto(`/spaces/${key}/board`);
  await page.getByRole('button', { name: new RegExp(`^${key}-1: Pour the foundation`) }).click();
  const panel = page.getByRole('dialog').filter({ hasText: `${key}-1` });
  await expect(panel.getByLabel('Title')).toHaveValue('Pour the foundation');

  // Rich description with a mention; it saves by itself.
  const description = panel.getByRole('textbox', { name: 'Description' });
  await description.click();
  await page.keyboard.type('Check the levels with ');
  await page.keyboard.type('@Mia');
  await page.getByRole('option', { name: /Mia Member/ }).click();
  await panel.getByRole('region', { name: 'Description' }).getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type(' today');
  await expect(panel.getByText('Saved')).toBeVisible({ timeout: 10_000 });

  // A comment that mentions someone.
  const composer = panel.getByRole('textbox', { name: 'Add a comment' });
  await composer.click();
  await page.keyboard.type('Booked the pump for Monday, ');
  await page.keyboard.type('@Max');
  await page.getByRole('option', { name: /Max Member/ }).click();
  await panel.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(panel.getByText('Booked the pump for Monday')).toBeVisible();
  await expect(composer).toHaveText('');

  // Attach a photo: it shows as a preview and opens larger.
  await panel.getByLabel('Choose files to attach').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG });
  await expect(panel.getByRole('button', { name: 'Preview site.png' })).toBeVisible();
  await panel.getByRole('button', { name: 'Preview site.png' }).click();
  await expect(page.getByRole('img', { name: 'site.png' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Link the other item from the actions menu.
  await panel.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /^Link/ }).click();
  await panel.getByPlaceholder(/type a key from another space/).fill(`${key}-2`);
  await panel.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(panel.getByRole('button', { name: new RegExp(`${key}-2\\s*Order concrete`) })).toBeVisible();

  // The history tells the story, newest first, and the owner now watches the item.
  await panel.getByRole('tab', { name: 'Activity' }).click();
  const history = panel.getByRole('list', { name: 'History, newest first' });
  await expect(history).toContainText(`linked: this relates to ${key}-2`);
  await expect(history).toContainText('attached site.png');
  await expect(history).toContainText('commented: “Booked the pump for Monday, @Max Member”');
  await expect(history).toContainText('updated the description');
  await expect(history).toContainText('created this work item');
  await panel.getByRole('tab', { name: 'Watchers' }).click();
  await expect(panel.getByRole('button', { name: 'Stop watching' }).last()).toBeVisible();

  // Everything survives a reload.
  await page.reload();
  const again = page.getByRole('dialog').filter({ hasText: `${key}-1` });
  await expect(again.getByText('Booked the pump for Monday')).toBeVisible();
  await expect(again.locator('.rich-text .mention', { hasText: '@Mia Member' })).toBeVisible();
  await expect(again.locator('.rich-text strong', { hasText: 'today' })).toBeVisible();

  // Accessibility of the full item panel.
  const results = await new AxeBuilder({ page })
    .disableRules(['aria-hidden-focus'])
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('nextjs-portal')
    .exclude('[data-nextjs-dev-tools-button]')
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, 'item panel has accessibility violations').toEqual([]);
});

test('duplicate an item and move it to another space', async ({ page }) => {
  test.setTimeout(120_000);
  const a = `M${rand(2).toUpperCase()}`;
  const b = `N${rand(2).toUpperCase()}`;
  await signInAsOwner(page);
  for (const key of [a, b]) {
    const made = await apiCall(page, 'POST', '/spaces', { key, name: `Space ${key}` });
    expect(made.status, made.text).toBe(200);
  }
  const item = await apiCall(page, 'POST', `/spaces/${a}/items`, { type: 'task', title: 'Fix the gate' });
  expect(item.status, item.text).toBe(200);

  await page.goto(`/spaces/${a}/items/${a}-1`);
  await expect(page.getByLabel('Title')).toHaveValue('Fix the gate');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await page.getByRole('dialog', { name: `Duplicate ${a}-1?` }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(new RegExp(`/items/${a}-2$`));
  await expect(page.getByLabel('Title')).toHaveValue('Fix the gate (copy)');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to another space' }).click();
  const dialog = page.getByRole('dialog', { name: `Move ${a}-2 to another space` });
  await dialog.getByRole('combobox', { name: 'Space to move to' }).click();
  await page.getByRole('option', { name: `Space ${b} (${b})` }).click();
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${b}/items/${b}-1$`));
  await expect(page.getByLabel('Title')).toHaveValue('Fix the gate (copy)');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('list', { name: 'History, newest first' })).toContainText(`moved this from ${a} to ${b} (it was ${a}-2)`);
});
