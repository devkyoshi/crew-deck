import { z } from 'zod';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---- Work items (docs/work-items) ----------------------------------------------------------------

export const ITEM_TYPES = ['epic', 'story', 'task', 'bug', 'ticket', 'subtask'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** How two work items relate. Stored once, read from either end ("blocks" / "is blocked by"). */
export const LINK_TYPES = ['blocks', 'relates_to', 'duplicates'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUS_CATEGORIES = ['todo', 'in_progress', 'done'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** Why a finished item was finished. Set when it moves to a Done status; cleared when it moves back. */
export const RESOLUTIONS = ['done', 'wont_do', 'duplicate', 'cannot_reproduce'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Most entries a checklist on one item may have, and the most a template may have. */
export const MAX_CHECKLIST = 50;

/** `service` is a service desk: a request queue worked against SLA targets. */
export const BOARD_TYPES = ['kanban', 'scrum', 'service'] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

/** Fixed palette for status and label colours (never free hex), so contrast is always checked. */
export const STATUS_COLORS = [
  'slate',
  'blue',
  'sky',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'violet',
] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

export const MAX_STATUSES = 12;

/** Which child types each item type may have. Depth is capped at three levels. */
export const ALLOWED_CHILDREN: Record<ItemType, readonly ItemType[]> = {
  epic: ['story', 'task', 'bug'],
  story: ['subtask'],
  task: ['subtask'],
  bug: ['subtask'],
  ticket: ['subtask'],
  subtask: [],
};

export * from './workspace';
export * from './sla';
export * from './space-features';
