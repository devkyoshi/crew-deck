import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { ALLOWED_CHILDREN, type ItemType } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import type {
  LabelDoc,
  SpaceStatusDoc,
  StatusCategory,
  UserDoc,
  WorkItemDoc,
} from '../db/types.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { effectiveRole, type SpaceView } from '../spaces/access.js';
import { resolveSpace } from '../routes/spaces.js';
import { docToText } from './doc.js';
import { liveTouch } from '../lib/live.js';

export type SpaceRow = SpaceView;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/;

// ---- Space guards ---------------------------------------------------------------------------------------

/** Items and statuses of an archived space are read-only until it is restored. */
export function assertWritable(space: { status: 'active' | 'archived' }) {
  if (space.status === 'archived') {
    throw new AppError(409, 'archived', 'Restore this space before changing its work items');
  }
}

export async function loadBoard(t: TenantDb, spaceId: string) {
  const board = await t.boards.findOne({ spaceId });
  if (!board) throw notFound('Board');
  return board;
}

// ---- Items ----------------------------------------------------------------------------------------------

/**
 * A work item with everything the board and detail views show, joined in application code (the old
 * SQL joined statuses, people, the parent and labels in one query).
 */
export interface ItemRow extends WorkItemDoc {
  statusName: string;
  statusCategory: StatusCategory;
  statusColor: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  assigneeAvatar: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  reporterAvatar: string | null;
  parentNumber: number | null;
  parentTitle: string | null;
  parentType: ItemType | null;
  parentDeletedAt: Date | null;
  labels: { id: string; name: string; color: string }[];
  childCount: number;
  childDone: number;
}

/** Joins statuses, people, parents, labels and subtask counts onto a batch of item documents. */
export async function hydrateItems(t: TenantDb, docs: WorkItemDoc[]): Promise<ItemRow[]> {
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const statusIds = [...new Set(docs.map((d) => d.statusId))];
  const parentIds = [...new Set(docs.map((d) => d.parentId).filter((x): x is string => !!x))];
  const labelIds = [...new Set(docs.flatMap((d) => d.labelIds ?? []))];
  const peopleIds = docs.flatMap((d) => [d.reporterId, ...(d.assigneeId ? [d.assigneeId] : [])]);

  const [statuses, people, parents, labels, children] = await Promise.all([
    t.spaceStatuses.find({ id: { $in: statusIds } }),
    t.users(peopleIds),
    parentIds.length ? t.workItems.find({ id: { $in: parentIds } }) : Promise.resolve([]),
    labelIds.length ? t.labels.find({ id: { $in: labelIds } }) : Promise.resolve([] as LabelDoc[]),
    t.workItems.find(
      { parentId: { $in: ids }, deletedAt: null },
      { projection: { parentId: 1, statusId: 1 } },
    ),
  ]);
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const parentById = new Map(parents.map((p) => [p.id, p]));
  const labelById = new Map(labels.map((l) => [l.id, l]));

  const childStatusIds = [...new Set(children.map((c) => c.statusId))].filter((id) => !statusById.has(id));
  if (childStatusIds.length) {
    for (const s of await t.spaceStatuses.find({ id: { $in: childStatusIds } })) {
      statusById.set(s.id, s);
    }
  }
  const childCount = new Map<string, number>();
  const childDone = new Map<string, number>();
  for (const c of children) {
    const pid = c.parentId!;
    childCount.set(pid, (childCount.get(pid) ?? 0) + 1);
    if (statusById.get(c.statusId)?.category === 'done') childDone.set(pid, (childDone.get(pid) ?? 0) + 1);
  }

  const person = (u: UserDoc | undefined) => ({
    name: u?.name ?? null,
    email: u?.email ?? null,
    avatar: u?.avatarUrl ?? null,
  });

  return docs.map((d) => {
    const s = statusById.get(d.statusId);
    const a = person(d.assigneeId ? people.get(d.assigneeId) : undefined);
    const rep = person(people.get(d.reporterId));
    const parent = d.parentId ? parentById.get(d.parentId) : undefined;
    return {
      ...d,
      statusName: s?.name ?? '',
      statusCategory: s?.category ?? 'todo',
      statusColor: s?.color ?? 'slate',
      assigneeName: a.name,
      assigneeEmail: a.email,
      assigneeAvatar: a.avatar,
      reporterName: rep.name,
      reporterEmail: rep.email,
      reporterAvatar: rep.avatar,
      parentNumber: parent?.number ?? null,
      parentTitle: parent?.title ?? null,
      parentType: parent?.type ?? null,
      parentDeletedAt: parent?.deletedAt ?? null,
      labels: (d.labelIds ?? [])
        .map((id) => labelById.get(id))
        .filter((l): l is LabelDoc => !!l)
        .map((l) => ({ id: l.id, name: l.name, color: l.color }))
        .sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase())),
      childCount: childCount.get(d.id) ?? 0,
      childDone: childDone.get(d.id) ?? 0,
    };
  });
}

type Person = { id: string; name: string | null; email: string; avatarUrl: string | null };

export function presentItem(row: ItemRow, spaceKey: string) {
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
    descriptionDoc: (row.description ?? null) as unknown,
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
    sprintId: row.sprintId ?? null,
    carryOverCount: row.carryOverCount ?? 0,
    labels: row.labels,
  };
}

/** Loads items matching a filter (live items only unless the filter says otherwise) with their joins. */
export async function loadItemRows(
  t: TenantDb,
  filter: Record<string, unknown>,
  opts: { sort?: Record<string, 1 | -1>; limit?: number } = {},
): Promise<ItemRow[]> {
  const docs = await t.workItems.find(filter, {
    sort: opts.sort ?? { rank: 1, id: 1 },
    limit: opts.limit,
  });
  return hydrateItems(t, docs);
}

/**
 * Finds an item by id or by key (`ENG-142`), checking the caller can see its space. Anything hidden,
 * deleted or in another tenant is a 404, so keys and ids cannot be probed.
 */
export async function resolveItem(t: TenantDb, actor: Actor, ref: string) {
  let itemId: string | null = null;
  let space: SpaceRow | null = null;
  if (UUID.test(ref)) {
    const hit = await t.workItems.findOne({ id: ref, deletedAt: null }, { projection: { id: 1, spaceId: 1 } });
    if (!hit) throw notFound('Work item');
    itemId = hit.id;
    space = await resolveSpace(t, actor, hit.spaceId).catch(() => null);
  } else {
    const m = KEY.exec(ref);
    if (!m) throw notFound('Work item');
    space = await resolveSpace(t, actor, m[1]!.toUpperCase()).catch(() => null);
    if (space) {
      const hit = await t.workItems.findOne(
        { spaceId: space.id, number: Number(m[2]), deletedAt: null },
        { projection: { id: 1 } },
      );
      itemId = hit?.id ?? null;
    }
    if (!itemId) {
      // An item moved to another space keeps answering to its old key; access is checked on the new space.
      const old = await t.workItems.findOne(
        { keyHistory: `${m[1]!.toUpperCase()}-${Number(m[2])}`, deletedAt: null },
        { projection: { id: 1, spaceId: 1 } },
      );
      if (old) {
        itemId = old.id;
        space = await resolveSpace(t, actor, old.spaceId).catch(() => null);
      }
    }
  }
  if (!space || !itemId) throw notFound('Work item');
  const [row] = await loadItemRows(t, { id: itemId });
  if (!row) throw notFound('Work item');
  return { row, space };
}

/** Hands out the next key number atomically, so numbers are unique and gap-free per space. */
export async function nextNumber(t: TenantDb, spaceId: string) {
  const row = await t.spaceCounters.findOneAndUpdate({ spaceId }, { $inc: { lastNumber: 1 } });
  if (!row) throw notFound('Space');
  return row.lastNumber;
}

// ---- Ranks ----------------------------------------------------------------------------------------------

/** A rank after every live item already in the column. */
export async function rankAtEnd(t: TenantDb, spaceId: string, statusId: string) {
  const last = await t.workItems.findOne(
    { spaceId, statusId, deletedAt: null },
    { sort: { rank: -1 }, projection: { rank: 1 } },
  );
  return generateKeyBetween(last?.rank ?? null, null);
}

/** `count` ranks after the last item (live or not) in the column, in order. */
export async function ranksAtEnd(t: TenantDb, spaceId: string, statusId: string, count: number) {
  const last = await t.workItems.findOne(
    { spaceId, statusId },
    { sort: { rank: -1 }, projection: { rank: 1 } },
  );
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

/** Filter for rows after a cursor, in (rank, id) order. Mongo compares strings byte-wise by default. */
export const afterCursor = (cursor: string | undefined): Record<string, unknown> | undefined => {
  if (!cursor) return undefined;
  const [rank, id] = decodeCursor(cursor);
  return { $or: [{ rank: { $gt: rank } }, { rank, id: { $gt: id } }] };
};

export const byRank = { rank: 1, id: 1 } as const;

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

/** True when this person is an active member who can open the space. */
export async function canOpenSpace(t: TenantDb, space: SpaceRow, userId: string) {
  const m = await t.memberships.findOne({ userId, status: 'active' });
  if (!m) return false;
  if (space.visibility === 'open' || m.orgRole === 'owner' || m.orgRole === 'admin') return true;
  return (await effectiveRole(t, userId, space.id)) !== null;
}

/** An assignee must be an active member who can actually open the space. */
export async function assertAssignable(t: TenantDb, _orgId: string, space: SpaceRow, userId: string) {
  if (!(await canOpenSpace(t, space, userId))) {
    throw new AppError(422, 'invalid_assignee', 'Choose someone who has access to this space', {
      assigneeId: 'Choose someone who has access to this space',
    });
  }
}

/** Mentions may only name people who can open the space, so nobody hears about work they cannot see. */
export async function assertMentionable(t: TenantDb, space: SpaceRow, ids: string[], field = 'body') {
  for (const id of ids) {
    if (!(await canOpenSpace(t, space, id))) {
      const msg = 'You can only mention people who can open this space';
      throw new AppError(422, 'invalid_mention', msg, { [field]: msg });
    }
  }
}

// ---- Statuses -------------------------------------------------------------------------------------------

export const listStatuses = async (t: TenantDb, spaceId: string) => {
  const rows = await t.spaceStatuses.find({ spaceId }, { sort: { position: 1, createdAt: 1 } });
  return rows.map(({ id, name, category, position, color, wipLimit }) => ({
    id,
    name,
    category,
    position,
    color,
    wipLimit,
  }));
};

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

/** Filter fragment: this item still has the updated_at the caller last saw (millisecond precision). */
export const matchesVersion = (expected: Date) => ({ updatedAt: expected });

export async function statusIn(t: TenantDb, space: { id: string }, statusId: string) {
  const s: SpaceStatusDoc | null = await t.spaceStatuses.findOne({ id: statusId, spaceId: space.id });
  if (!s) {
    throw new AppError(422, 'invalid_status', 'That status does not exist in this space', {
      statusId: 'Choose a status from this space',
    });
  }
  return { id: s.id, category: s.category };
}

export async function liveParent(t: TenantDb, space: { id: string }, parentId: string) {
  const p = await t.workItems.findOne(
    { id: parentId, spaceId: space.id, deletedAt: null },
    { projection: { id: 1, type: 1 } },
  );
  if (!p) {
    throw new AppError(422, 'invalid_parent', 'That parent does not exist in this space', {
      parentId: 'Choose an item from this space',
    });
  }
  return { id: p.id, type: p.type };
}

/**
 * Serialises changes within one space. Every create, move and bulk change writes the space's counter
 * document, so two concurrent transactions conflict and one retries after the other commits. They
 * therefore see each other's committed result and never compute the same rank. Only effective inside
 * a transaction (`withTenantTx`).
 */
export async function lockSpace(t: TenantDb, spaceId: string) {
  // Everything that takes the lock changes the board, so open boards hear about it once it commits.
  liveTouch({ orgId: t.orgId, spaceId, kind: 'board' });
  await t.spaceCounters.updateOne({ spaceId }, { $inc: { lockVersion: 1 } } as never);
}

/** Labels may only come from the item's own space, and an item holds at most 20. */
export async function setItemLabels(
  t: TenantDb,
  _orgId: string,
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
    const found = await t.labels.count({ spaceId: space.id, id: { $in: unique } });
    if (found !== unique.length) {
      throw new AppError(422, 'invalid_label', 'One of those labels does not exist in this space', {
        labelIds: 'Choose labels from this space',
      });
    }
  }
  await t.workItems.updateOne({ id: itemId }, { labelIds: unique });
}

// ---- Rank maintenance ---------------------------------------------------------------------------------------

/** Ranks grow by about a character per many repeated inserts at one spot; past this we rewrite them. */
export const MAX_RANK_LENGTH = 40;
export const needsRebalance = (rank: string) => rank.length > MAX_RANK_LENGTH;

/**
 * Rewrites every rank in one column as short, evenly spaced keys, keeping the exact order.
 * Items are touched in rank order and their `updatedAt` is left alone (nobody edited anything).
 */
export async function rebalanceColumn(t: TenantDb, spaceId: string, statusId: string) {
  const rows = await t.workItems.find(
    { spaceId, statusId },
    { sort: byRank, projection: { id: 1 } },
  );
  const keys = generateNKeysBetween(null, null, rows.length);
  for (const [i, row] of rows.entries()) {
    await t.workItems.updateOne({ id: row.id }, { rank: keys[i]! });
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

/** Columns with a rank long enough to need rewriting. */
export async function longRankColumns(t: TenantDb) {
  const rows = await t.workItems.aggregate<{ _id: { spaceId: string; statusId: string } }>([
    { $match: { rank: { $regex: `^.{${MAX_RANK_LENGTH + 1},}$` } } },
    { $group: { _id: { spaceId: '$spaceId', statusId: '$statusId' } } },
  ]);
  return rows.map((r) => r._id);
}
