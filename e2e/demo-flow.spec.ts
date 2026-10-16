import { expect, test, type Page } from '@playwright/test';
import { apiCall, rand, signInAs, signInAsMember, signInAsOwner } from './helpers';

/**
 * The demo walk-through: sign in, visit every main screen, and open the main interactions. The page
 * must stay free of console errors, uncaught exceptions, failed requests and server errors.
 */
function watch(page: Page) {
  const problems: string[] = [];
  const where = () => new URL(page.url()).pathname;
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console on ${where()}: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) =>
    problems.push(`exception on ${where()}: ${e.message.slice(0, 2500)}`),
  );
  page.on('requestfailed', (r) => {
    // Navigations aborted by a following navigation are normal.
    if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) problems.push(`failed: ${r.url()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()}: ${r.url()}`);
  });
  return problems;
}

const settle = async (page: Page) => {
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0, {
    timeout: 10_000,
  });
};

test('an admin walks through the whole product without a single error', async ({ page }) => {
  // About twenty screens, and the dev server compiles each route on first visit.
  test.setTimeout(240_000);
  const problems = watch(page);
  await signInAsOwner(page);

  const key = `W${rand(3).toUpperCase()}`.slice(0, 6);
  expect(
    (await apiCall(page, 'POST', '/spaces', { key, name: `Walk ${key}`, visibility: 'private' }))
      .status,
  ).toBe(200);

  for (const path of [
    '/',
    '/people',
    '/groups',
    '/spaces',
    `/spaces/${key}`,
    `/spaces/${key}/members`,
    `/spaces/${key}/settings`,
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
    '/crm/pipelines',
    '/admin/billing',
    '/admin/settings/branding',
    '/crm',
    '/crm/leads',
    '/crm/contacts',
    '/crm/companies',
    '/crm/deals',
    '/crm/activities',
    '/spaces/new',
    '/admin/settings',
  ]) {
    await page.goto(path);
    await settle(page);
  }

  // A few interactions: palette, switcher, theme, member dialog.
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch space' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.goto('/admin/members');
  await settle(page);
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page.keyboard.press('Escape');

  expect(problems, problems.join('\n')).toEqual([]);
});

test('an ordinary member walks through their screens without a single error', async ({ page }) => {
  const problems = watch(page);
  await signInAsMember(page);
  for (const path of [
    '/',
    '/people',
    '/groups',
    '/spaces',
    '/spaces/new',
    '/access-requests',
    '/request-access',
    '/profile',
  ]) {
    await page.goto(path);
    await settle(page);
  }
  // Admin-only pages explain themselves instead of failing.
  for (const path of [
    '/admin/members',
    '/admin/groups',
    '/admin/spaces',
    '/admin/audit',
    '/admin/attendance',
    '/admin/settings',
    '/admin/settings/work',
  ]) {
    await page.goto(path);
    await expect(page.getByText('Admins only')).toBeVisible();
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('unknown pages and hidden spaces show a friendly page, not an error', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/this/page/does/not/exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('/spaces/NOSUCHSPACE');
  await expect(page.getByText('Space not found')).toBeVisible();
  await page.goto('/people/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Member not found')).toBeVisible();
  await page.goto('/groups/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Group not found')).toBeVisible();
});

test('a session that ends sends the person back to sign in', async ({ page, context }) => {
  await signInAsOwner(page);
  await page.goto('/people');
  await settle(page);
  await context.clearCookies();
  // The next API call comes back 401; the app redirects instead of showing a broken page.
  await page.getByLabel('Search members').fill('a');
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
  await signInAs(page, 'owner@acme.test');
});
