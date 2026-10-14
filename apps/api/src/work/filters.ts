import { inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ITEM_TYPES, PRIORITIES } from '@crew-deck/shared';
import { likePattern } from '../lib/pagination.js';
import { workItems } from '../db/schema.js';

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
});
export type FilterQuery = z.infer<typeof filterQuery>;

/** True when any filter is set, so callers can tell a filtered view from the whole board. */
export const hasFilters = (f: FilterQuery) => Object.values(f).some((v) => v !== undefined);

/** WHERE conditions for the filters, for the current person (`mine` means assigned to them). */
export function filterConditions(f: FilterQuery, userId: string): SQL[] {
  const conds: SQL[] = [];
  if (f.q) {
    const p = likePattern(f.q);
    // A key typed in full ("ENG-12" or the bare number) also matches.
    conds.push(or(sql`${workItems.title} ilike ${p}`, sql`${workItems.number}::text = ${f.q.replace(/^.*-/, '')}`)!);
  }
  const mine = f.mine === '1';
  const assignees = [...(f.assignee ?? []), ...(mine ? [userId] : [])];
  if (assignees.length) {
    const ids = assignees.filter((a) => a !== 'none');
    const parts: SQL[] = [];
    if (ids.length) parts.push(inArray(workItems.assigneeId, ids));
    if (assignees.includes('none')) parts.push(isNull(workItems.assigneeId));
    conds.push(or(...parts)!);
  }
  if (f.type?.length) conds.push(inArray(workItems.type, f.type));
  if (f.priority?.length) conds.push(inArray(workItems.priority, f.priority));
  if (f.label?.length) {
    conds.push(sql`exists (select 1 from work_item_labels wl
      where wl.work_item_id = ${workItems.id} and wl.label_id in ${f.label})`);
  }
  if (f.epic?.length) {
    const ids = f.epic.filter((e: string) => e !== 'none');
    const parts: SQL[] = [];
    if (ids.length) parts.push(inArray(workItems.parentId, ids));
    if (f.epic.includes('none')) parts.push(isNull(workItems.parentId));
    conds.push(or(...parts)!);
  }
  if (f.due) {
    if (f.due === 'none') conds.push(isNull(workItems.dueDate));
    // Finished work is never overdue.
    else if (f.due === 'overdue') {
      conds.push(sql`${workItems.dueDate} < current_date and ${workItems.resolvedAt} is null`);
    } else if (f.due === 'today') conds.push(sql`${workItems.dueDate} = current_date`);
    else conds.push(sql`${workItems.dueDate} between current_date and current_date + 7`);
  }
  if (f.recent === '1') conds.push(sql`${workItems.updatedAt} > now() - interval '7 days'`);
  return conds;
}
