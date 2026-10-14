import type { Db as MongoDb, IndexDescription } from 'mongodb';
import { backfillSearchText } from '../work/search-text.js';

type Ix = [name: string, spec: IndexDescription['key'], opts?: Partial<IndexDescription>];

/**
 * Indexes replace the SQL migrations' constraints: uniqueness, and the lookups the API relies on.
 * `ensureIndexes` is idempotent and runs at startup, in seeds and in test setup.
 */
const U = { unique: true };
const ACTIVE = { partialFilterExpression: { deletedAt: { $type: 'null' } } } as const;

const INDEXES: Record<string, Ix[]> = {
  organizations: [
    ['id', { id: 1 }, U],
    ['slug', { slug: 1 }, U],
    ['created', { createdAt: -1 }],
  ],
  users: [
    ['id', { id: 1 }, U],
    ['email', { email: 1 }, U],
  ],
  plans: [['key', { key: 1 }, U]],
  platform_admins: [
    ['id', { id: 1 }, U],
    ['email', { email: 1 }, U],
  ],
  signup_requests: [
    ['id', { id: 1 }, U],
    ['token', { tokenHash: 1 }, U],
    ['email', { email: 1, createdAt: 1 }],
  ],
  platform_audit_logs: [
    ['id', { id: 1 }, U],
    ['org', { orgId: 1, createdAt: -1 }],
  ],
  memberships: [
    ['id', { id: 1 }, U],
    ['org_user', { orgId: 1, userId: 1 }, U],
    ['user', { userId: 1 }],
  ],
  invitations: [
    ['id', { id: 1 }, U],
    ['token', { tokenHash: 1 }, U],
    ['org_email', { orgId: 1, email: 1 }],
  ],
  audit_logs: [
    ['id', { id: 1 }, U],
    ['org_time', { orgId: 1, createdAt: -1 }],
  ],
  groups: [
    ['id', { id: 1 }, U],
    ['org_name', { orgId: 1, nameLower: 1 }, U],
  ],
  group_members: [
    ['pk', { groupId: 1, userId: 1 }, U],
    ['org_user', { orgId: 1, userId: 1 }],
  ],
  spaces: [
    ['id', { id: 1 }, U],
    ['org_key', { orgId: 1, key: 1 }, U],
  ],
  space_members: [
    ['id', { id: 1 }, U],
    ['principal', { spaceId: 1, principalType: 1, principalId: 1 }, U],
    ['by_principal', { orgId: 1, principalType: 1, principalId: 1 }],
  ],
  space_stars: [
    ['pk', { spaceId: 1, userId: 1 }, U],
    ['user', { orgId: 1, userId: 1 }],
  ],
  space_access_requests: [
    ['id', { id: 1 }, U],
    [
      'one_pending',
      { spaceId: 1, userId: 1 },
      { unique: true, partialFilterExpression: { status: 'pending' } },
    ],
  ],
  tenant_settings: [['org', { orgId: 1 }, U]],
  sites: [
    ['id', { id: 1 }, U],
    ['org_name', { orgId: 1, nameLower: 1 }, U],
  ],
  holidays: [
    ['id', { id: 1 }, U],
    ['org_date', { orgId: 1, date: 1 }, U],
  ],
  work_days: [
    ['id', { id: 1 }, U],
    ['org_user_date', { orgId: 1, userId: 1, date: 1 }, U],
    ['org_date', { orgId: 1, date: 1 }],
  ],
  work_day_edits: [
    ['id', { id: 1 }, U],
    ['day', { workDayId: 1 }],
  ],
  boards: [
    ['id', { id: 1 }, U],
    ['space', { spaceId: 1 }, U],
  ],
  space_counters: [['space', { spaceId: 1 }, U]],
  space_statuses: [
    ['id', { id: 1 }, U],
    ['space_pos', { spaceId: 1, position: 1 }],
    ['space_name', { spaceId: 1, nameLower: 1 }, U],
  ],
  work_items: [
    ['id', { id: 1 }, U],
    ['space_number', { spaceId: 1, number: 1 }, U],
    ['column_rank', { spaceId: 1, statusId: 1, rank: 1, id: 1 }],
    ['assignee', { orgId: 1, assigneeId: 1 }],
    ['parent', { parentId: 1 }],
    ['labels', { labelIds: 1 }],
    [
      'search',
      { title: 'text', searchText: 'text' },
      { weights: { title: 5, searchText: 1 }, default_language: 'english' },
    ],
    ['org_assignee_due', { orgId: 1, assigneeId: 1, resolvedAt: 1 }],
    ['org_reporter', { orgId: 1, reporterId: 1 }],
    ['sprint', { sprintId: 1 }],
  ],
  labels: [
    ['id', { id: 1 }, U],
    ['space_name', { spaceId: 1, nameLower: 1 }, U],
  ],
  crm_tags: [
    ['id', { id: 1 }, U],
    ['org_name', { orgId: 1, nameLower: 1 }, U],
  ],
  crm_companies: [
    ['id', { id: 1 }, U],
    ['org_name', { orgId: 1, nameLower: 1 }, { unique: true, ...ACTIVE }],
  ],
  crm_contacts: [
    ['id', { id: 1 }, U],
    ['company', { companyId: 1 }],
  ],
  crm_leads: [['id', { id: 1 }, U]],
  crm_pipelines: [
    ['id', { id: 1 }, U],
    [
      'one_default',
      { orgId: 1 },
      { unique: true, partialFilterExpression: { isDefault: true }, name: 'one_default' },
    ],
  ],
  crm_stages: [
    ['id', { id: 1 }, U],
    ['pipeline', { pipelineId: 1, position: 1 }],
  ],
  crm_deals: [
    ['id', { id: 1 }, U],
    ['stage', { stageId: 1, position: 1 }],
  ],
  crm_activities: [
    ['id', { id: 1 }, U],
    ['linked', { linkedType: 1, linkedId: 1 }],
  ],
  crm_notes: [
    ['id', { id: 1 }, U],
    ['linked', { linkedType: 1, linkedId: 1 }],
  ],
  crm_record_tags: [
    ['pk', { tagId: 1, recordType: 1, recordId: 1 }, U],
    ['record', { recordType: 1, recordId: 1 }],
  ],
  comments: [
    ['id', { id: 1 }, U],
    ['item', { itemId: 1, createdAt: 1, id: 1 }],
  ],
  work_item_links: [
    ['id', { id: 1 }, U],
    ['triple', { fromItemId: 1, toItemId: 1, linkType: 1 }, U],
    ['to', { toItemId: 1 }],
  ],
  watchers: [
    ['pk', { itemId: 1, userId: 1 }, U],
    ['user', { orgId: 1, userId: 1 }],
  ],
  activity_events: [
    ['id', { id: 1 }, U],
    ['item', { itemId: 1, createdAt: -1, id: -1 }],
  ],
  attachments: [
    ['id', { id: 1 }, U],
    ['item', { itemId: 1, createdAt: 1 }],
    ['org', { orgId: 1 }],
  ],
  saved_filters: [
    ['id', { id: 1 }, U],
    ['owner', { orgId: 1, ownerId: 1 }],
    ['shared', { orgId: 1, isShared: 1, spaceId: 1 }],
  ],
  notifications: [
    ['id', { id: 1 }, U],
    ['user_time', { orgId: 1, userId: 1, createdAt: -1 }],
    ['unread', { orgId: 1, userId: 1, readAt: 1 }],
    [
      'dedupe',
      { orgId: 1, userId: 1, dedupeKey: 1 },
      { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
    ],
  ],
  notification_prefs: [['user', { orgId: 1, userId: 1 }, U]],
  email_batches: [
    ['id', { id: 1 }, U],
    ['one_open', { orgId: 1, userId: 1 }, { unique: true, partialFilterExpression: { sentAt: { $type: 'null' } } }],
    ['due', { sentAt: 1, dueAt: 1 }],
  ],
  sprints: [
    ['id', { id: 1 }, U],
    ['space_state', { spaceId: 1, state: 1 }],
    ['one_active', { spaceId: 1 }, { unique: true, partialFilterExpression: { state: 'active' } }],
  ],
  sprint_items_history: [
    ['id', { id: 1 }, U],
    ['sprint_item', { sprintId: 1, itemId: 1 }],
  ],
  sprint_snapshots: [['sprint_date', { sprintId: 1, date: 1 }, U]],
};

export async function ensureIndexes(handle: MongoDb) {
  for (const [coll, list] of Object.entries(INDEXES)) {
    await handle.collection(coll).createIndexes(
      list.map(([name, key, opts]) => ({ name, key, ...opts })),
    );
  }
  await backfillSearchText(handle);
}
