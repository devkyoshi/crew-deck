import { defineConfig } from '@playwright/test';

const inCI = Boolean(process.env.CI);

// Starts the API and web app when they are not already running (CI always starts them). Chromium
// resolves *.localhost to loopback, so tenant subdomains work without hosts-file edits.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: inCI ? 1 : 0,
  forbidOnly: inCI,
  reporter: inCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://acme.localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'pnpm --filter @crew-deck/api dev',
      // No real email in browser tests: sign-up returns its link instead of sending it.
      env: { EMAIL_MODE: 'log' },
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: !inCI,
      timeout: 90_000,
    },
    {
      command: 'pnpm --filter @crew-deck/web dev',
      url: 'http://localhost:3000/workspaces',
      reuseExistingServer: !inCI,
      timeout: 120_000,
    },
  ],
});
