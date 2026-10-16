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
  | 'item.view'
  | 'ticket.submit'
  | 'item.create'
  | 'item.edit'
  | 'item.delete'
  | 'item.link'
  | 'item.watch'
  | 'item.duplicate'
  | 'item.transfer'
  | 'comment.create'
  | 'comment.editOwn'
  | 'comment.deleteAny'
  | 'attachment.add'
  | 'attachment.delete'
  | 'doc.add'
  | 'worklog.add'
  | 'worklog.editOwn'
  | 'worklog.deleteAny'
  | 'doc.delete'
  | 'filter.share'
  | 'sprint.create'
  | 'sprint.start'
  | 'sprint.complete'
  | 'status.manage'
  | 'board.manage'
  | 'label.create'
  | 'label.manage'
  | 'version.manage'
  | 'version.release'
  | 'component.manage'
  | 'settings.manage'
  | 'attendance.viewAll'
  | 'attendance.export'
  | 'workday.editOthers'
  | 'workday.viewTimes'
  | 'crm.view'
  | 'crm.edit'
  | 'crm.admin'
  | 'channel.create'
  | 'channel.view'
  | 'channel.join'
  | 'channel.post'
  | 'channel.manage'
  | 'channel.archive'
  | 'channel.delete'
  | 'channel.reply'
  | 'message.editOwn'
  | 'message.deleteAny'
  | 'message.react'
  | 'message.pin'
  | 'message.save';

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
  /** For item actions: the caller reported the item (members may delete only these). */
  isReporter?: boolean;
  /** For comments and attachments: the caller wrote or uploaded it. */
  isAuthor?: boolean;
  /** For channel actions: what kind of conversation it is. */
  channelType?: 'public' | 'private' | 'dm' | 'group_dm';
  /** The caller's own role in the channel, or null when they are not a member. */
  channelRole?: 'owner' | 'member' | null;
  /** The channel is archived (read-only). */
  isArchived?: boolean;
  /** Only channel owners and admins post here. */
  isAnnouncement?: boolean;
  /** Space channels: the caller only has viewer access to the space, so they read but cannot post. */
  isSpaceViewer?: boolean;
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

    // Work items (brief section 7). Viewing follows the space; editing needs member or better.
    case 'item.view':
    case 'ticket.submit':
    case 'item.watch':
    case 'space.view':
      if (adminLike) return true;
      if (resource.spaceRole) return true;
      return resource.spaceVisibility === 'open';

    case 'audit.viewSpace':
    case 'sprint.start':
    case 'sprint.complete':
    case 'status.manage':
    case 'board.manage':
    case 'label.manage':
    case 'version.release':
    case 'component.manage':
      return adminLike || spaceAdmin;

    case 'item.create':
    case 'item.edit':
    case 'item.link':
    case 'item.duplicate':
    case 'label.create':
    case 'comment.create':
    case 'attachment.add':
    case 'doc.add':
    case 'worklog.add':
    case 'filter.share':
    case 'sprint.create':
    case 'version.manage':
      return adminLike || spaceAdmin || resource.spaceRole === 'member';

    // People edit only their own comments, and only while they can still comment.
    case 'comment.editOwn':
    case 'worklog.editOwn':
      return (
        resource.isAuthor === true && (adminLike || spaceAdmin || resource.spaceRole === 'member')
      );
    case 'comment.deleteAny':
    case 'worklog.deleteAny':
      return adminLike || spaceAdmin;
    case 'attachment.delete':
    case 'doc.delete':
      return (
        adminLike || spaceAdmin || (resource.spaceRole === 'member' && resource.isAuthor === true)
      );

    // Members delete (or move to another space) only what they reported; viewers never do.
    case 'item.delete':
    case 'item.transfer':
      return (
        adminLike || spaceAdmin || (resource.spaceRole === 'member' && resource.isReporter === true)
      );

    // Messaging (brief section 7). Channel roles come from the channel; org admins keep their
    // moderation powers (archive, delete) without having to be a member.
    case 'channel.create':
      return true; // every member for now; the tenant setting arrives with the admin settings (M5)
    case 'channel.join':
      return resource.channelType === 'public' && !resource.channelRole;
    case 'channel.view':
      return resource.channelType === 'public' || !!resource.channelRole;
    case 'channel.post':
      if (!resource.channelRole || resource.isArchived || resource.isSpaceViewer) return false;
      if (resource.isAnnouncement) return resource.channelRole === 'owner' || adminLike;
      return true;
    case 'channel.manage':
    case 'channel.archive':
      // Direct messages have no owners to manage them.
      if (resource.channelType === 'dm' || resource.channelType === 'group_dm') return false;
      return adminLike || resource.channelRole === 'owner';
    case 'channel.delete':
      if (resource.channelType === 'dm' || resource.channelType === 'group_dm') return false;
      return adminLike;
    // Replying in a thread and reacting stay open to members of announcement channels (brief section 4).
    case 'channel.reply':
    case 'message.react':
      return !!resource.channelRole && !resource.isArchived && !resource.isSpaceViewer;
    // Pinning: channel owners and org admins; in a direct message everyone in it.
    case 'message.pin':
      if (resource.isArchived || !(resource.channelRole || adminLike)) return false;
      if (resource.channelType === 'dm' || resource.channelType === 'group_dm') return !!resource.channelRole;
      return adminLike || resource.channelRole === 'owner';
    // Saving is personal: anyone who can see the message.
    case 'message.save':
      return resource.channelType === 'public' || !!resource.channelRole;
    case 'message.editOwn':
      return resource.isAuthor === true && !!resource.channelRole && !resource.isArchived;
    case 'message.deleteAny':
      if (resource.isArchived) return false;
      // Nobody moderates a direct message, and an admin who is not in a private channel cannot read it either.
      if (resource.channelType === 'dm' || resource.channelType === 'group_dm') return false;
      if (resource.channelRole === 'owner') return true;
      return adminLike && (resource.channelType === 'public' || !!resource.channelRole);

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
