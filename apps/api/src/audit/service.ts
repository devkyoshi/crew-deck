import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { auditLogs, users } from '../db/schema.js';
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

/** Writes inside the caller's tenant transaction, so the change and its audit entry commit together. */
export async function writeAudit(tx: Tx, e: AuditEntry) {
  await tx.insert(auditLogs).values({
    orgId: e.orgId,
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
export async function listAudit(tx: Tx, f: AuditFilters) {
  const conds: (SQL | undefined)[] = [eq(auditLogs.orgId, f.orgId)];
  if (f.actor) conds.push(eq(auditLogs.actorId, f.actor));
  if (f.action) conds.push(eq(auditLogs.action, f.action));
  if (f.targetType) conds.push(eq(auditLogs.targetType, f.targetType));
  if (f.target) conds.push(eq(auditLogs.targetId, f.target));
  if (f.from) conds.push(gte(auditLogs.createdAt, f.from));
  // "to" is a date: include the whole day.
  if (f.to) conds.push(lt(auditLogs.createdAt, new Date(f.to.getTime() + 24 * 3600 * 1000)));
  const where = and(...conds);

  const items = await tx
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(f.pageSize)
    .offset(offsetOf(f));
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);
  return { items, total: count?.n ?? 0, page: f.page, pageSize: f.pageSize };
}
