import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsOwner } from './helpers';

test('find work: list view, epics, My work, search and saved filters', async ({ page }) => {
  test.setTimeout(150_000);
  const key = `F${rand(2).toUpperCase()}`;
  const word = `quokka${rand(2)}`;
  await signInAsOwner(page);
  const space = await apiCall(page, 'POST', '/spaces', { key, name: `Find ${key}` });
  expect(space.status, space.text).toBe(200);
  const me = (await apiCall(page, 'GET', '/me')).json.user.id as string;
  const epic = (await apiCall(page, 'POST', `/spaces/${key}/items`, { type: 'epic', title: 'Launch' })).json;
  for (const [title, priority, type] of [
    [`Low ${word} task`, 'low', 'task'],
    [`Urgent ${word} bug`, 'highest', 'bug'],
    ['Middle task', 'medium', 'task'],
  ] as const) {
    const made = await apiCall(page, 'POST', `/spaces/${key}/items`, {
      type,
      title,
      priority,
      parentId: epic.id,
      assigneeId: me,
      estimate: 2,
    });
    expect(made.status, made.text).toBe(200);
  }

  // List view: sort by priority, filter by type, open an item in the side panel.
  await page.goto(`/spaces/${key}/list`);
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(5); // header + epic + three items
  await table.getByRole('button', { name: 'Priority' }).click();
  await expect(page).toHaveURL(/sort=priority&dir=desc/);
  await table.getByRole('button', { name: 'Priority' }).click(); // now ascending: highest first
  await expect(page).toHaveURL(/dir=asc/);
  await expect(table.getByRole('row').nth(1)).toContainText('Urgent');
  await page.getByRole('button', { name: /^Type/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Bug' }).click();
  await page.keyboard.press('Escape');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(page).toHaveURL(/type=bug/);

  // Save the filter and use it again later.
  await page.getByRole('button', { name: 'Saved' }).click();
  await page.getByRole('menuitem', { name: 'Save current filters…' }).click();
  await page.getByLabel('Name').fill('Bugs only');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Filter saved')).toBeVisible();
  await page.goto(`/spaces/${key}/list`);
  await expect(table.getByRole('row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Saved' }).click();
  await page.getByRole('menuitem', { name: 'Bugs only' }).click();
  await expect(table.getByRole('row')).toHaveCount(2);

  await table.getByRole('button', { name: `Urgent ${word} bug` }).click();
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue(`Urgent ${word} bug`);
  await page.keyboard.press('Escape');

  // Epics: progress and children.
  await page.getByRole('link', { name: 'Epics', exact: true }).click();
  await expect(page.getByText('0/3 · 0/6 pts')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Show the .* in ${key}-1`) }).click();
  await expect(page.getByRole('button', { name: 'Middle task' })).toBeVisible();

  // My work lists what is assigned to me, grouped by space.
  await page.goto('/my-work');
  await expect(page.getByRole('region', { name: `Find ${key}` })).toContainText(`Urgent ${word} bug`);

  // Ctrl+K finds items by words and by key.
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search work or jump to…').fill(word);
  await expect(page.getByRole('option', { name: new RegExp(`Urgent ${word} bug`) })).toBeVisible();
  await page.getByPlaceholder('Search work or jump to…').fill(`${key}-3`);
  await page.getByRole('option', { name: new RegExp(`${key}-3`) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}/items/${key}-3$`));

  // The full search page.
  await page.goto(`/search?q=${word}`);
  await expect(page.getByRole('button', { name: `Low ${word} task` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Urgent ${word} bug` })).toBeVisible();

  for (const path of [`/spaces/${key}/list`, `/spaces/${key}/epics`, '/my-work', `/search?q=${word}`]) {
    await page.goto(path);
    await expect(page.locator('#main')).toBeVisible();
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('nextjs-portal')
      .exclude('[data-nextjs-dev-tools-button]')
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`),
      `${path} has accessibility violations`,
    ).toEqual([]);
  }
});
