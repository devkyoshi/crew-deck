import { jsonb, pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  domain: text('domain').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  jobTitle: text('job_title'),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status', { enum: ['invited', 'active', 'deactivated'] })
    .notNull()
    .default('invited'),
  passwordHash: text('password_hash'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    orgRole: text('org_role', { enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
    status: text('status', { enum: ['active', 'deactivated'] })
      .notNull()
      .default('active'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.userId)],
);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  email: text('email').notNull(),
  orgRole: text('org_role', { enum: ['owner', 'admin', 'member'] })
    .notNull()
    .default('member'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
