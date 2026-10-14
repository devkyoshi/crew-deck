import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsOwner } from './helpers';

test('plan, run and complete a sprint, then read its report', async ({ page }) => {
  test.setTimeout(180_000);
  const key = `S${rand(2).toUpperCase()}`;
  await signInAsOwner(page);
  const tabs = page.getByRole('navigation', { name: 'Space sections' });
  const space = await apiCall(page, 'POST', '/spaces', { key, name: `Scrum ${key}`, boardType: 'scrum' });
  expect(space.status, space.text).toBe(200);
  for (const [title, estimate] of [['Login page', 3], ['Password reset', 5], ['Audit trail', 2]] as const) {
    const made = await apiCall(page, 'POST', `/spaces/${key}/items`, { type: 'story', title, estimate });
    expect(made.status, made.text).toBe(200);
  }

  // The board points to the backlog until a sprint runs.
  await page.goto(`/spaces/${key}/board`);
  await expect(page.getByText('No active sprint')).toBeVisible();
  await page.getByRole('link', { name: 'Go to the backlog' }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}/backlog`));

  // Plan: create a sprint and move two stories into it (menu and keyboard friendly).
  await page.getByRole('button', { name: 'Create sprint' }).click();
  const sprintName = `${key} Sprint 1`;
  const sprint = page.getByRole('region', { name: sprintName });
  await expect(sprint).toBeVisible();
  for (const n of [1, 2]) {
    await page.getByRole('button', { name: `Move ${key}-${n}` }).click();
    await page.getByRole('menuitem', { name: sprintName }).click();
    await expect(sprint.getByRole('button', { name: `Move ${key}-${n}` })).toBeVisible();
  }
  await expect(sprint).toContainText('2 work items · 8 pts');

  // Start it from the dialog.
  await sprint.getByRole('button', { name: 'Start sprint' }).click();
  const start = page.getByRole('dialog', { name: `Start ${sprintName}` });
  await start.getByLabel('Goal (optional)').fill('Sign-in works end to end');
  await start.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText(/started with 2 work items \(8 pts\)/)).toBeVisible();
  await expect(sprint.getByText('Active')).toBeVisible();

  // The board shows the running sprint only.
  await tabs.getByRole('link', { name: 'Board', exact: true }).click();
  await expect(page.getByText('Goal: Sign-in works end to end')).toBeVisible();
  await expect(page.getByRole('article', { name: new RegExp(`${key}-1 Login page`) })).toBeVisible();
  await expect(page.getByRole('article', { name: new RegExp(`${key}-3 Audit trail`) })).toHaveCount(0);

  // Finish one story, then complete the sprint, moving the rest to a new sprint.
  const item = await apiCall(page, 'GET', `/items/${key}-1`);
  const statuses = (await apiCall(page, 'GET', `/spaces/${key}/statuses`)).json.items as { id: string; category: string }[];
  const done = statuses.find((s) => s.category === 'done')!;
  const patched = await page.evaluate(
    async ({ id, version, statusId }) =>
      (await fetch(`/api/v1/items/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': version }, body: JSON.stringify({ statusId }) })).status,
    { id: item.json.id, version: item.json.updatedAt, statusId: done.id },
  );
  expect(patched).toBe(200);
  // The change above went straight to the API, so load the backlog afresh.
  await page.goto(`/spaces/${key}/backlog`);
  await expect(sprint).toContainText('· 1 done');
  await sprint.getByRole('button', { name: 'Complete sprint' }).click();
  const complete = page.getByRole('dialog', { name: `Complete ${sprintName}` });
  await expect(complete).toContainText('1 work item done (3 pts). 1 work item not finished.');
  await complete.getByRole('button', { name: 'Complete sprint' }).click();
  await expect(page.getByText(new RegExp(`completed; 1 work item moved to ${key} Sprint 2`))).toBeVisible();
  const next = page.getByRole('region', { name: `${key} Sprint 2` });
  await expect(next.getByText('carry-overs')).toHaveCount(1);

  // Reports: the burndown and what got done.
  await tabs.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('img', { name: /Burndown for .*: 8 points at the start/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Completed', exact: true })).toContainText('Login page');
  await expect(page.getByRole('region', { name: 'Not completed' })).toContainText('Password reset');

  for (const path of [`/spaces/${key}/backlog`, `/spaces/${key}/reports`]) {
    await page.goto(path);
    await expect(page.locator('#main')).toBeVisible();
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('nextjs-portal')
      .exclude('[data-nextjs-dev-tools-button]')
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), path).toEqual([]);
  }
});
