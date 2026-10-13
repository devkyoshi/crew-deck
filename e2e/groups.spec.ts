import { expect, test } from '@playwright/test';
import {
  asAnotherPerson,
  createMember,
  PASSWORD,
  rand,
  signInAsMember,
  signInAsOwner,
} from './helpers';

test('admin builds a team and sees the group on each member profile', async ({ page }) => {
  const tag = rand();
  const ava = await createMember(`Ava ${tag}`);
  const ben = await createMember(`Ben ${tag}`);
  const groupName = `Backend ${tag}`;

  await signInAsOwner(page);
  await page.goto('/admin/groups');
  await page.getByRole('button', { name: 'New group' }).first().click();
  await page.getByLabel('Name').fill(groupName);
  await page.getByLabel('Description').fill('Server side people');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByText(`Group “${groupName}” created`)).toBeVisible();

  // Duplicate names are refused, ignoring case.
  await page.getByRole('button', { name: 'New group' }).first().click();
  await page.getByLabel('Name').fill(groupName.toUpperCase());
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByText('A group with that name already exists')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Open it and add two people through the searchable picker.
  await page.getByLabel('Search groups').fill(groupName);
  await page.getByRole('link', { name: groupName }).click();
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
  await expect(page.getByText('No members yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add members' }).first().click();
  const picker = page.getByRole('combobox', { name: 'People to add' });
  await picker.click();
  await page.getByPlaceholder('Search by name or email').fill(`Ava ${tag}`);
  await page.getByRole('option', { name: new RegExp(`Ava ${tag}`) }).click();
  await page.getByPlaceholder('Search by name or email').fill(`Ben ${tag}`);
  await page.getByRole('option', { name: new RegExp(`Ben ${tag}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add 2 people' }).click();
  await expect(page.getByRole('row', { name: new RegExp(ava.email) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(ben.email) })).toBeVisible();

  // The group shows on a member's profile.
  await page.getByRole('link', { name: new RegExp(`Ava ${tag}`) }).click();
  await expect(page.getByRole('link', { name: groupName })).toBeVisible();
  await page.goBack();

  // Removing a member updates the list.
  await page.getByRole('button', { name: `Remove Ben ${tag} from ${groupName}` }).click();
  await expect(page.getByRole('row', { name: new RegExp(ben.email) })).toHaveCount(0);

  // Ordinary members can read groups but not change them.
  await asAnotherPerson(page.context().browser()!, async (p) => {
    await p.goto('/sign-in');
    await p.getByLabel('Email', { exact: true }).fill('member@acme.test');
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await p.goto('/groups');
    await expect(p.getByRole('link', { name: groupName })).toBeVisible();
    await expect(p.getByRole('button', { name: 'New group' })).toHaveCount(0);
    await p.goto('/admin/groups');
    await expect(p.getByText('Admins only')).toBeVisible();
  });

  // Deleting removes the group, and it disappears from the profile.
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete group' }).click();
  await expect(page).toHaveURL(/\/admin\/groups$/);
  await page.getByLabel('Search groups').fill(groupName);
  await expect(page.getByText('No groups match your search')).toBeVisible();
});

test('inviting someone into a group puts them in it after they accept', async ({
  page,
  browser,
}) => {
  const tag = rand();
  const groupName = `QA ${tag}`;
  const email = `inv-${tag}@acme.test`;

  await signInAsOwner(page);
  await page.goto('/admin/groups');
  await page.getByRole('button', { name: 'New group' }).first().click();
  await page.getByLabel('Name').fill(groupName);
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByText(`Group “${groupName}” created`)).toBeVisible();

  await page.goto('/admin/members');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await page.getByLabel('Email addresses').fill(email);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('combobox', { name: 'Groups to join' }).click();
  await page.getByPlaceholder('Search groups').fill(groupName);
  await page.getByRole('option', { name: new RegExp(groupName) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(`Groups: ${groupName}`)).toBeVisible();
  await page.getByRole('button', { name: /Send 1 invitation/ }).click();
  const link = await page.getByLabel(`Invite link for ${email}`).inputValue();
  await page.getByRole('button', { name: 'Done' }).click();

  await asAnotherPerson(browser, async (p) => {
    await p.goto(link);
    await p.getByLabel('Full name').fill('Ivy Invited');
    await p.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
    await p.getByLabel('Confirm password').fill('a-long-enough-password');
    await p.getByRole('button', { name: 'Create account' }).click();
    await expect(p.getByRole('heading', { name: /Hello, Ivy/ })).toBeVisible();
  });

  await page.goto('/admin/members');
  await page.getByLabel('Search members').fill(email);
  await page
    .getByRole('row', { name: /Ivy Invited/ })
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByRole('link', { name: groupName })).toBeVisible();
});

test('members cannot create groups through the UI', async ({ page }) => {
  await signInAsMember(page);
  await page.goto('/groups');
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New group' })).toHaveCount(0);
});
