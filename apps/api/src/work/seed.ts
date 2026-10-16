import {
  DEFAULT_STATUSES,
  SERVICE_STATUSES,
  WORKSPACE_TEMPLATES,
  featuresFromBoardType,
  isWorkType,
  normalizeFeatures,
  type BoardType,
  type SpaceFeature,
  type StatusTemplate,
} from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { boardFieldsFor } from './space-features.js';

/**
 * Gives a new space its board, item counter and starting columns. This replaces the Postgres trigger
 * that did it on every insert, so every code path that creates a space (API, seed, tests) must call it.
 * Columns come from the workspace's template (software teams get To Do / In Progress / In Review / Done,
 * construction gets Planned / On site / Inspection / Complete, and so on).
 */
export async function seedSpaceWork(
  t: TenantDb,
  spaceId: string,
  opts: { statuses?: readonly StatusTemplate[]; features?: readonly SpaceFeature[]; boardType?: BoardType } = {},
) {
  // `boardType` is the older way to say the same thing and still works for callers that use it.
  const features = opts.features ? normalizeFeatures(opts.features) : featuresFromBoardType(opts.boardType);
  // A desk that is only tickets starts with ticket columns; any other mix uses the workspace's own.
  const deskOnly = features.includes('tickets') && !features.includes('sprints') && !features.includes('epics');
  let statuses = opts.statuses ?? (deskOnly ? SERVICE_STATUSES : undefined);
  if (!statuses) {
    const org = await t.organization();
    statuses =
      org?.workType && isWorkType(org.workType)
        ? WORKSPACE_TEMPLATES[org.workType].statuses
        : DEFAULT_STATUSES;
  }
  await t.boards.insert({ spaceId, ...boardFieldsFor(features) });
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
