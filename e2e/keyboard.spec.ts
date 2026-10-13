import { expect, test } from '@playwright/test';
import { signInAsOwner } from './helpers';

/** Everything below is operated with the keyboard only. */

test('the first Tab stop is a skip link that jumps to the main content', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/people');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('focus is clearly visible on interactive elements', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/groups');
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab'); // first control after it
  const visible = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const s = getComputedStyle(el);
    const ring = s.boxShadow !== 'none' && s.boxShadow !== '';
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    return ring || outline;
  });
  expect(visible).toBe(true);
});

test('command palette: open, move, choose and close with the keyboard', async ({ page }) => {
  await signInAsOwner(page);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Jump to…');
  await expect(input).toBeFocused();
  await input.fill('groups');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/(admin\/)?groups$/);

  // Escape closes it and returns focus to the page.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('dialogs trap focus, close on Escape, and return focus to the button that opened them', async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto('/admin/members');
  const trigger = page.getByRole('button', { name: 'Invite people' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Tab many times: focus never leaves the dialog.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(inside, `Tab #${i + 1} left the dialog`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('table row menus work from the keyboard', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/admin/members');
  const actions = page.getByRole('button', { name: /Actions for/ }).first();
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // "View profile"
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
});

test('the create-space wizard can be completed without a mouse', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/spaces/new');
  const key = `K${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const name = `Keys ${key}`;
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Key').fill(key);
  await page.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  // Choose "Private" with Space on the focused toggle.
  const priv = page.getByRole('button', { name: /Private/ });
  await priv.focus();
  await page.keyboard.press('Space');
  await expect(priv).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Create space' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name })).toBeVisible();
});

test('errors are announced: a failed sign-in is exposed as an alert', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill('owner@acme.test');
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await expect(page.locator('form').locator('xpath=..').getByRole('alert').first()).toBeVisible();
});
