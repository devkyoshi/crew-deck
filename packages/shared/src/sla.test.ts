import { describe, expect, it } from 'vitest';
import { DEFAULT_SLA, isSlaPolicy, slaClockState, ticketSla } from './sla';

const now = new Date('2026-01-05T10:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe('slaClockState', () => {
  it('has no state without a deadline', () => {
    expect(slaClockState(null, null, now)).toBe('none');
  });

  it('is ok while there is time, due soon inside the last hour, and breached once it passes', () => {
    expect(slaClockState(at(180), null, now)).toBe('ok');
    expect(slaClockState(at(30), null, now)).toBe('due_soon');
    expect(slaClockState(at(-1), null, now)).toBe('breached');
  });

  it('is met when done in time and breached when done late', () => {
    expect(slaClockState(at(60), at(20), now)).toBe('met');
    expect(slaClockState(at(-30), at(-10), now)).toBe('breached');
  });

  it('accepts ISO strings, as they arrive from the API', () => {
    expect(slaClockState(at(30).toISOString(), null, now)).toBe('due_soon');
  });
});

describe('ticketSla', () => {
  it('reads the response clock from the first answer and the resolve clock from resolution', () => {
    const s = ticketSla(
      { slaResponseDueAt: at(60), slaResolveDueAt: at(600), firstResponseAt: at(10), resolvedAt: null },
      now,
    );
    expect(s).toEqual({ response: 'met', resolve: 'ok' });
  });
});

describe('isSlaPolicy', () => {
  it('accepts the defaults', () => {
    expect(isSlaPolicy(DEFAULT_SLA)).toBe(true);
  });

  it('rejects missing priorities, zero and fractional minutes', () => {
    expect(isSlaPolicy({ businessHours: true, targets: {} })).toBe(false);
    const zero = structuredClone(DEFAULT_SLA);
    zero.targets.high.responseMinutes = 0;
    expect(isSlaPolicy(zero)).toBe(false);
    const half = structuredClone(DEFAULT_SLA);
    half.targets.low.resolveMinutes = 1.5;
    expect(isSlaPolicy(half)).toBe(false);
    expect(isSlaPolicy(null)).toBe(false);
  });
});
