import type { ErrorResponse } from '@crew-deck/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface Me {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    jobTitle: string | null;
    timezone: string;
  };
  org: {
    id: string;
    name: string;
    slug: string;
    domain: string;
    logoUrl: string | null;
    accentColor: string | null;
    domainRestricted: boolean;
  };
  plan: {
    key: string | null;
    name: string;
    onTrial: boolean;
    trialEndsAt: string | null;
    features: string[];
  };
  /** Email of the platform admin when this is a read-only impersonated session. */
  impersonatedBy: string | null;
  orgRole: 'owner' | 'admin' | 'member';
  permissions: string[];
  orgs: { id: string; name: string; slug: string; orgRole: string }[];
}

export interface Providers {
  tenant: { name: string; slug: string; suspended: boolean } | null;
  password: boolean;
  google: boolean;
  devLogin: boolean;
}

/** Browser-side JSON call to the same-origin API proxy. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  // The session expired or was ended (for example the person was deactivated): go to sign in.
  if (res.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') {
    window.location.assign(path.startsWith('/platform') ? '/platform/sign-in' : '/sign-in');
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ErrorResponse>;
    throw new ApiError(
      res.status,
      err.code ?? 'error',
      err.message ?? 'Something went wrong',
      err.fields,
    );
  }
  return data as T;
}

export type OrgRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'invited' | 'deactivated';

export interface Member {
  reportsTo?: string | null;
  reportsToName?: string | null;
  crmRole?: 'none' | 'viewer' | 'member' | 'admin';
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string;
  orgRole: OrgRole;
  status: MemberStatus;
  lastLoginAt: string | null;
  joinedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Invitation {
  id: string;
  email: string;
  orgRole: OrgRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedByName: string | null;
}

export type InviteResultStatus =
  'invited' | 'already_member' | 'deactivated_member' | 'already_invited' | 'invalid_domain';

export interface InviteResponse {
  results: { email: string; status: InviteResultStatus; invitationId?: string; link?: string }[];
  emailDelivery: boolean;
}

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface MemberDetail extends Member {
  groups: { id: string; name: string }[];
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  memberCount: number;
  members: { id: string; name: string | null; email: string; avatarUrl: string | null }[];
}

export interface GroupMember {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  orgRole: OrgRole;
  status: MemberStatus;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  members: GroupMember[];
}

export type SpaceRole = 'admin' | 'member' | 'viewer';
export type SpaceVisibility = 'open' | 'private';

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  visibility: SpaceVisibility;
  status: 'active' | 'archived';
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  myRole: SpaceRole | null;
  starred: boolean;
  memberCount: number;
}

export interface SpaceMemberSummary {
  type: 'user' | 'group';
  id: string;
  name: string | null;
  email?: string;
  avatarUrl?: string | null;
  role: SpaceRole;
}

export interface SpaceDetail extends Space {
  members: SpaceMemberSummary[];
  permissions: { edit: boolean; manageMembers: boolean; delete: boolean; viewAudit: boolean };
}

export interface SpaceMemberRow {
  id: string;
  type: 'user' | 'group';
  principalId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  role: SpaceRole;
  effectiveRole: SpaceRole;
  inheritedRole: SpaceRole | null;
  memberCount: number | null;
  deactivated: boolean;
}

export interface AccessRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  message: string | null;
  grantedRole: SpaceRole | null;
  createdAt: string;
  decidedAt: string | null;
  requesterId: string;
  requesterName: string | null;
  requesterEmail: string;
  requesterAvatar: string | null;
  spaceKey: string;
  spaceId: string | null;
  spaceName: string | null;
  spaceIcon: string | null;
  decidedByName: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
}

export type Location = 'onsite' | 'remote' | 'offsite' | 'leave' | 'holiday';
export type CheckinLocation = 'onsite' | 'remote' | 'offsite';

export interface WorkDayView {
  id: string;
  date: string;
  plannedLocation: Location | null;
  locationType: Location | null;
  siteId: string | null;
  siteName: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  checkinLocal: string | null;
  checkoutLocal: string | null;
  note: string | null;
  autoClosed: boolean;
  hours: number | null;
}

export interface Site {
  id: string;
  name: string;
  address?: string | null;
}

export interface TodayState {
  enabled: boolean;
  now: string;
  date: string;
  timezone: string;
  isWorkday: boolean;
  holiday: string | null;
  status: 'checked_in' | 'checked_out' | 'leave' | 'holiday' | 'not_in';
  workDay: WorkDayView | null;
  settings: { requireNote: boolean; workStart: string; workEnd: string };
  sites: Site[];
}

export interface WeekDay {
  date: string;
  weekday: number;
  isWorkday: boolean;
  isPast: boolean;
  holiday: string | null;
  plannedLocation: Location | null;
  workDay: WorkDayView | null;
}

export interface WeekState {
  today: string;
  timezone: string;
  days: WeekDay[];
}

export interface TeamItem {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  state: 'in' | 'out' | 'leave' | 'holiday' | 'planned' | 'none';
  location: Location | null;
  siteName: string | null;
  holiday: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  autoClosed: boolean | null;
}

export interface TeamStatus {
  items: TeamItem[];
  counts: Record<string, number>;
  total: number;
}

export interface HistoryRow extends WorkDayView {
  userId: string;
  name: string | null;
  email: string;
  timezone: string;
  source: string;
  edited: boolean;
}

export interface WorkSettingsView {
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  autoCloseTime: string;
  requireNote: boolean;
  checkinEnabled: boolean;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface WorkDayEdit {
  id: string;
  reason: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  editedAt: string;
  editorName: string | null;
  editorEmail: string;
}
