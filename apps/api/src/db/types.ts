/**
 * Document shapes for every MongoDB collection. Field names match the camelCase columns the old
 * Drizzle schema exposed, so route code keeps reading `row.orgId`, `row.createdAt` and so on.
 * Ids are UUID strings kept in an `id` field (the Mongo `_id` is never exposed). Dates are `Date`;
 * calendar dates (`date`, `dueDate`) are `YYYY-MM-DD` strings. Optional columns are `null`, not missing.
 */

export type OrgRole = 'owner' | 'admin' | 'member';
export type CrmRole = 'none' | 'viewer' | 'member' | 'admin';
export type SpaceRole = 'admin' | 'member' | 'viewer';

export interface OrganizationDoc {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: 'active' | 'suspended';
  suspendedAt: Date | null;
  suspendedReason: string | null;
  planKey: string | null;
  onTrial: boolean;
  trialEndsAt: Date | null;
  limitOverrides: Record<string, number>;
  createdVia: string;
  logoUrl: string | null;
  accentColor: string | null;
  domainRestricted: boolean;
  /** What the workspace is for (see WORK_TYPES in @crew-deck/shared). */
  workType: string | null;
  /** Every kind of work the company does; `workType` is the first (primary). Empty on older workspaces. */
  workTypes: string[];
  /** How the team plans to use it (see USAGE_OPTIONS). */
  usage: string[];
  createdAt: Date;
}

export interface UserDoc {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string;
  status: 'invited' | 'active' | 'deactivated';
  passwordHash: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface PlanDoc {
  key: string;
  name: string;
  sort: number;
  priceCents: number | null;
  public: boolean;
  limits: Record<string, number>;
  features: string[];
}

export interface PlatformAdminDoc {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  createdAt: Date;
}

export interface PlatformSettingsDoc {
  id: 'singleton';
  blockFreeEmailDomains: boolean;
  signupsEnabled: boolean;
  trialDays: number;
  updatedAt: Date;
}

export interface SignupRequestDoc {
  id: string;
  tokenHash: string;
  email: string;
  name: string | null;
  company: string;
  slug: string;
  workType: string | null;
  workTypes: string[];
  usage: string[];
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface PlatformAuditDoc {
  id: string;
  adminId: string | null;
  action: string;
  orgId: string | null;
  detail: unknown;
  createdAt: Date;
}

// ---- Tenant data (every document carries orgId) ----------------------------------------------------

export interface MembershipDoc {
  id: string;
  orgId: string;
  userId: string;
  orgRole: OrgRole;
  status: 'active' | 'deactivated';
  deactivatedAt: Date | null;
  reportsTo: string | null;
  crmRole: CrmRole;
  createdAt: Date;
}

export interface InvitationDoc {
  id: string;
  orgId: string;
  email: string;
  orgRole: OrgRole;
  groupIds: string[];
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedBy: string | null;
  createdAt: Date;
}

export interface AuditLogDoc {
  id: string;
  orgId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export interface GroupDoc {
  id: string;
  orgId: string;
  name: string;
  nameLower: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMemberDoc {
  groupId: string;
  orgId: string;
  userId: string;
  createdAt: Date;
}

export interface SpaceDoc {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  visibility: 'open' | 'private';
  status: 'active' | 'archived';
  ownerId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceMemberDoc {
  id: string;
  spaceId: string;
  orgId: string;
  principalType: 'user' | 'group';
  principalId: string;
  spaceRole: SpaceRole;
  createdAt: Date;
}

export interface SpaceStarDoc {
  spaceId: string;
  orgId: string;
  userId: string;
  createdAt: Date;
}

export interface SpaceAccessRequestDoc {
  id: string;
  orgId: string;
  spaceId: string;
  userId: string;
  message: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  decidedBy: string | null;
  decidedAt: Date | null;
  grantedRole: SpaceRole | null;
  createdAt: Date;
}

export interface TenantSettingsDoc {
  orgId: string;
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  autoCloseTime: string;
  requireNote: boolean;
  enabledModules: string[];
  updatedAt: Date;
}

export interface SiteDoc {
  id: string;
  orgId: string;
  name: string;
  nameLower: string;
  address: string | null;
  createdAt: Date;
}

export interface HolidayDoc {
  id: string;
  orgId: string;
  date: string;
  name: string;
}

export type LocationType = 'onsite' | 'remote' | 'offsite' | 'leave';

export interface WorkDayDoc {
  id: string;
  orgId: string;
  userId: string;
  date: string;
  plannedLocation: LocationType | null;
  locationType: LocationType | 'holiday' | null;
  siteId: string | null;
  checkinAt: Date | null;
  checkoutAt: Date | null;
  note: string | null;
  autoClosed: boolean;
  source: 'web' | 'auto' | 'edit' | 'plan';
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkDayEditDoc {
  id: string;
  orgId: string;
  workDayId: string;
  editedBy: string;
  oldValues: unknown;
  newValues: unknown;
  reason: string;
  editedAt: Date;
}

// ---- Work (boards and items) -----------------------------------------------------------------------

export interface BoardDoc {
  id: string;
  orgId: string;
  spaceId: string;
  /** Legacy: the closest board type to `features`. New code reads `features`. */
  type: 'kanban' | 'scrum' | 'service';
  /** What the space has switched on (see SPACE_FEATURES). Missing on spaces made before features existed. */
  features?: string[];
  name: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceCounterDoc {
  spaceId: string;
  orgId: string;
  lastNumber: number;
}

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface SpaceStatusDoc {
  id: string;
  orgId: string;
  spaceId: string;
  name: string;
  nameLower: string;
  category: StatusCategory;
  position: number;
  color: string;
  wipLimit: number | null;
  createdAt: Date;
}

export interface WorkItemDoc {
  id: string;
  orgId: string;
  spaceId: string;
  number: number;
  type: 'epic' | 'story' | 'task' | 'bug' | 'ticket' | 'subtask';
  parentId: string | null;
  title: string;
  description: unknown;
  statusId: string;
  priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
  assigneeId: string | null;
  reporterId: string;
  /** Story points or hours, one decimal. */
  estimate: number | null;
  dueDate: string | null;
  sprintId: string | null;
  /** Fractional-indexing key. Compared byte-wise, which is MongoDB's default string order. */
  rank: string;
  /** Embedded label ids (replaces the old work_item_labels join table). */
  labelIds: string[];
  /** The description as plain text, for the search index (see work/search-text.ts). */
  searchText?: string;
  /** Which sources `searchText` was built from (see work/search-text.ts). */
  searchVersion?: number;
  /** When work is planned to start (epics use it on the roadmap). */
  startDate?: string | null;
  /** Time planned and still expected, in minutes. */
  originalMinutes?: number | null;
  remainingMinutes?: number | null;
  /** Releases this item is planned for / was found in, and the parts of the product it touches. */
  fixVersionIds?: string[];
  affectsVersionIds?: string[];
  componentIds?: string[];
  /** Why the item was finished (set with a Done status). */
  resolution?: 'done' | 'wont_do' | 'duplicate' | 'cannot_reproduce' | null;
  /** A short to-do list inside the item. */
  checklist?: { id: string; text: string; done: boolean }[];
  /** Order inside the backlog or a sprint list; items without one follow the ranked ones by board rank. */
  backlogRank?: string | null;
  /** Earlier keys (`ENG-12`) of an item that was moved to another space; they still resolve to it. */
  keyHistory?: string[];
  /** How many sprints this item was carried out of unfinished. */
  carryOverCount?: number;
  /** Tickets only: when the response and resolve targets fall due, and when the team first answered. */
  slaResponseDueAt?: Date | null;
  slaResolveDueAt?: Date | null;
  firstResponseAt?: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** A release of the product, with an optional planned window. */
export interface VersionDoc {
  id: string;
  orgId: string;
  spaceId: string;
  name: string;
  nameLower: string;
  description: string;
  startDate: string | null;
  releaseDate: string | null;
  state: 'unreleased' | 'released' | 'archived';
  releasedAt: Date | null;
  createdAt: Date;
}

/** A part of the product. New work in it can go to its default assignee. */
export interface ComponentDoc {
  id: string;
  orgId: string;
  spaceId: string;
  name: string;
  nameLower: string;
  description: string;
  leadId: string | null;
  defaultAssigneeId: string | null;
  createdAt: Date;
}

/** A reusable checklist a space offers when someone adds a checklist to an item. */
export interface ChecklistTemplateDoc {
  id: string;
  orgId: string;
  spaceId: string;
  name: string;
  nameLower: string;
  items: string[];
  createdAt: Date;
}

export interface LabelDoc {
  id: string;
  orgId: string;
  spaceId: string;
  name: string;
  nameLower: string;
  color: string;
  createdAt: Date;
}

// ---- CRM ---------------------------------------------------------------------------------------------

export type CrmRecordType = 'company' | 'contact' | 'lead' | 'deal';

interface CrmRecord {
  ownerId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CrmTagDoc {
  id: string;
  orgId: string;
  name: string;
  nameLower: string;
  color: string;
}

export interface CrmCompanyDoc extends CrmRecord {
  id: string;
  orgId: string;
  name: string;
  nameLower: string;
  website: string | null;
  industry: string | null;
  size: string | null;
}

export interface CrmContactDoc extends CrmRecord {
  id: string;
  orgId: string;
  companyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
}

export interface CrmLeadDoc extends CrmRecord {
  id: string;
  orgId: string;
  name: string;
  email: string | null;
  companyName: string | null;
  source: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'unqualified';
  convertedAt: Date | null;
  convertedCompanyId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
}

export interface CrmPipelineDoc {
  id: string;
  orgId: string;
  name: string;
  isDefault: boolean;
}

export interface CrmStageDoc {
  id: string;
  orgId: string;
  pipelineId: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface CrmDealDoc extends CrmRecord {
  id: string;
  orgId: string;
  pipelineId: string;
  stageId: string;
  companyId: string | null;
  contactId: string | null;
  title: string;
  value: number;
  currency: string;
  expectedClose: string | null;
  status: 'open' | 'won' | 'lost';
  position: number;
  closedAt: Date | null;
}

export interface CrmActivityDoc {
  id: string;
  orgId: string;
  type: 'call' | 'meeting' | 'email' | 'task';
  subject: string;
  dueAt: Date | null;
  completedAt: Date | null;
  assigneeId: string | null;
  linkedType: CrmRecordType | null;
  linkedId: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface CrmNoteDoc {
  id: string;
  orgId: string;
  body: string;
  authorId: string;
  linkedType: CrmRecordType;
  linkedId: string;
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CrmRecordTagDoc {
  orgId: string;
  tagId: string;
  recordType: CrmRecordType;
  recordId: string;
}

// ---- Work item depth: comments, links, watchers, activity ----------------------------------------------

export type ActivityKind =
  | 'created'
  | 'updated'
  | 'moved'
  | 'deleted'
  | 'commented'
  | 'comment_deleted'
  | 'linked'
  | 'unlinked'
  | 'attachment_added'
  | 'attachment_removed'
  | 'transferred'
  | 'duplicated';

export interface CommentDoc {
  id: string;
  orgId: string;
  spaceId: string;
  itemId: string;
  authorId: string;
  /** Rich text (sanitised ProseMirror JSON); null once deleted. */
  body: unknown;
  mentions: string[];
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface WorkItemLinkDoc {
  id: string;
  orgId: string;
  fromItemId: string;
  toItemId: string;
  linkType: 'blocks' | 'relates_to' | 'duplicates';
  createdBy: string;
  createdAt: Date;
}

export interface WatcherDoc {
  orgId: string;
  itemId: string;
  userId: string;
  createdAt: Date;
}

/** Append-only history of an item. Values are display snapshots. */
export interface ActivityEventDoc {
  id: string;
  orgId: string;
  spaceId: string;
  itemId: string;
  actorId: string;
  kind: ActivityKind;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

export interface AttachmentDoc {
  id: string;
  orgId: string;
  spaceId: string;
  itemId: string;
  uploaderId: string;
  /** Cleaned display name. Never used on disk. */
  name: string;
  mime: string;
  /** The sniffed image type when the file is a real PNG, JPEG, GIF or WebP (shown inline), else null. */
  image: string | null;
  size: number;
  storageKey: string;
  createdAt: Date;
}

/** Time someone spent on an item. */
export interface WorklogDoc {
  id: string;
  orgId: string;
  spaceId: string;
  itemId: string;
  userId: string;
  minutes: number;
  /** The day the work was done (YYYY-MM-DD). */
  date: string;
  note: string;
  createdAt: Date;
}

/** One tile on a person's dashboard. Which data it shows is read live from the normal endpoints. */
export interface GadgetDoc {
  id: string;
  type: 'assigned' | 'filter' | 'sprint' | 'versions' | 'flow';
  spaceId: string | null;
  filterId: string | null;
}

/** A person's dashboard layout: the gadgets they chose, in order. */
export interface DashboardDoc {
  orgId: string;
  userId: string;
  gadgets: GadgetDoc[];
  updatedAt: Date;
}

/** A folder in a space's document library. Folders nest. */
export interface SpaceFolderDoc {
  id: string;
  orgId: string;
  spaceId: string;
  parentId: string | null;
  name: string;
  nameLower: string;
  createdBy: string;
  createdAt: Date;
}

/** A file in a space's document library (not tied to a work item). */
export interface SpaceFileDoc {
  id: string;
  orgId: string;
  spaceId: string;
  folderId: string | null;
  uploaderId: string;
  /** Cleaned display name. Never used on disk. */
  name: string;
  mime: string;
  image: string | null;
  size: number;
  storageKey: string;
  createdAt: Date;
}

/** A board or list filter someone saved (personal, or shared with everyone who can open the space). */
export interface SavedFilterDoc {
  id: string;
  orgId: string;
  ownerId: string;
  /** The space it belongs to, or null for a filter usable anywhere (My work). */
  spaceId: string | null;
  name: string;
  /** The filter part of the URL, as the board and list read it. */
  query: string;
  isShared: boolean;
  createdAt: Date;
}

// ---- Notifications ---------------------------------------------------------------------------------------

export type NotificationType =
  | 'assigned'
  | 'mentioned'
  | 'commented'
  | 'status_changed'
  | 'due_soon'
  | 'ticket_received'
  | 'sla_due_soon'
  | 'sla_breached'
  | 'sprint_started'
  | 'sprint_completed';

export interface NotificationDoc {
  id: string;
  orgId: string;
  /** Who it is for. */
  userId: string;
  type: NotificationType;
  itemId: string | null;
  spaceId: string | null;
  /** Who caused it (null for scheduled reminders). */
  actorId: string | null;
  /** Display snapshot: item key and title, space key, excerpt, status names. */
  data: Record<string, unknown>;
  /** Kept only to back an email, because the person turned in-app off for this type. */
  hidden: boolean;
  readAt: Date | null;
  /** Makes scheduled reminders idempotent (one per person, item and day). */
  dedupeKey: string | null;
  createdAt: Date;
}

export interface NotificationPrefsDoc {
  orgId: string;
  userId: string;
  settings: Partial<Record<NotificationType, { inApp: boolean; email: boolean }>>;
  /** Send emails as one daily summary (mornings, in the person's timezone) instead of a few minutes after the first. */
  digest?: boolean;
  updatedAt: Date;
}

/** Notifications waiting to go out together in one email. */
export interface EmailBatchDoc {
  id: string;
  orgId: string;
  userId: string;
  notificationIds: string[];
  dueAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}

// ---- Sprints (Scrum) -------------------------------------------------------------------------------------

export interface SprintDoc {
  id: string;
  orgId: string;
  spaceId: string;
  name: string;
  goal: string | null;
  /** Calendar dates (YYYY-MM-DD); required to start. */
  startDate: string | null;
  endDate: string | null;
  state: 'planned' | 'active' | 'closed';
  startedAt: Date | null;
  closedAt: Date | null;
  /** Points in the sprint when it started (the burndown's first ideal value). */
  startPoints: number | null;
  /** Written when the sprint completes, for the sprint report. */
  summary: {
    completed: string[];
    notCompleted: string[];
    addedAfterStart: string[];
    completedPoints: number;
    notCompletedPoints: number;
  } | null;
  createdBy: string;
  createdAt: Date;
}

/** Every time an item joins or leaves a sprint. */
export interface SprintItemHistoryDoc {
  id: string;
  orgId: string;
  sprintId: string;
  itemId: string;
  addedAt: Date;
  removedAt: Date | null;
  estimateAtAdd: number | null;
}

/** One row per sprint and day: what was left (the burndown's actual line). */
export interface SprintSnapshotDoc {
  orgId: string;
  sprintId: string;
  date: string;
  totalPoints: number;
  remainingPoints: number;
  items: number;
  open: number;
}
