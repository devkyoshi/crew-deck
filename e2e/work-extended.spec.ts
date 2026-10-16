import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, rand, signInAsOwner } from './helpers';

const ymd = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');

async function newSpace(page: Page, tag: string) {
  const key = `X${tag.toUpperCase()}`;
  const made = await apiCall(page, 'POST', '/spaces', { key, name: `Extended ${tag}` });
  expect(made.status, made.text).toBe(200);
  return { key, id: made.json.id as string };
}
async function newItem(page: Page, spaceId: string, body: object) {
  const res = await apiCall(page, 'POST', `/spaces/${spaceId}/items`, { type: 'story', title: 'Story', ...body });
  expect(res.status, res.text).toBe(200);
  return res.json as { id: string; key: string };
}

test('releases: create a version, plan work into it, release it and read the notes', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const { key, id } = await newSpace(page, rand(2));
  const done = (await apiCall(page, 'GET', `/spaces/${id}/statuses`)).json.items.find((s: { category: string }) => s.category === 'done');
  const finished = await newItem(page, id, { title: 'Ship the thing' });
  await newItem(page, id, { title: 'Not ready yet' });
  const version = (await apiCall(page, 'POST', `/spaces/${id}/versions`, { name: '1.0' })).json;
  expect((await apiCall(page, 'GET', `/items/${finished.id}`)).status).toBe(200);
  for (const title of ['Ship the thing', 'Not ready yet']) {
    const list = (await apiCall(page, 'GET', `/spaces/${id}/list`)).json.items as { id: string; title: string; updatedAt: string }[];
    const it = list.find((i) => i.title === title)!;
    await page.evaluate(
      async ({ itemId, updatedAt, versionId }) => {
        await fetch(`/api/v1/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'if-match': updatedAt },
          body: JSON.stringify({ fixVersionIds: [versionId] }),
        });
      },
      { itemId: it.id, updatedAt: it.updatedAt, versionId: version.id },
    );
  }
  const fresh = (await apiCall(page, 'GET', `/items/${finished.id}`)).json;
  await page.evaluate(
    async ({ itemId, updatedAt, statusId }) => {
      await fetch(`/api/v1/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': updatedAt },
        body: JSON.stringify({ statusId }),
      });
    },
    { itemId: finished.id, updatedAt: fresh.updatedAt, statusId: done.id },
  );

  await page.goto(`/spaces/${key}/releases`);
  await expect(page.getByRole('heading', { name: '1.0', exact: true })).toBeVisible();
  await expect(page.getByText('1 of 2 done, 1 open')).toBeVisible();

  await page.getByRole('button', { name: 'Release', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Release 1.0/ });
  await expect(dialog.getByText('1 item is not finished')).toBeVisible();
  await dialog.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.getByText('released', { exact: false }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Notes' }).click();
  const notes = page.getByRole('dialog', { name: /release notes/ });
  await expect(notes.getByRole('link', { name: /Ship the thing/ })).toBeVisible();
});

test('time tracking, roadmap and calendar', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const { key, id } = await newSpace(page, rand(2));
  const epic = await newItem(page, id, { type: 'epic', title: 'Big plan', startDate: ymd(-3), dueDate: ymd(20) });
  const story = await newItem(page, id, { title: 'Due soon', dueDate: ymd(0), parentId: epic.id, originalMinutes: 120 });

  // Log time from the item page.
  await page.goto(`/spaces/${key}/items/${story.key}`);
  const time = page.getByRole('region', { name: 'Time tracking' });
  await time.getByLabel('Time worked').fill('1h 15m');
  await time.getByRole('button', { name: 'Log time' }).click();
  await expect(time.getByText(/1h 15m logged/)).toBeVisible();
  await expect(time.getByText(/45m remaining/)).toBeVisible();
  await time.getByLabel('Time worked').fill('soon');
  await time.getByRole('button', { name: 'Log time' }).click();
  await expect(time.getByRole('alert')).toBeVisible();

  // The roadmap draws the epic; Enter on its bar opens the dates.
  await page.goto(`/spaces/${key}/roadmap`);
  const bar = page.getByRole('button', { name: new RegExp(`^${epic.key} Big plan, `) });
  await expect(bar).toBeVisible();
  await bar.focus();
  await bar.press('Enter');
  const dates = page.getByRole('dialog', { name: new RegExp(`Dates for ${epic.key}`) });
  await dates.getByLabel('Due').fill(ymd(40));
  await dates.getByRole('button', { name: 'Save' }).click();
  await expect(dates).toBeHidden();
  await page.getByText('Show the dates as a table').click();
  await expect(page.getByRole('cell', { name: ymd(40) })).toBeVisible();

  // The calendar lists the item on its due day.
  await page.goto(`/spaces/${key}/calendar`);
  await expect(page.getByRole('button', { name: /Due soon/ })).toBeVisible();
});

test('documents: folders, subfolders, upload and drag into a folder', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const { key } = await newSpace(page, rand(2));
  await page.goto(`/spaces/${key}/documents`);
  await expect(page.getByText('No documents yet')).toBeVisible();

  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Specs');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('button', { name: 'Specs', exact: true })).toBeVisible();

  // A subfolder from the folder's own menu.
  await page.getByRole('button', { name: 'Actions for Specs' }).click();
  await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Checkout');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

  await page.getByLabel('Choose files to upload').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('link', { name: 'plan.txt' })).toBeVisible();

  // Drag the file onto the folder with the mouse.
  const handle = page.getByRole('button', { name: 'Drag plan.txt to a folder' });
  const target = page.getByRole('button', { name: 'Specs', exact: true });
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('link', { name: 'plan.txt' })).toBeHidden();
  await target.click();
  await expect(page.getByRole('link', { name: 'plan.txt' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Specs' })).toBeVisible();
});

test('dashboard: add a tile and keep it', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Assigned to me' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a tile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a tile' });
  await dialog.getByRole('combobox', { name: 'Tile' }).click();
  await page.getByRole('option', { name: 'Release progress' }).click();
  await dialog.getByRole('combobox', { name: 'Space' }).click();
  await page.getByRole('option').first().click();
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('region', { name: 'Release progress' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Release progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the default' }).click();
  await expect(page.getByRole('region', { name: 'Release progress' })).toHaveCount(0);
});

test('another workspace cannot reach versions, documents, time or dashboards of this one', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const { id } = await newSpace(page, rand(2));
  const version = (await apiCall(page, 'POST', `/spaces/${id}/versions`, { name: 'secret' })).json;
  const folder = (await apiCall(page, 'POST', `/spaces/${id}/folders`, { name: 'private docs' })).json;
  const item = await newItem(page, id, { title: 'Hidden' });
  const log = (await apiCall(page, 'POST', `/items/${item.id}/worklogs`, { minutes: 30 })).json;

  const ctx = await browser.newContext({ baseURL: 'http://globex.localhost:3000' });
  const other = await ctx.newPage();
  try {
    await other.goto('/sign-in');
    await other.getByLabel('Email', { exact: true }).fill('owner@globex.test');
    await other.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'dev@1234');
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(other.getByRole('heading', { name: /Hello/ })).toBeVisible();
    for (const [method, path] of [
      ['GET', `/spaces/${id}/versions`],
      ['GET', `/versions/${version.id}/notes`],
      ['GET', `/spaces/${id}/documents`],
      ['DELETE', `/folders/${folder.id}`],
      ['GET', `/items/${item.id}/worklogs`],
      ['DELETE', `/worklogs/${log.id}`],
      ['GET', `/spaces/${id}/roadmap`],
      ['GET', `/spaces/${id}/reports`],
    ] as const) {
      const res = await apiCall(other, method, path);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // A dashboard cannot pin a space of another workspace.
    const pin = await apiCall(other, 'PUT', '/me/dashboard', { gadgets: [{ type: 'sprint', spaceId: id }] });
    expect(pin.status).toBe(422);
  } finally {
    await ctx.close();
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`new screens have no accessibility violations (${scheme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await signInAsOwner(page);
    const { key, id } = await newSpace(page, rand(2));
    await apiCall(page, 'POST', `/spaces/${id}/versions`, { name: '2.0' });
    await newItem(page, id, { type: 'epic', title: 'Epic', startDate: ymd(-2), dueDate: ymd(10) });
    for (const path of [`/spaces/${key}/releases`, `/spaces/${key}/roadmap`, `/spaces/${key}/calendar`, `/spaces/${key}/documents`, `/spaces/${key}/reports`, '/dashboard']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        results.violations.map((v) => `${v.id} on ${path}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        path,
      ).toEqual([]);
    }
  });
}
