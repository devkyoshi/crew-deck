import { describe, expect, it } from 'vitest';
import {
  boardTypeFromFeatures,
  FEATURE_GROUPS,
  FEATURE_PRESETS,
  featuresFromBoardType,
  normalizeFeatures,
  planFeaturesFor,
  SPACE_FEATURES,
} from './space-features';

describe('space features', () => {
  it('every feature belongs to exactly one group', () => {
    const grouped = FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.key));
    expect([...grouped].sort()).toEqual([...SPACE_FEATURES].sort());
  });

  it('presets only use known features, already in the standard order', () => {
    for (const p of FEATURE_PRESETS) expect(normalizeFeatures(p.features)).toEqual(p.features);
  });

  it('normalizes: drops unknown and repeats, keeps the standard order', () => {
    expect(normalizeFeatures(['tickets', 'nope', 'sprints', 'tickets'])).toEqual(['sprints', 'tickets']);
    expect(normalizeFeatures(null)).toEqual([]);
  });

  it('infers features for spaces made before they existed', () => {
    expect(featuresFromBoardType('scrum')).toContain('sprints');
    expect(featuresFromBoardType('kanban')).not.toContain('sprints');
    expect(featuresFromBoardType('service')).toEqual(['tickets']);
    expect(featuresFromBoardType(undefined)).toContain('epics');
  });

  it('maps features back to the closest legacy board type', () => {
    expect(boardTypeFromFeatures(['sprints', 'tickets'])).toBe('scrum');
    expect(boardTypeFromFeatures(['tickets'])).toBe('service');
    expect(boardTypeFromFeatures(['epics', 'tickets'])).toBe('kanban');
    expect(boardTypeFromFeatures([])).toBe('kanban');
  });

  it('names the plan features a set needs', () => {
    expect(planFeaturesFor(['sprints', 'epics', 'tickets'])).toEqual(['scrum_sprints', 'service_desk']);
  });

  it('round-trips each legacy type through features and back', () => {
    for (const t of ['kanban', 'scrum', 'service'] as const) {
      expect(boardTypeFromFeatures(featuresFromBoardType(t))).toBe(t);
    }
  });
});
