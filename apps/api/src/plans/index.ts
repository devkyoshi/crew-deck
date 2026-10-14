import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import {
  crmCompanies,
  crmContacts,
  crmDeals,
  crmLeads,
  crmPipelines,
  invitations,
  memberships,
  sites,
  spaces,
} from '../db/schema.js';
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

type PlanRow = {
  plan_key: string | null;
  on_trial: boolean;
  trial_ends_at: Date | null;
  limit_overrides: Record<string, number | null>;
  plan_name: string | null;
  limits: Record<string, number> | null;
  features: string[] | null;
};

const ALL_FEATURES = [...FEATURE_KEYS];

/**
 * The plan a workspace is on right now. A trial that has ended counts as Free even before the daily
 * job has recorded the change, so nobody keeps paid features by timing.
 */
export async function loadPlan(tx: Tx, orgId: string, now = new Date()): Promise<EffectivePlan> {
  const rows = await tx.execute<PlanRow>(sql`select * from plan_for_org(${orgId})`);
  const row = rows[0];
  if (!row || row.plan_key === null) {
    return {
      key: null,
      name: 'Internal',
      onTrial: false,
      trialEndsAt: null,
      limits: {},
      features: ALL_FEATURES,
    };
  }
  let { plan_name: name, limits, features } = row;
  let key = row.plan_key;
  const ended = row.on_trial && row.trial_ends_at !== null && new Date(row.trial_ends_at) <= now;
  if (ended) {
    const free = await tx.execute<{
      name: string;
      limits: Record<string, number>;
      features: string[];
    }>(sql`select name, limits, features from plans where key = 'free'`);
    key = 'free';
    name = free[0]?.name ?? 'Free';
    limits = free[0]?.limits ?? {};
    features = free[0]?.features ?? [];
  }
  const merged: Partial<Record<LimitKey, number>> = {};
  for (const k of LIMIT_KEYS) {
    const base = limits?.[k];
    const override = ended ? undefined : row.limit_overrides?.[k];
    // An override of null lifts the limit; a number replaces it.
    const v = override === undefined ? base : override;
    if (typeof v === 'number') merged[k] = v;
  }
  return {
    key,
    name: name ?? key,
    onTrial: row.on_trial && !ended,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    limits: merged,
    features: (features ?? []).filter((f): f is FeatureKey =>
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

const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

/** Active members plus invitations still waiting, so invitations cannot dodge the seat limit. */
export async function countSeats(tx: Tx, orgId: string) {
  const members = await count(
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'active'))),
  );
  const pending = await count(
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invitations)
      .where(
        and(
          eq(invitations.orgId, orgId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
  );
  return members + pending;
}

export const countSpaces = (tx: Tx, orgId: string) =>
  count(
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(spaces)
      .where(and(eq(spaces.orgId, orgId), isNull(spaces.deletedAt))),
  );

export async function countCrmRecords(tx: Tx, orgId: string) {
  let total = 0;
  for (const t of [crmCompanies, crmContacts, crmLeads, crmDeals]) {
    total += await count(
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(t)
        .where(and(eq(t.orgId, orgId), isNull(t.deletedAt))),
    );
  }
  return total;
}

export const countPipelines = (tx: Tx, orgId: string) =>
  count(
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(crmPipelines)
      .where(eq(crmPipelines.orgId, orgId)),
  );

export const countSites = (tx: Tx, orgId: string) =>
  count(
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sites)
      .where(eq(sites.orgId, orgId)),
  );

export type Usage = Partial<Record<LimitKey, number>>;

export async function loadUsage(tx: Tx, orgId: string): Promise<Usage> {
  return {
    seats: await countSeats(tx, orgId),
    spaces: await countSpaces(tx, orgId),
    crm_records: await countCrmRecords(tx, orgId),
    pipelines: await countPipelines(tx, orgId),
    sites: await countSites(tx, orgId),
    // No file storage exists yet; the limit is wired in so it is ready when uploads arrive.
    storage_mb: 0,
  };
}

/** Oldest audit entry a plan may show, or null for full history. */
export function auditFloor(plan: EffectivePlan, now = new Date()): Date | null {
  const days = plan.limits.audit_days;
  return days === undefined ? null : new Date(now.getTime() - days * 86_400_000);
}
