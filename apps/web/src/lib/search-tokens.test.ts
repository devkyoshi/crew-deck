import { describe, expect, it } from 'vitest';
import { setToken, toggleToken } from './search-tokens';

describe('search filter tokens', () => {
  it('adds a filter, and removes it when toggled again', () => {
    expect(toggleToken('budget', 'has:file')).toBe('budget has:file');
    expect(toggleToken('budget has:file', 'has:file')).toBe('budget');
    expect(toggleToken('', 'is:thread')).toBe('is:thread');
  });

  it('replaces a dated filter instead of stacking them, and can clear it', () => {
    expect(setToken('plan after:2026-01-01', 'after', '2026-02-01')).toBe('plan after:2026-02-01');
    expect(setToken('plan after:2026-01-01 before:2026-03-01', 'after', null)).toBe(
      'plan before:2026-03-01',
    );
    expect(setToken('plan', 'before', '2026-03-01')).toBe('plan before:2026-03-01');
  });
});
