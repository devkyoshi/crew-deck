import { DEFAULT_STATUSES, WORKSPACE_TEMPLATES, isWorkType, type StatusTemplate } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';

/**
 * Gives a new space its board, item counter and starting columns. This replaces the Postgres trigger
 * that did it on every insert, so every code path that creates a space (API, seed, tests) must call it.
 * Columns come from the workspace's template (software teams get To Do / In Progress / In Review / Done,
 * construction gets Planned / On site / Inspection / Complete, and so on).
 */
export async function seedSpaceWork(
  t: TenantDb,
  spaceId: string,
  opts: { statuses?: readonly StatusTemplate[] } = {},
) {
  let statuses = opts.statuses;
  if (!statuses) {
    const org = await t.organization();
    statuses =
      org?.workType && isWorkType(org.workType)
        ? WORKSPACE_TEMPLATES[org.workType].statuses
        : DEFAULT_STATUSES;
  }
  await t.boards.insert({ spaceId });
  await t.spaceCounters.insert({ spaceId });
  await t.spaceStatuses.insert(
    statuses.map((s, position) => ({
      spaceId,
      name: s.name,
      category: s.category,
      position,
      color: s.color,
    })),
  );
}
