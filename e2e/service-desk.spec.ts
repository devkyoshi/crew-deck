import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsMember, signInAsOwner } from './helpers';

test('a member raises a ticket in a service desk and the queue shows its deadline', async ({ page, browser }) => {
  const tag = rand(2).toUpperCase();
  const key = `Q${tag}A`;

  // The owner sets up a QA desk.
  await signInAsOwner(page);
  const created = await apiCall(page, 'POST', '/spaces', { key, name: `QA desk ${tag}`, features: ['tickets'] });
  expect(created.status, created.text).toBe(200);
  await page.goto(`/spaces/${key}`);

  // A desk shows Tickets and leaves out the tabs it did not ask for: no Epics, Roadmap or Releases.
  const tabs = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Tickets' }) });
  await expect(tabs.getByRole('link', { name: 'Tickets' })).toBeVisible();
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
    await member.goto(`/spaces/${key}/tickets`);
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

test('the create-space wizard picks features in groups, and a mixed space gets both sets of tabs', async ({ page }) => {
  const tag = rand(2).toUpperCase();
  const key = `M${tag}X`;
  await signInAsOwner(page);
  await page.goto('/spaces/new');
  // The wizard sits on the page, not in a card.
  await expect(page.locator('[data-slot="card"]')).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill(`Mixed ${tag}`);
  await page.getByLabel('Key').fill(key);
  const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();
  await next(); // Visibility
  await next(); // Features

  // Ticking a group ticks all of its features; unticking one leaves the group half-ticked.
  const delivery = page.getByTestId('feature-group-delivery');
  await delivery.click();
  for (const f of ['sprints', 'epics', 'releases']) await expect(page.getByTestId(`feature-${f}`)).toBeChecked();
  await page.getByTestId('feature-releases').click();
  await expect(delivery).toHaveAttribute('data-state', 'indeterminate');
  await page.getByTestId('feature-tickets').click();

  await next(); // Access
  await next(); // Review
  await expect(page.getByText(/A board and a list, backlog and sprints, epics, tickets/)).toBeVisible();
  await page.getByRole('button', { name: 'Create space' }).click();

  const tabs = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Tickets' }) });
  for (const name of ['Tickets', 'Backlog', 'Board', 'List', 'Epics']) {
    await expect(tabs.getByRole('link', { name })).toBeVisible();
  }
  await expect(tabs.getByRole('link', { name: 'Releases' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'Roadmap' })).toHaveCount(0);
});
