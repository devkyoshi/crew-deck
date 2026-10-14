import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadSettings } from '../checkin/service.js';
import type { Tx } from '../db/client.js';
import {
  crmPipelines,
  crmRecordTags,
  crmStages,
  crmTags,
  memberships,
  users,
  type CrmRecordType,
} from '../db/schema.js';
import { AppError, forbidden } from '../lib/errors.js';
import { can, type Action, type Actor } from '../permissions/can.js';

export const TAG_COLORS = ['blue', 'orange', 'pink', 'green', 'violet', 'amber'] as const;
export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.union([z.literal(''), z.string().email()]))
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();
export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, for example USD');

/** Every CRM route starts here: the module must be on for the workspace, and the caller needs the role. */
export async function crmGuard(tx: Tx, actor: Actor, need: 'view' | 'edit' | 'admin') {
  const settings = await loadSettings(tx, actor.orgId);
  if (!settings.crmEnabled) {
    throw new AppError(404, 'module_disabled', 'The CRM is switched off for this workspace');
  }
  if (!can(actor, `crm.${need}` as Action)) throw forbidden();
  return settings;
}

/** An owner or assignee must be an active member of the workspace (or empty). */
export async function assertActiveMember(
  tx: Tx,
  orgId: string,
  userId: string | null | undefined,
  field = 'ownerId',
) {
  if (!userId) return;
  const [m] = await tx
    .select({ status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  if (!m || m.status !== 'active') {
    throw new AppError(400, 'validation_error', 'That person is not an active member', {
      [field]: 'Choose an active member',
    });
  }
}

export type TagView = { id: string; name: string; color: string };

/** Tags for a set of records of one type, keyed by record id. */
export async function loadTags(tx: Tx, orgId: string, type: CrmRecordType, ids: string[]) {
  const out = new Map<string, TagView[]>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select({
      recordId: crmRecordTags.recordId,
      id: crmTags.id,
      name: crmTags.name,
      color: crmTags.color,
    })
    .from(crmRecordTags)
    .innerJoin(
      crmTags,
      and(eq(crmTags.id, crmRecordTags.tagId), eq(crmTags.orgId, crmRecordTags.orgId)),
    )
    .where(
      and(
        eq(crmRecordTags.orgId, orgId),
        eq(crmRecordTags.recordType, type),
        inArray(crmRecordTags.recordId, ids),
      ),
    )
    .orderBy(asc(sql`lower(${crmTags.name})`));
  for (const r of rows) {
    const list = out.get(r.recordId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    out.set(r.recordId, list);
  }
  return out;
}

/** Replaces a record's tags. Every tag must exist in the workspace. */
export async function setTags(
  tx: Tx,
  orgId: string,
  type: CrmRecordType,
  recordId: string,
  tagIds: string[],
) {
  const wanted = [...new Set(tagIds)];
  if (wanted.length) {
    const found = await tx
      .select({ id: crmTags.id })
      .from(crmTags)
      .where(and(eq(crmTags.orgId, orgId), inArray(crmTags.id, wanted)));
    if (found.length !== wanted.length) {
      throw new AppError(400, 'validation_error', 'One of the tags does not exist', {
        tagIds: 'Unknown tag',
      });
    }
  }
  await tx
    .delete(crmRecordTags)
    .where(
      and(
        eq(crmRecordTags.orgId, orgId),
        eq(crmRecordTags.recordType, type),
        eq(crmRecordTags.recordId, recordId),
      ),
    );
  if (wanted.length) {
    await tx
      .insert(crmRecordTags)
      .values(wanted.map((tagId) => ({ orgId, tagId, recordType: type, recordId })));
  }
}

export const DEFAULT_STAGES = [
  { name: 'Prospecting', probability: 10, isWon: false, isLost: false },
  { name: 'Qualified', probability: 25, isWon: false, isLost: false },
  { name: 'Proposal', probability: 50, isWon: false, isLost: false },
  { name: 'Negotiation', probability: 75, isWon: false, isLost: false },
  { name: 'Won', probability: 100, isWon: true, isLost: false },
  { name: 'Lost', probability: 0, isWon: false, isLost: true },
];

/** The workspace's default pipeline, created with the standard stages the first time it is needed. */
export async function ensureDefaultPipeline(tx: Tx, orgId: string) {
  const [existing] = await tx
    .select()
    .from(crmPipelines)
    .where(and(eq(crmPipelines.orgId, orgId), eq(crmPipelines.isDefault, true)));
  if (existing) return existing;
  // The partial unique index makes a concurrent first use safe: the loser's insert does nothing.
  await tx
    .insert(crmPipelines)
    .values({ orgId, name: 'Sales pipeline', isDefault: true })
    .onConflictDoNothing();
  const [pipeline] = await tx
    .select()
    .from(crmPipelines)
    .where(and(eq(crmPipelines.orgId, orgId), eq(crmPipelines.isDefault, true)));
  const have = await tx
    .select({ id: crmStages.id })
    .from(crmStages)
    .where(and(eq(crmStages.orgId, orgId), eq(crmStages.pipelineId, pipeline!.id)))
    .limit(1);
  if (have.length === 0) {
    await tx
      .insert(crmStages)
      .values(
        DEFAULT_STAGES.map((s, i) => ({ ...s, orgId, pipelineId: pipeline!.id, position: i + 1 })),
      );
  }
  return pipeline!;
}

export const likeEscape = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Spreadsheet cells that start with these characters can run as formulas when opened. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const BOM = String.fromCharCode(0xfeff);

export async function ownerLabel(tx: Tx, userId: string | null) {
  if (!userId) return null;
  const [u] = await tx
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return u ? (u.name ?? u.email) : null;
}
