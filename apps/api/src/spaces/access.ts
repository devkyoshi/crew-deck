import type { TenantDb } from '../db/client.js';
import type { SpaceDoc } from '../db/types.js';
import type { Actor, SpaceRole } from '../permissions/can.js';

const RANK: Record<SpaceRole, number> = { admin: 3, member: 2, viewer: 1 };

/** A space as the caller sees it: the space plus their effective role, star and member count. */
export interface SpaceView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  visibility: 'open' | 'private';
  status: 'active' | 'archived';
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  myRole: SpaceRole | null;
  starred: boolean;
  memberCount: number;
}

export const isOrgAdmin = (a: Pick<Actor, 'orgRole'>) =>
  a.orgRole === 'owner' || a.orgRole === 'admin';

/**
 * The caller's effective role in each space: the highest of their direct membership and every group
 * they belong to (admin > member > viewer). Missing from the map when they have no access through
 * membership. Replaces the old correlated subquery so list and detail share one definition.
 */
export async function effectiveRoles(
  t: TenantDb,
  userId: string,
  spaceIds?: string[],
): Promise<Map<string, SpaceRole>> {
  const myGroups = (await t.groupMembers.find({ userId })).map((g) => g.groupId);
  const rows = await t.spaceMembers.find({
    ...(spaceIds ? { spaceId: { $in: spaceIds } } : {}),
    $or: [
      { principalType: 'user', principalId: userId },
      ...(myGroups.length ? [{ principalType: 'group' as const, principalId: { $in: myGroups } }] : []),
    ],
  });
  const roles = new Map<string, SpaceRole>();
  for (const m of rows) {
    const current = roles.get(m.spaceId);
    if (!current || RANK[m.spaceRole] > RANK[current]) roles.set(m.spaceId, m.spaceRole);
  }
  return roles;
}

/** One space's effective role for a user, or null. */
export async function effectiveRole(
  t: TenantDb,
  userId: string,
  spaceId: string,
): Promise<SpaceRole | null> {
  return (await effectiveRoles(t, userId, [spaceId])).get(spaceId) ?? null;
}

/**
 * Spaces the caller may see, as views. Org owners and admins see everything; everyone else sees open
 * spaces plus private ones they have a role in. Deleted spaces are never visible.
 * `filter` narrows the stored spaces (e.g. by key or status) before visibility is applied.
 */
export async function loadVisibleSpaces(
  t: TenantDb,
  actor: Pick<Actor, 'userId' | 'orgRole'>,
  filter: Record<string, unknown> = {},
): Promise<SpaceView[]> {
  const docs = await t.spaces.find({ ...filter, deletedAt: null });
  if (docs.length === 0) return [];
  const ids = docs.map((s) => s.id);
  const [roles, stars, members] = await Promise.all([
    effectiveRoles(t, actor.userId, ids),
    t.spaceStars.find({ userId: actor.userId, spaceId: { $in: ids } }),
    t.spaceMembers.aggregate<{ _id: string; n: number }>([
      { $match: { spaceId: { $in: ids } } },
      { $group: { _id: '$spaceId', n: { $sum: 1 } } },
    ]),
  ]);
  const starred = new Set(stars.map((s) => s.spaceId));
  const counts = new Map(members.map((m) => [m._id, m.n]));
  const admin = isOrgAdmin(actor);
  const views: SpaceView[] = [];
  for (const s of docs) {
    const myRole = roles.get(s.id) ?? null;
    if (!admin && s.visibility !== 'open' && myRole === null) continue;
    views.push(toView(s, myRole, starred.has(s.id), counts.get(s.id) ?? 0));
  }
  return views;
}

export const toView = (
  s: SpaceDoc,
  myRole: SpaceRole | null,
  starred: boolean,
  memberCount: number,
): SpaceView => ({
  id: s.id,
  key: s.key,
  name: s.name,
  description: s.description,
  icon: s.icon,
  visibility: s.visibility,
  status: s.status,
  ownerId: s.ownerId,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  myRole,
  starred,
  memberCount,
});

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const isValidKey = (key: string) => KEY_RE.test(key);
