import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsMember, signInAsOwner } from './helpers';

test('a member raises a ticket in a service desk and the queue shows its deadline', async ({ page, browser }) => {
  const tag = rand(2).toUpperCase();
  const key = `Q${tag}A`;

  // The owner sets up a QA desk.
  await signInAsOwner(page);
  const created = await apiCall(page, 'POST', '/spaces', { key, name: `QA desk ${tag}`, boardType: 'service' });
  expect(created.status, created.text).toBe(200);
  await page.goto(`/spaces/${key}`);

  // A desk has a Queue instead of the board-only tabs: no Epics, Roadmap or Releases.
  const tabs = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Queue' }) });
  await expect(tabs.getByRole('link', { name: 'Queue' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Epics' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'Roadmap' })).toHaveCount(0);

  // The owner can see and change the response targets in the space settings.
  await page.goto(`/spaces/${key}/settings`);
  await expect(page.getByText('Response targets', { exact: true })).toBeVisible();

  // A member who was never added to the desk raises a ticket from the queue.
  const ctx = await browser.newContext({ baseURL: 'http://acme.localhost:3000' });
  try {
    const member = await ctx.newPage();
    await signInAsMember(member);
    await member.goto(`/spaces/${key}/list`);
    await member.getByTestId('new-ticket').click();
    const title = `Login fails ${rand()}`;
    await member.getByLabel('Title').fill(title);
    await member.getByRole('button', { name: /^Create/ }).click();
    await expect(member.getByRole('link', { name: 'Open' }).or(member.getByText(/created/)).first()).toBeVisible();
    await expect(member.getByRole('button', { name: title })).toBeVisible();
    await expect(member.getByText(/Response: On track/)).toBeVisible();

    const results = await new AxeBuilder({ page: member }).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
