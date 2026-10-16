import { describe, expect, it } from 'vitest';
import { STATUS_COLORS } from './index';
import {
  capitalize,
  modulesFor,
  suggestedUsageFor,
  usageNeedsCrm,
  USAGE_KEYS,
  vocabularyFor,
  WORK_TYPES,
  WORKSPACE_TEMPLATES,
  workTypesOf,
} from './workspace';

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const SPACE_ICONS = ['folder', 'rocket', 'code', 'briefcase', 'palette', 'bug', 'chart', 'globe', 'shield', 'lightbulb', 'users', 'megaphone'];

describe('workspace templates', () => {
  it.each(WORK_TYPES)('%s is complete and valid', (type) => {
    const t = WORKSPACE_TEMPLATES[type];
    expect(t.type).toBe(type);
    expect(t.statuses.map((s) => s.category)).toEqual(expect.arrayContaining(['todo', 'in_progress', 'done']));
    for (const s of t.statuses) expect(STATUS_COLORS).toContain(s.color);
    for (const key of t.suggestedUsage) expect(USAGE_KEYS).toContain(key);
    expect(t.starter.space.key).toMatch(KEY_RE);
    expect(SPACE_ICONS).toContain(t.starter.space.icon);
    for (const l of t.starter.labels) expect(STATUS_COLORS).toContain(l.color);
    expect(new Set(t.starter.labels.map((l) => l.name.toLowerCase())).size).toBe(t.starter.labels.length);
    expect(t.itemTypes.length).toBeGreaterThan(0);
  });

  it('turns check-in on for everyone and CRM where the work needs it', () => {
    expect(modulesFor('construction', [])).toEqual(['members', 'spaces', 'checkin']);
    expect(modulesFor('sales', WORKSPACE_TEMPLATES.sales.suggestedUsage)).toContain('crm');
    expect(modulesFor('sales', [])).not.toContain('crm');
    expect(modulesFor('legal', ['track_leads'])).toContain('crm');
  });
});

describe('vocabularyFor', () => {
  it('uses the workspace’s own words', () => {
    const v = vocabularyFor('construction');
    expect(v.noun).toBe('job');
    expect(v.nounPlural).toBe('jobs');
    expect(v.typeLabel('task')).toBe('Job');
    expect(v.typeLabel('bug')).toBe('Defect');
    expect(v.typeLabel('epic')).toBe('Project');
    expect(v.allowedTypes).toEqual(['epic', 'task', 'bug', 'subtask']);
  });

  it('keeps the standard words for software and for workspaces with no kind chosen', () => {
    for (const v of [vocabularyFor('software'), vocabularyFor(null), vocabularyFor('not-a-type')]) {
      expect(v.noun).toBe('work item');
      expect(v.typeLabel('story')).toBe('Story');
      expect(v.allowedTypes).toEqual(['task', 'story', 'bug', 'epic', 'subtask']);
    }
  });

  it('always offers subtasks, once', () => {
    for (const type of WORK_TYPES) {
      const types = vocabularyFor(type).allowedTypes;
      expect(types.filter((t) => t === 'subtask')).toHaveLength(1);
    }
  });

  it('capitalizes nouns for headings', () => {
    expect(capitalize('work item')).toBe('Work item');
    expect(capitalize('')).toBe('');
  });
});

describe('several kinds of work', () => {
  it('workTypesOf keeps order, drops invalid and duplicates, and falls back to the single type', () => {
    expect(workTypesOf('software', ['sales', 'nope', 'sales', 'marketing'])).toEqual(['sales', 'marketing']);
    expect(workTypesOf('software', [])).toEqual(['software']);
    expect(workTypesOf(null, undefined)).toEqual([]);
  });

  it('modulesFor unions the modules of every type', () => {
    expect(modulesFor(['software', 'sales'], [])).toEqual(
      expect.arrayContaining([...modulesFor('software', []), ...modulesFor('sales', [])]),
    );
  });

  it('suggestedUsageFor unions without duplicates', () => {
    const u = suggestedUsageFor(['software', 'sales']);
    expect(new Set(u).size).toBe(u.length);
    for (const k of WORKSPACE_TEMPLATES.sales.suggestedUsage) expect(u).toContain(k);
  });
});

describe('CRM follows usage', () => {
  it('is needed only by the lead and activity options', () => {
    expect(usageNeedsCrm(['track_leads'])).toBe(true);
    expect(usageNeedsCrm(['log_activities', 'manage_tasks'])).toBe(true);
    expect(usageNeedsCrm(['manage_tasks', 'run_sprints'])).toBe(false);
    expect(usageNeedsCrm([])).toBe(false);
  });
});
