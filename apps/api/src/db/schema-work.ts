import {
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Ranks are fractional-indexing keys, which compare by byte order, so the column uses COLLATE "C". */
const rankText = customType<{ data: string }>({
  dataType: () => 'text COLLATE "C"',
});

export const boards = pgTable('boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  type: text('type', { enum: ['kanban', 'scrum'] })
    .notNull()
    .default('kanban'),
  name: text('name').notNull().default('Board'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spaceCounters = pgTable('space_counters', {
  spaceId: uuid('space_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  lastNumber: integer('last_number').notNull().default(0),
});

export const spaceStatuses = pgTable('space_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  name: text('name').notNull(),
  category: text('category', { enum: ['todo', 'in_progress', 'done'] }).notNull(),
  position: integer('position').notNull(),
  color: text('color').notNull().default('slate'),
  wipLimit: integer('wip_limit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    spaceId: uuid('space_id').notNull(),
    number: integer('number').notNull(),
    type: text('type', { enum: ['epic', 'story', 'task', 'bug', 'subtask'] }).notNull(),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: jsonb('description'),
    statusId: uuid('status_id').notNull(),
    priority: text('priority', { enum: ['highest', 'high', 'medium', 'low', 'lowest'] })
      .notNull()
      .default('medium'),
    assigneeId: uuid('assignee_id'),
    reporterId: uuid('reporter_id').notNull(),
    estimate: numeric('estimate', { precision: 5, scale: 1 }),
    dueDate: date('due_date'),
    sprintId: uuid('sprint_id'),
    rank: rankText('rank').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('work_items_org_idx').on(t.orgId, t.spaceId)],
);

export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  spaceId: uuid('space_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('slate'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workItemLabels = pgTable(
  'work_item_labels',
  {
    workItemId: uuid('work_item_id').notNull(),
    labelId: uuid('label_id').notNull(),
    orgId: uuid('org_id').notNull(),
    spaceId: uuid('space_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.labelId] })],
);
