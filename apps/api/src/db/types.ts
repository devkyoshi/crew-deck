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
  type: 'kanban' | 'scrum';
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
  type: 'epic' | 'story' | 'task' | 'bug' | 'subtask';
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
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
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
