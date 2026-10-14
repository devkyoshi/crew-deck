import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, asAnotherPerson, rand, signInAsMember, signInAsOwner } from './helpers';

test('an assignment and a mention reach the other person through the bell', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const key = `B${rand(2).toUpperCase()}`;

  // The member reads their own id and clears what is already waiting for them.
  await signInAsMember(page);
  const memberId = (await apiCall(page, 'GET', '/me')).json.user.id as string;
  await apiCall(page, 'POST', '/notifications/read', { all: true });

  // The owner sets up a space, assigns work to the member and mentions them.
  await asAnotherPerson(browser, async (owner) => {
    await signInAsOwner(owner);
    const space = await apiCall(owner, 'POST', '/spaces', {
      key,
      name: `Bell ${key}`,
      members: [{ type: 'user', id: memberId, role: 'member' }],
    });
    expect(space.status, space.text).toBe(200);
    const item = await apiCall(owner, 'POST', `/spaces/${key}/items`, { type: 'task', title: 'Fit the doors', assigneeId: memberId });
    expect(item.status, item.text).toBe(200);
    const comment = await apiCall(owner, 'POST', `/items/${item.json.id}/comments`, {
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Over to you ' }, { type: 'mention', attrs: { id: memberId, label: 'Mia' } }] }],
      },
    });
    expect(comment.status, comment.text).toBe(200);
  });

  await page.goto('/');
  const bell = page.getByRole('button', { name: /^Notifications, 2 unread/ });
  await expect(bell).toBeVisible({ timeout: 15_000 });
  await bell.click();
  await expect(page.getByRole('button', { name: new RegExp(`mentioned you on ${key}-1 Fit the doors`) })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`assigned ${key}-1 Fit the doors to you`) }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}/items/${key}-1$`));
  await expect(page.getByRole('button', { name: /^Notifications, 1 unread/ })).toBeVisible();

  // The inbox page and its settings.
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('Nothing unread', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const statusEmail = page.getByRole('switch', { name: /The status changes .*: by email/ });
  await expect(statusEmail).not.toBeChecked();
  await statusEmail.click();
  await expect(statusEmail).toBeChecked();
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: /The status changes .*: by email/ })).toBeChecked();
  await page.getByRole('switch', { name: /The status changes .*: by email/ }).click();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('nextjs-portal')
    .exclude('[data-nextjs-dev-tools-button]')
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});
