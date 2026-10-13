import { defineConfig } from '@playwright/test';

// Expects `make dev` (or the compose `full` profile) to be running. Chromium resolves
// *.localhost to loopback, so tenant subdomains work without hosts-file edits.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://acme.localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
