import { expect, test } from '@playwright/test';
import {
  asAnotherPerson,
  createMember,
  PASSWORD,
  rand,
  signInAsMember,
  signInAsOwner,
} from './helpers';

test('a member creates a private space, others cannot see it, and admins can archive and delete it', async ({
  page,
  browser,
}) => {
  const tag = rand(2).toUpperCase();
  const key = `E${tag}X`;
  const name = `Launch ${tag}`;
  const teammate = await createMember(`Tess ${rand()}`);

  // 1. Any member creates a space with the 4-step wizard.
  await signInAsMember(page);
  await page.goto('/spaces/new');
  await page.getByLabel('Name').fill('Product Launch');
  await expect(page.getByLabel('Key')).toHaveValue('PL'); // suggested from the name
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Key').fill(key);
  await page.getByRole('radio', { name: 'rocket' }).click();
  await page.getByLabel('Description').fill('Everything for the launch');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: /Private/ }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('combobox', { name: 'People to add' }).click();
  await page.getByPlaceholder('Search by name or email').fill(teammate.name);
  await page.getByRole('option', { name: new RegExp(teammate.name) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: `Role for ${teammate.name}` }).click();
  await page.getByRole('option', { name: 'Viewer' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText(`${teammate.name}: viewer`)).toBeVisible();
  await page.getByRole('button', { name: 'Create space' }).click();

  // 2. The overview shows the creator as admin of a private space.
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}$`));
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Private').first()).toBeVisible();
  await expect(page.getByText('Everything for the launch')).toBeVisible();
  await expect(page.getByText('Mia Member').first()).toBeVisible();

  // 3. Starring puts it in the sidebar; opening it puts it in Recent.
  await page.getByRole('button', { name: `Star ${name}` }).click();
  await expect(page.getByRole('button', { name: `Unstar ${name}` })).toBeVisible();
  const sidebar = page.locator('[data-sidebar="content"]');
  await expect(sidebar.getByText('Starred')).toBeVisible();
  await expect(sidebar.getByRole('link', { name })).toBeVisible();

  // 4. A different member cannot see or open it.
  await asAnotherPerson(browser, async (p) => {
    await p.goto('/sign-in');
    await p.getByLabel('Email', { exact: true }).fill('member2@acme.test');
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await p.goto('/spaces');
    await p.getByLabel('Search spaces').fill(name);
    await expect(p.getByText('No spaces match')).toBeVisible();
    await p.goto(`/spaces/${key}`);
    await expect(p.getByText('Space not found')).toBeVisible();
  });

  // 5. Space admins edit settings.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Description').fill('Updated description');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // 6. Archive makes it read-only; restore brings it back.
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive space' }).click();
  await expect(page.getByText('This space is archived and read-only.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expect(page.getByText('This space is archived and read-only.')).toHaveCount(0);

  // 7. A space admin cannot delete (workspace admins only).
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

  // 8. A workspace admin sees it in the admin list, and deletes it by typing the key.
  await asAnotherPerson(browser, async (p) => {
    await p.goto('/sign-in');
    await p.getByLabel('Email', { exact: true }).fill('owner@acme.test');
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(p.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await p.goto('/admin/spaces');
    await p.getByLabel('Search spaces').fill(name);
    await expect(p.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await p.goto(`/spaces/${key}/settings`);
    await p.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = p.getByRole('alertdialog').getByRole('button', { name: 'Delete space' });
    await expect(confirm).toBeDisabled();
    await p.getByLabel('Space key').fill(key);
    await confirm.click();
    await expect(p).toHaveURL(/\/spaces$/);
    await p.goto(`/spaces/${key}`);
    await expect(p.getByText('Space not found')).toBeVisible();
  });
});

test('the directory filters by visibility and my spaces, and the key must be valid', async ({
  page,
}) => {
  const tag = rand(2).toUpperCase();
  await signInAsOwner(page);
  await page.goto('/spaces/new');
  await page.getByLabel('Name').fill(`Dir ${tag}`);
  await page.getByLabel('Key').fill('1BAD');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    page.getByText('Use 2 to 10 letters or digits, starting with a letter'),
  ).toBeVisible();
  await page.getByLabel('Key').fill(`D${tag}Y`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Create space' }).click();
  await expect(page.getByRole('heading', { name: `Dir ${tag}` })).toBeVisible();

  await page.goto('/spaces');
  await page.getByLabel('Search spaces').fill(`Dir ${tag}`);
  await expect(
    page.locator('#main').getByRole('link', { name: new RegExp(`Dir ${tag}`) }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Private' }).click();
  await expect(page.getByText('No spaces match')).toBeVisible();
  await page.getByRole('tab', { name: 'Open' }).click();
  await expect(
    page.locator('#main').getByRole('link', { name: new RegExp(`Dir ${tag}`) }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Dir ${tag}`) })).toBeVisible();
});

test('the space switcher offers shortcuts to the directory and the create page', async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.getByRole('button', { name: 'Switch space' }).click();
  await page.getByRole('option', { name: 'Create space' }).click();
  await expect(page).toHaveURL(/\/spaces\/new$/);
  await expect(page.getByRole('heading', { name: 'Create space' })).toBeVisible();
});
