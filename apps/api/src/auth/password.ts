import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;

export const hashPassword = (password: string) => hash(password);

// Verified against when the account does not exist, so response time does not reveal it.
let dummy: Promise<string> | undefined;

export async function verifyPassword(stored: string | null | undefined, password: string) {
  if (!stored) {
    dummy ??= hash('not-a-real-password');
    await verify(await dummy, password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}
