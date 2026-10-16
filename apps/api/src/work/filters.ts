import { z } from 'zod';
import { ITEM_TYPES, PRIORITIES } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { escapeRegex } from '../lib/pagination.js';
import { blockedItemIds } from './service.js';

const UUID = z.string().uuid();
/** Comma-separated list in a query string, each entry checked by `item`. */
const list = <T extends z.ZodType<string, string>>(item: T, max = 25) =>
  z
    .string()
    .max(2000)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(item).max(max));

/**
 * The filters the board and the list share (brief section 9): the same names in the UI's URL and in
 * the API's query string. Every value is validated, and lists are comma-separated.
 */
export const filterQuery = z.object({
  q: z.string().trim().max(100).optional(),
  assignee: list(z.union([UUID, z.literal('none')])).optional(),
  type: list(z.enum(ITEM_TYPES)).optional(),
  priority: list(z.enum(PRIORITIES)).optional(),
  label: list(UUID).optional(),
  epic: list(z.union([UUID, z.literal('none')])).optional(),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  mine: z.enum(['1']).optional(),
  recent: z.enum(['1']).optional(),
  /** Only items that something open still blocks. */
  blocked: z.enum(['1']).optional(),
  version: list(z.union([UUID, z.literal('none')])).optional(),
  component: list(z.union([UUID, z.literal('none')])).optional(),
});
export type FilterQuery = z.infer<typeof filterQuery>;

/** True when any filter is set, so callers can tell a filtered view from the whole board. */
export const hasFilters = (f: FilterQuery) => Object.values(f).some((v) => v !== undefined);

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Conditions that need a lookup first (so they cannot sit in `filterConditions`). */
export async function lookupConditions(t: TenantDb, spaceId: string, f: FilterQuery): Promise<Record<string, unknown>[]> {
  return f.blocked === '1' ? [{ id: { $in: await blockedItemIds(t, spaceId) } }] : [];
}

/** Mongo conditions (to be `$and`-ed) for the filters, for the current person (`mine` = assigned to them). */
export function filterConditions(f: FilterQuery, userId: string): Record<string, unknown>[] {
  const conds: Record<string, unknown>[] = [];
  if (f.q) {
    // A key typed in full ("ENG-12" or the bare number) also matches by number.
    const bare = f.q.replace(/^.*-/, '');
    const or: Record<string, unknown>[] = [
      { title: { $regex: escapeRegex(f.q), $options: 'i' } },
    ];
    if (/^\d+$/.test(bare)) or.push({ number: Number(bare) });
    conds.push({ $or: or });
  }
  const mine = f.mine === '1';
  const assignees = [...(f.assignee ?? []), ...(mine ? [userId] : [])];
  if (assignees.length) {
    const ids = assignees.filter((a) => a !== 'none');
    const parts: Record<string, unknown>[] = [];
    if (ids.length) parts.push({ assigneeId: { $in: ids } });
    if (assignees.includes('none')) parts.push({ assigneeId: null });
    conds.push({ $or: parts });
  }
  if (f.type?.length) conds.push({ type: { $in: f.type } });
  if (f.priority?.length) conds.push({ priority: { $in: f.priority } });
  if (f.label?.length) conds.push({ labelIds: { $in: f.label } });
  if (f.epic?.length) {
    const ids = f.epic.filter((e: string) => e !== 'none');
    const parts: Record<string, unknown>[] = [];
    if (ids.length) parts.push({ parentId: { $in: ids } });
    if (f.epic.includes('none')) parts.push({ parentId: null });
    conds.push({ $or: parts });
  }
  if (f.due) {
    const now = new Date();
    if (f.due === 'none') conds.push({ dueDate: null });
    // Finished work is never overdue.
    else if (f.due === 'overdue') {
      conds.push({ dueDate: { $ne: null, $lt: day(now) }, resolvedAt: null });
    } else if (f.due === 'today') conds.push({ dueDate: day(now) });
    else conds.push({ dueDate: { $gte: day(now), $lte: day(new Date(now.getTime() + 7 * 86_400_000)) } });
  }
  if (f.version?.length) {
    const ids = f.version.filter((v: string) => v !== 'none');
    const parts: Record<string, unknown>[] = [];
    if (ids.length) parts.push({ fixVersionIds: { $in: ids } });
    if (f.version.includes('none')) parts.push({ fixVersionIds: { $in: [null, []] } });
    conds.push({ $or: parts });
  }
  if (f.component?.length) {
    const ids = f.component.filter((v: string) => v !== 'none');
    const parts: Record<string, unknown>[] = [];
    if (ids.length) parts.push({ componentIds: { $in: ids } });
    if (f.component.includes('none')) parts.push({ componentIds: { $in: [null, []] } });
    conds.push({ $or: parts });
  }
  if (f.recent === '1') conds.push({ updatedAt: { $gt: new Date(Date.now() - 7 * 86_400_000) } });
  return conds;
}
