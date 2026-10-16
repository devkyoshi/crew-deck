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

// `localhost` can try IPv6 first on Windows, which delays every new connection; tests use IPv4 directly.
if (process.env.MONGODB_URI) process.env.MONGODB_URI = process.env.MONGODB_URI.replace('//localhost', '//127.0.0.1');
if (process.env.REDIS_URL) process.env.REDIS_URL = process.env.REDIS_URL.replace('//localhost', '//127.0.0.1');

// Workers = databases to prepare. Override with TEST_WORKERS (1 runs the files one at a time).
const WORKERS = Math.max(1, Number(process.env.TEST_WORKERS ?? 4));
process.env.TEST_WORKERS = String(WORKERS);

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Each worker gets its own copy of the test database (see test/setup-db.ts), so files run side by
    // side. Fewer workers than cores: Mongo and Redis in Docker are the shared bottleneck.
    setupFiles: ['./test/setup-db.ts'],
    fileParallelism: true,
    maxWorkers: WORKERS,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
