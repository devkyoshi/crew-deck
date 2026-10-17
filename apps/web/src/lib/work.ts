import type {
  SpaceFeature,
  SlaState,
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
  Ticket,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type { BoardType, ItemType, Priority, SlaState, StatusCategory, StatusColor };

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
  startDate?: string | null;
  time?: { original: number | null; remaining: number | null; spent: number };
  fixVersions?: VersionRef[];
  affectsVersions?: VersionRef[];
  components?: { id: string; name: string }[];
  /** Tickets only: the response and resolve deadlines and where each stands. */
  sla?: {
    response: { dueAt: string | null; doneAt: string | null; state: SlaState };
    resolve: { dueAt: string | null; doneAt: string | null; state: SlaState };
  } | null;
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
  board: { id: string; type: BoardType; features: SpaceFeature[]; name: string; settings: BoardSettings };
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
    tile: 'bg-violet-soft ',
    text: 'text-violet-soft-foreground ',
  },
  story: {
    label: 'Story',
    icon: BookOpen,
    tile: 'bg-success-soft ',
    text: 'text-success-soft-foreground ',
  },
  task: {
    label: 'Task',
    icon: CheckSquare,
    tile: 'bg-info-soft ',
    text: 'text-info-soft-foreground ',
  },
  bug: {
    label: 'Bug',
    icon: Bug,
    tile: 'bg-danger-soft ',
    text: 'text-danger-soft-foreground ',
  },
  ticket: {
    label: 'Ticket',
    icon: Ticket,
    tile: 'bg-warning-soft ',
    text: 'text-warning-soft-foreground ',
  },
  subtask: {
    label: 'Subtask',
    icon: CornerDownRight,
    tile: 'bg-muted ',
    text: 'text-muted-foreground ',
  },
};

export const PRIORITY_META: Record<Priority, { label: string; icon: LucideIcon; text: string }> = {
  highest: { label: 'Highest', icon: ChevronsUp, text: 'text-danger-soft-foreground ' },
  high: { label: 'High', icon: ChevronUp, text: 'text-orange-soft-foreground ' },
  medium: { label: 'Medium', icon: Equal, text: 'text-warning-soft-foreground ' },
  low: { label: 'Low', icon: ChevronDown, text: 'text-info-soft-foreground ' },
  lowest: { label: 'Lowest', icon: ChevronsDown, text: 'text-muted-foreground ' },
};

export const CATEGORY_META: Record<
  StatusCategory,
  { label: string; icon: LucideIcon; accent: string; chip: string }
> = {
  todo: {
    label: 'To do',
    icon: Circle,
    accent: 'bg-muted-foreground/40 ',
    chip: 'bg-muted text-muted-foreground ',
  },
  in_progress: {
    label: 'In progress',
    icon: CircleDot,
    accent: 'bg-info ',
    chip: 'bg-info-soft text-info-soft-foreground ',
  },
  done: {
    label: 'Done',
    icon: CheckCircle2,
    accent: 'bg-success ',
    chip: 'bg-success-soft text-success-soft-foreground ',
  },
};

/** The small dot beside a status name. Colour is decoration; the category icon and name carry the meaning. */
export const STATUS_DOT: Record<StatusColor, string> = {
  slate: 'bg-muted-foreground/40',
  blue: 'bg-info',
  sky: 'bg-info',
  teal: 'bg-success',
  green: 'bg-success',
  amber: 'bg-warning',
  orange: 'bg-orange',
  red: 'bg-danger',
  pink: 'bg-violet',
  violet: 'bg-violet',
};

/** Label chips share the status palette. Text and fill are chosen together to stay readable. */
export const LABEL_CHIP: Record<StatusColor, string> = {
  slate: 'bg-muted text-muted-foreground ',
  blue: 'bg-info-soft text-info-soft-foreground ',
  sky: 'bg-info-soft text-info-soft-foreground ',
  teal: 'bg-success-soft text-success-soft-foreground ',
  green: 'bg-success-soft text-success-soft-foreground ',
  amber: 'bg-warning-soft text-warning-soft-foreground ',
  orange: 'bg-orange-soft text-orange-soft-foreground ',
  red: 'bg-danger-soft text-danger-soft-foreground ',
  pink: 'bg-violet-soft text-violet-soft-foreground ',
  violet: 'bg-violet-soft text-violet-soft-foreground ',
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
