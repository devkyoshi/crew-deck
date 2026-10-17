import { test } from '@playwright/test';
import { signInAsOwner } from './helpers';

// Throwaway visual check (not part of the suite): SHOTS=<dir> pnpm exec playwright test e2e/_shots.spec.ts
const dir = process.env.SHOTS ?? 'test-results/shots';

test.skip(!process.env.SHOTS, 'visual check only');
test('capture', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsOwner(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/home.png` });

  await page.goto('/spaces');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/spaces.png` });

  const first = page.locator('[data-sidebar="content"] a[href^="/spaces/"]:not([href="/spaces/new"])').first();
  if (await first.count()) {
    const href = await first.getAttribute('href');
    await page.goto(`${href}/board`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/board.png` });
    await page.goto(`${href}/calendar`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/calendar.png` });
    await page.getByRole('button', { name: 'week', exact: true }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/calendar-week.png` });
  }

  await page.goto('/messages');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/messages.png` });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle theme' }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/home-dark.png` });
});
