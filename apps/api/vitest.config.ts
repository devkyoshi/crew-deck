import { defineConfig } from 'vitest/config';

// Locally, load the repo-root .env. In CI the variables are already in the environment.
try {
  process.loadEnvFile('../../.env');
} catch {
  /* no .env file */
}

// Tests run against <db>_test so they never pollute the development database. Set in the main process
// so global setup and every worker see the test database.
const base = process.env.MONGODB_DB ?? 'crewdeck';
process.env.MONGODB_DB = base.endsWith('_test') ? base : `${base}_test`;

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
