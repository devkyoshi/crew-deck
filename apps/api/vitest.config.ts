import { defineConfig } from 'vitest/config';

// Locally, load the repo-root .env. In CI the variables are already in the environment.
try {
  process.loadEnvFile('../../.env');
} catch {
  /* no .env file */
}

/** Tests run against <db>_test so they never pollute the development database. */
function testUrl(url: string | undefined) {
  if (!url) return url;
  const u = new URL(url);
  if (!u.pathname.endsWith('_test')) u.pathname = `${u.pathname}_test`;
  return u.toString();
}

// Set in the main process so global setup and every worker see the test database.
process.env.DATABASE_URL = testUrl(process.env.DATABASE_URL);
process.env.DATABASE_ADMIN_URL = testUrl(process.env.DATABASE_ADMIN_URL);

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
