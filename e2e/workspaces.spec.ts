import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, PASSWORD, rand, signInWithPassword } from './helpers';

const APEX = 'http://localhost:3000';

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('nextjs-portal')
    .exclude('[data-nextjs-dev-tools-button]')
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, `${label} has accessibility violations`).toEqual([]);
}

test('a construction company signs up and its first space starts with construction columns', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const tag = rand(3);
  const slug = `e2e-build-${tag}`;

  await page.goto(`${APEX}/signup`);
  await page.getByLabel('What should we call you?').fill('Cam Contractor');
  await page.getByLabel('Your work email').fill(`cam-${tag}@build-${tag}.test`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Company name').fill(`Build ${tag}`);
  await page.getByLabel('Workspace address').fill(slug);
  await expect(page.getByText(/is available/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'What kind of work does your company do?' })).toBeVisible();
  await page.getByTestId('work-type-construction').click();
  await expect(page.getByTestId('work-type-construction')).toHaveAttribute('aria-checked', 'true');
  await scan(page, 'sign-up: kind of work');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'How does your team plan to use it?' })).toBeVisible();
  // Construction suggestions are ticked; options that are not built say so.
  await expect(page.getByTestId('usage-site_work').getByRole('checkbox')).toBeChecked();
  await expect(page.getByTestId('usage-approvals')).toContainText('Coming soon');
  await scan(page, 'sign-up: usage');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Construction', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Email me the link' }).click();
  await page.getByTestId('dev-link').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password').fill('a-good-password-123');
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await page.waitForURL(`http://${slug}.localhost:3000/`);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();

  // The workspace starts with a job board in the team's own words.
  await page.goto(`http://${slug}.localhost:3000/spaces/JOBS/board`);
  await expect(page.getByText('No jobs yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'My jobs' })).toBeVisible();
  await page.getByRole('button', { name: 'Create the first job' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create job' });
  const types = dialog.getByRole('radiogroup', { name: 'Type' });
  for (const name of ['Project', 'Job', 'Defect', 'Subtask']) {
    await expect(types.getByRole('radio', { name })).toBeVisible();
  }
  await expect(types.getByRole('radio', { name: 'Story' })).toHaveCount(0);
  await types.getByRole('radio', { name: 'Job' }).click();
  await dialog.getByLabel('Title').fill('Pour the level 1 slab');
  await dialog.getByRole('button', { name: /^Create/ }).click();
  await expect(page.getByRole('article', { name: /JOBS-1 Pour the level 1 slab/ })).toBeVisible();
  await expect(page.getByText('1 job on the board')).toBeVisible();

  // The create-space wizard says which columns a new space gets.
  await page.goto(`http://${slug}.localhost:3000/spaces/new`);
  await page.getByLabel('Name', { exact: true }).fill('Riverside');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('starting-columns')).toContainText(
    'Starts with: Planned → On site → Inspection → Complete',
  );

  // And a space created now really has them.
  const space = await apiCall(page, 'POST', '/spaces', { key: 'JOB', name: 'Job board' });
  expect(space.status).toBe(200);
  const statuses = await apiCall(page, 'GET', `/spaces/${space.json.id}/statuses`);
  expect(statuses.json.items.map((s: { name: string }) => s.name)).toEqual([
    'Planned',
    'On site',
    'Inspection',
    'Complete',
  ]);
});

test('a person in several workspaces switches between them and starts another', async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithPassword(page, 'multi@crewdeck.test', PASSWORD);

  await page.getByRole('button', { name: 'Switch workspace' }).click();
  const menu = page.getByRole('menu');
  for (const name of ['Acme Inc', 'Brightly Marketing', 'Buildwell Construction', 'Globex Corp']) {
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  }
  await menu.getByRole('menuitem', { name: 'All workspaces' }).click();

  await expect(page.getByRole('heading', { name: 'Your workspaces' })).toBeVisible();
  await expect(page.getByTestId('workspace-buildwell')).toContainText('Construction');
  await expect(page.getByTestId('workspace-brightly')).toContainText('Owner');
  await scan(page, 'your workspaces');

  await page.getByRole('link', { name: 'Create a workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await scan(page, 'create a workspace');
  const tag = rand(3);
  await page.getByLabel('Workspace name').fill(`Counsel ${tag}`);
  await expect(page.getByLabel('Workspace address')).toHaveValue(`counsel-${tag}`);
  await expect(page.getByText(/is available/)).toBeVisible();
  await page.getByTestId('work-type-legal').click();
  await page.getByTestId('create-workspace').click();

  // The new workspace has its own address, and the hand-over signs us straight in as its owner.
  await page.waitForURL(`http://counsel-${tag}.localhost:3000/`);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  expect((await apiCall(page, 'GET', '/me')).json.orgRole).toBe('owner');
  const mine = (await apiCall(page, 'GET', '/workspaces')).json.items as { slug: string; current: boolean }[];
  expect(mine.find((w) => w.slug === `counsel-${tag}`)?.current).toBe(true);
  expect(mine.map((w) => w.slug)).toEqual(expect.arrayContaining(['acme', 'globex', 'buildwell', 'brightly']));

  // Changing what the workspace is for switches the matching modules on.
  const leads = page.getByRole('link', { name: 'Leads' });
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await expect(leads).toHaveCount(0);
  await page.goto(`http://counsel-${tag}.localhost:3000/admin/settings/workspace`);
  await expect(page.getByRole('heading', { name: 'Kind of work', level: 1 })).toBeVisible();
  await expect(page.getByTestId('work-type-legal')).toHaveAttribute('aria-checked', 'true');
  await scan(page, 'settings: kind of work');
  await page.getByTestId('work-type-sales').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Leads' })).toBeVisible();
});

test('switching to another workspace needs no second sign-in', async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithPassword(page, 'multi@crewdeck.test', PASSWORD);
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await page.getByRole('menuitem', { name: /Buildwell Construction/ }).click();
  await page.waitForURL('http://buildwell.localhost:3000/');
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  expect((await apiCall(page, 'GET', '/me')).json.org.slug).toBe('buildwell');
  // And back again from the "Your workspaces" page.
  await page.goto('http://buildwell.localhost:3000/my-workspaces');
  await page.getByTestId('workspace-acme').getByRole('button', { name: /Open/ }).click();
  await page.waitForURL('http://acme.localhost:3000/');
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
});

