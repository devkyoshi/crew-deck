import { randomUUID } from 'node:crypto';
import {
  MongoClient,
  type ClientSession,
  type Db as MongoDb,
  type Document,
  type Filter,
  type Sort,
  type UpdateFilter,
} from 'mongodb';
import type * as T from './types.js';

/**
 * MongoDB access layer.
 *
 * Postgres enforced tenant isolation with row-level security. MongoDB has nothing like it, so isolation
 * lives here: route and service code only ever receives a `TenantDb`, whose repositories add
 * `orgId = <tenant>` to every filter and stamp it on every insert. Code that legitimately crosses
 * tenants (sign-in lookups, the platform console, background fan-out jobs, seeds) must say so by using
 * `db.global`, which keeps those call sites easy to grep and review.
 */

// ---- Collections -----------------------------------------------------------------------------------

/** Tenant collections: every document has an `orgId`. Property name -> collection name. */
const TENANT = {
  memberships: 'memberships',
  invitations: 'invitations',
  auditLogs: 'audit_logs',
  groups: 'groups',
  groupMembers: 'group_members',
  spaces: 'spaces',
  spaceMembers: 'space_members',
  spaceStars: 'space_stars',
  spaceAccessRequests: 'space_access_requests',
  tenantSettings: 'tenant_settings',
  sites: 'sites',
  holidays: 'holidays',
  workDays: 'work_days',
  workDayEdits: 'work_day_edits',
  boards: 'boards',
  spaceCounters: 'space_counters',
  spaceStatuses: 'space_statuses',
  workItems: 'work_items',
  labels: 'labels',
  crmTags: 'crm_tags',
  crmCompanies: 'crm_companies',
  crmContacts: 'crm_contacts',
  crmLeads: 'crm_leads',
  crmPipelines: 'crm_pipelines',
  crmStages: 'crm_stages',
  crmDeals: 'crm_deals',
  crmActivities: 'crm_activities',
  crmNotes: 'crm_notes',
  crmRecordTags: 'crm_record_tags',
  comments: 'comments',
  workItemLinks: 'work_item_links',
  watchers: 'watchers',
  activityEvents: 'activity_events',
  attachments: 'attachments',
  savedFilters: 'saved_filters',
  notifications: 'notifications',
  notificationPrefs: 'notification_prefs',
  emailBatches: 'email_batches',
  sprints: 'sprints',
  sprintItemsHistory: 'sprint_items_history',
  sprintSnapshots: 'sprint_snapshots',
  checklistTemplates: 'checklist_templates',
  versions: 'versions',
  components: 'components',
  spaceFolders: 'space_folders',
  spaceFiles: 'space_files',
  worklogs: 'worklogs',
  dashboards: 'dashboards',
  channels: 'channels',
  channelMembers: 'channel_members',
  messages: 'messages',
  messageEdits: 'message_edits',
  readCursors: 'read_cursors',
  userStatuses: 'user_statuses',
  messageReactions: 'message_reactions',
  messageMentions: 'message_mentions',
  pins: 'pins',
  savedMessages: 'saved_messages',
  threadFollows: 'thread_follows',
  messageAttachments: 'message_attachments',
  linkPreviews: 'link_previews',
} as const;

/** Global collections: not tenant data, only reachable through `db.global`. */
const GLOBAL = {
  organizations: 'organizations',
  users: 'users',
  plans: 'plans',
  platformAdmins: 'platform_admins',
  platformSettings: 'platform_settings',
  signupRequests: 'signup_requests',
  platformAudit: 'platform_audit_logs',
} as const;

/** Names of every tenant collection property, for tests and tooling. */
export const TENANT_COLLECTIONS = Object.keys(TENANT) as (keyof typeof TENANT)[];

export interface TenantDocs {
  memberships: T.MembershipDoc;
  invitations: T.InvitationDoc;
  auditLogs: T.AuditLogDoc;
  groups: T.GroupDoc;
  groupMembers: T.GroupMemberDoc;
  spaces: T.SpaceDoc;
  spaceMembers: T.SpaceMemberDoc;
  spaceStars: T.SpaceStarDoc;
  spaceAccessRequests: T.SpaceAccessRequestDoc;
  tenantSettings: T.TenantSettingsDoc;
  sites: T.SiteDoc;
  holidays: T.HolidayDoc;
  workDays: T.WorkDayDoc;
  workDayEdits: T.WorkDayEditDoc;
  boards: T.BoardDoc;
  spaceCounters: T.SpaceCounterDoc;
  spaceStatuses: T.SpaceStatusDoc;
  workItems: T.WorkItemDoc;
  labels: T.LabelDoc;
  crmTags: T.CrmTagDoc;
  crmCompanies: T.CrmCompanyDoc;
  crmContacts: T.CrmContactDoc;
  crmLeads: T.CrmLeadDoc;
  crmPipelines: T.CrmPipelineDoc;
  crmStages: T.CrmStageDoc;
  crmDeals: T.CrmDealDoc;
  crmActivities: T.CrmActivityDoc;
  crmNotes: T.CrmNoteDoc;
  crmRecordTags: T.CrmRecordTagDoc;
  comments: T.CommentDoc;
  workItemLinks: T.WorkItemLinkDoc;
  watchers: T.WatcherDoc;
  activityEvents: T.ActivityEventDoc;
  attachments: T.AttachmentDoc;
  savedFilters: T.SavedFilterDoc;
  notifications: T.NotificationDoc;
  notificationPrefs: T.NotificationPrefsDoc;
  emailBatches: T.EmailBatchDoc;
  sprints: T.SprintDoc;
  sprintItemsHistory: T.SprintItemHistoryDoc;
  sprintSnapshots: T.SprintSnapshotDoc;
  checklistTemplates: T.ChecklistTemplateDoc;
  versions: T.VersionDoc;
  components: T.ComponentDoc;
  spaceFolders: T.SpaceFolderDoc;
  spaceFiles: T.SpaceFileDoc;
  worklogs: T.WorklogDoc;
  dashboards: T.DashboardDoc;
  channels: T.ChannelDoc;
  channelMembers: T.ChannelMemberDoc;
  messages: T.MessageDoc;
  messageEdits: T.MessageEditDoc;
  readCursors: T.ReadCursorDoc;
  userStatuses: T.UserStatusDoc;
  messageReactions: T.MessageReactionDoc;
  messageMentions: T.MessageMentionDoc;
  pins: T.PinDoc;
  savedMessages: T.SavedMessageDoc;
  threadFollows: T.ThreadFollowDoc;
  messageAttachments: T.MessageAttachmentDoc;
  linkPreviews: T.LinkPreviewDoc;
}

export interface GlobalDocs {
  organizations: T.OrganizationDoc;
  users: T.UserDoc;
  plans: T.PlanDoc;
  platformAdmins: T.PlatformAdminDoc;
  platformSettings: T.PlatformSettingsDoc;
  signupRequests: T.SignupRequestDoc;
  platformAudit: T.PlatformAuditDoc;
}

/** Collections whose `name` is unique case-insensitively: a lowercase copy is kept in `nameLower`. */
/** Collections nobody may update or delete through a tenant scope (the old grants made them SELECT/INSERT only). */
const APPEND_ONLY = new Set<string>(['auditLogs', 'workDayEdits', 'activityEvents']);

const LOWER_NAME = new Set<string>(['groups', 'sites', 'labels', 'crmCompanies', 'spaceStatuses', 'crmTags', 'channels']);

const now = () => new Date();
const recordDefaults = () => ({
  ownerId: null,
  createdBy: null,
  createdAt: now(),
  updatedAt: now(),
  deletedAt: null,
});

/** Column defaults the old schema applied in the database. Explicit values always win. */
const DEFAULTS: Record<string, () => Document> = {
  organizations: () => ({
    status: 'active',
    suspendedAt: null,
    suspendedReason: null,
    planKey: null,
    onTrial: false,
    trialEndsAt: null,
    limitOverrides: {},
    createdVia: 'admin',
    logoUrl: null,
    accentColor: null,
    domainRestricted: true,
    workType: null,
    workTypes: [],
    usage: [],
    createdAt: now(),
  }),
  users: () => ({
    name: null,
    avatarUrl: null,
    jobTitle: null,
    timezone: 'UTC',
    status: 'invited',
    passwordHash: null,
    lastLoginAt: null,
    createdAt: now(),
  }),
  signupRequests: () => ({ name: null, workType: null, workTypes: [], usage: [], usedAt: null, createdAt: now() }),
  platformAudit: () => ({ adminId: null, orgId: null, detail: null, createdAt: now() }),
  platformAdmins: () => ({ name: null, createdAt: now() }),
  memberships: () => ({
    orgRole: 'member',
    status: 'active',
    deactivatedAt: null,
    reportsTo: null,
    crmRole: 'member',
    createdAt: now(),
  }),
  invitations: () => ({
    orgRole: 'member',
    groupIds: [],
    acceptedAt: null,
    revokedAt: null,
    invitedBy: null,
    createdAt: now(),
  }),
  auditLogs: () => ({ actorId: null, targetId: null, before: null, after: null, createdAt: now() }),
  groups: () => ({ description: null, createdAt: now(), updatedAt: now() }),
  groupMembers: () => ({ createdAt: now() }),
  spaces: () => ({
    description: null,
    icon: 'folder',
    visibility: 'open',
    status: 'active',
    ownerId: null,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  }),
  spaceMembers: () => ({ createdAt: now() }),
  spaceStars: () => ({ createdAt: now() }),
  spaceAccessRequests: () => ({
    message: null,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    grantedRole: null,
    createdAt: now(),
  }),
  tenantSettings: () => ({
    timezone: 'UTC',
    workDays: [1, 2, 3, 4, 5],
    workStart: '09:00',
    workEnd: '17:30',
    autoCloseTime: '20:00',
    requireNote: false,
    enabledModules: ['members', 'spaces', 'checkin'],
    updatedAt: now(),
  }),
  sites: () => ({ address: null, createdAt: now() }),
  workDays: () => ({
    plannedLocation: null,
    locationType: null,
    siteId: null,
    checkinAt: null,
    checkoutAt: null,
    note: null,
    autoClosed: false,
    source: 'web',
    createdAt: now(),
    updatedAt: now(),
  }),
  workDayEdits: () => ({ editedAt: now() }),
  boards: () => ({ type: 'kanban', name: 'Board', settings: {}, createdAt: now(), updatedAt: now() }),
  spaceCounters: () => ({ lastNumber: 0 }),
  spaceStatuses: () => ({ color: 'slate', wipLimit: null, createdAt: now() }),
  workItems: () => ({
    parentId: null,
    description: null,
    priority: 'medium',
    assigneeId: null,
    estimate: null,
    dueDate: null,
    sprintId: null,
    labelIds: [],
    resolvedAt: null,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  }),
  labels: () => ({ color: 'slate', createdAt: now() }),
  crmTags: () => ({ color: 'blue' }),
  crmCompanies: () => ({ website: null, industry: null, size: null, ...recordDefaults() }),
  crmContacts: () => ({
    companyId: null,
    email: null,
    phone: null,
    jobTitle: null,
    ...recordDefaults(),
  }),
  crmLeads: () => ({
    email: null,
    companyName: null,
    source: null,
    status: 'new',
    convertedAt: null,
    convertedCompanyId: null,
    convertedContactId: null,
    convertedDealId: null,
    ...recordDefaults(),
  }),
  crmPipelines: () => ({ isDefault: false }),
  crmStages: () => ({ probability: 0, isWon: false, isLost: false }),
  crmDeals: () => ({
    companyId: null,
    contactId: null,
    value: 0,
    currency: 'USD',
    expectedClose: null,
    status: 'open',
    position: 0,
    closedAt: null,
    ...recordDefaults(),
  }),
  crmActivities: () => ({
    dueAt: null,
    completedAt: null,
    assigneeId: null,
    linkedType: null,
    linkedId: null,
    createdBy: null,
    createdAt: now(),
  }),
  crmNotes: () => ({ mentions: [], createdAt: now(), updatedAt: now() }),
  crmRecordTags: () => ({}),
  comments: () => ({ mentions: [], editedAt: null, deletedAt: null, createdAt: now() }),
  workItemLinks: () => ({ createdAt: now() }),
  watchers: () => ({ createdAt: now() }),
  activityEvents: () => ({ field: null, oldValue: null, newValue: null, createdAt: now() }),
  channels: () => ({
    type: 'public',
    name: null,
    slug: null,
    topic: null,
    description: null,
    spaceId: null,
    dmKey: null,
    isAnnouncement: false,
    isArchived: false,
    createdBy: null,
    lastSeq: 0,
    lastMessageAt: null,
    createdAt: now(),
  }),
  channelMembers: () => ({
    role: 'member',
    joinedAt: now(),
    notificationLevel: 'all',
    mutedUntil: null,
    isStarred: false,
    sectionId: null,
  }),
  messages: () => ({
    kind: 'user',
    authorId: null,
    botId: null,
    body: null,
    bodyText: null,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    replyAuthors: [],
    clientMsgId: null,
    metadata: {},
    editedAt: null,
    deletedAt: null,
    createdAt: now(),
  }),
  messageEdits: () => ({ editedAt: now() }),
  readCursors: () => ({ lastReadSeq: 0, lastReadAt: now() }),
  userStatuses: () => ({ emoji: null, text: null, expiresAt: null }),
  messageReactions: () => ({ createdAt: now() }),
  pins: () => ({ pinnedAt: now() }),
  savedMessages: () => ({ savedAt: now() }),
  threadFollows: () => ({ lastReadSeq: 0, createdAt: now() }),
  messageAttachments: () => ({ messageId: null, image: null, createdAt: now() }),
  linkPreviews: () => ({
    title: null,
    description: null,
    imageUrl: null,
    siteName: null,
    status: 'ok',
    fetchedAt: now(),
  }),
};

/** Collections with no `id` field (their identity is a composite of other fields). */
const NO_ID = new Set<string>([
  'groupMembers',
  'spaceStars',
  'tenantSettings',
  'spaceCounters',
  'crmRecordTags',
  'watchers',
  'notificationPrefs',
  'dashboards',
  'sprintSnapshots',
  'platformSettings',
  'plans',
  'channelMembers',
  'readCursors',
  'userStatuses',
  'messageReactions',
  'messageMentions',
  'pins',
  'savedMessages',
  'threadFollows',
]);

// ---- Repository -------------------------------------------------------------------------------------

const HIDE_ID = { _id: 0 } as const;
const _ID_OFF = HIDE_ID;

export interface FindOptions {
  sort?: Sort;
  limit?: number;
  skip?: number;
  projection?: Document;
  /** Case-insensitive sorting: pass `CI`. */
  collation?: { locale: string; strength?: number };
}

/** Collation for case-insensitive ordering of names (like the old `lower(name)` sorts). */
export const CI = { locale: 'en', strength: 2 } as const;

export class Repo<D extends object> {
  constructor(
    readonly prop: string,
    private readonly coll: import('mongodb').Collection<Document>,
    private readonly orgId: string | null,
    private readonly session?: ClientSession,
  ) {}

  /** The raw collection. Tenant repos never expose it: use the methods below so orgId is always applied. */
  private scope(filter: Filter<D> | Document | undefined): Document {
    const f = (filter ?? {}) as Document;
    if (!this.orgId) return f;
    // A filter that names a different tenant matches nothing (what row-level security did), rather than
    // being silently rewritten to this tenant's rows.
    if (f.orgId !== undefined && f.orgId !== this.orgId) {
      return { $and: [{ orgId: this.orgId }, { orgId: f.orgId }] };
    }
    return { ...f, orgId: this.orgId };
  }

  /** Tenant-scoped audit tables are insert-only: nothing in the app edits or removes history. */
  private assertMutable() {
    if (this.orgId && APPEND_ONLY.has(this.prop)) {
      throw new Error(`${this.prop} is append-only`);
    }
  }

  private lowerName(set: Record<string, unknown>) {
    if (LOWER_NAME.has(this.prop) && typeof set.name === 'string') {
      return { ...set, nameLower: set.name.toLowerCase() };
    }
    return set;
  }

  async find(filter?: Filter<D>, opts: FindOptions = {}): Promise<D[]> {
    let cur = this.coll.find(this.scope(filter), {
      projection: { ...opts.projection, ..._ID_OFF },
      session: this.session,
    });
    if (opts.collation) cur = cur.collation(opts.collation);
    if (opts.sort) cur = cur.sort(opts.sort);
    if (opts.skip) cur = cur.skip(opts.skip);
    if (opts.limit) cur = cur.limit(opts.limit);
    return (await cur.toArray()) as unknown as D[];
  }

  async findOne(filter: Filter<D>, opts: Pick<FindOptions, 'sort' | 'projection'> = {}): Promise<D | null> {
    const doc = await this.coll.findOne(this.scope(filter), {
      projection: { ...opts.projection, ..._ID_OFF },
      sort: opts.sort,
      session: this.session,
    });
    return doc as unknown as D | null;
  }

  /** Lookup by the `id` field. */
  get(id: string): Promise<D | null> {
    return this.findOne({ id } as unknown as Filter<D>);
  }

  count(filter?: Filter<D>): Promise<number> {
    return this.coll.countDocuments(this.scope(filter), { session: this.session });
  }

  async exists(filter: Filter<D>): Promise<boolean> {
    return (await this.coll.countDocuments(this.scope(filter), { limit: 1, session: this.session })) > 0;
  }

  distinct<K extends string>(key: K, filter?: Filter<D>): Promise<string[]> {
    return this.coll.distinct(key, this.scope(filter), { session: this.session }) as Promise<string[]>;
  }

  /** Inserts one or many documents, filling defaults, a fresh `id` and the tenant's `orgId`. */
  async insert(doc: Partial<D>): Promise<D>;
  async insert(docs: Partial<D>[]): Promise<D[]>;
  async insert(input: Partial<D> | Partial<D>[]): Promise<D | D[]> {
    const many = Array.isArray(input);
    const docs = (many ? input : [input]).map((d) => {
      const base = { ...(DEFAULTS[this.prop]?.() ?? {}), ...(d as Document) };
      if (!NO_ID.has(this.prop) && base.id === undefined) base.id = randomUUID();
      if (this.orgId) {
        if (base.orgId !== undefined && base.orgId !== this.orgId) {
          throw new Error(`${this.prop}: insert for a different tenant`);
        }
        base.orgId = this.orgId;
      }
      return this.lowerName(base);
    });
    if (docs.length === 0) return [] as D[];
    await this.coll.insertMany(docs, { session: this.session });
    const out = docs.map((d) => {
      const { _id: _omit, ...rest } = d as Document;
      return rest as D;
    });
    return many ? out : out[0]!;
  }

  /** Inserts, ignoring documents that already exist (unique-index conflicts). Returns how many were new. */
  async insertIgnore(input: Partial<D> | Partial<D>[]): Promise<number> {
    const list = Array.isArray(input) ? input : [input];
    let n = 0;
    for (const d of list) {
      try {
        await this.insert(d);
        n++;
      } catch (e) {
        if (!isDuplicateKey(e)) throw e;
      }
    }
    return n;
  }

  /** Sets fields on the first matching document. Returns the number matched (0 or 1). */
  async updateOne(
    filter: Filter<D>,
    set: Partial<D> | UpdateFilter<Document>,
    opts: { unset?: string[]; upsert?: boolean } = {},
  ): Promise<number> {
    this.assertMutable();
    const res = await this.coll.updateOne(this.scope(filter), this.toUpdate(set, opts.unset), {
      upsert: opts.upsert,
      session: this.session,
    });
    return res.matchedCount + (res.upsertedCount ?? 0);
  }

  async updateMany(
    filter: Filter<D>,
    set: Partial<D> | UpdateFilter<Document>,
    opts: { unset?: string[] } = {},
  ): Promise<number> {
    this.assertMutable();
    const res = await this.coll.updateMany(this.scope(filter), this.toUpdate(set, opts.unset), {
      session: this.session,
    });
    return res.matchedCount;
  }

  /** Like `updateOne` but returns the updated document (or null if nothing matched). */
  async findOneAndUpdate(
    filter: Filter<D>,
    set: Partial<D> | UpdateFilter<Document>,
    opts: { unset?: string[]; sort?: Sort } = {},
  ): Promise<D | null> {
    this.assertMutable();
    const doc = await this.coll.findOneAndUpdate(this.scope(filter), this.toUpdate(set, opts.unset), {
      returnDocument: 'after',
      projection: HIDE_ID,
      sort: opts.sort,
      session: this.session,
    });
    return doc as unknown as D | null;
  }

  /** Inserts the document if no match, otherwise sets `set`. `onInsert` only applies to a new document. */
  async upsert(filter: Filter<D>, set: Partial<D>, onInsert: Partial<D> = {}): Promise<void> {
    this.assertMutable();
    const insertDefaults: Document = {
      ...(DEFAULTS[this.prop]?.() ?? {}),
      ...(NO_ID.has(this.prop) ? {} : { id: randomUUID() }),
      ...(onInsert as Document),
    };
    for (const k of Object.keys(set as Document)) delete insertDefaults[k];
    for (const k of Object.keys(filter as Document)) delete insertDefaults[k];
    await this.coll.updateOne(
      this.scope(filter),
      { $set: this.lowerName(set as Record<string, unknown>), $setOnInsert: insertDefaults },
      { upsert: true, session: this.session },
    );
  }

  async deleteOne(filter: Filter<D>): Promise<number> {
    this.assertMutable();
    return (await this.coll.deleteOne(this.scope(filter), { session: this.session })).deletedCount;
  }

  async deleteMany(filter: Filter<D>): Promise<number> {
    this.assertMutable();
    if (!this.orgId && Object.keys((filter ?? {}) as Document).length === 0) {
      throw new Error(`${this.prop}: refusing an unfiltered deleteMany`);
    }
    return (await this.coll.deleteMany(this.scope(filter), { session: this.session })).deletedCount;
  }

  /** Aggregation. For tenant repos a `$match` on orgId is always the first stage. `_id` is not stripped. */
  async aggregate<R extends Document = Document>(pipeline: Document[]): Promise<R[]> {
    const stages = this.orgId ? [{ $match: { orgId: this.orgId } }, ...pipeline] : pipeline;
    return this.coll.aggregate<R>(stages, { session: this.session }).toArray();
  }

  private toUpdate(set: Document, unset?: string[]): UpdateFilter<Document> {
    const isOperator = Object.keys(set).some((k) => k.startsWith('$'));
    const update: UpdateFilter<Document> = isOperator ? { ...set } : { $set: this.lowerName(set) };
    if (unset?.length) update.$unset = Object.fromEntries(unset.map((k) => [k, ''])) as never;
    return update;
  }
}

export const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

// ---- Scopes -------------------------------------------------------------------------------------------

type TenantRepos = { [K in keyof TenantDocs]: Repo<TenantDocs[K]> };
type GlobalRepos = { [K in keyof GlobalDocs]: Repo<GlobalDocs[K]> } & TenantRepos;

function build<M extends Record<string, string>>(
  names: M,
  handle: MongoDb,
  orgId: string | null,
  session?: ClientSession,
) {
  const out: Record<string, Repo<object>> = {};
  for (const [prop, name] of Object.entries(names)) {
    out[prop] = new Repo(prop, handle.collection(name), orgId, session);
  }
  return out;
}

/** Everything a request for one workspace may touch. Cannot reach another tenant's data. */
export class TenantDb {
  readonly memberships!: TenantRepos['memberships'];
  readonly invitations!: TenantRepos['invitations'];
  readonly auditLogs!: TenantRepos['auditLogs'];
  readonly groups!: TenantRepos['groups'];
  readonly groupMembers!: TenantRepos['groupMembers'];
  readonly spaces!: TenantRepos['spaces'];
  readonly spaceMembers!: TenantRepos['spaceMembers'];
  readonly spaceStars!: TenantRepos['spaceStars'];
  readonly spaceAccessRequests!: TenantRepos['spaceAccessRequests'];
  readonly tenantSettings!: TenantRepos['tenantSettings'];
  readonly sites!: TenantRepos['sites'];
  readonly holidays!: TenantRepos['holidays'];
  readonly workDays!: TenantRepos['workDays'];
  readonly workDayEdits!: TenantRepos['workDayEdits'];
  readonly boards!: TenantRepos['boards'];
  readonly spaceCounters!: TenantRepos['spaceCounters'];
  readonly spaceStatuses!: TenantRepos['spaceStatuses'];
  readonly workItems!: TenantRepos['workItems'];
  readonly labels!: TenantRepos['labels'];
  readonly crmTags!: TenantRepos['crmTags'];
  readonly crmCompanies!: TenantRepos['crmCompanies'];
  readonly crmContacts!: TenantRepos['crmContacts'];
  readonly crmLeads!: TenantRepos['crmLeads'];
  readonly crmPipelines!: TenantRepos['crmPipelines'];
  readonly crmStages!: TenantRepos['crmStages'];
  readonly crmDeals!: TenantRepos['crmDeals'];
  readonly crmActivities!: TenantRepos['crmActivities'];
  readonly crmNotes!: TenantRepos['crmNotes'];
  readonly crmRecordTags!: TenantRepos['crmRecordTags'];
  readonly comments!: TenantRepos['comments'];
  readonly workItemLinks!: TenantRepos['workItemLinks'];
  readonly watchers!: TenantRepos['watchers'];
  readonly activityEvents!: TenantRepos['activityEvents'];
  readonly attachments!: TenantRepos['attachments'];
  readonly savedFilters!: TenantRepos['savedFilters'];
  readonly notifications!: TenantRepos['notifications'];
  readonly notificationPrefs!: TenantRepos['notificationPrefs'];
  readonly emailBatches!: TenantRepos['emailBatches'];
  readonly sprints!: TenantRepos['sprints'];
  readonly sprintItemsHistory!: TenantRepos['sprintItemsHistory'];
  readonly sprintSnapshots!: TenantRepos['sprintSnapshots'];
  readonly checklistTemplates!: TenantRepos['checklistTemplates'];
  readonly versions!: TenantRepos['versions'];
  readonly components!: TenantRepos['components'];
  readonly spaceFolders!: TenantRepos['spaceFolders'];
  readonly spaceFiles!: TenantRepos['spaceFiles'];
  readonly worklogs!: TenantRepos['worklogs'];
  readonly dashboards!: TenantRepos['dashboards'];
  readonly channels!: TenantRepos['channels'];
  readonly channelMembers!: TenantRepos['channelMembers'];
  readonly messages!: TenantRepos['messages'];
  readonly messageEdits!: TenantRepos['messageEdits'];
  readonly readCursors!: TenantRepos['readCursors'];
  readonly userStatuses!: TenantRepos['userStatuses'];
  readonly messageReactions!: TenantRepos['messageReactions'];
  readonly messageMentions!: TenantRepos['messageMentions'];
  readonly pins!: TenantRepos['pins'];
  readonly savedMessages!: TenantRepos['savedMessages'];
  readonly threadFollows!: TenantRepos['threadFollows'];
  readonly messageAttachments!: TenantRepos['messageAttachments'];
  readonly linkPreviews!: TenantRepos['linkPreviews'];

  private readonly usersRepo: Repo<T.UserDoc>;
  private readonly orgsRepo: Repo<T.OrganizationDoc>;
  private readonly plansRepo: Repo<T.PlanDoc>;

  constructor(
    handle: MongoDb,
    readonly orgId: string,
    readonly session?: ClientSession,
  ) {
    if (!UUID_RE.test(orgId)) throw new Error('TenantDb: invalid org id');
    Object.assign(this, build(TENANT, handle, orgId, session));
    this.usersRepo = new Repo('users', handle.collection(GLOBAL.users), null, session);
    this.orgsRepo = new Repo('organizations', handle.collection(GLOBAL.organizations), null, session);
    this.plansRepo = new Repo('plans', handle.collection(GLOBAL.plans), null, session);
  }

  /** This workspace's own organization document. */
  organization(): Promise<T.OrganizationDoc | null> {
    return this.orgsRepo.findOne({ id: this.orgId });
  }

  /**
   * A tenant may change only its own branding. Status, plan and limits belong to the platform
   * (replaces the old column-level GRANT on organizations).
   */
  updateBranding(
    set: Partial<Pick<T.OrganizationDoc, 'name' | 'logoUrl' | 'accentColor' | 'domainRestricted'>>,
  ): Promise<number> {
    const allowed: Partial<T.OrganizationDoc> = {};
    for (const k of ['name', 'logoUrl', 'accentColor', 'domainRestricted'] as const) {
      if (k in set) (allowed as Record<string, unknown>)[k] = set[k];
    }
    return this.orgsRepo.updateOne({ id: this.orgId }, allowed);
  }

  planByKey(key: string): Promise<T.PlanDoc | null> {
    return this.plansRepo.findOne({ key });
  }

  /** All plans, for the plan and pricing screens. */
  listPlans(): Promise<T.PlanDoc[]> {
    return this.plansRepo.find({}, { sort: { sort: 1 } });
  }

  /**
   * Users are global identities. Tenant code may read only those who are members of this workspace,
   * so this resolves ids through `memberships` first (the equivalent of the old `users` RLS policy).
   */
  async users(ids: string[]): Promise<Map<string, T.UserDoc>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const members = await this.memberships.find({ userId: { $in: unique } }, { projection: { userId: 1 } });
    const allowed = members.map((m) => m.userId);
    if (allowed.length === 0) return new Map();
    const rows = await this.usersRepo.find({ id: { $in: allowed } });
    return new Map(rows.map((u) => [u.id, u]));
  }

  /** Updates a member's own global profile row (name, avatar, ...). Only for users in this workspace. */
  async updateUser(userId: string, set: Partial<T.UserDoc>): Promise<number> {
    if (!(await this.memberships.exists({ userId }))) return 0;
    return this.usersRepo.updateOne({ id: userId }, set);
  }
}

/** Unscoped access: sign-in, the platform console, cross-tenant jobs, seeds. Use deliberately. */
export class GlobalDb {
  readonly organizations!: GlobalRepos['organizations'];
  readonly users!: GlobalRepos['users'];
  readonly plans!: GlobalRepos['plans'];
  readonly platformAdmins!: GlobalRepos['platformAdmins'];
  readonly platformSettings!: GlobalRepos['platformSettings'];
  readonly signupRequests!: GlobalRepos['signupRequests'];
  readonly platformAudit!: GlobalRepos['platformAudit'];
  /** Every tenant collection without the orgId guard. */
  readonly all!: TenantRepos;

  constructor(
    private readonly handle: MongoDb,
    readonly session?: ClientSession,
  ) {
    Object.assign(this, build(GLOBAL, handle, null, session));
    (this as { all: TenantRepos }).all = build(TENANT, handle, null, session) as unknown as TenantRepos;
  }

  forOrg(orgId: string): TenantDb {
    return new TenantDb(this.handle, orgId, this.session);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Database {
  readonly global: GlobalDb;

  constructor(
    readonly client: MongoClient,
    readonly handle: MongoDb,
  ) {
    this.global = new GlobalDb(handle);
  }

  /** Tenant-scoped access. Single operations are atomic per document; use `tx` for multi-step changes. */
  tenant(orgId: string): TenantDb {
    return new TenantDb(this.handle, orgId);
  }

  /** Runs `fn` in a transaction scoped to one tenant. The callback may be retried on transient errors. */
  async tx<R>(orgId: string, fn: (t: TenantDb) => Promise<R>): Promise<R> {
    return this.session((s) => fn(new TenantDb(this.handle, orgId, s)));
  }

  /** A transaction that spans tenants and global collections (workspace provisioning). */
  async globalTx<R>(fn: (g: GlobalDb) => Promise<R>): Promise<R> {
    return this.session((s) => fn(new GlobalDb(this.handle, s)));
  }

  private async session<R>(fn: (s: ClientSession) => Promise<R>): Promise<R> {
    const s = this.client.startSession();
    try {
      let result!: R;
      await s.withTransaction(async () => {
        result = await fn(s);
      });
      return result;
    } finally {
      await s.endSession();
    }
  }

  close() {
    return this.client.close();
  }
}

export type Db = Database;

/**
 * Opens a database handle. The driver connects lazily on first use, so this is synchronous; callers
 * that want to fail fast can `await db.handle.command({ ping: 1 })`.
 */
export function createDb(uri: string, dbName: string) {
  const client = new MongoClient(uri, { maxPoolSize: 20, retryWrites: true });
  const db = new Database(client, client.db(dbName));
  return { db, client, close: () => db.close() };
}

export { ensureIndexes } from './indexes.js';

/** Runs `fn` with access scoped to one tenant. Single-document writes are atomic; use `withTenantTx` for more. */
export function withTenant<R>(db: Db, orgId: string, fn: (t: TenantDb) => Promise<R>): Promise<R> {
  return fn(db.tenant(orgId));
}

/** Same as `withTenant` but every read and write in `fn` happens in one transaction. */
export function withTenantTx<R>(db: Db, orgId: string, fn: (t: TenantDb) => Promise<R>): Promise<R> {
  return db.tx(orgId, fn);
}
