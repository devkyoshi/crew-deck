import { createHash, randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { orgIdOf, withDb } from './db';
import { expect, test, type Page } from '@playwright/test';
import { completeInvite } from './helpers';

const OWNER = {
  email: 'owner@acme.test',
  password: process.env.SEED_PASSWORD ?? 'dev@1234',
};
const shots = process.env.E2E_SCREENSHOTS;

async function signIn(page: Page, email = OWNER.email, password = OWNER.password) {
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function createInvite() {
  const token = randomBytes(24).toString('base64url');
  const email = `e2e-${randomBytes(4).toString('hex')}@acme.test`;
  await withDb(async (db) => {
    await db.collection('invitations').insertOne({
      id: randomUUID(),
      orgId: await orgIdOf(db, 'acme'),
      email,
      orgRole: 'member',
      groupIds: [],
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
      acceptedAt: null,
      revokedAt: null,
      invitedBy: null,
      createdAt: new Date(),
    });
  });
  return { token, email };
}

test('password sign-in lands on the shell, and sign-out returns to sign-in', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /Hello, Alice/ })).toBeVisible();
  await expect(page.getByText('Administration')).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // Protected routes bounce back to sign-in once signed out.
  await page.goto('/people');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('wrong password shows an error and stays on the page', async ({ page }) => {
  await signIn(page, OWNER.email, 'not-the-password');
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('members do not see the Administration section', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Dev login email').fill('member@acme.test');
  await page.getByRole('button', { name: 'Dev sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await expect(page.getByText('Administration')).toHaveCount(0);
});

test('an invited person can accept the invite and land signed in', async ({ page }) => {
  const { token, email } = await createInvite();
  await page.goto(`/accept-invite?token=${token}`);
  await expect(page.getByText(email)).toBeVisible();
  await completeInvite(page, 'Eve Invited', 'a-long-enough-password');
  await expect(page.getByRole('heading', { name: /Hello, Eve/ })).toBeVisible();

  // The link is single use.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.goto(`/accept-invite?token=${token}`);
  await expect(page.getByText('This invitation is not valid')).toBeVisible();
});

test('command palette navigates with the keyboard', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Jump to…').fill('groups');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
});

for (const [name, size] of [
  ['desktop', { width: 1440, height: 900 }],
  ['tablet', { width: 820, height: 1100 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test(`shell renders at ${name} width`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page);
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
    // No horizontal page scroll at any width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    if (name === 'mobile') {
      // Sidebar is a sheet on mobile: hidden until opened.
      await expect(
        page.locator('[data-sidebar="menu-button"]', { hasText: 'People' }),
      ).toBeHidden();
      await page.getByRole('button', { name: 'Toggle sidebar' }).click();
      await expect(
        page.locator('[data-sidebar="menu-button"]', { hasText: 'People' }),
      ).toBeVisible();
    } else {
      await expect(
        page.locator('[data-sidebar="menu-button"]', { hasText: 'People' }),
      ).toBeVisible();
    }
    if (shots) await page.screenshot({ path: `${shots}/shell-${name}.png` });
  });
}
