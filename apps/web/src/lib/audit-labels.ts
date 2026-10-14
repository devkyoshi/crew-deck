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
  'member.crm_role_changed': 'changed CRM access',
  'member.manager_changed': 'changed a manager',
  'crm.module_toggled': 'switched the CRM on or off',
  'crm.company_created': 'added a company',
  'crm.company_updated': 'updated a company',
  'crm.company_deleted': 'deleted a company',
  'crm.contact_created': 'added a contact',
  'crm.contact_updated': 'updated a contact',
  'crm.contact_deleted': 'deleted a contact',
  'crm.lead_created': 'added a lead',
  'crm.lead_updated': 'updated a lead',
  'crm.lead_deleted': 'deleted a lead',
  'crm.lead_converted': 'converted a lead',
  'crm.deal_created': 'created a deal',
  'crm.deal_updated': 'updated a deal',
  'crm.deal_deleted': 'deleted a deal',
  'crm.deal_moved': 'moved a deal',
  'crm.activity_created': 'logged a CRM activity',
  'crm.pipeline_created': 'created a pipeline',
  'crm.pipeline_updated': 'renamed a pipeline',
  'crm.pipeline_deleted': 'deleted a pipeline',
  'crm.stage_created': 'added a pipeline stage',
  'crm.stage_updated': 'changed a pipeline stage',
  'crm.stage_deleted': 'removed a pipeline stage',
  'crm.stages_reordered': 'reordered pipeline stages',
  'crm.import': 'imported CRM records',
  'crm.export': 'exported CRM records',
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
