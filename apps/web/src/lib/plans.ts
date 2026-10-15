import { useMe } from '@/components/shell/me-context';

/** Keys match docs/FEATURES.md and docs/PRICING.md and the API's plans module. */
export type FeatureKey =
  | 'attendance_export'
  | 'crm_io'
  | 'domain_lock'
  | 'space_audit'
  | 'branding_name'
  | 'branding_full'
  | 'scrum_sprints'
  | 'shared_filters'
  | 'burndown_reports';

export type LimitKey =
  | 'seats'
  | 'spaces'
  | 'crm_records'
  | 'pipelines'
  | 'storage_mb'
  | 'audit_days'
  | 'sites'
  | 'work_items'
  | 'max_attachment_mb';

export interface PlanInfo {
  key: string;
  name: string;
  priceCents: number | null;
  limits: Partial<Record<LimitKey, number>>;
  features: string[];
}

export interface PlanState {
  plan: {
    key: string | null;
    name: string;
    onTrial: boolean;
    trialEndsAt: string | null;
    limits: Partial<Record<LimitKey, number>>;
    features: string[];
  };
  usage: Partial<Record<LimitKey, number>> | null;
  plans: PlanInfo[];
}

/** What the signed-in workspace's plan includes, for showing or hiding paid features. */
export function useHasFeature(key: FeatureKey) {
  return useMe().plan.features.includes(key);
}

export const LIMIT_LABEL: Record<LimitKey, string> = {
  seats: 'People',
  spaces: 'Spaces',
  crm_records: 'CRM records',
  pipelines: 'CRM pipelines',
  storage_mb: 'Storage',
  audit_days: 'Audit log history',
  sites: 'Sites',
  work_items: 'Work items',
  max_attachment_mb: 'Attachment size',
};

export function formatLimit(key: LimitKey, value: number | undefined) {
  if (value === undefined) return 'Unlimited';
  if (key === 'max_attachment_mb') return `${value} MB`;
  if (key === 'storage_mb') return value >= 1024 ? `${value / 1024} GB` : `${value} MB`;
  if (key === 'audit_days')
    return value >= 365 ? `${Math.round(value / 365)} year` : `${value} days`;
  return String(value);
}

export function formatPrice(cents: number | null) {
  if (cents === null) return 'Contact us';
  if (cents === 0) return '$0';
  return `$${cents / 100}`;
}

/** The rows of the plan comparison, in the order shown on the pricing page. */
export const COMPARISON: { label: string; value: (p: PlanInfo) => string }[] = [
  { label: 'People', value: (p) => formatLimit('seats', p.limits.seats) },
  { label: 'Spaces', value: (p) => formatLimit('spaces', p.limits.spaces) },
  {
    label: 'Work items on boards',
    value: (p) =>
      p.limits.work_items === undefined ? 'Unlimited' : `Up to ${p.limits.work_items} items`,
  },
  { label: 'Storage', value: (p) => formatLimit('storage_mb', p.limits.storage_mb) },
  { label: 'Attachment size', value: (p) => formatLimit('max_attachment_mb', p.limits.max_attachment_mb) },
  { label: 'Kanban boards, list view, epics and search', value: () => 'Included' },
  {
    label: 'Scrum backlog and sprints',
    value: (p) => (p.features.includes('scrum_sprints') ? 'Included' : 'Not included'),
  },
  {
    label: 'Burndown and sprint reports',
    value: (p) => (p.features.includes('burndown_reports') ? 'Included' : 'Not included'),
  },
  {
    label: 'Saved filters shared with the team',
    value: (p) => (p.features.includes('shared_filters') ? 'Included' : 'Not included'),
  },
  { label: 'Audit log history', value: (p) => formatLimit('audit_days', p.limits.audit_days) },
  { label: 'Members, groups and access requests', value: () => 'Included' },
  { label: 'Google and password sign-in', value: () => 'Included' },
  { label: 'Check-in, team board and my day', value: () => 'Included' },
  {
    label: 'Sites and holidays',
    value: (p) => (p.limits.sites === undefined ? 'Unlimited sites' : `${p.limits.sites} site`),
  },
  {
    label: 'Attendance reports and CSV export',
    value: (p) => (p.features.includes('attendance_export') ? 'Included' : 'Not included'),
  },
  {
    label: 'CRM leads, contacts, companies, deals',
    value: (p) =>
      p.limits.crm_records === undefined
        ? 'Unlimited records'
        : `Up to ${p.limits.crm_records} records`,
  },
  { label: 'CRM pipelines', value: (p) => formatLimit('pipelines', p.limits.pipelines) },
  {
    label: 'CRM CSV import and export',
    value: (p) => (p.features.includes('crm_io') ? 'Included' : 'Not included'),
  },
  {
    label: 'Lock invitations to your email domain',
    value: (p) => (p.features.includes('domain_lock') ? 'Included' : 'Not included'),
  },
  {
    label: 'Per-space audit log',
    value: (p) => (p.features.includes('space_audit') ? 'Included' : 'Not included'),
  },
  {
    label: 'Branding',
    value: (p) =>
      p.features.includes('branding_full')
        ? 'Logo and accent colour'
        : p.features.includes('branding_name')
          ? 'Workspace name'
          : 'Not included',
  },
  {
    label: 'Support',
    value: (p) =>
      ({ free: 'Community', team: 'Email', business: 'Priority' })[p.key] ?? 'Dedicated',
  },
];
