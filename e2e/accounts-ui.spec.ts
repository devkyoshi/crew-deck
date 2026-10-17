import { expect, test, type Browser } from '@playwright/test';
import { asAnotherPerson, signInAsOwner, signInWithPassword } from './helpers';

// A 600x300 PNG made of two flat colours, so cropping to a square is visible.
const WIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAlgAAAEsCAIAAACQX1rBAAAHcUlEQVR4nO3VMQ0AMADDsAEbfw3WYOSoJf/p1/PuBUJ1H9adfgJsq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rHCHE6j6sc4QQq/uwzhFCrO7DOkcIsboP6xwhxOo+rHOEEKv7sM4RQqzuwzpHCLG6D+scIcTqPqxzhBCr+7DOEUKs7sM6Rwixug/rPghTG4KQ8cIbAAAAAElFTkSuQmCC',
  'base64',
);

test('status in the profile menu: choosing Away and Do not disturb changes the dot others see', async ({ page, browser }) => {
  await signInAsOwner(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Away' }).click();
  await expect(page.getByText('You are away')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' }).getByRole('img', { name: 'Away' })).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Do not disturb' }).click();
  await page.getByRole('menuitem', { name: 'For 30 minutes' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' }).getByRole('img', { name: 'Do not disturb' })).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Available' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' }).getByRole('img', { name: 'Available' })).toBeVisible();
  void browser;
});

test('a custom status is set from the profile menu', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  // The first item is the status line, whatever it says now.
  await page.getByRole('menu').getByRole('menuitem').first().click();
  await page.getByLabel('Status', { exact: true }).fill('Heads down');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Status updated')).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: /Heads down/ })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Clear status' }).click();
  await expect(page.getByText('Status cleared')).toBeVisible();
});

test('an admin adds a member with a temporary password who must choose their own', async ({ page, browser }: { page: import('@playwright/test').Page; browser: Browser }) => {
  await signInAsOwner(page);
  await page.goto('/people');
  await page.getByRole('button', { name: 'Invite people' }).click();
  const email = `temp-${Date.now()}@acme.test`;
  await page.getByLabel('Email addresses').fill(email);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: /Create with a temporary password/ }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /Create 1 account/ }).click();
  const box = page.getByLabel(`Temporary password for ${email}`);
  await expect(box).toBeVisible();
  const temp = await box.inputValue();
  expect(temp).toMatch(/^[A-Za-z0-9]{14}$/);

  await asAnotherPerson(browser, async (other) => {
    await other.goto('/sign-in');
    await other.getByLabel('Email', { exact: true }).fill(email);
    await other.getByLabel('Password').fill(temp);
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    // Held on the Security tab until the temporary password is replaced.
    await expect(other).toHaveURL(/\/profile/);
    await expect(other.getByText(/set a temporary password for you/)).toBeVisible();
    await other.goto('/people');
    await expect(other).toHaveURL(/\/profile/);
    await other.getByLabel('Current password').fill(temp);
    await other.getByLabel('New password', { exact: true }).fill('Brand-new-passphrase-7');
    await other.getByLabel('Repeat the new password').fill('Brand-new-passphrase-7');
    await other.getByRole('button', { name: 'Change password' }).click();
    await expect(other).toHaveURL(/\/$/);
    await other.goto('/people');
    await expect(other).toHaveURL(/\/people/);
  });
  void signInWithPassword;
});

test('photo upload offers a square crop before saving', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/profile');
  await page.getByLabel('Profile photo file').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: WIDE_PNG });
  const dialog = page.getByRole('dialog', { name: /Crop your profile photo/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Profile photo updated')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile' }).locator('img')).toHaveAttribute('src', /\/api\/v1\/avatars\//);
  const size = await page.getByRole('link', { name: 'Profile' }).locator('img').evaluate(async (el) => {
    const i = el as HTMLImageElement;
    await i.decode();
    return [i.naturalWidth, i.naturalHeight];
  });
  expect(size).toEqual([512, 512]);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Profile photo removed')).toBeVisible();
});
