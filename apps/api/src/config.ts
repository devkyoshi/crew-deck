import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('crewdeck'),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Tenants live at <slug>.<BASE_DOMAIN>. */
  BASE_DOMAIN: z.string().default('localhost'),
  /** Public origin of the apex (no tenant) site, used as the Google redirect target. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** Origin pattern for a tenant's site. {slug} is replaced. */
  TENANT_ORIGIN_TEMPLATE: z.string().default('http://{slug}.localhost:3000'),
  /** Max sign-in attempts per client+email per minute. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),
  SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
  /** Brevo transactional email. Without a key, invite links are logged and shown to admins instead. */
  BREVO_API_KEY: z.string().optional(),
  /** 'log' never sends email, even with a key: messages are logged and links are shown (browser tests). */
  EMAIL_MODE: z.enum(['auto', 'log']).default('auto'),
  EMAIL_FROM_ADDRESS: z.string().default('no-reply@example.com'),
  EMAIL_FROM_NAME: z.string().default('Crew Deck'),
  INVITE_TTL_DAYS: z.coerce.number().default(7),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Where attachments are kept. Only 'local' (a directory) for now; object storage can slot in later. */
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  /** Directory for the local driver. Relative paths resolve from the API's working directory. */
  STORAGE_DIR: z.string().default('./storage'),
  /** Signs short-lived file links. Required in production (32+ characters). */
  STORAGE_SIGNING_SECRET: z.string().optional(),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}

/** The secret for file links. A fixed value is used outside production so development needs no setup. */
export function storageSecret(c: Config) {
  if (c.STORAGE_SIGNING_SECRET && c.STORAGE_SIGNING_SECRET.length >= 32) return c.STORAGE_SIGNING_SECRET;
  if (isProd(c)) throw new Error('STORAGE_SIGNING_SECRET must be set (32+ characters) in production');
  return 'development-only-file-link-secret-not-for-production';
}

export const emailEnabled = (c: Config) => Boolean(c.BREVO_API_KEY) && c.EMAIL_MODE !== 'log';
export const isProd = (c: Config) => c.NODE_ENV === 'production';
export const devLoginEnabled = (c: Config) => c.NODE_ENV !== 'production';
