import { and, eq, sql, type SQL } from 'drizzle-orm';
import { spaces } from '../db/schema.js';
import type { SpaceRole } from '../permissions/can.js';

// Drizzle renders a column inside a raw sql`` fragment without its table, so inside a subquery an
// unqualified "id" would bind to the subquery's own table. Qualify the outer reference explicitly.
const SPACE_ID = sql.raw('"spaces"."id"');

/**
 * The caller's effective role in a space: the highest of their direct membership and every group
 * they belong to (admin > member > viewer). NULL when they have no access through membership.
 * Written as a correlated subquery so list and detail queries share one definition.
 */
export function effectiveRoleSql(userId: string, orgId: string) {
  return sql<SpaceRole | null>`(
    select sm.space_role from space_members sm
    where sm.space_id = ${SPACE_ID} and sm.org_id = ${orgId}
      and (
        (sm.principal_type = 'user' and sm.principal_id = ${userId})
        or (sm.principal_type = 'group' and sm.principal_id in (
          select gm.group_id from group_members gm where gm.user_id = ${userId} and gm.org_id = ${orgId}
        ))
      )
    order by case sm.space_role when 'admin' then 3 when 'member' then 2 else 1 end desc
    limit 1
  )`;
}

export const starredSql = (userId: string) => sql<boolean>`exists (
  select 1 from space_stars st where st.space_id = ${SPACE_ID} and st.user_id = ${userId}
)`;

export const memberCountSql = sql<number>`(
  select count(*)::int from space_members sm where sm.space_id = ${SPACE_ID}
)`;

/**
 * Rows the caller may see. Org owners and admins see everything; everyone else sees open spaces
 * plus private ones they have a role in. Deleted spaces are never visible.
 */
export function visibleTo(opts: { orgId: string; isOrgAdmin: boolean; role: SQL }): SQL {
  const base = and(eq(spaces.orgId, opts.orgId), sql`${spaces.deletedAt} is null`)!;
  if (opts.isOrgAdmin) return base;
  return and(base, sql`(${spaces.visibility} = 'open' or ${opts.role} is not null)`)!;
}

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const isValidKey = (key: string) => KEY_RE.test(key);
