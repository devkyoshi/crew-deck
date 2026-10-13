/** Human wording for audit actions. Unknown actions fall back to the raw action name. */
export const AUDIT_LABELS: Record<string, string> = {
  'invitation.created': 'invited someone',
  'invitation.resent': 'resent an invitation',
  'invitation.revoked': 'revoked an invitation',
  'invitation.accepted': 'accepted an invitation',
  'member.role_changed': 'changed a role',
  'member.profile_updated': 'updated a profile',
  'member.deactivated': 'deactivated a member',
  'member.reactivated': 'reactivated a member',
  'group.created': 'created a group',
  'group.updated': 'updated a group',
  'group.deleted': 'deleted a group',
  'group.members_changed': 'changed group members',
  'space.created': 'created a space',
  'space.updated': 'updated a space',
  'space.archived': 'archived a space',
  'space.restored': 'restored a space',
  'space.deleted': 'deleted a space',
  'space.member_added': 'added someone to a space',
  'space.member_role_changed': 'changed a space role',
  'space.member_removed': 'removed someone from a space',
  'space.access_requested': 'asked for access to a space',
  'space.access_approved': 'approved an access request',
  'space.access_declined': 'declined an access request',
  'space.access_cancelled': 'cancelled an access request',
};

export const auditLabel = (action: string) => AUDIT_LABELS[action] ?? action;

/** Short single-line summary of what changed, from the before/after snapshots. */
export function auditSummary(e: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})]);
  for (const k of keys) {
    if (k.endsWith('Id') || k === 'memberRowId' || k === 'requestId') continue;
    const b = e.before?.[k];
    const a = e.after?.[k];
    const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
    if (b !== undefined && a !== undefined) parts.push(`${k}: ${fmt(b)} → ${fmt(a)}`);
    else if (a !== undefined) parts.push(`${k}: ${fmt(a)}`);
    else if (b !== undefined) parts.push(`${k}: ${fmt(b)}`);
  }
  return parts.join(' · ');
}
