import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { ALLOWED_CHILDREN, type ItemType } from '@crew-deck/shared';
import type { Tx } from '../db/client.js';
import {
  boards,
  labels,
  memberships,
  spaceCounters,
  spaceStatuses,
  spaces,
  users,
  workItemLabels,
  workItems,
} from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { effectiveRoleSql } from '../spaces/access.js';
import { resolveSpace } from '../routes/spaces.js';
import { docToText } from './doc.js';

export type SpaceRow = Awaited<ReturnType<typeof resolveSpace>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/;

// ---- Space guards ---------------------------------------------------------------------------------------

/** Items and statuses of an archived space are read-only until it is restored. */
export function assertWritable(space: { status: 'active' | 'archived' }) {
  if (space.status === 'archived') {
    throw new AppError(409, 'archived', 'Restore this space before changing its work items');
  }
}

export async function loadBoard(tx: Tx, spaceId: string) {
  const [board] = await tx.select().from(boards).where(eq(boards.spaceId, spaceId));
  if (!board) throw notFound('Board');
  return board;
}

// ---- Items ----------------------------------------------------------------------------------------------

const assigneeU = alias(users, 'assignee_u');
const reporterU = alias(users, 'reporter_u');
const parentW = alias(workItems, 'parent_w');

export const itemSelect = {
  id: workItems.id,
  number: workItems.number,
  spaceId: workItems.spaceId,
  type: workItems.type,
  parentId: workItems.parentId,
  title: workItems.title,
  description: workItems.description,
  statusId: workItems.statusId,
  priority: workItems.priority,
  assigneeId: workItems.assigneeId,
  reporterId: workItems.reporterId,
  estimate: workItems.estimate,
  dueDate: workItems.dueDate,
  rank: workItems.rank,
  resolvedAt: workItems.resolvedAt,
  createdAt: workItems.createdAt,
  updatedAt: workItems.updatedAt,
  statusName: spaceStatuses.name,
  statusCategory: spaceStatuses.category,
  statusColor: spaceStatuses.color,
  assigneeName: assigneeU.name,
  assigneeEmail: assigneeU.email,
  assigneeAvatar: assigneeU.avatarUrl,
  reporterName: reporterU.name,
  reporterEmail: reporterU.email,
  reporterAvatar: reporterU.avatarUrl,
  parentNumber: parentW.number,
  parentTitle: parentW.title,
  parentType: parentW.type,
  parentDeletedAt: parentW.deletedAt,
  labels: sql<{ id: string; name: string; color: string }[]>`(
    select coalesce(json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color)
      order by lower(l.name)), '[]'::json)
    from work_item_labels wl join labels l on l.id = wl.label_id
    where wl.work_item_id = ${workItems.id})`,
  childCount: sql<number>`(select count(*)::int from work_items c
    where c.parent_id = ${workItems.id} and c.deleted_at is null)`,
  childDone: sql<number>`(select count(*)::int from work_items c
    join space_statuses cs on cs.id = c.status_id
    where c.parent_id = ${workItems.id} and c.deleted_at is null and cs.category = 'done')`,
};

/** The base query every item read shares: status, people and parent are joined in. */
export function itemQuery(tx: Tx) {
  return tx
    .select(itemSelect)
    .from(workItems)
    .innerJoin(spaceStatuses, eq(spaceStatuses.id, workItems.statusId))
    .leftJoin(assigneeU, eq(assigneeU.id, workItems.assigneeId))
    .innerJoin(reporterU, eq(reporterU.id, workItems.reporterId))
    .leftJoin(parentW, eq(parentW.id, workItems.parentId));
}

type Person = { id: string; name: string | null; email: string; avatarUrl: string | null };

export function presentItem(row: Awaited<ReturnType<typeof loadItemRows>>[number], spaceKey: string) {
  const person = (
    id: string | null,
    name: string | null,
    email: string | null,
    avatarUrl: string | null,
  ): Person | null => (id && email ? { id, name, email, avatarUrl } : null);
  return {
    id: row.id,
    key: `${spaceKey}-${row.number}`,
    number: row.number,
    spaceId: row.spaceId,
    spaceKey,
    type: row.type,
    // A deleted parent (an epic) is hidden: its children simply no longer belong to it.
    parentId: row.parentDeletedAt ? null : row.parentId,
    parent:
      row.parentId && !row.parentDeletedAt && row.parentNumber !== null && row.parentType
        ? {
            id: row.parentId,
            key: `${spaceKey}-${row.parentNumber}`,
            title: row.parentTitle ?? '',
            type: row.parentType,
          }
        : null,
    title: row.title,
    description: docToText(row.description),
    statusId: row.statusId,
    status: {
      id: row.statusId,
      name: row.statusName,
      category: row.statusCategory,
      color: row.statusColor,
    },
    priority: row.priority,
    assignee: person(row.assigneeId, row.assigneeName, row.assigneeEmail, row.assigneeAvatar),
    reporter: person(row.reporterId, row.reporterName, row.reporterEmail, row.reporterAvatar)!,
    estimate: row.estimate === null ? null : Number(row.estimate),
    dueDate: row.dueDate,
    rank: row.rank,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    subtasks: { total: row.childCount, done: row.childDone },
    labels: row.labels,
  };
}

export const loadItemRows = (tx: Tx, where: SQL | undefined) => itemQuery(tx).where(where);

/**
 * Finds an item by id or by key (`ENG-142`), checking the caller can see its space. Anything hidden,
 * deleted or in another tenant is a 404, so keys and ids cannot be probed.
 */
export async function resolveItem(tx: Tx, actor: Actor, ref: string) {
  let itemId: string | null = null;
  let space: SpaceRow | null = null;
  if (UUID.test(ref)) {
    const [hit] = await tx
      .select({ id: workItems.id, spaceId: workItems.spaceId })
      .from(workItems)
      .where(and(eq(workItems.id, ref), eq(workItems.orgId, actor.orgId), isNull(workItems.deletedAt)));
    if (!hit) throw notFound('Work item');
    itemId = hit.id;
    space = await resolveSpace(tx, actor, hit.spaceId).catch(() => null);
  } else {
    const m = KEY.exec(ref);
    if (!m) throw notFound('Work item');
    space = await resolveSpace(tx, actor, m[1]!.toUpperCase()).catch(() => null);
    if (space) {
      const [hit] = await tx
        .select({ id: workItems.id })
        .from(workItems)
        .where(
          and(
            eq(workItems.spaceId, space.id),
            eq(workItems.number, Number(m[2])),
            eq(workItems.orgId, actor.orgId),
            isNull(workItems.deletedAt),
          ),
        );
      itemId = hit?.id ?? null;
    }
  }
  if (!space || !itemId) throw notFound('Work item');
  const [row] = await loadItemRows(tx, eq(workItems.id, itemId));
  if (!row) throw notFound('Work item');
  return { row, space };
}

/** Hands out the next key number. The row lock serialises creates, so numbers are gap-free per space. */
export async function nextNumber(tx: Tx, spaceId: string) {
  const [row] = await tx
    .update(spaceCounters)
    .set({ lastNumber: sql`${spaceCounters.lastNumber} + 1` })
    .where(eq(spaceCounters.spaceId, spaceId))
    .returning({ n: spaceCounters.lastNumber });
  if (!row) throw notFound('Space');
  return row.n;
}

// ---- Ranks ----------------------------------------------------------------------------------------------

const C = sql.raw(' COLLATE "C"');

/** A rank after every live item already in the column. */
export async function rankAtEnd(tx: Tx, spaceId: string, statusId: string) {
  const [last] = await tx
    .select({ rank: workItems.rank })
    .from(workItems)
    .where(
      and(
        eq(workItems.spaceId, spaceId),
        eq(workItems.statusId, statusId),
        isNull(workItems.deletedAt),
      ),
    )
    .orderBy(sql`${workItems.rank}${C} desc`)
    .limit(1);
  return generateKeyBetween(last?.rank ?? null, null);
}

/** `count` ranks after the last live item in the column, in order. */
export async function ranksAtEnd(tx: Tx, spaceId: string, statusId: string, count: number) {
  const [last] = await tx
    .select({ rank: workItems.rank })
    .from(workItems)
    .where(and(eq(workItems.spaceId, spaceId), eq(workItems.statusId, statusId)))
    .orderBy(sql`${workItems.rank}${C} desc`)
    .limit(1);
  return generateNKeysBetween(last?.rank ?? null, null, count);
}

// ---- Cursors --------------------------------------------------------------------------------------------

export const encodeCursor = (rank: string, id: string) =>
  Buffer.from(JSON.stringify([rank, id])).toString('base64url');

export function decodeCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && UUID.test(v[1])) {
      return [v[0], v[1]];
    }
  } catch {
    // fall through
  }
  throw new AppError(400, 'bad_cursor', 'That page marker is not valid');
}

/** Rows after a cursor, in (rank, id) order. */
export const afterCursor = (cursor: string | undefined) => {
  if (!cursor) return undefined;
  const [rank, id] = decodeCursor(cursor);
  return sql`(${workItems.rank}, ${workItems.id}) > (${rank}::text${C}, ${id}::uuid)`;
};

export const byRank = [sql`${workItems.rank}${C} asc`, asc(workItems.id)] as const;

// ---- Hierarchy ------------------------------------------------------------------------------------------

/**
 * Epic > story/task/bug > subtask, three levels at most. `childTypes` are the types of the item's
 * existing live children, so a type or parent change cannot strand them.
 */
export function validateHierarchy(
  type: ItemType,
  parent: { type: ItemType } | null,
  childTypes: ItemType[] = [],
) {
  const fail = (message: string, field: 'type' | 'parentId' = 'parentId') => {
    throw new AppError(422, 'invalid_hierarchy', message, { [field]: message });
  };
  if (type === 'epic' && parent) fail('An epic cannot have a parent');
  if (type === 'subtask' && !parent) fail('A subtask needs a parent story, task or bug');
  if (parent) {
    if (!ALLOWED_CHILDREN[parent.type].includes(type)) {
      fail(
        parent.type === 'subtask'
          ? 'A subtask cannot have children'
          : `A ${type} cannot sit under a ${parent.type}`,
      );
    }
  }
  const stranded = childTypes.find((c) => !ALLOWED_CHILDREN[type].includes(c));
  if (stranded) {
    fail(`This item has ${stranded}s under it, which a ${type} cannot hold`, 'type');
  }
}

// ---- People ---------------------------------------------------------------------------------------------

/** An assignee must be an active member who can actually open the space. */
export async function assertAssignable(tx: Tx, orgId: string, space: SpaceRow, userId: string) {
  const bad = () =>
    new AppError(422, 'invalid_assignee', 'Choose someone who has access to this space', {
      assigneeId: 'Choose someone who has access to this space',
    });
  const [m] = await tx
    .select({ role: memberships.orgRole })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    );
  if (!m) throw bad();
  if (space.visibility === 'open' || m.role === 'owner' || m.role === 'admin') return;
  const [access] = await tx
    .select({ role: effectiveRoleSql(userId, orgId) })
    .from(spaces)
    .where(eq(spaces.id, space.id));
  if (!access?.role) throw bad();
}

// ---- Statuses -------------------------------------------------------------------------------------------

export const listStatuses = (tx: Tx, spaceId: string) =>
  tx
    .select({
      id: spaceStatuses.id,
      name: spaceStatuses.name,
      category: spaceStatuses.category,
      position: spaceStatuses.position,
      color: spaceStatuses.color,
      wipLimit: spaceStatuses.wipLimit,
    })
    .from(spaceStatuses)
    .where(eq(spaceStatuses.spaceId, spaceId))
    .orderBy(asc(spaceStatuses.position), asc(spaceStatuses.createdAt));

/** `resolved_at` follows the Done category: set when an item enters it, cleared when it leaves. */
export function resolvedAtFor(
  category: 'todo' | 'in_progress' | 'done',
  current: Date | null,
  now = new Date(),
) {
  if (category !== 'done') return null;
  return current ?? now;
}

// ---- Shared helpers for item routes -----------------------------------------------------------------------

/** The optimistic-concurrency token: the item's updated_at, as sent in If-Match. */
export function ifMatch(req: { headers: Record<string, unknown> }): Date {
  const raw = req.headers['if-match'];
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError(428, 'precondition_required', 'Send the item’s last-seen update time in If-Match');
  }
  const d = new Date(raw.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'bad_if_match', 'If-Match must be the item’s updated time');
  }
  return d;
}

export const stale = () =>
  new AppError(412, 'stale', 'Someone else changed this item. Reload it to see the latest.');

/** SQL: this row still has the updated_at the caller last saw (millisecond precision, like JSON dates). */
export const matchesVersion = (expected: Date) =>
  sql`date_trunc('milliseconds', ${workItems.updatedAt}) = ${expected.toISOString()}::timestamptz`;

export async function statusIn(tx: Tx, space: { id: string }, statusId: string) {
  const [s] = await tx
    .select({ id: spaceStatuses.id, category: spaceStatuses.category })
    .from(spaceStatuses)
    .where(and(eq(spaceStatuses.id, statusId), eq(spaceStatuses.spaceId, space.id)));
  if (!s) {
    throw new AppError(422, 'invalid_status', 'That status does not exist in this space', {
      statusId: 'Choose a status from this space',
    });
  }
  return s;
}

export async function liveParent(tx: Tx, space: { id: string }, parentId: string) {
  const [p] = await tx
    .select({ id: workItems.id, type: workItems.type })
    .from(workItems)
    .where(
      and(eq(workItems.id, parentId), eq(workItems.spaceId, space.id), isNull(workItems.deletedAt)),
    );
  if (!p) {
    throw new AppError(422, 'invalid_parent', 'That parent does not exist in this space', {
      parentId: 'Choose an item from this space',
    });
  }
  return p;
}

/**
 * Takes the space's counter row lock. Creates, moves and bulk changes in one space queue up behind
 * it, so two people dropping cards into the same gap each see the other's committed result and
 * never compute the same rank.
 */
export async function lockSpace(tx: Tx, spaceId: string) {
  await tx.execute(sql`select 1 from space_counters where space_id = ${spaceId} for update`);
}

/** Labels may only come from the item's own space, and an item holds at most 20. */
export async function setItemLabels(
  tx: Tx,
  orgId: string,
  space: { id: string },
  itemId: string,
  labelIds: string[],
) {
  const unique = [...new Set(labelIds)];
  if (unique.length > 20) {
    throw new AppError(422, 'too_many_labels', 'An item can have at most 20 labels', {
      labelIds: 'Use 20 labels or fewer',
    });
  }
  if (unique.length) {
    const found = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.spaceId, space.id), inArray(labels.id, unique)));
    if (found.length !== unique.length) {
      throw new AppError(422, 'invalid_label', 'One of those labels does not exist in this space', {
        labelIds: 'Choose labels from this space',
      });
    }
  }
  await tx.delete(workItemLabels).where(eq(workItemLabels.workItemId, itemId));
  if (unique.length) {
    await tx
      .insert(workItemLabels)
      .values(unique.map((labelId) => ({ workItemId: itemId, labelId, orgId, spaceId: space.id })));
  }
}

// ---- Rank maintenance ---------------------------------------------------------------------------------------

/** Ranks grow by about a character per many repeated inserts at one spot; past this we rewrite them. */
export const MAX_RANK_LENGTH = 40;
export const needsRebalance = (rank: string) => rank.length > MAX_RANK_LENGTH;

/**
 * Rewrites every live rank in one column as short, evenly spaced keys, keeping the exact order.
 * Items are touched in rank order and their `updated_at` is left alone (nobody edited anything).
 */
export async function rebalanceColumn(tx: Tx, spaceId: string, statusId: string) {
  const rows = await tx
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.spaceId, spaceId), eq(workItems.statusId, statusId)))
    .orderBy(...byRank);
  const keys = generateNKeysBetween(null, null, rows.length);
  for (const [i, row] of rows.entries()) {
    await tx.update(workItems).set({ rank: keys[i]! }).where(eq(workItems.id, row.id));
  }
  return rows.length;
}

/** What the caller may do with an item, mirrored to the UI. */
export function itemPermissions(
  actor: Actor,
  space: SpaceRow,
  reporterId: string,
  can: (a: Actor, action: 'item.edit' | 'item.delete', r: object) => boolean,
) {
  const ctx = {
    spaceRole: space.myRole,
    spaceVisibility: space.visibility,
    isReporter: reporterId === actor.userId,
  };
  const writable = space.status === 'active';
  return {
    edit: writable && can(actor, 'item.edit', ctx),
    delete: writable && can(actor, 'item.delete', ctx),
  };
}

/** Spaces and columns with a rank long enough to need rewriting. */
export async function longRankColumns(tx: Tx, orgId: string) {
  return tx
    .selectDistinct({ spaceId: workItems.spaceId, statusId: workItems.statusId })
    .from(workItems)
    .where(and(eq(workItems.orgId, orgId), sql`length(${workItems.rank}) > ${MAX_RANK_LENGTH}`));
}
