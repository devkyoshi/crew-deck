import { test } from '@playwright/test';
import { signInAsOwner } from './helpers';

// Throwaway visual check (not part of the suite): SHOTS=<dir> pnpm exec playwright test e2e/_shots.spec.ts
const dir = process.env.SHOTS ?? 'test-results/shots';
test.skip(!process.env.SHOTS, 'visual check only');

test('capture', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await signInAsOwner(page);
  const shot = async (name: string, wait = 1500) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${dir}/${name}.png` });
  };
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await shot('status-menu', 600);
  await page.getByRole('menuitem', { name: 'Do not disturb' }).hover();
  await shot('status-menu-dnd', 600);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto('/people');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page.getByLabel('Email addresses').fill('new.person@acme.test');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await shot('invite-method', 500);
  await page.getByRole('radio', { name: /Create with a temporary password/ }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await shot('invite-method-password', 400);
  await page.keyboard.press('Escape');

  await page.goto('/profile?tab=security');
  await shot('security');
  await page.goto('/profile');
  const wide = Buffer.from('iVBORw0KGgo=', 'base64');
  void wide;
});
