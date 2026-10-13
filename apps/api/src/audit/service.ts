import type { Tx } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  orgId: string;
  actorId: string | null;
  action: string;
  targetType: 'member' | 'invitation';
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
