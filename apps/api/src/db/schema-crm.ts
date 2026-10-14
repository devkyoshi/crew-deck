import {
  boolean,
  date,
  doublePrecision,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const crmTags = pgTable('crm_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('blue'),
});

const recordColumns = {
  ownerId: uuid('owner_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

export const crmCompanies = pgTable('crm_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  website: text('website'),
  industry: text('industry'),
  size: text('size'),
  ...recordColumns,
});

export const crmContacts = pgTable('crm_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  companyId: uuid('company_id'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  jobTitle: text('job_title'),
  ...recordColumns,
});

export const crmLeads = pgTable('crm_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  companyName: text('company_name'),
  source: text('source'),
  status: text('status', { enum: ['new', 'contacted', 'qualified', 'unqualified'] })
    .notNull()
    .default('new'),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  convertedCompanyId: uuid('converted_company_id'),
  convertedContactId: uuid('converted_contact_id'),
  convertedDealId: uuid('converted_deal_id'),
  ...recordColumns,
});

export const crmPipelines = pgTable('crm_pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
});

export const crmStages = pgTable('crm_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  probability: integer('probability').notNull().default(0),
  isWon: boolean('is_won').notNull().default(false),
  isLost: boolean('is_lost').notNull().default(false),
});

export const crmDeals = pgTable('crm_deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  companyId: uuid('company_id'),
  contactId: uuid('contact_id'),
  title: text('title').notNull(),
  value: numeric('value', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('USD'),
  expectedClose: date('expected_close'),
  status: text('status', { enum: ['open', 'won', 'lost'] })
    .notNull()
    .default('open'),
  position: doublePrecision('position').notNull().default(0),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...recordColumns,
});

export const crmActivities = pgTable('crm_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  type: text('type', { enum: ['call', 'meeting', 'email', 'task'] }).notNull(),
  subject: text('subject').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  assigneeId: uuid('assignee_id'),
  linkedType: text('linked_type', { enum: ['company', 'contact', 'lead', 'deal'] }),
  linkedId: uuid('linked_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crmNotes = pgTable('crm_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  body: text('body').notNull(),
  authorId: uuid('author_id').notNull(),
  linkedType: text('linked_type', { enum: ['company', 'contact', 'lead', 'deal'] }).notNull(),
  linkedId: uuid('linked_id').notNull(),
  mentions: uuid('mentions').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crmRecordTags = pgTable(
  'crm_record_tags',
  {
    orgId: uuid('org_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    recordType: text('record_type', { enum: ['company', 'contact', 'lead', 'deal'] }).notNull(),
    recordId: uuid('record_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tagId, t.recordType, t.recordId] })],
);

export type CrmRecordType = 'company' | 'contact' | 'lead' | 'deal';
