import type { ItemType, Priority } from '@/lib/work';

/** The board filters. The same names are used in the page URL and in the API query string. */
export interface Filters {
  q: string;
  assignee: string[];
  type: ItemType[];
  priority: Priority[];
  label: string[];
  epic: string[];
  due: '' | 'overdue' | 'today' | 'week' | 'none';
  mine: boolean;
  recent: boolean;
  blocked: boolean;
}

export const NO_FILTERS: Filters = {
  q: '',
  assignee: [],
  type: [],
  priority: [],
  label: [],
  epic: [],
  due: '',
  mine: false,
  recent: false,
  blocked: false,
};

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const DUES = ['overdue', 'today', 'week', 'none'] as const;

export function parseFilters(params: URLSearchParams): Filters {
  const due = params.get('due');
  return {
    q: params.get('q') ?? '',
    assignee: list(params.get('assignee')),
    type: list(params.get('type')) as ItemType[],
    priority: list(params.get('priority')) as Priority[],
    label: list(params.get('label')),
    epic: list(params.get('epic')),
    due: (DUES as readonly string[]).includes(due ?? '') ? (due as Filters['due']) : '',
    mine: params.get('mine') === '1',
    recent: params.get('recent') === '1',
    blocked: params.get('blocked') === '1',
  };
}

/** The filter part of a URL or API query, without a leading "?". Empty filters are left out. */
export function filterString(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.assignee.length) p.set('assignee', f.assignee.join(','));
  if (f.type.length) p.set('type', f.type.join(','));
  if (f.priority.length) p.set('priority', f.priority.join(','));
  if (f.label.length) p.set('label', f.label.join(','));
  if (f.epic.length) p.set('epic', f.epic.join(','));
  if (f.due) p.set('due', f.due);
  if (f.mine) p.set('mine', '1');
  if (f.recent) p.set('recent', '1');
  if (f.blocked) p.set('blocked', '1');
  return p.toString();
}

export const FILTER_KEYS = ['q', 'assignee', 'type', 'priority', 'label', 'epic', 'due', 'mine', 'recent', 'blocked'];

export const hasActiveFilters = (f: Filters) => filterString(f) !== '';

export const countFilters = (f: Filters) =>
  (f.q.trim() ? 1 : 0) +
  (f.assignee.length ? 1 : 0) +
  (f.type.length ? 1 : 0) +
  (f.priority.length ? 1 : 0) +
  (f.label.length ? 1 : 0) +
  (f.epic.length ? 1 : 0) +
  (f.due ? 1 : 0) +
  (f.mine ? 1 : 0) +
  (f.recent ? 1 : 0) +
  (f.blocked ? 1 : 0);
