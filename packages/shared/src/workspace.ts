/**
 * What a workspace is for. Chosen at sign-up ("What kind of work do you do?") and refined with the
 * "How does your team plan to use it?" step. Each type maps to a template that sets the enabled
 * modules, the default board columns and the language used for work items.
 *
 * Features marked `planned` are suggested to the team but not built yet; they show as "Coming soon"
 * and are tracked in docs/MISSING-FEATURES.md.
 */

export const WORK_TYPES = [
  'software',
  'product',
  'marketing',
  'design',
  'project_mgmt',
  'operations',
  'it_support',
  'hr',
  'customer_service',
  'legal',
  'finance',
  'sales',
  'data_science',
  'construction',
  'other',
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/** Product modules a workspace can switch on. `members` and `spaces` are always on. */
export const MODULES = ['members', 'spaces', 'checkin', 'crm'] as const;
export type ModuleKey = (typeof MODULES)[number];

export interface UsageOption {
  key: string;
  label: string;
  hint: string;
  /** What backs this option today. 'planned' = not built yet (listed in docs/MISSING-FEATURES.md). */
  status: 'built' | 'partial' | 'planned';
  /** Module switched on when this option is chosen. */
  module?: ModuleKey;
}

export const USAGE_OPTIONS: readonly UsageOption[] = [
  { key: 'manage_tasks', label: 'Manage tasks', hint: 'Boards with statuses, assignees and due dates', status: 'built', module: 'spaces' },
  { key: 'prioritize_work', label: 'Prioritize work', hint: 'Priorities, ranking and filters', status: 'built', module: 'spaces' },
  { key: 'track_bugs', label: 'Track bugs', hint: 'Bug item type with priority and status', status: 'built', module: 'spaces' },
  { key: 'run_sprints', label: 'Run sprints', hint: 'Backlog and sprint planning', status: 'planned' },
  { key: 'work_in_scrum', label: 'Work in scrum', hint: 'Scrum boards and burndown', status: 'planned' },
  { key: 'map_dependencies', label: 'Map work dependencies', hint: 'Link items that block each other', status: 'planned' },
  { key: 'roadmap', label: 'Plan a roadmap', hint: 'Timeline of epics', status: 'planned' },
  { key: 'track_leads', label: 'Track leads and deals', hint: 'Companies, contacts, leads, deal pipeline', status: 'built', module: 'crm' },
  { key: 'log_activities', label: 'Log calls and meetings', hint: 'Activities and notes on CRM records', status: 'built', module: 'crm' },
  { key: 'attendance', label: 'Track attendance', hint: 'Check in and out, sites, holidays', status: 'built', module: 'checkin' },
  { key: 'site_work', label: 'Manage jobs and sites', hint: 'Sites with who is on site today', status: 'built', module: 'checkin' },
  { key: 'plan_campaigns', label: 'Plan campaigns', hint: 'Campaign boards', status: 'built', module: 'spaces' },
  { key: 'content_calendar', label: 'Content calendar', hint: 'Calendar of publish dates', status: 'planned' },
  { key: 'approvals', label: 'Run approvals', hint: 'Request and approve with a trail', status: 'planned' },
  { key: 'service_requests', label: 'Handle requests and tickets', hint: 'Request queue with SLAs', status: 'planned' },
  { key: 'checklists', label: 'Use checklists', hint: 'Onboarding, punch lists and inspections', status: 'planned' },
  { key: 'documents', label: 'Store documents', hint: 'Files and attachments on items', status: 'planned' },
];

export interface StatusTemplate {
  name: string;
  category: 'todo' | 'in_progress' | 'done';
  color: string;
}

export interface WorkspaceTemplate {
  type: WorkType;
  label: string;
  /** Short line shown on the type card. */
  blurb: string;
  /** Usage options pre-checked on the "How will your team use it?" step. */
  suggestedUsage: string[];
  /** Modules enabled on top of the always-on members and spaces. */
  modules: ModuleKey[];
  /** Columns a new space starts with. */
  statuses: StatusTemplate[];
  /** What the team calls an "item" in this kind of work (display only). */
  itemNoun: { singular: string; plural: string };
  boardType: 'kanban' | 'scrum';
  /** Item types offered first when creating work. */
  itemTypes: ('epic' | 'story' | 'task' | 'bug' | 'subtask')[];
}

const S = (name: string, category: StatusTemplate['category'], color: string): StatusTemplate => ({
  name,
  category,
  color,
});

export const DEFAULT_STATUSES: StatusTemplate[] = [
  S('To Do', 'todo', 'slate'),
  S('In Progress', 'in_progress', 'blue'),
  S('In Review', 'in_progress', 'violet'),
  S('Done', 'done', 'green'),
];

const tpl = (t: Omit<WorkspaceTemplate, 'statuses' | 'itemNoun' | 'boardType' | 'itemTypes'> & Partial<WorkspaceTemplate>): WorkspaceTemplate => ({
  statuses: DEFAULT_STATUSES,
  itemNoun: { singular: 'task', plural: 'tasks' },
  boardType: 'kanban',
  itemTypes: ['task', 'story', 'bug', 'epic'],
  ...t,
});

export const WORKSPACE_TEMPLATES: Record<WorkType, WorkspaceTemplate> = {
  software: tpl({
    type: 'software',
    label: 'Software development',
    blurb: 'Plan, track and ship software',
    suggestedUsage: ['run_sprints', 'work_in_scrum', 'prioritize_work', 'track_bugs', 'manage_tasks', 'map_dependencies'],
    modules: [],
    itemNoun: { singular: 'issue', plural: 'issues' },
  }),
  product: tpl({
    type: 'product',
    label: 'Product management',
    blurb: 'Prioritize and plan what to build',
    suggestedUsage: ['prioritize_work', 'roadmap', 'manage_tasks', 'track_bugs'],
    modules: [],
    statuses: [S('Ideas', 'todo', 'slate'), S('Planned', 'todo', 'sky'), S('Building', 'in_progress', 'blue'), S('Shipped', 'done', 'green')],
    itemNoun: { singular: 'initiative', plural: 'initiatives' },
    itemTypes: ['epic', 'story', 'task'],
  }),
  marketing: tpl({
    type: 'marketing',
    label: 'Marketing',
    blurb: 'Plan and run campaigns',
    suggestedUsage: ['plan_campaigns', 'content_calendar', 'manage_tasks', 'approvals'],
    modules: ['crm'],
    statuses: [S('Ideas', 'todo', 'slate'), S('Drafting', 'in_progress', 'blue'), S('Review', 'in_progress', 'amber'), S('Published', 'done', 'green')],
    itemNoun: { singular: 'campaign task', plural: 'campaign tasks' },
    itemTypes: ['epic', 'task'],
  }),
  design: tpl({
    type: 'design',
    label: 'Design',
    blurb: 'Track design requests and reviews',
    suggestedUsage: ['manage_tasks', 'approvals', 'prioritize_work'],
    modules: [],
    statuses: [S('Requested', 'todo', 'slate'), S('Designing', 'in_progress', 'blue'), S('Review', 'in_progress', 'amber'), S('Approved', 'done', 'green')],
    itemNoun: { singular: 'request', plural: 'requests' },
    itemTypes: ['task', 'epic'],
  }),
  project_mgmt: tpl({
    type: 'project_mgmt',
    label: 'Project management',
    blurb: 'Run projects and deadlines',
    suggestedUsage: ['manage_tasks', 'prioritize_work', 'map_dependencies', 'checklists'],
    modules: ['checkin'],
    itemNoun: { singular: 'task', plural: 'tasks' },
    itemTypes: ['epic', 'task', 'bug'],
  }),
  operations: tpl({
    type: 'operations',
    label: 'Operations',
    blurb: 'Keep the business running',
    suggestedUsage: ['manage_tasks', 'attendance', 'checklists', 'approvals'],
    modules: ['checkin'],
    statuses: [S('Backlog', 'todo', 'slate'), S('Doing', 'in_progress', 'blue'), S('Blocked', 'in_progress', 'red'), S('Done', 'done', 'green')],
    itemNoun: { singular: 'task', plural: 'tasks' },
    itemTypes: ['task', 'bug'],
  }),
  it_support: tpl({
    type: 'it_support',
    label: 'IT support',
    blurb: 'Handle requests and incidents',
    suggestedUsage: ['service_requests', 'track_bugs', 'prioritize_work'],
    modules: [],
    statuses: [S('Open', 'todo', 'slate'), S('In Progress', 'in_progress', 'blue'), S('Waiting', 'in_progress', 'amber'), S('Resolved', 'done', 'green')],
    itemNoun: { singular: 'ticket', plural: 'tickets' },
    itemTypes: ['bug', 'task'],
  }),
  hr: tpl({
    type: 'hr',
    label: 'Human resources',
    blurb: 'People operations and onboarding',
    suggestedUsage: ['checklists', 'attendance', 'approvals', 'manage_tasks'],
    modules: ['checkin'],
    statuses: [S('To Do', 'todo', 'slate'), S('In Progress', 'in_progress', 'blue'), S('Waiting on person', 'in_progress', 'amber'), S('Done', 'done', 'green')],
    itemNoun: { singular: 'task', plural: 'tasks' },
    itemTypes: ['task'],
  }),
  customer_service: tpl({
    type: 'customer_service',
    label: 'Customer service',
    blurb: 'Answer and resolve customer issues',
    suggestedUsage: ['service_requests', 'track_leads', 'log_activities'],
    modules: ['crm'],
    statuses: [S('New', 'todo', 'slate'), S('Working', 'in_progress', 'blue'), S('Waiting on customer', 'in_progress', 'amber'), S('Resolved', 'done', 'green')],
    itemNoun: { singular: 'case', plural: 'cases' },
    itemTypes: ['task', 'bug'],
  }),
  legal: tpl({
    type: 'legal',
    label: 'Legal',
    blurb: 'Track matters and reviews',
    suggestedUsage: ['approvals', 'documents', 'manage_tasks'],
    modules: [],
    statuses: [S('Intake', 'todo', 'slate'), S('In Review', 'in_progress', 'blue'), S('With counterparty', 'in_progress', 'amber'), S('Signed', 'done', 'green')],
    itemNoun: { singular: 'matter', plural: 'matters' },
    itemTypes: ['task', 'epic'],
  }),
  finance: tpl({
    type: 'finance',
    label: 'Finance',
    blurb: 'Close the books and approve spend',
    suggestedUsage: ['approvals', 'checklists', 'manage_tasks'],
    modules: [],
    statuses: [S('Requested', 'todo', 'slate'), S('Reviewing', 'in_progress', 'blue'), S('Approved', 'in_progress', 'green'), S('Paid', 'done', 'teal')],
    itemNoun: { singular: 'request', plural: 'requests' },
    itemTypes: ['task'],
  }),
  sales: tpl({
    type: 'sales',
    label: 'Sales',
    blurb: 'Leads, deals and follow-ups',
    suggestedUsage: ['track_leads', 'log_activities', 'manage_tasks'],
    modules: ['crm'],
    statuses: [S('To Do', 'todo', 'slate'), S('Following up', 'in_progress', 'blue'), S('Done', 'done', 'green')],
    itemNoun: { singular: 'task', plural: 'tasks' },
    itemTypes: ['task'],
  }),
  data_science: tpl({
    type: 'data_science',
    label: 'Data science',
    blurb: 'Experiments and analyses',
    suggestedUsage: ['manage_tasks', 'prioritize_work', 'documents'],
    modules: [],
    statuses: [S('Backlog', 'todo', 'slate'), S('Exploring', 'in_progress', 'blue'), S('Validating', 'in_progress', 'amber'), S('Shipped', 'done', 'green')],
    itemNoun: { singular: 'experiment', plural: 'experiments' },
    itemTypes: ['epic', 'task', 'bug'],
  }),
  construction: tpl({
    type: 'construction',
    label: 'Construction',
    blurb: 'Jobs, sites and crews',
    suggestedUsage: ['site_work', 'attendance', 'checklists', 'manage_tasks'],
    modules: ['checkin'],
    statuses: [S('Planned', 'todo', 'slate'), S('On site', 'in_progress', 'blue'), S('Inspection', 'in_progress', 'amber'), S('Complete', 'done', 'green')],
    itemNoun: { singular: 'job', plural: 'jobs' },
    itemTypes: ['epic', 'task', 'bug'],
  }),
  other: tpl({
    type: 'other',
    label: 'Other',
    blurb: 'Something else',
    suggestedUsage: ['manage_tasks', 'prioritize_work'],
    modules: [],
  }),
};

export const isWorkType = (v: unknown): v is WorkType =>
  typeof v === 'string' && (WORK_TYPES as readonly string[]).includes(v);

/** Modules for a workspace: the template's, plus any module implied by the usage the team chose. */
export function modulesFor(type: WorkType, usage: readonly string[]): ModuleKey[] {
  // Check-in (who is where today) is on for every workspace, as it was before templates existed.
  const out = new Set<ModuleKey>(['members', 'spaces', 'checkin', ...WORKSPACE_TEMPLATES[type].modules]);
  for (const key of usage) {
    const m = USAGE_OPTIONS.find((o) => o.key === key)?.module;
    if (m) out.add(m);
  }
  return MODULES.filter((m) => out.has(m));
}

export const USAGE_KEYS = USAGE_OPTIONS.map((o) => o.key);
