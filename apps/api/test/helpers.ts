import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import type { GoogleClient, GoogleProfile } from '../src/auth/google.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { invitations, memberships, organizations, users } from '../src/db/schema.js';
import { randomToken, sha256 } from '../src/lib/crypto.js';
import { createRedis } from '../src/lib/redis.js';

export const PASSWORD = 'correct-horse-battery';

// Hashing is deliberately slow; tests create hundreds of users with the same password.
const hashes = new Map<string, Promise<string>>();
const hashOnce = (password: string) => {
  if (!hashes.has(password)) hashes.set(password, hashPassword(password));
  return hashes.get(password)!;
};

export function appDb() {
  return createDb(process.env.DATABASE_URL!);
}

export function adminDb() {
  return createDb(process.env.DATABASE_ADMIN_URL!);
}

/** Looks up demo tenant ids on the admin connection (bypasses RLS). */
export async function tenantIds() {
  const admin = adminDb();
  try {
    const rows = await admin.db.select().from(organizations);
    const id = (slug: string) => rows.find((r) => r.slug === slug)!.id;
    return { acme: id('acme'), globex: id('globex') };
  } finally {
    await admin.close();
  }
}

/** A Google client whose next profile is set by the test. */
export function fakeGoogle() {
  const state = { profile: null as GoogleProfile | null, fail: false };
  const client: GoogleClient = {
    authUrl: ({ state: s, nonce }) => `https://google.test/auth?state=${s}&nonce=${nonce}`,
    exchange: async () => {
      if (state.fail || !state.profile) throw new Error('exchange failed');
      return state.profile;
    },
  };
  return { client, state };
}

export type CapturedInvite = { to: string; link: string; orgId: string; orgName: string };

export function makeApp(
  opts: {
    google?: GoogleClient | null;
    rateLimit?: number;
    enqueue?: (job: CapturedInvite) => Promise<void> | void;
    sendMail?: (m: {
      to: string;
      subject: string;
      html: string;
      text: string;
    }) => Promise<void> | void;
    env?: Record<string, string>;
  } = {},
) {
  const config = loadConfig({
    ...process.env,
    LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_MAX: String(opts.rateLimit ?? 1000),
    BREVO_API_KEY: '',
    ...opts.env,
  });
  const conn = appDb();
  const redis = createRedis(config.REDIS_URL);
  const app = buildApp({
    db: conn.db,
    redis,
    config,
    google: opts.google ?? null,
    enqueueInviteEmail: async (job) => {
      await opts.enqueue?.(job);
    },
    sendMail: async (m) => {
      await opts.sendMail?.(m);
    },
  });
  return {
    app,
    config,
    db: conn.db,
    async close() {
      await app.close();
      redis.disconnect();
      await conn.close();
    },
  };
}

export const hostFor = (slug: string) => `${slug}.localhost:3000`;

/** Creates (or resets) a user with a password and a membership, using the admin connection. */
export async function ensureUser(opts: {
  orgId: string;
  email: string;
  role?: 'owner' | 'admin' | 'member';
  status?: 'active' | 'invited' | 'deactivated';
  password?: string;
}) {
  const admin = adminDb();
  try {
    const passwordHash = await hashOnce(opts.password ?? PASSWORD);
    const [user] = await admin.db
      .insert(users)
      .values({
        email: opts.email,
        name: opts.email.split('@')[0],
        status: opts.status ?? 'active',
        passwordHash,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { status: opts.status ?? 'active', passwordHash },
      })
      .returning();
    await admin.db
      .insert(memberships)
      .values({ orgId: opts.orgId, userId: user!.id, orgRole: opts.role ?? 'member' })
      .onConflictDoUpdate({
        target: [memberships.orgId, memberships.userId],
        set: { orgRole: opts.role ?? 'member' },
      });
    return user!;
  } finally {
    await admin.close();
  }
}

export async function setUserStatus(userId: string, status: 'active' | 'deactivated') {
  const admin = adminDb();
  try {
    await admin.db.update(users).set({ status }).where(eq(users.id, userId));
  } finally {
    await admin.close();
  }
}

export async function createInvitation(opts: {
  orgId: string;
  email?: string;
  role?: 'owner' | 'admin' | 'member';
  expiresInMs?: number;
  revoked?: boolean;
}) {
  const admin = adminDb();
  try {
    const token = randomToken();
    const email = opts.email ?? `invitee-${randomUUID().slice(0, 8)}@acme.test`;
    await admin.db.insert(invitations).values({
      orgId: opts.orgId,
      email,
      orgRole: opts.role ?? 'member',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 3600_000)),
      revokedAt: opts.revoked ? new Date() : null,
    });
    return { token, email };
  } finally {
    await admin.close();
  }
}

export function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
  return res.cookies.find((c) => c.name === 'cd_session')?.value;
}

type Json = object | undefined;

/** Thin wrapper over app.inject for tenant-host requests with an optional session cookie. */
export function caller(app: ReturnType<typeof makeApp>['app']) {
  return (opts: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    slug: string;
    cookie?: string;
    payload?: Json;
  }) =>
    app.inject({
      method: opts.method,
      url: `/api/v1${opts.url}`,
      headers: { host: hostFor(opts.slug) },
      cookies: opts.cookie ? { cd_session: opts.cookie } : {},
      payload: opts.payload,
    });
}

/** Creates a user (admin connection), signs them in by password, and returns the session cookie. */
export async function signInAs(
  app: ReturnType<typeof makeApp>['app'],
  slug: string,
  user: { id: string; email: string },
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { host: hostFor(slug) },
    payload: { email: user.email, password: PASSWORD },
  });
  const cookie = sessionCookie(res);
  if (!cookie) throw new Error(`sign-in failed for ${user.email}: ${res.statusCode} ${res.body}`);
  return cookie;
}

export const uniqueEmail = (prefix: string, domain = 'acme.test') =>
  `${prefix}-${randomUUID().slice(0, 8)}@${domain}`;

/** Creates an isolated workspace with exactly one owner, for tests that need a pristine tenant. */
export async function createOrg(slugPrefix: string) {
  const slug = `${slugPrefix}-${randomUUID().slice(0, 6)}`;
  const admin = adminDb();
  try {
    const [org] = await admin.db
      .insert(organizations)
      .values({ name: slug, slug, domain: `${slug}.test` })
      .returning();
    const owner = await ensureUser({ orgId: org!.id, email: `owner@${slug}.test`, role: 'owner' });
    return { org: org!, slug, owner };
  } finally {
    await admin.close();
  }
}
