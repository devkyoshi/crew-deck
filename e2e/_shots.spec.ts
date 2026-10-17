import { test } from '@playwright/test';
import { signInAsOwner } from './helpers';

// Throwaway visual check (not part of the suite): SHOTS=<dir> pnpm exec playwright test e2e/_shots.spec.ts
const dir = process.env.SHOTS ?? 'test-results/shots';
test.skip(!process.env.SHOTS, 'visual check only');

test('capture', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await signInAsOwner(page);
  const shot = async (name: string, wait = 1800) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${dir}/${name}.png` });
  };

  await shot('home');
  // Hover the active rail item: the icon must stay visible.
  await page.getByRole('link', { name: 'Home', exact: true }).first().hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/rail-hover.png`, clip: { x: 0, y: 0, width: 420, height: 860 } });

  await page.getByRole('button', { name: /Quick messages/ }).click();
  await shot('quick-messages', 800);
  await page.getByRole('button', { name: /^(#|[a-z0-9])/i }).filter({ hasText: /ago|No messages/ }).first().click();
  await shot('quick-chat', 3000);

  await page.goto('/profile');
  await shot('profile');
  await page.goto('/admin/settings/branding');
  await shot('branding');
  await page.goto('/dashboard');
  await shot('dashboard', 3000);
  await page.goto('/spaces/ENG/board');
  await shot('board', 3000);
  await page.goto('/spaces/ENG/settings');
  await shot('space-settings', 2500);
});
