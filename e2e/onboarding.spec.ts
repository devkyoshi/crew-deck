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

/** The "What kind of work" and "How will you use it" steps: pick a type, keep the suggested usage. */
async function passWorkSteps(page: Page, type = 'software') {
  await expect(page.getByRole('heading', { name: 'What kind of work does your company do?' })).toBeVisible();
  await page.getByTestId(`work-type-${type}`).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'How does your team plan to use it?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Walks the sign-up steps up to and including "Email me the link". */
async function walkSignUp(
  page: Page,
  a: { name: string; email: string; company: string; slug?: string },
) {
  await page.goto(`${APEX}/signup`);
  await page.getByLabel('What should we call you?').fill(a.name);
  await page.getByLabel('Your work email').fill(a.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Company name').fill(a.company);
  if (a.slug) await page.getByLabel('Workspace address').fill(a.slug);
  await expect(page.getByText(/is available/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await passWorkSteps(page);
  await page.getByRole('button', { name: 'Email me the link' }).click();
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
  await expect(page.getByRole('heading', { name: /set up your workspace/ })).toBeVisible();
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

  // ---- Sign up: guided steps, then the emailed link ---------------------------------------------
  await page.goto(`${APEX}/signup`);
  await page.getByLabel('What should we call you?').fill('Nora Founder');
  await page.getByLabel('Your work email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Nice to meet you, Nora/ })).toBeFocused();
  await page.getByLabel('Company name').fill(company);
  // The address follows the company name, and is checked live.
  await expect(page.getByLabel('Workspace address')).toHaveValue(
    slug.replace('e2e-', 'e2e-company-'),
  );
  await page.getByLabel('Workspace address').fill(slug);
  await expect(page.getByText(`${slug}.localhost is available`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Choosing a kind of work pre-ticks what teams like this usually need.
  await expect(page.getByRole('heading', { name: 'What kind of work does your company do?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose at least one kind of work your company does')).toBeVisible();
  await page.getByTestId('work-type-sales').click();
  // A company can do several kinds of work: picking another keeps the first.
  await page.getByTestId('work-type-marketing').click();
  await expect(page.getByTestId('work-type-sales')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('work-type-marketing')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('usage-track_leads').getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Here’s what we’ll create/ })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('Sales, Marketing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  await page.getByTestId('dev-link').click();

  // The link greets us by name; a new person then chooses a password.
  await expect(page.getByRole('heading', { name: /Welcome, Nora/ })).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Nora Founder');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a password' })).toBeVisible();
  await page.getByLabel('Password').fill('short');
  await expect(page.getByText(/more characters to go/)).toBeVisible();
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
  await page.getByLabel('Password').fill('a-good-password-123');
  await expect(page.getByText(/Strong|Good/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`${company} is ready`) }),
  ).toBeVisible();

  // ---- We land signed in on the new workspace, on a Business trial --------------------------------
  await page.waitForURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await expect(page.getByText(/Business trial: 14 days left/)).toBeVisible();

  // Isolation: it has one person, only its own starter space, and none of Acme's data.
  const members = await apiCall(page, 'GET', '/members');
  expect(members.json.total).toBe(1);
  const spaces = (await apiCall(page, 'GET', '/spaces')).json;
  expect(spaces.items.map((sp: { key: string }) => sp.key)).toEqual(['MKT', 'SALES']);
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
    await walkSignUp(page, {
      name: 'Gina Gmail',
      email: `someone-${tag}@gmail.com`,
      company: `Gmail Co ${tag}`,
    });
    // The platform rule is applied when the link is requested, and sends us back to fix the email.
    await expect(page.getByText(/use your work email/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /set up your workspace/ })).toBeVisible();

    // Back to the default so later runs are not affected.
    await toggle.click();
    await admin.getByRole('button', { name: 'Save settings' }).click();
    await expect
      .poll(
        async () => (await apiCall(admin, 'GET', '/platform/settings')).json.blockFreeEmailDomains,
      )
      .toBe(false);
    // Our earlier answers were kept: carry on from the first step with the email fixed.
    await page.getByLabel('Your work email').fill(`someone2-${tag}@gmail.com`);
    // Wait for each step before the next click: a click during a step change can be lost.
    for (const next of ['company', 'work', 'usage', 'review']) {
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(new RegExp(`step=${next}`));
    }
    // The kind of work and usage answers were kept too.
    await expect(page.getByText('Software development', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Email me the link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
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

test.describe('guided sign-up navigation', () => {
  test('each step checks its answers, Back and the browser Back keep them, and you cannot skip ahead', async ({
    page,
  }) => {
    const tag = rand(3);
    await page.goto(`${APEX}/signup`);
    await expect(page.getByText('Step 1 of 6: You')).toBeVisible();

    // Step 1 will not continue without answers, and says what is missing.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Tell us what to call you')).toBeVisible();
    await expect(page.getByText(/Enter your work email/)).toBeVisible();
    await page.getByLabel('What should we call you?').fill('Sam Guide');
    await page.getByLabel('Your work email').fill(`sam-${tag}@guided.test`);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2: a bad or reserved address is refused before moving on.
    await expect(page).toHaveURL(/step=company/);
    await expect(page.getByText('Step 2 of 6: Company')).toBeVisible();
    await page.getByLabel('Company name').fill(`Guided ${tag}`);
    await page.getByLabel('Workspace address').fill('Bad Address!');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Use 3 to 30 lowercase letters/).first()).toBeVisible();
    await page.getByLabel('Workspace address').fill('admin');
    await expect(page.getByText(/reserved/)).toBeVisible();
    await page.getByLabel('Workspace address').fill(`guided-${tag}`);
    await expect(page.getByText(/is available/)).toBeVisible();

    // The browser's Back button returns to step 1 with the answers still there; Forward comes back.
    await page.goBack();
    await expect(page).toHaveURL(/step=you/);
    await expect(page.getByLabel('What should we call you?')).toHaveValue('Sam Guide');
    await page.goForward();
    await expect(page.getByLabel('Company name')).toHaveValue(`Guided ${tag}`);

    // A refresh keeps the step and the answers.
    await page.reload();
    await expect(page.getByText('Step 2 of 6: Company')).toBeVisible();
    await expect(page.getByLabel('Workspace address')).toHaveValue(`guided-${tag}`);

    // Typing a later step into the address bar cannot skip the questions.
    await page.goto(`${APEX}/signup?step=sent`);
    await expect(page.getByText('Step 2 of 6: Company')).toBeVisible();
    await expect(page).toHaveURL(/step=company/);

    // Review shows the answers, with a way back to change each one.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Step 3 of 6: Work')).toBeVisible();
    await passWorkSteps(page, 'construction');
    await expect(page.getByRole('heading', { name: /Here’s what we’ll create/ })).toBeVisible();
    await expect(page.getByText('Construction', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Change work email' }).click();
    await expect(page.getByLabel('Your work email')).toHaveValue(`sam-${tag}@guided.test`);
    // Completed steps in the progress bar are buttons back to them.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByRole('navigation', { name: 'Progress' })
      .getByRole('button', { name: /Company/ })
      .click();
    await expect(page.getByLabel('Company name')).toHaveValue(`Guided ${tag}`);
  });

  test('after the link is sent you can resend only after a short wait, and change your details', async ({
    page,
  }) => {
    const tag = rand(3);
    await walkSignUp(page, {
      name: 'Rae Resend',
      email: `rae-${tag}@resend.test`,
      company: `Resend ${tag}`,
    });
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    await expect(page.getByText(`rae-${tag}@resend.test`)).toBeVisible();
    await expect(page.getByRole('button', { name: /Send again in \d+s/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Change my details' }).click();
    await expect(page.getByRole('heading', { name: /set up your workspace/ })).toBeVisible();
  });

  test('the whole sign-up can be done with the keyboard, and focus follows each step', async ({
    page,
  }) => {
    const tag = rand(3);
    await page.goto(`${APEX}/signup`);
    await expect(page.getByLabel('What should we call you?')).toBeFocused();
    await page.keyboard.type('Kay Board');
    await page.keyboard.press('Tab');
    await page.keyboard.type(`kay-${tag}@keys.test`);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Nice to meet you, Kay/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.type(`Keys ${tag}`);
    await expect(page.getByText(/is available/)).toBeVisible();
    await page.keyboard.press('Enter');
    // Kind of work: the cards are buttons, so Tab reaches them and Space picks one.
    await expect(page.getByRole('heading', { name: 'What kind of work does your company do?' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('work-type-software')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('work-type-software')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    // Usage: checkboxes, already ticked from the kind of work.
    await expect(page.getByRole('heading', { name: 'How does your team plan to use it?' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('usage-run_sprints').getByRole('checkbox')).toBeFocused();
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Here’s what we’ll create/ })).toBeFocused();
    await page.getByRole('button', { name: 'Email me the link' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeFocused();
  });

  test('a used or expired link explains what to do', async ({ page }) => {
    await page.goto(`${APEX}/signup/verify?token=not-a-real-token-at-all`);
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start again' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find my workspace' })).toBeVisible();
  });
});
