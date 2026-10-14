import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';

import { completeInvite } from './helpers';
const ADMIN = {
  email: 'owner@acme.test',
  password: process.env.SEED_PASSWORD ?? 'dev@1234',
};
const NEW_PASSWORD = 'a-long-enough-password';

async function signInAsAdmin(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
}

/** Runs `fn` in a fresh browser context (no shared cookies), like a different person's browser. */
async function asAnotherPerson<T>(browser: Browser, fn: (page: Page) => Promise<T>) {
  const ctx = await browser.newContext({ baseURL: 'http://acme.localhost:3000' });
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

test('admin invites someone, they join and appear in the list, then admin deactivates them and blocks their login', async ({
  page,
  browser,
}) => {
  const email = `e2e-${randomBytes(4).toString('hex')}@acme.test`;

  // 1. Admin sends an invitation through the 3-step form.
  await signInAsAdmin(page);
  await page.goto('/admin/members');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page.getByLabel('Email addresses').fill(email);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Groups to join' })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: /Send 1 invitation/ }).click();

  // Email delivery is not configured locally, so the link is shown for the admin to share.
  await expect(page.getByText('Email delivery is not set up')).toBeVisible();
  const link = await page.getByLabel(`Invite link for ${email}`).inputValue();
  expect(link).toContain('/accept-invite?token=');
  await page.getByRole('button', { name: 'Done' }).click();

  // The pending tab lists it.
  await page.getByRole('tab', { name: 'Pending invites' }).click();
  await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible();

  // 2. The invited person accepts and lands signed in.
  await asAnotherPerson(browser, async (p) => {
    await p.goto(link);
    await expect(p.getByText(email)).toBeVisible();
    await completeInvite(p, 'Eve E2E', NEW_PASSWORD);
    await expect(p.getByRole('heading', { name: /Hello, Eve/ })).toBeVisible();
  });

  // 3. They appear in the members list, and the invite is no longer pending.
  await page.reload();
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByLabel('Search members').fill(email);
  const row = page.getByRole('row', { name: new RegExp(email) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Active');
  await page.getByRole('tab', { name: 'Pending invites' }).click();
  await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0);

  // 4. Admin deactivates them from the row menu.
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByLabel('Search members').fill(email);
  await page
    .getByRole('row', { name: new RegExp(email) })
    .getByRole('button', { name: /Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByRole('row', { name: new RegExp(email) })).toContainText('Deactivated');

  // 5. Their login is blocked.
  await asAnotherPerson(browser, async (p) => {
    await p.goto('/sign-in');
    await p.getByLabel('Email', { exact: true }).fill(email);
    await p.getByLabel('Password').fill(NEW_PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p.getByText('This account has been deactivated')).toBeVisible();
    await expect(p).toHaveURL(/\/sign-in/);
  });
});

test('members see the directory but not the admin tools', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Dev login email').fill('member@acme.test');
  await page.getByRole('button', { name: 'Dev sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();

  await page.goto('/people');
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.getByLabel('Search members')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Invite people/ })).toHaveCount(0);

  await page.goto('/admin/members');
  await expect(page.getByText('Admins only')).toBeVisible();
});

test('a user can edit their own profile', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/profile');
  await expect(page.locator('form[data-ready]')).toBeVisible();
  const title = `Engineer ${randomBytes(2).toString('hex')}`;
  await page.getByLabel('Job title').fill(title);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Job title')).toHaveValue(title);
});

test('search, role filter and pagination work on the members table', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/members');
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  await page.getByLabel('Search members').fill('no-such-person-xyz');
  await expect(page.getByText('No one matches those filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'Owners' }).click();
  await expect(page.getByRole('row', { name: /owner@acme\.test/ })).toBeVisible();
});
