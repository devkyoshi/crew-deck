import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, rand, signInAsOwner } from './helpers';

type Made = { key: string; id: string; statuses: Record<string, string> };

async function setup(page: Page, titles: string[], opts: { type?: string }[] = []) {
  const key = `D${rand(2).toUpperCase()}`;
  const made = await apiCall(page, 'POST', '/spaces', { key, name: `Drag ${key}` });
  expect(made.status, made.text).toBe(200);
  const st = await apiCall(page, 'GET', `/spaces/${made.json.id}/statuses`);
  const statuses = Object.fromEntries(st.json.items.map((s: { name: string; id: string }) => [s.name, s.id]));
  for (const [i, title] of titles.entries()) {
    const r = await apiCall(page, 'POST', `/spaces/${made.json.id}/items`, { type: opts[i]?.type ?? 'task', title });
    expect(r.status, r.text).toBe(200);
  }
  return { key, id: made.json.id as string, statuses } satisfies Made;
}

/** The button that opens a card (its drag handle has a similar name). */
const openButton = (page: Page, title: RegExp) =>
  page.getByRole('article', { name: title }).locator('[data-card-open]');

/** Presses keys one at a time, giving the board a moment to react to each (as a person would). */
async function keys(page: Page, ...codes: string[]) {
  for (const code of codes) {
    await page.keyboard.press(code);
    await page.waitForTimeout(200);
  }
}

const column = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
const titlesIn = async (page: Page, name: string) =>
  (await column(page, name).locator('article h3').allInnerTexts()).map((t) => t.replace(/^[A-Z0-9]+-\d+:\s*/, '').trim());

test('move cards between and within columns with the keyboard, and it persists', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['Alpha', 'Beta', 'Gamma']);
  await page.goto(`/spaces/${sp.key}/board`);
  await expect(page.getByRole('article', { name: /Alpha/ })).toBeVisible();

  // Pick up Alpha with Space, move it to the next column with the arrow key, drop with Space.
  const handle = page.getByRole('button', { name: new RegExp(`Move ${sp.key}-1: Alpha`) });
  await handle.focus();
  await keys(page, 'Space', 'ArrowRight', 'Space');
  await expect(column(page, 'In Progress').getByRole('article', { name: /Alpha/ })).toBeVisible();
  await expect(column(page, 'To Do').getByRole('article', { name: /Alpha/ })).toHaveCount(0);

  // Reorder inside To Do: Beta goes below Gamma.
  await page.getByRole('button', { name: new RegExp(`Move ${sp.key}-2: Beta`) }).focus();
  await keys(page, 'Space', 'ArrowDown', 'Space');
  await expect.poll(() => titlesIn(page, 'To Do')).toEqual(['Gamma', 'Beta']);

  // The server agrees after a reload.
  await page.reload();
  await expect(page.getByRole('article', { name: /Alpha/ })).toBeVisible();
  expect(await titlesIn(page, 'To Do')).toEqual(['Gamma', 'Beta']);
  expect(await titlesIn(page, 'In Progress')).toEqual(['Alpha']);
});

test('drag with the mouse, drop into an empty column, and snap back when refused', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['One', 'Two']);
  // Live updates would refresh the card before the drag; with the stream down the page is stale, which is
  // the situation the version check exists for.
  await page.route('**/spaces/*/events', (route) => route.abort());
  await page.goto(`/spaces/${sp.key}/board`);
  const card = page.getByRole('article', { name: /One/ });
  await expect(card).toBeVisible();

  const drag = async (title: RegExp, target: ReturnType<typeof column>) => {
    const from = await page.getByRole('article', { name: title }).boundingBox();
    const to = await target.boundingBox();
    await page.mouse.move(from!.x + 60, from!.y + 20);
    await page.mouse.down();
    await page.mouse.move(from!.x + 80, from!.y + 30, { steps: 4 });
    await page.mouse.move(to!.x + to!.width / 2, to!.y + 140, { steps: 12 });
    await page.mouse.up();
  };
  await drag(/One/, column(page, 'Done'));
  await expect(column(page, 'Done').getByRole('article', { name: /One/ })).toBeVisible();
  await page.reload();
  await expect(column(page, 'Done').getByRole('article', { name: /One/ })).toBeVisible();

  // Someone else changes the card; our next drag is refused (412), so the card snaps back with a message.
  const item = await apiCall(page, 'GET', `/items/${sp.key}-2`);
  await page.getByRole('article', { name: /Two/ }).waitFor();
  await page.evaluate(
    async ({ id, version }) => {
      await fetch(`/api/v1/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': version },
        body: JSON.stringify({ priority: 'highest' }),
      });
    },
    { id: item.json.id, version: item.json.updatedAt },
  );
  await drag(/Two/, column(page, 'Done'));
  await expect(page.getByText(/Someone else changed that card/)).toBeVisible();
  await expect(column(page, 'To Do').getByRole('article', { name: /Two/ })).toBeVisible();
});

test('filters live in the URL, show as chips, and can be cleared', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['Login bug', 'Pay task', 'Docs task'], [{ type: 'bug' }, {}, {}]);
  await page.goto(`/spaces/${sp.key}/board`);
  await expect(page.getByRole('article', { name: /Login bug/ })).toBeVisible();

  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Bug/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/type=bug/);
  await expect(page.getByRole('article', { name: /Pay task/ })).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Login bug/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Active filters' }).getByText('Type: Bug')).toBeVisible();

  // The same view after a reload, and by search too.
  await page.reload();
  await expect(page.getByRole('article', { name: /Login bug/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Docs task/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('article', { name: /Docs task/ })).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search this board')).toBeFocused();
  await page.keyboard.type('docs');
  await expect(page).toHaveURL(/q=docs/);
  await expect(page.getByRole('article', { name: /Pay task/ })).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Docs task/ })).toBeVisible();

  // A filter that matches nothing says so, and offers a way back.
  await page.getByLabel('Search this board').fill('zzzzzz');
  await expect(page.getByText('Nothing matches these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('article', { name: /Pay task/ })).toBeVisible();
});

test('select several cards and change them together', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['First', 'Second', 'Third']);
  await page.goto(`/spaces/${sp.key}/board`);
  await expect(page.getByRole('article', { name: /First/ })).toBeVisible();

  const isMac = process.platform === 'darwin';
  const mod = isMac ? 'Meta' : 'Control';
  await openButton(page, /First/).click({ modifiers: [mod] });
  await openButton(page, /Second/).click({ modifiers: [mod] });
  const bar = page.getByRole('region', { name: 'Selected items' });
  await expect(bar.getByText('2 selected')).toBeVisible();

  await bar.getByRole('combobox', { name: 'Move selected items to' }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await expect(page.getByText('2 work items moved')).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(column(page, 'Done').getByRole('article')).toHaveCount(2);
  await expect(column(page, 'To Do').getByRole('article')).toHaveCount(1);

  // The card menu can select too, and Escape clears the selection.
  await page.getByRole('button', { name: `Actions for ${sp.key}-3` }).click();
  await page.getByRole('menuitem', { name: 'Select' }).click();
  await expect(bar.getByText('1 selected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
});

test('labels: create one from an item, see it on the card, and filter by it', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['Tag me', 'Leave me']);
  await page.goto(`/spaces/${sp.key}/board`);
  await openButton(page, /Tag me/).click();
  const panel = page.getByRole('dialog').filter({ hasText: `${sp.key}-1` });
  await panel.getByRole('combobox', { name: 'Labels' }).click();
  await page.getByPlaceholder('Find or create a label').fill('payments');
  await page.getByRole('option', { name: /Create “payments”/ }).click();
  await expect(panel.getByText('Saved')).toBeVisible();
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('article', { name: /Tag me/ }).getByText('payments')).toBeVisible();

  await page.getByRole('button', { name: /^Label/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'payments' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article', { name: /Leave me/ })).toHaveCount(0);
  await expect(page).toHaveURL(/label=/);
});

test('swimlanes group cards, and dropping into another lane changes the field', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['Lane card']);
  const board = await apiCall(page, 'GET', `/spaces/${sp.id}/board`);
  const set = await apiCall(page, 'PATCH', `/boards/${board.json.board.id}`, { settings: { swimlane: 'priority' } });
  expect(set.status, set.text).toBe(200);
  await page.goto(`/spaces/${sp.key}/board`);
  for (const lane of ['Highest', 'High', 'Medium', 'Low', 'Lowest']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${lane}\\s`) })).toBeVisible();
  }
  const card = page.getByRole('article', { name: /Lane card/ });
  await expect(card).toBeVisible();

  // Collapse and expand a lane.
  const lowest = page.getByRole('button', { name: /^Lowest\s/ });
  await lowest.click();
  await expect(lowest).toHaveAttribute('aria-expanded', 'false');
  await lowest.click();

  // Drop the Medium card into the Highest lane with the mouse.
  const from = await card.boundingBox();
  const target = await page.locator('section[aria-label^="Lane: Highest"] [data-cell]').first().boundingBox();
  await page.mouse.move(from!.x + 60, from!.y + 20);
  await page.mouse.down();
  await page.mouse.move(from!.x + 80, from!.y + 30, { steps: 4 });
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 30, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await apiCall(page, 'GET', `/items/${sp.key}-1`)).json.priority).toBe('highest');
});

test('a board of 500 items loads quickly and still drags', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsOwner(page);
  const sp = await setup(page, []);
  // Insert the cards straight into the database: this test is about the board, not item creation.
  const { randomUUID } = await import('node:crypto');
  const { orgIdOf, withDb } = await import('./db');
  await withDb(async (db) => {
    const orgId = await orgIdOf(db, 'acme');
    const space = await db.collection('spaces').findOne({ orgId, key: sp.key });
    const statuses = await db
      .collection('space_statuses')
      .find({ spaceId: space!.id })
      .sort({ position: 1 })
      .toArray();
    const owner = await db.collection('memberships').findOne({ orgId, orgRole: 'owner' });
    const now = new Date();
    await db.collection('work_items').insertMany(
      Array.from({ length: 500 }, (_, i) => {
        const n = i + 1;
        return {
          id: randomUUID(),
          orgId,
          spaceId: space!.id,
          number: n,
          type: 'task',
          parentId: null,
          title: `Card ${n}`,
          description: null,
          statusId: statuses[n % 3]!.id,
          priority: 'medium',
          assigneeId: null,
          reporterId: owner!.userId,
          estimate: null,
          dueDate: null,
          sprintId: null,
          rank: `a${String(n).padStart(6, '0')}`,
          labelIds: [],
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
      }),
    );
    await db.collection('space_counters').updateOne({ spaceId: space!.id }, { $set: { lastNumber: 500 } });
  });
  const started = Date.now();
  await page.goto(`/spaces/${sp.key}/board`);
  await expect(column(page, 'To Do').getByRole('article').first()).toBeVisible();
  const ready = Date.now() - started;
  expect(ready).toBeLessThan(8000);
  await expect(column(page, 'To Do').getByRole('article')).toHaveCount(50);
  await expect(column(page, 'To Do').getByRole('button', { name: /Show more/ })).toBeVisible();
  await column(page, 'To Do').getByRole('button', { name: /Show more/ }).click();
  await expect(column(page, 'To Do').getByRole('article')).toHaveCount(100);

  const handle = page.getByRole('button', { name: new RegExp(`Move ${sp.key}-3: Card 3`) });
  await handle.focus();
  await keys(page, 'Space', 'ArrowRight', 'Space');
  await expect(column(page, 'In Progress').getByRole('article', { name: `${sp.key}-3 Card 3` })).toBeVisible();
});

test('the filter bar, lanes and shortcut list pass the automated accessibility scan', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const sp = await setup(page, ['Scan me']);
  const board = await apiCall(page, 'GET', `/spaces/${sp.id}/board`);
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
    for (const lanes of ['none', 'assignee']) {
      await apiCall(page, 'PATCH', `/boards/${board.json.board.id}`, { settings: { swimlane: lanes } });
      await page.goto(`/spaces/${sp.key}/board?type=task`);
      await page.evaluate((t) => window.localStorage.setItem('theme', t), theme);
      await page.reload();
      await expect(page.getByRole('article', { name: /Scan me/ })).toBeVisible();
      await scan(`board with filters, lanes=${lanes} (${theme})`);
    }
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await scan(`shortcuts (${theme})`, true);
    await page.keyboard.press('Escape');
  }
});
