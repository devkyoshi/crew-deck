import { defineConfig } from 'vitest/config';

// Locally, load the repo-root .env. In CI the variables are already in the environment.
try {
  process.loadEnvFile('../../.env');
} catch {
  /* no .env file */
}

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
