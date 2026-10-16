import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsOwner, signInWithPassword } from './helpers';

const member = (page: Page) => signInWithPassword(page, 'member@acme.test');
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const defaults = {
  channelCreation: 'all',
  broadcastLimit: 50,
  defaultChannelIds: [] as string[],
  retentionDays: null as number | null,
  spaceChannels: true,
  announcementDefault: false,
  leaveSetsDnd: false,
};

test('the owner sets who can create channels, and members stop seeing the option', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  try {
    await page.goto('/admin/settings/messaging');
    await expect(page.getByRole('heading', { name: 'Messaging', level: 1 })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('combobox', { name: 'Who can create channels' }).click();
    await page.getByRole('option', { name: 'Admins only' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Messaging settings saved')).toBeVisible({ timeout: 8000 });

    await asAnotherPerson(browser, async (other) => {
      await member(other);
      await other.goto('/messages');
      await other.getByRole('button', { name: 'More', exact: true }).click();
      await expect(other.getByRole('menuitem', { name: 'Browse channels' })).toBeVisible();
      await expect(other.getByRole('menuitem', { name: 'Create a channel' })).toHaveCount(0);
      // The server refuses it as well.
      const refused = await apiCall(other, 'POST', '/channels', { name: `nope-${rand()}`, type: 'public' });
      expect(refused.status).toBe(403);
    });
  } finally {
    await apiCall(page, 'PUT', '/admin/messaging-settings', defaults);
  }
});

test('retention and export: set a limit for the workspace and a channel, then make and download a copy', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const name = `ret-${rand()}`;
  const made = await apiCall(page, 'POST', '/channels', { name, type: 'public' });
  const channelId = made.json.channel.id as string;
  await apiCall(page, 'POST', `/channels/${channelId}/messages`, { clientMsgId: crypto.randomUUID().slice(0, 30), body: doc('exported words') });
  try {
    await page.goto('/admin/settings/messaging');
    await expect(page.getByText('How long messages are kept', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('switch', { name: 'Keep messages forever' }).click();
    await page.getByLabel('Delete messages older than').fill('400');
    // The second Save on the page belongs to this card.
    await page.getByRole('button', { name: 'Save', exact: true }).nth(1).click();
    await expect(page.getByText('Retention saved')).toBeVisible({ timeout: 8000 });

    await page.getByRole('textbox', { name: 'Find a channel', exact: true }).fill(name);
    await page.getByRole('list', { name: new RegExp(`Channels matching ${name}`) }).getByRole('button', { name: `#${name}` }).click();
    await page.getByLabel('Days', { exact: true }).fill('30');
    await page.getByRole('button', { name: 'Set limit' }).click();
    await expect(page.getByText('Channel limit saved')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('list').filter({ hasText: `#${name}` }).getByText('30 days')).toBeVisible();

    // The channel says so to the people in it.
    await page.goto(`/messages/${channelId}`);
    await page.getByRole('button', { name: 'Channel details' }).click();
    await expect(page.getByText('Messages in this channel are deleted after 30 days.')).toBeVisible({ timeout: 8000 });

    await page.goto('/admin/settings/messaging');
    await page.getByRole('button', { name: 'Create an export' }).click();
    const list = page.getByRole('list', { name: 'Exports' });
    await expect(list.getByRole('link', { name: /Download/ }).first()).toBeVisible({ timeout: 30_000 });
    const href = await list.getByRole('link', { name: /Download/ }).first().getAttribute('href');
    const file = await apiCall(page, 'GET', href!.replace('/api/v1', ''));
    expect(file.status).toBe(200);
  } finally {
    await apiCall(page, 'PUT', '/admin/messaging-settings', defaults);
    await apiCall(page, 'PUT', `/admin/channels/${channelId}/retention`, { days: null });
  }
});

test('an admin makes a webhook, copies its address once, and a post to it appears as a bot', async ({ page }) => {
  test.setTimeout(120_000);
  const name = `hook-${rand()}`;
  const text = `deployed ${rand()}`;
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name, type: 'public' });
  const channelId = made.json.channel.id as string;
  await page.goto(`/messages/${channelId}`);
  await page.getByRole('button', { name: 'Channel details' }).click();
  await expect(page.getByText('Incoming webhooks')).toBeVisible({ timeout: 8000 });
  await page.getByLabel('Webhook name').fill('Build server');
  await page.getByLabel('Webhook name').press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Copy the address now' });
  await expect(dialog).toBeVisible({ timeout: 8000 });
  const url = await dialog.getByLabel('Webhook address').inputValue();
  expect(url).toMatch(/\/api\/v1\/hooks\/whk_[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  // The list shows the name, never the address.
  const row = page.getByRole('list', { name: 'Webhooks' });
  await expect(row.getByText('Build server')).toBeVisible();
  await expect(page.getByText('whk_')).toHaveCount(0);

  // Another tool posts to it, with no session.
  const posted = await page.evaluate(
    async ({ url, text }) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), credentials: 'omit' });
      return res.status;
    },
    { url, text },
  );
  expect(posted).toBe(201);
  const msg = page.getByRole('article').filter({ hasText: text });
  await expect(msg).toBeVisible({ timeout: 10_000 });
  await expect(msg.getByText('Build server')).toBeVisible();
  await expect(msg.getByText('Bot', { exact: true })).toBeVisible();

  // Revoked: the address stops working at once.
  await row.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Webhook revoked')).toBeVisible({ timeout: 8000 });
  const after = await page.evaluate(async (u) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }), credentials: 'omit' })).status, url);
  expect(after).toBe(404);
});

test('Open channel on a CRM deal makes a channel that hears about stage changes', async ({ page }) => {
  test.setTimeout(120_000);
  const title = `Renewal ${rand()}`;
  await signInAsOwner(page);
  const deal = await apiCall(page, 'POST', '/crm/deals', { title, value: 1200 });
  expect(deal.status, deal.text).toBeLessThan(300);
  await page.goto(`/crm/deals/${deal.json.id}`);
  await page.getByRole('button', { name: 'Open channel' }).click();
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 1, name: /^deal-/ })).toBeVisible();

  const pipelines = await apiCall(page, 'GET', '/crm/pipelines');
  const stages = pipelines.json.items[0].stages as { id: string; name: string; isWon: boolean; isLost: boolean }[];
  const next = stages.find((s) => s.id !== deal.json.stageId && !s.isWon && !s.isLost)!;
  const moved = await apiCall(page, 'POST', `/crm/deals/${deal.json.id}/move`, { stageId: next.id });
  expect(moved.status).toBeLessThan(300);
  const note = page.getByRole('article').filter({ hasText: `moved “${title}”` });
  await expect(note).toBeVisible({ timeout: 10_000 });
  await expect(note.getByText('CRM', { exact: true })).toBeVisible();
});

test('messaging settings, the webhook dialog and chat limits have no accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsOwner(page);
  const made = await apiCall(page, 'POST', '/channels', { name: `a11y-m5-${rand()}`, type: 'public' });
  const channelId = made.json.channel.id as string;
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/admin/settings/messaging');
    await expect(page.getByText('Export your chat', { exact: true })).toBeVisible({ timeout: 10_000 });
    const a = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-nextjs-dev-tools-button]').analyze();
    expect(a.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `settings (${theme})`).toEqual([]);

    await page.goto(`/messages/${channelId}`);
    const toggle = page.getByRole('button', { name: 'Channel details' });
    await expect(toggle).toBeVisible();
    // Whether the panel starts open is applied just after load, so look before pressing.
    const hook = page.getByText('Incoming webhooks');
    if (!(await hook.isVisible({ timeout: 3000 }).catch(() => false)) && !(await hook.waitFor({ timeout: 2500 }).then(() => true, () => false))) await toggle.click();
    await expect(hook).toBeVisible({ timeout: 8000 });
    const b = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-nextjs-dev-tools-button]').analyze();
    expect(b.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), `details (${theme})`).toEqual([]);
  }
});
