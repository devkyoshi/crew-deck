import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsOwner } from './helpers';

test('create, open, edit and organise work items on a space board', async ({ page }) => {
  test.setTimeout(120_000);
  const tag = rand(2).toUpperCase();
  const key = `W${tag}`;
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/spaces', { key, name: `Work ${tag}` });
  expect(made.status, made.text).toBe(200);

  // A new space starts with the four default columns and an empty-board prompt.
  await page.goto(`/spaces/${key}/board`);
  for (const name of ['To Do', 'In Progress', 'In Review', 'Done']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText('No work items yet').first()).toBeVisible();

  // Inline create in the first column: Enter creates the item and gives it the first key.
  await page.getByRole('button', { name: 'Create', exact: true }).first().click();
  await page.getByLabel('Title of the new item').fill('Write the spec');
  await page.getByLabel('Title of the new item').press('Enter');
  await expect(page.getByRole('article', { name: `${key}-1 Write the spec` })).toBeVisible();
  await expect(page.getByText('No work items yet')).toHaveCount(0);

  // The "C" shortcut opens the full create dialog, with "create another".
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'Create work item' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Bug' }).click();
  await dialog.getByLabel('Title').fill('Login button does nothing');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('article', { name: `${key}-2 Login button does nothing` })).toBeVisible();

  // Open the card in the side panel and edit it; the board stays visible behind it.
  await page.getByRole('button', { name: new RegExp(`^${key}-1: Write the spec`) }).click();
  const panel = page.getByRole('dialog').filter({ hasText: `${key}-1` });
  await expect(panel.getByLabel('Title')).toHaveValue('Write the spec');
  await panel.getByLabel('Title').fill('Write the product spec');
  await panel.getByLabel('Title').press('Enter');
  await expect(panel.getByText('Saved')).toBeVisible();
  await panel.getByRole('combobox', { name: 'Priority' }).click();
  await page.getByRole('option', { name: 'Highest' }).click();
  await panel.getByRole('button', { name: '5', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'In Progress' }).click();
  await expect(panel.getByText('Saved')).toBeVisible();

  // Add a subtask from the panel.
  await panel.getByRole('button', { name: 'Add' }).click();
  await panel.getByLabel('Subtask title').fill('Draft outline');
  await panel.getByLabel('Subtask title').press('Enter');
  await expect(panel.getByText('Draft outline')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();

  // The changes persisted: the card is now in In Progress with its new title, and shows progress.
  await page.reload();
  const card = page.getByRole('article', { name: `${key}-1 Write the product spec` });
  await expect(card).toBeVisible();
  await expect(card.getByText('0/1')).toBeVisible();
  const inProgress = page.locator('section').filter({ has: page.getByRole('heading', { name: 'In Progress', exact: true }) });
  await expect(inProgress.getByRole('article', { name: `${key}-1 Write the product spec` })).toBeVisible();

  // The panel closes with Escape too, and the open item lives in the URL.
  await card.locator('[data-card-open]').click();
  await expect(page).toHaveURL(new RegExp(`item=${key}-1`));
  await expect(page.getByRole('dialog').getByLabel('Title')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).not.toHaveURL(/item=/);

  // The shareable full page for an item.
  await page.goto(`/spaces/${key}/items/${key}-2`);
  await expect(page.getByLabel('Title')).toHaveValue('Login button does nothing');

  // Board settings: add a status, and it becomes a column.
  await page.goto(`/spaces/${key}/board`);
  await page.getByRole('button', { name: 'Board settings' }).click();
  await page.getByLabel('New status').fill('Blocked');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Name of Blocked')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Blocked', exact: true })).toBeVisible();

  // Card menu: move to another status.
  await page.getByRole('button', { name: `Actions for ${key}-2` }).click();
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  const done = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Done', exact: true }) });
  await expect(done.getByRole('article', { name: new RegExp(`${key}-2`) })).toBeVisible();
});

test('the board, item panel and settings pass the automated accessibility scan', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const scan = async (label: string, modalOpen = false) => {
    const results = await new AxeBuilder({ page })
      .disableRules(modalOpen ? ['aria-hidden-focus'] : [])
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('nextjs-portal')
      .exclude('[data-nextjs-dev-tools-button]')
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`,
    );
    expect(summary, `${label} has accessibility violations`).toEqual([]);
  };
  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/spaces/ENG/board');
    await page.evaluate((t) => window.localStorage.setItem('theme', t), theme);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'To Do', exact: true })).toBeVisible();
    await scan(`board (${theme})`);
    await page.getByRole('button', { name: /^ENG-2: Let customers/ }).click();
    await expect(page.getByRole('dialog').getByLabel('Title')).toBeVisible();
    await scan(`item panel (${theme})`, true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Board settings' }).click();
    await expect(page.getByLabel('New status')).toBeVisible();
    await scan(`board settings (${theme})`, true);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('New status')).toBeHidden();
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: 'Create work item' })).toBeVisible();
    await page.waitForTimeout(500); // let the opening animation finish before measuring contrast
    await scan(`create dialog (${theme})`, true);
  }
});
