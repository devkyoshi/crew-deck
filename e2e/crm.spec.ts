import { expect, test } from '@playwright/test';
import { apiCall, createMember, rand, signInAsOwner, signInDev } from './helpers';

const stamp = () => rand(3);

test('capture a lead, convert it, move the deal, and log an activity', async ({ page }) => {
  test.setTimeout(120_000);
  const tag = stamp();
  const lead = `Lead ${tag}`;
  const company = `Co ${tag}`;
  await signInAsOwner(page);

  // Capture the lead.
  await page.goto('/crm/leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  await page.getByLabel('Name *').fill(lead);
  await page.getByRole('dialog').getByLabel('Email').fill(`lead-${tag}@example.com`);
  await page.getByLabel('Source').fill('Webinar');
  await page.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByRole('link', { name: lead })).toBeVisible();

  // Convert it into a company, a contact and a deal.
  await page.getByRole('link', { name: lead }).click();
  await expect(page.getByRole('heading', { name: lead })).toBeVisible();
  await page.getByRole('button', { name: 'Convert lead' }).click();
  await page.getByRole('button', { name: 'Create new' }).click();
  await page.getByPlaceholder('Company name').fill(company);
  await page.getByLabel('Title').fill(`${company} rollout`);
  await page.getByLabel('Value').fill('12500');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  // We land on the new deal, in the first stage and open.
  await expect(page.getByRole('heading', { name: `${company} rollout` })).toBeVisible();
  await expect(page.getByText('$12,500').first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Stage' })).toHaveText('Prospecting');

  // Move it with the stage control.
  await page.getByRole('combobox', { name: 'Stage' }).click();
  await page.getByRole('option', { name: 'Proposal' }).click();
  await expect(page.getByRole('combobox', { name: 'Stage' })).toHaveText('Proposal');

  // Log an activity against the deal.
  await page.getByLabel('Subject').fill('Send the contract');
  await page.getByRole('button', { name: 'Add activity' }).click();
  await expect(page.getByText('Send the contract')).toBeVisible();

  // The lead now shows as converted and cannot be converted twice.
  await page.goto('/crm/leads');
  await page.getByLabel('Search by name, email or company').fill(lead);
  await expect(
    page.getByRole('row', { name: new RegExp(lead) }).getByText('Converted'),
  ).toBeVisible();
  await page.getByRole('link', { name: lead }).click();
  await expect(page.getByRole('button', { name: 'Convert lead' })).toHaveCount(0);

  // On the board the card sits in Proposal, and the card menu moves it to Won.
  await page.goto('/crm/deals');
  const proposal = page.getByRole('region', { name: /^Proposal,/ });
  await expect(proposal.getByRole('link', { name: `${company} rollout` })).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${company} rollout` }).click();
  await page.getByRole('menuitem', { name: 'Won' }).click();
  const won = page.getByRole('region', { name: /^Won,/ });
  await expect(won.getByRole('link', { name: `${company} rollout` })).toBeVisible();
  await expect(proposal.getByRole('link', { name: `${company} rollout` })).toHaveCount(0);

  // Survives a reload: the move was saved, and the deal is closed as won.
  await page.reload();
  await expect(
    page.getByRole('region', { name: /^Won,/ }).getByRole('link', { name: `${company} rollout` }),
  ).toBeVisible();
});

test('a deal can be moved with the keyboard-driven drag handle', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = stamp();
  await signInAsOwner(page);
  const created = await apiCall(page, 'POST', '/crm/deals', { title: `Kbd ${tag}`, value: 100 });
  expect(created.status).toBe(200);
  const dealId = created.json.id as string;
  const pipelines = await apiCall(page, 'GET', '/crm/pipelines');
  const stages = pipelines.json.items[0].stages as { id: string; name: string }[];

  await page.goto('/crm/deals');
  const handle = page.getByRole('button', { name: `Drag Kbd ${tag}` });
  await expect(handle).toBeVisible();
  await page.waitForLoadState('networkidle');
  await handle.focus();
  await page.keyboard.press('Space');
  // aria-pressed confirms the drag has started before we steer it.
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByText(new RegExp('^Kbd ' + tag + ' is over (?!Prospecting)')),
  ).toBeAttached();
  await page.keyboard.press('Space');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');

  // Where the card lands depends on the other cards in the columns, so check that it left the first
  // column, that the move was saved, and that the board shows it in the stage the server reports.
  await expect
    .poll(async () => (await apiCall(page, 'GET', `/crm/deals/${dealId}`)).json.stageId, {
      timeout: 10_000,
    })
    .not.toBe(stages[0]!.id);
  const landed = (await apiCall(page, 'GET', `/crm/deals/${dealId}`)).json.stageId as string;
  const stageName = stages.find((s) => s.id === landed)!.name;
  await expect(
    page
      .getByRole('region', { name: new RegExp(`^${stageName},`) })
      .getByRole('link', { name: `Kbd ${tag}` }),
  ).toBeVisible();
});

test('import a CSV of leads: bad files are explained, good files are saved', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = stamp();
  await signInAsOwner(page);
  await page.goto('/crm/leads');
  await page.getByRole('button', { name: 'Import' }).click();

  const upload = (csv: string) =>
    page
      .getByLabel('CSV file')
      .setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  // A file with a bad row is explained and cannot be imported.
  await upload(
    `Name,Email,Source\nGood ${tag},good-${tag}@example.com,Import\nBad ${tag},not-an-email,Import\n`,
  );
  await expect(page.getByText('Map columns').first()).toBeVisible();
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText(/1 problem found/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Not a valid email address' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import \d+ leads/ })).toBeDisabled();

  // Fix the file: start over and import it.
  await page.getByRole('button', { name: 'Start over' }).click();
  await upload(
    `Name,Email,Source\nGood ${tag},good-${tag}@example.com,Import\nSecond ${tag},second-${tag}@example.com,Import\n`,
  );
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('All 2 rows are valid.')).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 leads' }).click();
  await expect(page.getByRole('dialog').getByText('Imported 2 leads')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByLabel('Search by name, email or company').fill(tag);
  await expect(page.getByRole('link', { name: `Good ${tag}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `Second ${tag}` })).toBeVisible();
  // The rejected row was never saved.
  await expect(page.getByRole('link', { name: `Bad ${tag}` })).toHaveCount(0);

  // The export is a CSV download.
  const exp = await apiCall(page, 'GET', '/crm/export/leads');
  expect(exp.status).toBe(200);
  expect(exp.contentType).toContain('text/csv');
  expect(exp.text).toContain(`Good ${tag}`);
});

test('CRM roles: viewers read only, people without access see why', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const tag = stamp();
  const viewer = await createMember(`Viewer ${tag}`);
  const nobody = await createMember(`Nobody ${tag}`);
  await signInAsOwner(page);
  for (const [who, crmRole] of [
    [viewer, 'viewer'],
    [nobody, 'none'],
  ] as const) {
    const list = await apiCall(page, 'GET', `/members?q=${encodeURIComponent(who.name)}`);
    const id = list.json.items[0].id as string;
    expect((await apiCall(page, 'PATCH', `/members/${id}`, { crmRole })).status).toBe(200);
  }

  const ctx = await browser.newContext({ baseURL: 'http://acme.localhost:3000' });
  try {
    const v = await ctx.newPage();
    await signInDev(v, viewer.email);
    await v.goto('/crm/leads');
    await expect(v.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
    await expect(v.getByRole('button', { name: 'New lead' })).toHaveCount(0);
    await expect(v.getByRole('button', { name: 'Import' })).toHaveCount(0);
    await v.goto('/crm/deals');
    await expect(v.getByRole('link', { name: /Northwind renewal/ })).toBeVisible();
    await expect(v.getByRole('button', { name: /^Drag / })).toHaveCount(0);
    await expect(v.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
  } finally {
    await ctx.close();
  }

  const ctx2 = await browser.newContext({ baseURL: 'http://acme.localhost:3000' });
  try {
    const n = await ctx2.newPage();
    await signInDev(n, nobody.email);
    await n.goto('/crm/leads');
    await expect(n.getByText('You don’t have access to this')).toBeVisible();
    // The sidebar has no CRM group for them.
    await expect(n.getByRole('link', { name: 'Deals', exact: true })).toHaveCount(0);
  } finally {
    await ctx2.close();
  }
});

test('admins can switch the CRM off and on', async ({ page }) => {
  await signInAsOwner(page);
  await page.goto('/admin/crm');
  const toggle = page.getByRole('switch', { name: 'CRM module' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.goto('/crm');
  await expect(page.getByText('The CRM is switched off')).toBeVisible();
  await page.goto('/admin/crm');
  await page.getByRole('switch', { name: 'CRM module' }).click();
  await expect(page.getByRole('switch', { name: 'CRM module' })).toBeChecked();
  await page.goto('/crm');
  await expect(page.getByRole('heading', { name: 'CRM', level: 1 })).toBeVisible();
});

test('pipeline stages can be added and reordered from settings', async ({ page }) => {
  const tag = stamp();
  await signInAsOwner(page);
  await page.goto('/admin/crm');
  await page
    .getByLabel(/New stage name/)
    .first()
    .fill(`Legal ${tag}`);
  await page.getByRole('button', { name: 'Add stage' }).first().click();
  await expect(
    page
      .getByLabel(/Name of stage \d+/)
      .filter({ hasText: '' })
      .first(),
  ).toBeVisible();
  await expect(page.locator(`input[value="Legal ${tag}"]`)).toBeVisible();
  await page.getByRole('button', { name: `Move Legal ${tag} up` }).click();
  // The board reflects the new stage.
  await page.goto('/crm/deals');
  await expect(page.getByRole('region', { name: new RegExp(`^Legal ${tag},`) })).toBeVisible();
  // Clean up so later runs start from the standard pipeline.
  await page.goto('/admin/crm');
  await page.getByRole('button', { name: `Delete stage Legal ${tag}` }).click();
  await expect(page.locator(`input[value="Legal ${tag}"]`)).toHaveCount(0);
});
