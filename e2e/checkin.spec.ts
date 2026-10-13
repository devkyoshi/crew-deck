import { expect, test } from '@playwright/test';
import { apiCall, asAnotherPerson, createMember, rand, signInAsOwner, signInDev } from './helpers';

const stamp = () => rand(3);

test('a member checks in from the top bar and teammates see their status within seconds', async ({
  page,
  browser,
}) => {
  const tag = stamp();
  const sam = await createMember(`Sam ${tag}`);
  const kim = await createMember(`Kim ${tag}`);

  // Kim (a teammate) already has the board open.
  const kimCtx = await browser.newContext({ baseURL: 'http://acme.localhost:3000' });
  const kimPage = await kimCtx.newPage();
  try {
    await signInDev(kimPage, kim.email);
    await kimPage.goto('/team');
    await expect(kimPage.getByRole('heading', { name: 'Team' })).toBeVisible();
    await kimPage.getByLabel('Search the team').fill(`Sam ${tag}`);
    await expect(kimPage.getByText(`Sam ${tag}`)).toHaveCount(1);
    await expect(
      kimPage.getByRole('region', { name: 'Not checked in' }).getByText(`Sam ${tag}`),
    ).toBeVisible();

    // Sam checks in from the top bar.
    await signInDev(page, sam.email);
    await page.getByRole('button', { name: /Check in\. Open check-in/ }).click();
    await page.getByRole('button', { name: 'Remote' }).click();
    await page.getByLabel('Note (optional)').fill('Writing the quarterly report');
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByText('Checked in', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Checked in \d\d:\d\d\. Open check-in/ }),
    ).toBeVisible();

    // Within the board's refresh interval Kim sees Sam under Remote, as "In", with no exact time.
    const remote = kimPage.getByRole('region', { name: 'Remote' });
    await expect(remote.getByText(`Sam ${tag}`)).toBeVisible({ timeout: 25_000 });
    await expect(remote.getByText(/^In/)).toBeVisible();
    await expect(remote.getByText(/since/)).toHaveCount(0);

    // Sam checks out with a note.
    await page.getByRole('button', { name: /Open check-in/ }).click();
    await page.getByLabel(/What did you work on/).fill('Finished the report');
    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByRole('button', { name: /^Checked out \d\d:\d\d/ })).toBeVisible();
    await expect(kimPage.getByRole('region', { name: 'Remote' }).getByText(/^Out/)).toBeVisible({
      timeout: 25_000,
    });
  } finally {
    await kimCtx.close();
  }
});

test('managers and admins see exact times; teammates do not', async ({ page, browser }) => {
  const tag = stamp();
  const boss = await createMember(`Boss ${tag}`);
  const rep = await createMember(`Rep ${tag}`);
  const mate = await createMember(`Mate ${tag}`);

  await signInAsOwner(page);
  const found = await apiCall(page, 'GET', `/members?q=${rep.email}`);
  const bossId = (await apiCall(page, 'GET', `/members?q=${boss.email}`)).json.items[0]
    .id as string;
  expect(
    (await apiCall(page, 'PATCH', `/members/${found.json.items[0].id}`, { reportsTo: bossId }))
      .status,
  ).toBe(200);

  await asAnotherPerson(browser, async (p) => {
    await signInDev(p, rep.email);
    await p.getByRole('button', { name: /Check in\. Open check-in/ }).click();
    await p.getByRole('button', { name: 'Offsite' }).click();
    await p.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(p.getByRole('button', { name: /^Checked in/ })).toBeVisible();
  });

  const seeSince = async (email: string) =>
    asAnotherPerson(browser, async (p) => {
      await signInDev(p, email);
      await p.goto('/team');
      await p.getByLabel('Search the team').fill(`Rep ${tag}`);
      const card = p
        .getByRole('region', { name: 'Offsite' })
        .getByRole('listitem')
        .filter({ hasText: `Rep ${tag}` });
      await expect(card).toBeVisible();
      return (await card.textContent()) ?? '';
    });
  expect(await seeSince(boss.email)).toMatch(/since \d\d:\d\d/); // the manager
  expect(await seeSince(mate.email)).not.toMatch(/since/); // a teammate

  await page.goto('/team');
  await page.getByLabel('Search the team').fill(`Rep ${tag}`);
  await expect(
    page.getByRole('region', { name: 'Offsite' }).getByText(/since \d\d:\d\d/),
  ).toBeVisible(); // an admin
});

test('planning the week, and correcting a day with a reason', async ({ page }) => {
  const tag = stamp();
  const me = await createMember(`Plan ${tag}`);
  await signInDev(page, me.email);
  await page.goto('/my-day');
  await expect(page.getByRole('heading', { name: 'My day' })).toBeVisible();

  // Plan: pick a day later this week or next, set it to Remote, and it survives a reload.
  const grid = page
    .getByRole('list')
    .filter({ has: page.getByLabel(/^Plan for/) })
    .first();
  await page.getByRole('button', { name: 'Next week' }).click();
  const select = grid.getByLabel(/^Plan for/).first();
  await expect(select).toBeVisible();
  await select.click();
  await page.getByRole('option', { name: 'Remote' }).click();
  await expect(select).toContainText('Remote');
  await page.reload();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByLabel(/^Plan for/).first()).toContainText('Remote');

  // Add a day that was forgotten entirely, with a reason; it is flagged as edited and kept in history.
  await page.getByRole('button', { name: 'Add a missing day' }).click();
  const dialog = page.getByRole('dialog');
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await dialog.getByLabel('Date').fill(twoDaysAgo);
  await dialog.getByLabel('Check-in').fill('09:10');
  await dialog.getByLabel('Check-out').fill('17:40');
  await dialog.getByRole('button', { name: 'Add day' }).click();
  // The reason is mandatory.
  await expect(dialog.getByText('Say why you are changing this')).toBeVisible();
  await dialog.getByLabel('Reason for the change').fill('Forgot to check in');
  await dialog.getByRole('button', { name: 'Add day' }).click();
  await expect(page.getByText('Day added')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '09:10' });
  await expect(row).toContainText('17:40');
  await expect(row).toContainText('Edited');
  await expect(row).toContainText('8h 30m');

  // Correct it again; the history shows both reasons.
  await row.getByRole('button', { name: /^Correct/ }).click();
  await dialog.getByLabel('Check-out').fill('18:00');
  await dialog.getByLabel('Reason for the change').fill('Stayed later than I recorded');
  await dialog.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('Day corrected')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '09:10' })).toContainText('8h 50m');
});

test('admins manage hours, sites and holidays, and see attendance with a CSV export', async ({
  page,
}) => {
  const tag = stamp();
  await signInAsOwner(page);

  await page.goto('/admin/settings/work');
  await expect(page.getByRole('heading', { name: 'Work and check-in' })).toBeVisible();

  // Sites.
  await page.getByRole('button', { name: 'Add site' }).click();
  const siteDialog = page.getByRole('dialog');
  await siteDialog.getByLabel('Name').fill(`Lab ${tag}`);
  await siteDialog.getByLabel('Address (optional)').fill('1 Test Street');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(`Lab ${tag}`)).toBeVisible();
  await page.getByRole('button', { name: `Delete Lab ${tag}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete site' }).click();
  await expect(page.getByText(`Lab ${tag}`)).toHaveCount(0);

  // Holidays: a duplicate date is refused with a clear message (checked through the API for a far-away year).
  const day = String(10 + (parseInt(tag.slice(0, 2), 16) % 18));
  const month = String(1 + (parseInt(tag.slice(2, 4), 16) % 9)).padStart(2, '0');
  const date = `2031-${month}-${day}`;
  await apiCall(page, 'POST', '/holidays', { date, name: `Seed ${tag}` });
  const dup = await apiCall(page, 'POST', '/holidays', { date, name: 'Again' });
  expect(dup.status).toBe(409);
  expect(dup.json.fields.date).toContain('already a holiday');
  const list = await apiCall(page, 'GET', '/holidays?year=2031');
  for (const h of (list.json.items as { id: string; name: string }[]).filter((x) =>
    x.name.startsWith('Seed'),
  )) {
    await apiCall(page, 'DELETE', `/holidays/${h.id}`);
  }
  // The same through the form for the current year.
  const thisYear = new Date().getFullYear();
  const formDate = `${thisYear}-${month}-${day}`;
  await page.getByLabel('Date').fill(formDate);
  await page.getByLabel('Name', { exact: true }).last().fill(`Form ${tag}`);
  await page.getByRole('button', { name: 'Add holiday' }).click();
  await expect(page.getByText('Holiday added')).toBeVisible();
  await expect(page.getByText(`Form ${tag}`)).toBeVisible();
  await page.getByRole('button', { name: `Remove Form ${tag}` }).click();
  await expect(page.getByText(`Form ${tag}`)).toHaveCount(0);

  // Hours: validation, then a successful save that is put back afterwards.
  const original = (await apiCall(page, 'GET', '/settings/work')).json.settings;
  await page.getByLabel('Day ends').fill('08:00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Must be after the start time')).toBeVisible();
  await page.getByLabel('Day ends').fill('18:00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await apiCall(page, 'PUT', '/settings/work', original);

  // Attendance: demo history is listed, flagged, and exportable.
  await page.goto('/admin/attendance');
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByText('Auto-closed').first()).toBeVisible();
  const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
  expect(href).toMatch(
    /^\/api\/v1\/work-days\/export\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/,
  );
  const csv = await apiCall(page, 'GET', href!.replace('/api/v1', ''));
  expect(csv.status).toBe(200);
  expect(csv.contentType).toContain('text/csv');
  const body = csv.text;
  // (The byte-order mark itself is asserted in the API tests; fetch strips it when decoding text.)
  expect(body).toContain(
    'Date,Name,Email,Location,Site,Check-in,Check-out,Hours,Auto-closed,Edited,Note',
  );
});

test('members cannot reach admin check-in screens, and the board filters by group', async ({
  page,
}) => {
  const tag = stamp();
  const me = await createMember(`Plain ${tag}`);
  await signInDev(page, me.email);
  for (const path of ['/admin/attendance', '/admin/settings', '/admin/settings/work']) {
    await page.goto(path);
    await expect(page.getByText('Admins only')).toBeVisible();
  }
  expect((await apiCall(page, 'GET', '/work-days/export')).status).toBe(403);
  expect(
    (
      await apiCall(page, 'PUT', '/settings/work', {
        timezone: 'UTC',
        workDays: [1, 2, 3, 4, 5],
        workStart: '09:00',
        workEnd: '17:30',
        autoCloseTime: '20:00',
        requireNote: false,
        checkinEnabled: true,
      })
    ).status,
  ).toBe(403);

  await page.goto('/team');
  await page.getByRole('combobox', { name: 'Filter by group' }).click();
  await page.getByRole('option', { name: 'Backend' }).click();
  await expect(page.getByText('Priya Raman')).toBeVisible();
  await expect(page.getByText('Hiro Tanaka')).toHaveCount(0); // Design, not Backend
});
