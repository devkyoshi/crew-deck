import type { Db } from './client.js';
import type { PlanDoc } from './types.js';

/**
 * The plans every deployment ships with (docs/PRICING.md). The old SQL migrations inserted these rows;
 * with MongoDB they are upserted at startup, so they are always present and current.
 * `limits` holds numbers (a missing key means unlimited); `features` holds the keys in docs/FEATURES.md.
 */
export const PLANS: PlanDoc[] = [
  {
    key: 'free',
    name: 'Free',
    sort: 1,
    priceCents: 0,
    public: true,
    limits: {
      seats: 5,
      spaces: 3,
      crm_records: 500,
      pipelines: 1,
      storage_mb: 100,
      audit_days: 30,
      sites: 1,
      work_items: 250,
      max_attachment_mb: 5,
    },
    features: [],
  },
  {
    key: 'team',
    name: 'Team',
    sort: 2,
    priceCents: 600,
    public: true,
    limits: { seats: 50, pipelines: 3, storage_mb: 5120, audit_days: 365, max_attachment_mb: 25 },
    features: [
      'attendance_export',
      'crm_io',
      'domain_lock',
      'branding_name',
      'scrum_sprints',
      'shared_filters',
    ],
  },
  {
    key: 'business',
    name: 'Business',
    sort: 3,
    priceCents: 1200,
    public: true,
    limits: { storage_mb: 51200, max_attachment_mb: 100 },
    features: [
      'attendance_export',
      'crm_io',
      'domain_lock',
      'space_audit',
      'branding_name',
      'branding_full',
      'scrum_sprints',
      'shared_filters',
      'burndown_reports',
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    sort: 4,
    priceCents: null,
    public: false,
    limits: {},
    features: [
      'attendance_export',
      'crm_io',
      'domain_lock',
      'space_audit',
      'branding_name',
      'branding_full',
      'scrum_sprints',
      'shared_filters',
      'burndown_reports',
    ],
  },
];

/** Keeps the plan catalogue current. Idempotent. */
export async function ensurePlans(db: Db) {
  for (const p of PLANS) {
    const { key, ...rest } = p;
    await db.global.plans.upsert({ key }, rest);
  }
}
