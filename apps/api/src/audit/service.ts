import type { TenantDb } from '../db/client.js';
import { offsetOf } from '../lib/pagination.js';

export const AUDIT_TARGET_TYPES = [
  'member',
  'invitation',
  'group',
  'space',
  'work_day',
  'settings',
  'site',
  'holiday',
  'crm_company',
  'crm_contact',
  'crm_lead',
  'crm_deal',
  'crm_pipeline',
  'crm_import',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Appends an audit entry. Pass the transaction's TenantDb so the change and its entry commit together.
 * The audit log is append-only: repositories expose insert here and nothing in the app updates or deletes it.
 */
export async function writeAudit(t: TenantDb, e: AuditEntry) {
  await t.auditLogs.insert({
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    before: e.before ?? null,
    after: e.after ?? null,
  });
}

export interface AuditFilters {
  orgId: string;
  actor?: string;
  action?: string;
  targetType?: AuditTargetType;
  target?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/** One query for the org-wide and per-space audit views. Always scoped to the tenant. */
export async function listAudit(t: TenantDb, f: AuditFilters) {
  const filter: Record<string, unknown> = {};
  if (f.actor) filter.actorId = f.actor;
  if (f.action) filter.action = f.action;
  if (f.targetType) filter.targetType = f.targetType;
  if (f.target) filter.targetId = f.target;
  const range: Record<string, Date> = {};
  if (f.from) range.$gte = f.from;
  // "to" is a date: include the whole day.
  if (f.to) range.$lt = new Date(f.to.getTime() + 24 * 3600 * 1000);
  if (f.from || f.to) filter.createdAt = range;

  const rows = await t.auditLogs.find(filter, {
    sort: { createdAt: -1, id: -1 },
    skip: offsetOf(f),
    limit: f.pageSize,
  });
  const total = await t.auditLogs.count(filter);
  const people = await t.users(rows.map((r) => r.actorId).filter((x): x is string => !!x));
  const items = rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    before: r.before,
    after: r.after,
    createdAt: r.createdAt,
    actorId: r.actorId,
    actorName: r.actorId ? (people.get(r.actorId)?.name ?? null) : null,
    actorEmail: r.actorId ? (people.get(r.actorId)?.email ?? null) : null,
  }));
  return { items, total, page: f.page, pageSize: f.pageSize };
}
