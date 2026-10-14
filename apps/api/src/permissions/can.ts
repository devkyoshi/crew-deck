import type { OrgRole } from '@crew-deck/shared';

/** Space-level roles. Resolved in Phase 5; accepted here so the matrix lives in one place. */
export type SpaceRole = 'admin' | 'member' | 'viewer';

export type Action =
  | 'member.invite'
  | 'member.deactivate'
  | 'member.changeRole'
  | 'member.editProfile'
  | 'group.manage'
  | 'space.create'
  | 'space.viewAll'
  | 'space.edit'
  | 'space.delete'
  | 'space.manageMembers'
  | 'accessRequest.approve'
  | 'space.view'
  | 'audit.viewOrg'
  | 'audit.viewSpace'
  | 'settings.manage'
  | 'attendance.viewAll'
  | 'attendance.export'
  | 'workday.editOthers'
  | 'workday.viewTimes'
  | 'crm.view'
  | 'crm.edit'
  | 'crm.admin';

export type CrmRole = 'none' | 'viewer' | 'member' | 'admin';

export interface Actor {
  userId: string;
  orgId: string;
  orgRole: OrgRole;
  /** The member's CRM role. Owners and admins act as CRM admins regardless of it. */
  crmRole?: CrmRole;
}

export interface Resource {
  /** Target of the action when it is a person (for example whose role is being changed). */
  targetOrgRole?: OrgRole;
  /** The caller's effective role in the space the action targets (highest of direct and group). */
  spaceRole?: SpaceRole | null;
  /** Visibility of the space the action targets. */
  spaceVisibility?: 'open' | 'private';
  /** For work-day actions: the day belongs to the caller. */
  isSelf?: boolean;
  /** For work-day actions: the day belongs to someone who reports to the caller. */
  isManager?: boolean;
}

const isAdminLike = (role: OrgRole) => role === 'owner' || role === 'admin';

/**
 * The single source of truth for permissions (brief section 5). API routes call this; the UI only
 * mirrors it. Unknown actions are denied.
 */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  const adminLike = isAdminLike(actor.orgRole);
  const spaceAdmin = resource.spaceRole === 'admin';

  switch (action) {
    case 'member.invite':
    case 'member.deactivate':
    case 'member.editProfile':
    case 'group.manage':
    case 'space.viewAll':
    case 'space.delete':
    case 'audit.viewOrg':
    case 'settings.manage':
    case 'attendance.viewAll':
    case 'attendance.export':
      return adminLike;

    // Exact check-in times and corrections: the person, their manager, and admins. Teammates see status only.
    case 'workday.editOthers':
    case 'workday.viewTimes':
      return adminLike || resource.isSelf === true || resource.isManager === true;

    // CRM: viewers read, members create and edit, CRM admins configure, import and delete.
    case 'crm.view':
      return adminLike || (actor.crmRole !== undefined && actor.crmRole !== 'none');
    case 'crm.edit':
      return adminLike || actor.crmRole === 'member' || actor.crmRole === 'admin';
    case 'crm.admin':
      return adminLike || actor.crmRole === 'admin';

    case 'member.changeRole':
      if (!adminLike) return false;
      // Admins cannot change owners (or promote anyone to owner); only owners can.
      if (actor.orgRole === 'admin') return resource.targetOrgRole !== 'owner';
      return true;

    case 'space.create':
      return true; // any org member (open decision: admins only)

    case 'space.edit':
    case 'space.manageMembers':
    case 'accessRequest.approve':
      return adminLike || spaceAdmin;

    case 'space.view':
      if (adminLike) return true;
      if (resource.spaceRole) return true;
      return resource.spaceVisibility === 'open';

    case 'audit.viewSpace':
      return adminLike || spaceAdmin;

    default:
      return false;
  }
}

export const ADMIN_ACTIONS: Action[] = [
  'member.invite',
  'member.deactivate',
  'member.changeRole',
  'member.editProfile',
  'group.manage',
  'space.viewAll',
  'space.delete',
  'audit.viewOrg',
  'settings.manage',
  'attendance.viewAll',
  'attendance.export',
];
