import {
  boardTypeFromFeatures,
  featuresFromBoardType,
  normalizeFeatures,
  type SpaceFeature,
} from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { assertFeature, type EffectivePlan } from '../plans/index.js';
import type { BoardDoc } from '../db/types.js';
import { AppError } from '../lib/errors.js';

/**
 * What a space has switched on. Spaces made before features existed have none stored, so they get what
 * their board type used to give them; nothing needs migrating.
 */
export function featuresOfBoard(board: Pick<BoardDoc, 'type' | 'features'> | null | undefined): SpaceFeature[] {
  if (board?.features) return normalizeFeatures(board.features);
  return featuresFromBoardType(board?.type);
}

export async function loadFeatures(t: TenantDb, spaceId: string): Promise<SpaceFeature[]> {
  return featuresOfBoard(await t.boards.findOne({ spaceId }));
}

const LABEL: Record<SpaceFeature, string> = {
  sprints: 'sprints',
  epics: 'epics',
  releases: 'releases',
  roadmap: 'the roadmap',
  calendar: 'the calendar',
  tickets: 'tickets',
};

/** 422 unless the space has the feature on. */
export async function assertFeatureOn(t: TenantDb, spaceId: string, feature: SpaceFeature) {
  if (!(await loadFeatures(t, spaceId)).includes(feature)) {
    throw new AppError(422, `no_${feature}`, `This space does not use ${LABEL[feature]}. A space admin can turn it on in Board settings.`);
  }
}

/** Sprints and tickets need a plan that includes them; the other features are open to every plan. */
export function assertPlanAllows(plan: EffectivePlan, features: readonly SpaceFeature[]) {
  if (features.includes('sprints')) assertFeature(plan, 'scrum_sprints', 'Sprints');
  if (features.includes('tickets')) assertFeature(plan, 'service_desk', 'Tickets');
}

/** The stored shape for a set of features: the list, plus the legacy board type that matches it. */
export const boardFieldsFor = (features: readonly SpaceFeature[]) => {
  const list = normalizeFeatures(features);
  return { features: list, type: boardTypeFromFeatures(list) };
};
