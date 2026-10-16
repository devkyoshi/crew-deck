import type {
  BoardType,
  ItemType,
  Priority,
  StatusCategory,
  StatusColor,
} from '@crew-deck/shared';
import {
  Bug,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleDot,
  CornerDownRight,
  Equal,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type { BoardType, ItemType, Priority, StatusCategory, StatusColor };

// ---- API shapes (apps/api/src/work and routes/board.ts) ------------------------------------------------

export interface Person {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface WorkStatus {
  id: string;
  name: string;
  category: StatusCategory;
  color: StatusColor;
  position?: number;
  wipLimit?: number | null;
  itemCount?: number;
}

export interface Label {
  id: string;
  name: string;
  color: StatusColor;
  itemCount?: number;
}

export interface WorkItem {
  id: string;
  key: string;
  number: number;
  spaceId: string;
  spaceKey: string;
  type: ItemType;
  parentId: string | null;
  parent: { id: string; key: string; title: string; type: ItemType } | null;
  title: string;
  description: string;
  /** The description as rich text (ProseMirror JSON), or null when empty. */
  descriptionDoc?: unknown;
  statusId: string;
  status: { id: string; name: string; category: StatusCategory; color: StatusColor };
  priority: Priority;
  assignee: Person | null;
  reporter: Person;
  estimate: number | null;
  dueDate: string | null;
  rank: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: { total: number; done: number };
  labels: Label[];
  permissions?: { edit: boolean; delete: boolean };
  sprintId?: string | null;
  /** Sprints this item was carried out of unfinished. */
  carryOverCount?: number;
  /** Why it was finished (only while it is in a Done status). */
  resolution?: Resolution | null;
  checklist?: { total: number; done: number; items: ChecklistEntry[] };
  /** Open items that block this one / that this one blocks. */
  blockedBy?: number;
  blocks?: number;
  fixVersions?: VersionRef[];
  affectsVersions?: VersionRef[];
  components?: { id: string; name: string }[];
}

export interface VersionRef {
  id: string;
  name: string;
  state: 'unreleased' | 'released' | 'archived';
}

export type Resolution = 'done' | 'wont_do' | 'duplicate' | 'cannot_reproduce';
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  done: 'Done',
  wont_do: 'Won’t do',
  duplicate: 'Duplicate',
  cannot_reproduce: 'Cannot reproduce',
};
export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}

export interface BoardSettings {
  swimlane: 'none' | 'assignee' | 'epic' | 'priority';
  cardFields: ('assignee' | 'priority' | 'estimate' | 'dueDate' | 'epic' | 'labels' | 'subtasks')[];
  doneRetentionDays: number;
}

export interface BoardData {
  space: { id: string; key: string; name: string; status: 'active' | 'archived' };
  board: { id: string; type: BoardType; name: string; settings: BoardSettings };
  /** The running sprint on a Scrum board (null when none is running, or on Kanban). */
  sprint?: { id: string; name: string; goal: string | null; startDate: string | null; endDate: string | null } | null;
  statuses: {
    id: string;
    name: string;
    category: StatusCategory;
    color: StatusColor;
    position: number;
    wipLimit: number | null;
  }[];
  /** True when filters narrow the board. */
  filtered: boolean;
  columns: {
    statusId: string;
    items: WorkItem[];
    /** Cards matching the filters. */
    total: number;
    /** Cards in the column ignoring filters: what the WIP limit counts. */
    wipCount: number;
    nextCursor: string | null;
  }[];
  permissions: {
    createItem: boolean;
    editItem: boolean;
    manageBoard: boolean;
    manageStatuses: boolean;
  };
}

// ---- Presentation: one definition of icon and colour per concept, used everywhere ----------------------

export const TYPE_META: Record<
  ItemType,
  { label: string; icon: LucideIcon; tile: string; text: string }
> = {
  epic: {
    label: 'Epic',
    icon: Zap,
    tile: 'bg-violet-100 dark:bg-violet-500/20',
    text: 'text-violet-700 dark:text-violet-300',
  },
  story: {
    label: 'Story',
    icon: BookOpen,
    tile: 'bg-emerald-100 dark:bg-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  task: {
    label: 'Task',
    icon: CheckSquare,
    tile: 'bg-sky-100 dark:bg-sky-500/20',
    text: 'text-sky-700 dark:text-sky-300',
  },
  bug: {
    label: 'Bug',
    icon: Bug,
    tile: 'bg-rose-100 dark:bg-rose-500/20',
    text: 'text-rose-700 dark:text-rose-300',
  },
  subtask: {
    label: 'Subtask',
    icon: CornerDownRight,
    tile: 'bg-slate-100 dark:bg-slate-500/20',
    text: 'text-slate-600 dark:text-slate-300',
  },
};

export const PRIORITY_META: Record<Priority, { label: string; icon: LucideIcon; text: string }> = {
  highest: { label: 'Highest', icon: ChevronsUp, text: 'text-red-700 dark:text-red-400' },
  high: { label: 'High', icon: ChevronUp, text: 'text-orange-700 dark:text-orange-400' },
  medium: { label: 'Medium', icon: Equal, text: 'text-amber-700 dark:text-amber-400' },
  low: { label: 'Low', icon: ChevronDown, text: 'text-sky-700 dark:text-sky-400' },
  lowest: { label: 'Lowest', icon: ChevronsDown, text: 'text-slate-600 dark:text-slate-400' },
};

export const CATEGORY_META: Record<
  StatusCategory,
  { label: string; icon: LucideIcon; accent: string; chip: string }
> = {
  todo: {
    label: 'To do',
    icon: Circle,
    accent: 'bg-slate-400 dark:bg-slate-500',
    chip: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  },
  in_progress: {
    label: 'In progress',
    icon: CircleDot,
    accent: 'bg-sky-500 dark:bg-sky-400',
    chip: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  },
  done: {
    label: 'Done',
    icon: CheckCircle2,
    accent: 'bg-emerald-500 dark:bg-emerald-400',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  },
};

/** The small dot beside a status name. Colour is decoration; the category icon and name carry the meaning. */
export const STATUS_DOT: Record<StatusColor, string> = {
  slate: 'bg-slate-400',
  blue: 'bg-blue-500',
  sky: 'bg-sky-500',
  teal: 'bg-teal-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pink: 'bg-pink-500',
  violet: 'bg-violet-500',
};

/** Label chips share the status palette. Text and fill are chosen together to stay readable. */
export const LABEL_CHIP: Record<StatusColor, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  orange: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
};

export const initialsOf = (p: { name: string | null; email: string }) =>
  (p.name ?? p.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

/** Overdue means before today, in the viewer's calendar; Done items are never overdue. */
export function dueState(dueDate: string | null, done: boolean, now = new Date()) {
  if (!dueDate) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(`${dueDate}T00:00:00`).getTime();
  if (done) return 'done' as const;
  if (due < today) return 'overdue' as const;
  if (due - today <= 86_400_000) return 'soon' as const;
  return 'later' as const;
}

export const formatDue = (dueDate: string) =>
  new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
