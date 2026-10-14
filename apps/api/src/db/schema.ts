import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  uuid,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  domain: text('domain').notNull(),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: text('suspended_reason'),
  planKey: text('plan_key'),
  onTrial: boolean('on_trial').notNull().default(false),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  limitOverrides: jsonb('limit_overrides').notNull().default({}),
  createdVia: text('created_via').notNull().default('admin'),
  logoUrl: text('logo_url'),
  accentColor: text('accent_color'),
  domainRestricted: boolean('domain_restricted').notNull().default(true),
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
    reportsTo: uuid('reports_to'),
    crmRole: text('crm_role', { enum: ['none', 'viewer', 'member', 'admin'] })
      .notNull()
      .default('member'),
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
  groupIds: uuid('group_ids').array().notNull().default([]),
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

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id').notNull(),
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon').notNull().default('folder'),
    visibility: text('visibility', { enum: ['open', 'private'] })
      .notNull()
      .default('open'),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    ownerId: uuid('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.key)],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id').notNull(),
    orgId: uuid('org_id').notNull(),
    principalType: text('principal_type', { enum: ['user', 'group'] }).notNull(),
    principalId: uuid('principal_id').notNull(),
    spaceRole: text('space_role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.spaceId, t.principalType, t.principalId)],
);

export const spaceStars = pgTable(
  'space_stars',
  {
    spaceId: uuid('space_id').notNull(),
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

export const spaceAccessRequests = pgTable('space_access_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  userId: uuid('user_id').notNull(),
  message: text('message'),
  status: text('status', { enum: ['pending', 'approved', 'declined', 'cancelled'] })
    .notNull()
    .default('pending'),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  grantedRole: text('granted_role', { enum: ['admin', 'member', 'viewer'] }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantSettings = pgTable('tenant_settings', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id),
  timezone: text('timezone').notNull().default('UTC'),
  workDays: integer('work_days').array().notNull().default([1, 2, 3, 4, 5]),
  workStart: text('work_start').notNull().default('09:00'),
  workEnd: text('work_end').notNull().default('17:30'),
  autoCloseTime: text('auto_close_time').notNull().default('20:00'),
  requireNote: boolean('require_note').notNull().default(false),
  enabledModules: text('enabled_modules')
    .array()
    .notNull()
    .default(['members', 'spaces', 'checkin']),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const holidays = pgTable('holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  date: date('date').notNull(),
  name: text('name').notNull(),
});

export const workDays = pgTable('work_days', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  date: date('date').notNull(),
  plannedLocation: text('planned_location', { enum: ['onsite', 'remote', 'offsite', 'leave'] }),
  locationType: text('location_type', {
    enum: ['onsite', 'remote', 'offsite', 'leave', 'holiday'],
  }),
  siteId: uuid('site_id'),
  checkinAt: timestamp('checkin_at', { withTimezone: true }),
  checkoutAt: timestamp('checkout_at', { withTimezone: true }),
  note: text('note'),
  autoClosed: boolean('auto_closed').notNull().default(false),
  source: text('source', { enum: ['web', 'auto', 'edit', 'plan'] })
    .notNull()
    .default('web'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workDayEdits = pgTable('work_day_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  workDayId: uuid('work_day_id').notNull(),
  editedBy: uuid('edited_by')
    .notNull()
    .references(() => users.id),
  oldValues: jsonb('old_values').notNull(),
  newValues: jsonb('new_values').notNull(),
  reason: text('reason').notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
});

export * from './schema-crm.js';
export * from './schema-work.js';
