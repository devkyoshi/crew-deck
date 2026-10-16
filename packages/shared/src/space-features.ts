import type { BoardType } from './index';

/**
 * What a space switches on beyond the basics. Every space has a board, list, documents, reports,
 * members and settings; these are the parts a team may or may not want.
 */
export const SPACE_FEATURES = ['sprints', 'epics', 'releases', 'roadmap', 'calendar', 'tickets'] as const;
export type SpaceFeature = (typeof SPACE_FEATURES)[number];

export const isSpaceFeature = (v: unknown): v is SpaceFeature =>
  typeof v === 'string' && (SPACE_FEATURES as readonly string[]).includes(v);

export interface FeatureInfo {
  key: SpaceFeature;
  label: string;
  hint: string;
  /** Plan feature it needs before it can be switched on (see FEATURE_KEYS in the API's plans module). */
  plan?: 'scrum_sprints' | 'service_desk';
}

export interface FeatureGroup {
  id: string;
  label: string;
  hint: string;
  features: FeatureInfo[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'delivery',
    label: 'Delivery',
    hint: 'Plan and ship work in iterations',
    features: [
      { key: 'sprints', label: 'Backlog and sprints', hint: 'Plan sprints from a backlog, with burndown and velocity', plan: 'scrum_sprints' },
      { key: 'epics', label: 'Epics', hint: 'Group stories and tasks under bigger goals' },
      { key: 'releases', label: 'Releases', hint: 'Versions, release notes and components' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    hint: 'See work over time',
    features: [
      { key: 'roadmap', label: 'Roadmap', hint: 'A timeline of epics you can drag to reschedule' },
      { key: 'calendar', label: 'Calendar', hint: 'Work by due date and release date' },
    ],
  },
  {
    id: 'support',
    label: 'Support and QA',
    hint: 'Take requests and work them against deadlines',
    features: [
      { key: 'tickets', label: 'Tickets', hint: 'A request queue anyone can raise into, with response and resolve deadlines', plan: 'service_desk' },
    ],
  },
];

export const FEATURE_INFO: Record<SpaceFeature, FeatureInfo> = Object.fromEntries(
  FEATURE_GROUPS.flatMap((g) => g.features).map((f) => [f.key, f]),
) as Record<SpaceFeature, FeatureInfo>;

export interface FeaturePreset {
  id: string;
  label: string;
  hint: string;
  features: SpaceFeature[];
}

export const FEATURE_PRESETS: FeaturePreset[] = [
  { id: 'simple', label: 'Simple board', hint: 'Just a board and a list', features: [] },
  {
    id: 'software',
    label: 'Software delivery',
    hint: 'Sprints, epics, releases and a roadmap',
    features: ['sprints', 'epics', 'releases', 'roadmap', 'calendar'],
  },
  { id: 'desk', label: 'QA / support desk', hint: 'A ticket queue with deadlines', features: ['tickets'] },
  {
    id: 'software_qa',
    label: 'Software + QA',
    hint: 'Delivery and a ticket queue in one space',
    features: ['sprints', 'epics', 'releases', 'roadmap', 'calendar', 'tickets'],
  },
];

/** Known features only, no repeats, in the standard order. */
export function normalizeFeatures(list: readonly unknown[] | null | undefined): SpaceFeature[] {
  const set = new Set((list ?? []).filter(isSpaceFeature));
  return SPACE_FEATURES.filter((f) => set.has(f));
}

/** Spaces made before features existed: what their board type gave them. */
export function featuresFromBoardType(type: BoardType | null | undefined): SpaceFeature[] {
  switch (type) {
    case 'scrum':
      return ['sprints', 'epics', 'releases', 'roadmap', 'calendar'];
    case 'service':
      return ['tickets'];
    default:
      return ['epics', 'releases', 'roadmap', 'calendar'];
  }
}

/** The legacy board type that best describes a set of features (kept for older callers). */
export function boardTypeFromFeatures(features: readonly SpaceFeature[]): BoardType {
  if (features.includes('sprints')) return 'scrum';
  if (features.includes('tickets') && !features.includes('epics')) return 'service';
  return 'kanban';
}

/** Plan features a set of space features needs. */
export const planFeaturesFor = (features: readonly SpaceFeature[]) =>
  features.flatMap((f) => (FEATURE_INFO[f].plan ? [FEATURE_INFO[f].plan!] : []));
