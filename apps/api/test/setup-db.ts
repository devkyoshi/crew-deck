// Runs in every worker before the test file's imports. Points the worker at its own copy of the test
// database (created by global-setup), so files in different workers never share rows.
const base = process.env.MONGODB_DB!;
const worker = Number(process.env.VITEST_POOL_ID ?? 1);
const copies = Number(process.env.TEST_WORKERS ?? 1);
if (copies > 1) process.env.MONGODB_DB = `${base}_w${worker}`;
