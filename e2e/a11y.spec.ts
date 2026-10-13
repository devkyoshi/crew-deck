import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsMember, signInAsOwner } from './helpers';

/**
 * WCAG 2.1 A and AA automated checks on every main screen, in light and dark themes. Automated scans
 * catch roughly a third of issues (contrast, names, roles, ARIA misuse); the keyboard tests cover
 * focus and operation.
 */
async function scan(page: Page, label: string, opts: { modalOpen?: boolean } = {}) {
  const results = await new AxeBuilder({ page })
    // While a modal menu or dialog is open, Radix marks the rest of the page aria-hidden and traps
    // focus inside, so those regions cannot take focus. axe cannot see the trap and reports them.
    .disableRules(opts.modalOpen ? ['aria-hidden-focus'] : [])
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The Next.js dev overlay is not part of the product.
    .exclude('nextjs-portal')
    .exclude('[data-nextjs-dev-tools-button]')
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, `${label} has accessibility violations`).toEqual([]);
}

const ADMIN_PAGES = [
  '/',
  '/people',
  '/groups',
  '/spaces',
  '/spaces/new',
  '/access-requests',
  '/request-access',
  '/profile',
  '/my-day',
  '/team',
  '/admin/attendance',
  '/admin/settings',
  '/admin/settings/work',
  '/admin/members',
  '/admin/groups',
  '/admin/spaces',
  '/admin/audit',
];

test.describe('accessibility: signed-out screens', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`sign-in page (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      await page.goto('/sign-in');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await scan(page, `sign-in ${theme}`);
    });
  }

  test('accept-invite page, invalid link', async ({ page }) => {
    await page.goto('/accept-invite?token=nope-nope-nope-nope');
    await expect(page.getByText('Invitation not valid')).toBeVisible();
    await scan(page, 'accept-invite');
  });

  test('workspace picker', async ({ page }) => {
    await page.goto('http://localhost:3000/workspaces');
    await expect(page.getByText('Find your workspace')).toBeVisible();
    await scan(page, 'workspaces');
  });
});

test.describe('accessibility: signed-in screens', () => {
  // Many pages per test, and the dev server compiles each route the first time it is visited.
  test.setTimeout(240_000);

  for (const theme of ['light', 'dark'] as const) {
    test(`all admin screens (${theme})`, async ({ page }) => {
      await signInAsOwner(page);
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      for (const path of ADMIN_PAGES) {
        await page.goto(path);
        await expect(page.locator('#main')).toBeVisible();
        // Let skeletons resolve so we scan real content.
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
        await scan(page, `${path} (${theme})`);
      }
    });
  }

  test('member screens, space pages and dialogs', async ({ page }) => {
    await signInAsMember(page);
    for (const path of [
      '/',
      '/people',
      '/groups',
      '/spaces',
      '/access-requests',
      '/my-day',
      '/team',
    ]) {
      await page.goto(path);
      await expect(page.locator('#main')).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
      await scan(page, `member ${path}`);
    }
  });

  test('open dialogs, menus and pickers', async ({ page }) => {
    await signInAsOwner(page);
    await page.goto('/admin/members');
    await page.getByRole('button', { name: 'Invite people' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, 'invite dialog', { modalOpen: true });
    await page.keyboard.press('Escape');

    await page
      .getByRole('button', { name: /Actions for/ })
      .first()
      .click();
    await expect(page.getByRole('menu')).toBeVisible();
    await scan(page, 'row actions menu', { modalOpen: true });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Open check-in/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, 'check-in popover');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('option').first()).toBeVisible();
    await scan(page, 'command palette', { modalOpen: true });
  });
});
