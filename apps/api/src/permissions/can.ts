import type { OrgRole } from '@crew-deck/shared';

/** Space-level roles. Resolved in Phase 5; accepted here so the matrix lives in one place. */
export type SpaceRole = 'admin' | 'member' | 'viewer';

export type Action =
  | 'member.invite'
  | 'member.deactivate'
  | 'member.changeRole'
  | 'group.manage'
  | 'space.create'
  | 'space.viewAll'
  | 'space.edit'
  | 'space.manageMembers'
  | 'accessRequest.approve'
  | 'space.view'
  | 'audit.viewOrg'
  | 'audit.viewSpace';

export interface Actor {
  userId: string;
  orgId: string;
  orgRole: OrgRole;
}

export interface Resource {
  /** Target of the action when it is a person (for example whose role is being changed). */
  targetOrgRole?: OrgRole;
  /** The caller's effective role in the space the action targets (highest of direct and group). */
  spaceRole?: SpaceRole | null;
  /** Visibility of the space the action targets. */
  spaceVisibility?: 'open' | 'private';
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
    case 'group.manage':
    case 'space.viewAll':
    case 'audit.viewOrg':
      return adminLike;

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
  'group.manage',
  'space.viewAll',
  'audit.viewOrg',
];
