import { test } from '@playwright/test';
import { signInAsOwner } from './helpers';

// Throwaway visual check (not part of the suite): SHOTS=<dir> pnpm exec playwright test e2e/_shots.spec.ts
const dir = process.env.SHOTS ?? 'test-results/shots';

test.skip(!process.env.SHOTS, 'visual check only');
test('capture', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1200, height: 900 });
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
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${dir}/board.png` });
    await page.goto(`${href}/calendar`);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${dir}/calendar.png` });
    await page.getByRole('button', { name: 'week', exact: true }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/calendar-week.png` });
  }

  await page.goto('/messages');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${dir}/messages.png` });

  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/home-dark.png` });
  const f2 = page.locator('[data-sidebar="content"] a[href^="/spaces/"]:not([href="/spaces/new"])').first();
  await page.goto('/spaces/ENG/board');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${dir}/board-dark.png` });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/home-mobile.png` });
  void f2;
});
