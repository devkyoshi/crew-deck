import { z } from 'zod';
import { loadSettings } from '../checkin/service.js';
import type { TenantDb } from '../db/client.js';
import type { CrmPipelineDoc, CrmRecordType } from '../db/types.js';
import { AppError, forbidden } from '../lib/errors.js';
import { assertWithinLimit, countCrmRecords, loadPlan } from '../plans/index.js';
import { can, type Action, type Actor } from '../permissions/can.js';

export type { CrmRecordType };

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
export async function crmGuard(tx: TenantDb, actor: Actor, need: 'view' | 'edit' | 'admin') {
  const settings = await loadSettings(tx, actor.orgId);
  if (!settings.crmEnabled) {
    throw new AppError(404, 'module_disabled', 'The CRM is switched off for this workspace');
  }
  if (!can(actor, `crm.${need}` as Action)) throw forbidden();
  return settings;
}

/** An owner or assignee must be an active member of the workspace (or empty). */
export async function assertActiveMember(
  tx: TenantDb,
  _orgId: string,
  userId: string | null | undefined,
  field = 'ownerId',
) {
  if (!userId) return;
  const m = await tx.memberships.findOne({ userId });
  if (!m || m.status !== 'active') {
    throw new AppError(400, 'validation_error', 'That person is not an active member', {
      [field]: 'Choose an active member',
    });
  }
}

export type TagView = { id: string; name: string; color: string };

/** Tags for a set of records of one type, keyed by record id. */
export async function loadTags(tx: TenantDb, _orgId: string, type: CrmRecordType, ids: string[]) {
  const out = new Map<string, TagView[]>();
  if (ids.length === 0) return out;
  const links = await tx.crmRecordTags.find({ recordType: type, recordId: { $in: ids } });
  const tags = await tx.crmTags.find({ id: { $in: [...new Set(links.map((l) => l.tagId))] } });
  const byId = new Map(tags.map((t) => [t.id, t]));
  for (const l of links) {
    const t = byId.get(l.tagId);
    if (!t) continue;
    const list = out.get(l.recordId) ?? [];
    list.push({ id: t.id, name: t.name, color: t.color });
    out.set(l.recordId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

/** Ids of records of one type that carry a tag (for the "filter by tag" query). */
export async function recordIdsWithTag(tx: TenantDb, type: CrmRecordType, tagId: string) {
  const links = await tx.crmRecordTags.find({ recordType: type, tagId });
  return links.map((l) => l.recordId);
}

/** Replaces a record's tags. Every tag must exist in the workspace. */
export async function setTags(
  tx: TenantDb,
  _orgId: string,
  type: CrmRecordType,
  recordId: string,
  tagIds: string[],
) {
  const wanted = [...new Set(tagIds)];
  if (wanted.length) {
    const found = await tx.crmTags.count({ id: { $in: wanted } });
    if (found !== wanted.length) {
      throw new AppError(400, 'validation_error', 'One of the tags does not exist', {
        tagIds: 'Unknown tag',
      });
    }
  }
  await tx.crmRecordTags.deleteMany({ recordType: type, recordId });
  if (wanted.length) {
    await tx.crmRecordTags.insert(wanted.map((tagId) => ({ tagId, recordType: type, recordId })));
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
export async function ensureDefaultPipeline(tx: TenantDb, _orgId?: string): Promise<CrmPipelineDoc> {
  const existing = await tx.crmPipelines.findOne({ isDefault: true });
  if (existing) return existing;
  // The partial unique index makes a concurrent first use safe: the loser's insert does nothing.
  await tx.crmPipelines.insertIgnore({ name: 'Sales pipeline', isDefault: true });
  const pipeline = (await tx.crmPipelines.findOne({ isDefault: true }))!;
  if (!(await tx.crmStages.exists({ pipelineId: pipeline.id }))) {
    await tx.crmStages.insert(
      DEFAULT_STAGES.map((s, i) => ({ ...s, pipelineId: pipeline.id, position: i + 1 })),
    );
  }
  return pipeline;
}

/** Spreadsheet cells that start with these characters can run as formulas when opened. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const BOM = String.fromCharCode(0xfeff);

/** Display names ("name or email") for a set of owners, keyed by user id. */
export async function ownerNames(tx: TenantDb, ids: (string | null | undefined)[]) {
  const people = await tx.users(ids.filter((x): x is string => !!x));
  return new Map([...people].map(([id, u]) => [id, u.name ?? u.email]));
}

export async function ownerLabel(tx: TenantDb, userId: string | null) {
  if (!userId) return null;
  return (await ownerNames(tx, [userId])).get(userId) ?? null;
}

/** Creating `adding` more CRM records must fit the plan's record limit. */
export async function crmCapacity(tx: TenantDb, orgId: string, adding = 1) {
  if (adding <= 0) return;
  assertWithinLimit(
    await loadPlan(tx, orgId),
    'crm_records',
    await countCrmRecords(tx, orgId),
    adding,
  );
}
