import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password-123';
export const rand = (n = 3) => randomBytes(n).toString('hex');

const adminUrl = () =>
  process.env.DATABASE_ADMIN_URL ?? 'postgres://crew_admin:crew_admin_dev@localhost:5433/crewdeck';

export async function signInWithPassword(page: Page, email: string, password = PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
}

export const signInAsOwner = (page: Page) => signInWithPassword(page, 'owner@acme.test');
export const signInAsMember = (page: Page) => signInWithPassword(page, 'member@acme.test');

/** Runs `fn` in a fresh browser context (no shared cookies), like a different person's browser. */
export async function asAnotherPerson<T>(browser: Browser, fn: (page: Page) => Promise<T>) {
  const ctx = await browser.newContext({ baseURL: 'http://acme.localhost:3000' });
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** Adds an active member to the acme workspace directly in the database (test setup only). */
export async function createMember(name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '-')}@acme.test`;
  const sql = postgres(adminUrl());
  try {
    await sql`
      with u as (
        insert into users (email, name, status) values (${email}, ${name}, 'active')
        on conflict (email) do update set name = excluded.name returning id
      )
      insert into memberships (org_id, user_id, org_role)
      select o.id, u.id, 'member' from organizations o, u where o.slug = 'acme'
      on conflict do nothing`;
    return { email, name };
  } finally {
    await sql.end();
  }
}

/** Fills the page's first form once React has hydrated it (avoids typing into a not-yet-live input). */
export const waitForHydration = (page: Page) =>
  page.waitForFunction(
    () => document.querySelector('[data-ready]') !== null || document.readyState === 'complete',
  );

/** Calls the API from inside a signed-in page (same origin, so the session cookie is sent). */
export async function apiCall(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: ReturnType<typeof JSON.parse> = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON (for example a CSV) */
      }
      return { status: res.status, json, text, contentType: res.headers.get('content-type') ?? '' };
    },
    { method, path, body },
  );
}

export const signInAs = (page: Page, email: string) => signInWithPassword(page, email);

/** Signs in with the development-only box (works for accounts that have no password). */
export async function signInDev(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Dev login email').fill(email);
  await page.getByRole('button', { name: 'Dev sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
}
