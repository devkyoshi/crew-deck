import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;

// Tests sign in dozens of users per file; the production cost (about 100 ms a check) adds minutes.
// The cost parameters travel inside each hash, so a test hash verifies cheaply and production hashes
// are unchanged.
const TEST_COST = process.env.VITEST ? { memoryCost: 1024, timeCost: 1 } : undefined;

export const hashPassword = (password: string) => hash(password, TEST_COST);

// Verified against when the account does not exist, so response time does not reveal it.
let dummy: Promise<string> | undefined;

export async function verifyPassword(stored: string | null | undefined, password: string) {
  if (!stored) {
    dummy ??= hash('not-a-real-password', TEST_COST);
    await verify(await dummy, password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}
