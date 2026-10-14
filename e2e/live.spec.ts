import { expect, test } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsOwner } from './helpers';

test('two browsers see each other’s changes on the board within about a second', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const key = `V${rand(2).toUpperCase()}`;
  await signInAsOwner(page);
  const space = await apiCall(page, 'POST', '/spaces', { key, name: `Live ${key}` });
  expect(space.status, space.text).toBe(200);
  await page.goto(`/spaces/${key}/board`);
  await expect(page.getByRole('heading', { name: 'To Do', exact: true })).toBeVisible();
  // Let the live stream connect before the other person acts.
  await page.waitForTimeout(1000);

  await asAnotherPerson(browser, async (other) => {
    await signInAsOwner(other);
    const made = await apiCall(other, 'POST', `/spaces/${key}/items`, { type: 'task', title: 'Arrives by itself' });
    expect(made.status, made.text).toBe(200);
    const started = Date.now();
    await expect(page.getByRole('article', { name: `${key}-1 Arrives by itself` })).toBeVisible({ timeout: 3000 });
    expect(Date.now() - started).toBeLessThan(2500);

    // A move in the other browser shows up too.
    const statuses = (await apiCall(other, 'GET', `/spaces/${key}/statuses`)).json.items as { id: string; name: string }[];
    const doing = statuses.find((s) => s.name === 'In Progress')!;
    const moved = await other.evaluate(
      async ({ id, version, statusId }) =>
        (
          await fetch(`/api/v1/items/${id}/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'if-match': version },
            body: JSON.stringify({ statusId }),
          })
        ).status,
      { id: made.json.id, version: made.json.updatedAt, statusId: doing.id },
    );
    expect(moved).toBe(200);
    const column = page.getByRole('list', { name: /^In Progress,/ });
    await expect(column.getByRole('article', { name: `${key}-1 Arrives by itself` })).toBeVisible({ timeout: 3000 });
  });
});
