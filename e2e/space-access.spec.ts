import { expect, test } from '@playwright/test';
import { apiCall, asAnotherPerson, createMember, rand, signInAs, signInAsOwner } from './helpers';

const newKey = () => `P${rand(3).toUpperCase()}`.slice(0, 7);

test('someone requests access to a hidden space, the space admin approves, and they get in', async ({
  page,
  browser,
}) => {
  const key = newKey();
  const name = `Secret ${key}`;

  // The space admin (an ordinary member) creates a private space.
  await signInAs(page, 'member@acme.test');
  const made = await apiCall(page, 'POST', '/spaces', { key, name, visibility: 'private' });
  expect(made.status).toBe(200);

  await asAnotherPerson(browser, async (p) => {
    await signInAs(p, 'member2@acme.test');

    // The space is invisible: same page as a space that does not exist.
    await p.goto(`/spaces/${key}`);
    await expect(p.getByText('Space not found')).toBeVisible();

    // They can still ask, and the answer is identical for a key that does not exist.
    await p.getByRole('link', { name: 'Request access' }).click();
    await expect(p.getByLabel('Space key')).toHaveValue(key);
    await p.getByLabel('Message (optional)').fill('I am joining the team next week');
    await p.getByRole('button', { name: 'Request access' }).click();
    await expect(p.getByText('Request sent')).toBeVisible();
    const sentText = await p.getByText(/If that space exists and is private/).textContent();

    await p.goto('/request-access?key=NOSUCHKEY');
    await p.getByRole('button', { name: 'Request access' }).click();
    await expect(p.getByText(/If that space exists and is private/)).toHaveText(sentText!);

    // Their own list shows only the key, with status pending.
    await p.goto('/access-requests');
    await p.getByRole('tab', { name: 'My requests' }).click();
    const mine = p.locator('#main').getByRole('listitem').filter({ hasText: key });
    await expect(mine).toContainText('Pending');
    await expect(mine).not.toContainText(name);
  });

  // The space admin sees it in their inbox and approves it as a viewer.
  await page.goto('/access-requests');
  const row = page
    .locator('#main')
    .getByRole('listitem')
    .filter({ hasText: 'I am joining the team next week' });
  await expect(row).toContainText(key);
  await row.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('combobox', { name: 'Role to grant' }).click();
  await page.getByRole('option', { name: /Viewer/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Access granted')).toBeVisible();
  await expect(row).toHaveCount(0);

  // The requester can now open the space, as a viewer, and cannot change it.
  await asAnotherPerson(browser, async (p) => {
    await signInAs(p, 'member2@acme.test');
    await p.goto(`/spaces/${key}`);
    await expect(p.getByRole('heading', { name })).toBeVisible();
    await expect(p.getByText('Viewer').first()).toBeVisible();
    await expect(p.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await p.goto('/access-requests');
    await p.getByRole('tab', { name: 'My requests' }).click();
    await expect(p.locator('#main').getByRole('listitem').filter({ hasText: key })).toContainText(
      'Approved as viewer',
    );
  });
});

test('adding a group gives its members access, and removing it takes access away', async ({
  page,
  browser,
}) => {
  const tag = rand();
  const key = newKey();
  const person = await createMember(`Gwen ${tag}`);

  // Workspace owner builds a group containing the new person.
  await signInAsOwner(page);
  const g = await apiCall(page, 'POST', '/groups', { name: `Access ${tag}` });
  expect(g.status).toBe(200);
  const list = await apiCall(page, 'GET', `/members?q=${person.email}`);
  const personId = list.json.items[0].id as string;
  await apiCall(page, 'PUT', `/groups/${g.json.id}/members`, { userIds: [personId] });

  // A private space with no members besides its admin.
  await signInAs(page, 'member@acme.test');
  expect(
    (await apiCall(page, 'POST', '/spaces', { key, name: `Team ${key}`, visibility: 'private' }))
      .status,
  ).toBe(200);

  // Add the group from the Members tab.
  await page.goto(`/spaces/${key}/members`);
  await page.getByRole('button', { name: 'Add members' }).click();
  await page.getByRole('combobox', { name: 'Groups to add' }).click();
  await page.getByPlaceholder('Search groups').fill(`Access ${tag}`);
  await page.getByRole('option', { name: new RegExp(`Access ${tag}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Add 1 member/ }).click();
  await expect(page.getByText('1 added')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Access ${tag}`) })).toContainText(
    '1 person',
  );

  // Group-based access works: the person sees the private space.
  const personCookieLogin = async (fn: (p: import('@playwright/test').Page) => Promise<void>) =>
    asAnotherPerson(browser, async (p) => {
      // createMember makes a passwordless account; use the dev-only login box instead.
      await p.goto('/sign-in');
      await p.getByLabel('Dev login email').fill(person.email);
      await p.getByRole('button', { name: 'Dev sign in' }).click();
      await expect(p.getByRole('heading', { name: /Hello/ })).toBeVisible();
      await fn(p);
    });
  await personCookieLogin(async (p) => {
    await p.goto(`/spaces/${key}`);
    await expect(p.getByRole('heading', { name: `Team ${key}` })).toBeVisible();
  });

  // The last admin cannot be demoted or removed.
  await page.getByRole('combobox', { name: 'Role for Mia Member' }).click();
  await page.getByRole('option', { name: 'Viewer' }).click();
  await expect(page.getByText('A space needs at least one admin')).toBeVisible();

  // Removing the group removes the access it gave.
  await page.getByRole('button', { name: `Actions for Access ${tag}` }).click();
  await page.getByRole('menuitem', { name: 'Remove from space' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Access ${tag}`) })).toHaveCount(0);
  await personCookieLogin(async (p) => {
    await p.goto(`/spaces/${key}`);
    await expect(p.getByText('Space not found')).toBeVisible();
  });
});

test('the audit log page lists access changes and filters them', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();

  await page.getByRole('combobox', { name: 'Filter by action' }).click();
  await page.getByRole('option', { name: 'Approved an access request' }).click();
  await expect(
    page.getByRole('row', { name: /approved an access request/i }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Show details' }).first().click();
  await expect(page.getByText('Before').first()).toBeVisible();

  await page.getByLabel('From').fill('2999-01-01');
  await expect(page.getByText('Nothing matches those filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
});

test('members cannot open the org audit log', async ({ page }) => {
  await signInAs(page, 'member@acme.test');
  await page.goto('/admin/audit');
  await expect(page.getByText('Admins only')).toBeVisible();
});
