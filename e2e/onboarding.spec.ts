import { expect, test, type Page } from '@playwright/test';
import { apiCall, PASSWORD, rand } from './helpers';

const APEX = 'http://localhost:3000';

async function signInToPlatform(page: Page) {
  await page.goto(`${APEX}/platform/sign-in`);
  await page.getByLabel('Email').fill('platform@crewdeck.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Workspaces', level: 1 })).toBeVisible();
}

test('the pricing page compares the plans, and sign-up is one click away', async ({ page }) => {
  await page.goto(`${APEX}/pricing`);
  await expect(page.getByRole('heading', { name: /Simple plans/ })).toBeVisible();
  const table = page.getByRole('table', { name: 'Compare plans' });
  await expect(table.getByRole('columnheader', { name: /Free/ })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /Team/ })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /Business/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /^People 5 50 Unlimited/ })).toBeVisible();
  await expect(
    table.getByRole('row', { name: /Per-space audit log Not included Not included Included/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Start free trial' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
});

test('a new company signs up, runs on a trial, is isolated, and the platform can suspend and restore it', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const tag = rand(3);
  const slug = `e2e-${tag}`;
  const email = `owner-${tag}@e2e-${tag}.test`;
  const company = `E2E Company ${tag}`;
  const origin = `http://${slug}.localhost:3000`;

  // ---- Sign up: details, then the emailed link --------------------------------------------------
  await page.goto(`${APEX}/signup`);
  await page.getByLabel('Company name').fill(company);
  // The address follows the company name, and is checked live.
  await expect(page.getByLabel('Workspace address')).toHaveValue(
    slug.replace('e2e-', 'e2e-company-'),
  );
  await page.getByLabel('Workspace address').fill(slug);
  await expect(page.getByText(`${slug}.localhost is available`)).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByText('Check your email', { exact: true })).toBeVisible();
  await page.getByTestId('dev-link').click();

  await expect(page.getByText(`Create ${company}`, { exact: true })).toBeVisible();
  await page.getByLabel('Your name').fill('Nora Founder');
  await page.getByLabel('Choose a password').fill('a-good-password-123');
  await page.getByRole('button', { name: 'Create my workspace' }).click();

  // ---- We land signed in on the new workspace, on a Business trial --------------------------------
  await page.waitForURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await expect(page.getByText(/Business trial: 14 days left/)).toBeVisible();

  // Isolation: it has one person, no spaces, and none of Acme's data.
  const members = await apiCall(page, 'GET', '/members');
  expect(members.json.total).toBe(1);
  expect((await apiCall(page, 'GET', '/spaces')).json.total).toBe(0);
  await page.goto(`${origin}/admin/billing`);
  await expect(page.getByRole('heading', { name: 'Plan and billing', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Business', level: 2 })).toBeVisible();
  await expect(page.getByText('Trial', { exact: true })).toBeVisible();
  await expect(page.getByText(/1 of Unlimited/).first()).toBeVisible();

  // ---- The platform finds it ----------------------------------------------------------------------
  const platformCtx = await browser.newContext();
  const admin = await platformCtx.newPage();
  try {
    await signInToPlatform(admin);
    await admin.getByLabel('Search workspaces').fill(slug);
    await expect(admin.getByRole('link', { name: company })).toBeVisible();
    await admin.getByRole('link', { name: company }).click();
    await expect(admin.getByRole('heading', { name: company, level: 1 })).toBeVisible();
    await expect(admin.getByText('Business', { exact: false }).first()).toBeVisible();

    // Moving to Free applies the Free limits straight away: six people do not fit.
    await admin.getByRole('combobox', { name: 'Change plan' }).click();
    await admin.getByRole('option', { name: 'Free' }).click();
    await expect(admin.getByText('Plan updated').first()).toBeVisible();
    const six = Array.from({ length: 6 }, (_, i) => `p${i}-${tag}@e2e-${tag}.test`);
    const over = await apiCall(page, 'POST', '/invitations', { emails: six });
    expect(over.status).toBe(402);
    expect(over.json.message).toContain('Free plan allows up to 5 people');
    // CRM import and export now show as locked, with a way to see the plans.
    await page.goto(`${origin}/crm/leads`);
    await expect(page.getByRole('link', { name: /Import and export/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);

    // ---- Suspend: nobody can get in, open sessions end ---------------------------------------------
    await admin.getByRole('button', { name: 'Suspend', exact: true }).click();
    await admin.getByLabel(/Reason/).fill('Test suspension');
    await admin.getByRole('button', { name: 'Suspend workspace' }).click();
    await expect(admin.getByText(/Suspended .*Reason: Test suspension/)).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/sign-in/);
    await expect(page.getByText(/This workspace is suspended/).first()).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    const login = await apiCall(page, 'POST', '/auth/login', {
      email,
      password: 'a-good-password-123',
    });
    expect(login.status).toBe(403);
    expect(login.json.code).toBe('workspace_suspended');

    // ---- Restore -----------------------------------------------------------------------------------------
    await admin.getByRole('button', { name: 'Unsuspend' }).click();
    await expect(admin.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible();
    await page.goto(`${origin}/sign-in`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password').fill('a-good-password-123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  } finally {
    await platformCtx.close();
  }
});

test('platform admins can open a workspace read-only, and every visit is recorded', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  try {
    await signInToPlatform(admin);
    await admin.getByLabel('Search workspaces').fill('acme');
    await admin.getByRole('link', { name: 'Acme Inc' }).click();
    await admin.getByRole('button', { name: /Open as owner/ }).click();
    await admin.waitForURL('http://acme.localhost:3000/');
    await expect(admin.getByText(/This visit is read-only/)).toBeVisible();
    const blocked = await apiCall(admin, 'POST', '/spaces', { key: 'NOPE', name: 'Nope' });
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe('impersonation_read_only');
    // The workspace's audit log shows it.
    await admin.goto('/admin/audit');
    await expect(admin.getByText(/impersonation_started|platform admin/i).first()).toBeVisible();
  } finally {
    await ctx.close();
  }
  void page;
});

test('platform settings can block free email providers at sign-up', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = rand(3);
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  try {
    await signInToPlatform(admin);
    await admin.getByRole('link', { name: 'Settings' }).click();
    const toggle = admin.getByRole('switch', { name: /Block free email providers/ });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await admin.getByRole('button', { name: 'Save settings' }).click();
    await expect(admin.getByText('Settings saved').first()).toBeVisible();

    await page.goto(`${APEX}/signup`);
    await page.getByLabel('Company name').fill(`Gmail Co ${tag}`);
    await page.getByLabel('Work email').fill(`someone-${tag}@gmail.com`);
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByText(/use your work email/i)).toBeVisible();

    // Back to the default so later runs are not affected.
    await toggle.click();
    await admin.getByRole('button', { name: 'Save settings' }).click();
    await expect
      .poll(
        async () => (await apiCall(admin, 'GET', '/platform/settings')).json.blockFreeEmailDomains,
      )
      .toBe(false);
    await page.getByLabel('Work email').fill(`someone2-${tag}@gmail.com`);
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByText('Check your email', { exact: true })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('the platform console is not reachable from a workspace, or without signing in', async ({
  page,
}) => {
  await page.goto(`${APEX}/platform`);
  await expect(page).toHaveURL(/platform\/sign-in/);
  // From inside a workspace address the console does not exist at all.
  await page.goto('http://acme.localhost:3000/sign-in');
  expect((await apiCall(page, 'GET', '/platform/tenants')).status).toBe(404);
  expect((await apiCall(page, 'GET', '/platform/me')).status).toBe(404);
});
