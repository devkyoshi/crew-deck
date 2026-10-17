import { expect, test } from '@playwright/test';
import { signInAsOwner } from './helpers';

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

test('profile photo: upload shows in the rail and top bar, remove brings back initials', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/profile');
  await expect(page.locator('form[data-ready]')).toBeVisible();
  await page.getByLabel('Profile photo file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Profile photo updated')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile' }).locator('img')).toHaveAttribute('src', /\/api\/v1\/avatars\//);
  await expect(page.getByRole('button', { name: 'Account menu' }).locator('img')).toHaveAttribute('src', /\/api\/v1\/avatars\//);

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Profile photo removed')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile' }).locator('img')).toHaveCount(0);
});

test('a file that is not a picture is refused', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/profile');
  await page.getByLabel('Profile photo file').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
  await expect(page.getByText(/PNG, JPG or WebP/).first()).toBeVisible();
});

test('quick messages: the top bar lists conversations and opens a chat window', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('button', { name: /Quick messages/ }).click();
  const first = page.getByRole('button').filter({ hasText: /ago|No messages yet/ }).first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByRole('region', { name: /^Chat / })).toBeVisible();
  await page.getByRole('button', { name: /^Minimise / }).click();
  await page.getByRole('button', { name: /^Close / }).click();
  await expect(page.getByRole('region', { name: /^Chat / })).toHaveCount(0);
});

test('the rail icon stays visible when the active module is hovered', async ({ page }) => {
  await signInAsOwner(page);
  const home = page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: 'Home' });
  await home.hover();
  const [fg, bg] = await home.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el.querySelector('span')!).backgroundColor]);
  expect(fg).not.toBe(bg);
});

test('space admins carry a star in the header member list', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/spaces/ENG/board');
  await expect(page.getByRole('img', { name: 'Space admin' }).first()).toBeVisible();
});

test('the space tabs no longer include Settings or Overview', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/spaces/ENG');
  await expect(page).toHaveURL(/\/spaces\/ENG\/board/);
  const tabs = page.getByRole('navigation', { name: 'Space sections' });
  await expect(tabs.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Edit space settings' }).click();
  await expect(page).toHaveURL(/\/spaces\/ENG\/settings/);
});
