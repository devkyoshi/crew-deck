import type { TenantDb } from '../db/client.js';
import { AppError } from '../lib/errors.js';

/** Numeric limits. A missing key means unlimited. Keys match docs/PRICING.md. */
export const LIMIT_KEYS = [
  'seats',
  'spaces',
  'crm_records',
  'pipelines',
  'storage_mb',
  'audit_days',
  'sites',
  'work_items',
  'max_attachment_mb',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Feature switches. Keys match docs/FEATURES.md. */
export const FEATURE_KEYS = [
  'attendance_export',
  'crm_io',
  'domain_lock',
  'space_audit',
  'branding_name',
  'branding_full',
  'scrum_sprints',
  'shared_filters',
  'burndown_reports',
  'releases',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface EffectivePlan {
  /** NULL for internal workspaces that have no plan and no limits. */
  key: string | null;
  name: string;
  onTrial: boolean;
  trialEndsAt: Date | null;
  limits: Partial<Record<LimitKey, number>>;
  features: FeatureKey[];
}

const ALL_FEATURES = [...FEATURE_KEYS];

/**
 * The plan a workspace is on right now. A trial that has ended counts as Free even before the hourly
 * job has recorded the change, so nobody keeps paid features by timing.
 */
export async function loadPlan(
  t: TenantDb,
  _orgId?: string,
  now = new Date(),
): Promise<EffectivePlan> {
  const org = await t.organization();
  if (!org || org.planKey === null) {
    return {
      key: null,
      name: 'Internal',
      onTrial: false,
      trialEndsAt: null,
      limits: {},
      features: ALL_FEATURES,
    };
  }
  let plan = await t.planByKey(org.planKey);
  let key = org.planKey;
  const ended = org.onTrial && org.trialEndsAt !== null && org.trialEndsAt <= now;
  if (ended) {
    plan = await t.planByKey('free');
    key = 'free';
  }
  const limits = plan?.limits ?? {};
  const merged: Partial<Record<LimitKey, number>> = {};
  for (const k of LIMIT_KEYS) {
    const base = limits[k];
    const override = ended ? undefined : (org.limitOverrides as Record<string, number | null>)?.[k];
    // An override of null lifts the limit; a number replaces it.
    const v = override === undefined ? base : override;
    if (typeof v === 'number') merged[k] = v;
  }
  return {
    key,
    name: plan?.name ?? key,
    onTrial: org.onTrial && !ended,
    trialEndsAt: org.trialEndsAt,
    limits: merged,
    features: (plan?.features ?? []).filter((f): f is FeatureKey =>
      (FEATURE_KEYS as readonly string[]).includes(f),
    ),
  };
}

export const hasFeature = (plan: EffectivePlan, f: FeatureKey) => plan.features.includes(f);

const upgradeHint = (plan: EffectivePlan) =>
  plan.key === 'business' || plan.key === 'enterprise' || plan.key === null
    ? 'Contact us to raise this limit.'
    : 'Upgrade your plan to unlock this.';

/** Thrown when a feature is not part of the plan. The UI turns this into an upgrade prompt. */
export function assertFeature(plan: EffectivePlan, f: FeatureKey, what: string) {
  if (hasFeature(plan, f)) return;
  throw new AppError(
    402,
    'feature_locked',
    `${what} is not included in the ${plan.name} plan. ${upgradeHint(plan)}`,
    { feature: f, plan: plan.key ?? '' },
  );
}

const LIMIT_WORDS: Record<LimitKey, string> = {
  seats: 'people',
  spaces: 'spaces',
  crm_records: 'CRM records',
  pipelines: 'pipelines',
  storage_mb: 'MB of storage',
  audit_days: 'days of audit history',
  sites: 'sites',
  work_items: 'work items',
  max_attachment_mb: 'MB per attachment',
};

/** Throws when adding `adding` more would pass the plan's limit. Existing data is never touched. */
export function assertWithinLimit(plan: EffectivePlan, key: LimitKey, current: number, adding = 1) {
  const max = plan.limits[key];
  if (max === undefined || current + adding <= max) return;
  throw new AppError(
    402,
    'plan_limit',
    `The ${plan.name} plan allows up to ${max} ${LIMIT_WORDS[key]}. ${upgradeHint(plan)}`,
    { limit: key, plan: plan.key ?? '' },
  );
}

// ---- Usage ---------------------------------------------------------------------------------------------

/** Active members plus invitations still waiting, so invitations cannot dodge the seat limit. */
export async function countSeats(t: TenantDb, _orgId?: string) {
  const members = await t.memberships.count({ status: 'active' });
  const pending = await t.invitations.count({
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return members + pending;
}

export const countSpaces = (t: TenantDb, _orgId?: string) => t.spaces.count({ deletedAt: null });

export async function countCrmRecords(t: TenantDb, _orgId?: string) {
  const live = { deletedAt: null };
  const counts = await Promise.all([
    t.crmCompanies.count(live),
    t.crmContacts.count(live),
    t.crmLeads.count(live),
    t.crmDeals.count(live),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

export const countPipelines = (t: TenantDb, _orgId?: string) => t.crmPipelines.count();

export const countSites = (t: TenantDb, _orgId?: string) => t.sites.count();

/** Work items that are not deleted, across every space. Deleted items never count toward the limit. */
export const countWorkItems = (t: TenantDb, _orgId?: string) =>
  t.workItems.count({ deletedAt: null });

/** Bytes of attachments the workspace keeps. */
export async function storageBytes(t: TenantDb) {
  const [row] = await t.attachments.aggregate<{ total: number }>([
    { $group: { _id: null, total: { $sum: '$size' } } },
  ]);
  return row?.total ?? 0;
}

export type Usage = Partial<Record<LimitKey, number>>;

export async function loadUsage(tx: TenantDb, orgId: string): Promise<Usage> {
  return {
    seats: await countSeats(tx, orgId),
    spaces: await countSpaces(tx, orgId),
    crm_records: await countCrmRecords(tx, orgId),
    pipelines: await countPipelines(tx, orgId),
    sites: await countSites(tx, orgId),
    work_items: await countWorkItems(tx, orgId),
    storage_mb: Math.ceil((await storageBytes(tx)) / (1024 * 1024)),
  };
}

/** Oldest audit entry a plan may show, or null for full history. */
export function auditFloor(plan: EffectivePlan, now = new Date()): Date | null {
  const days = plan.limits.audit_days;
  return days === undefined ? null : new Date(now.getTime() - days * 86_400_000);
}
