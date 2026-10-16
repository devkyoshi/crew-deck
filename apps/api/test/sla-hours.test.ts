import { describe, expect, it } from 'vitest';
import { addWorkingMinutes, type WorkCalendar } from '../src/work/sla.js';

const cal: WorkCalendar = { tz: 'UTC', workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '17:00' };

describe('addWorkingMinutes', () => {
  it('adds within the same working day', () => {
    // Monday 5 January 2026, 10:00 plus two hours
    expect(addWorkingMinutes(new Date('2026-01-05T10:00:00Z'), 120, cal).toISOString()).toBe('2026-01-05T12:00:00.000Z');
  });

  it('rolls over to the next morning after closing time', () => {
    // Monday 16:00 plus two hours: one hour left today, one the next morning
    expect(addWorkingMinutes(new Date('2026-01-05T16:00:00Z'), 120, cal).toISOString()).toBe('2026-01-06T10:00:00.000Z');
  });

  it('skips the weekend', () => {
    // Friday 16:30 plus one hour: thirty minutes today, thirty on Monday
    expect(addWorkingMinutes(new Date('2026-01-09T16:30:00Z'), 60, cal).toISOString()).toBe('2026-01-12T09:30:00.000Z');
  });

  it('starts counting at opening time when raised overnight or on a day off', () => {
    expect(addWorkingMinutes(new Date('2026-01-10T12:00:00Z'), 60, cal).toISOString()).toBe('2026-01-12T10:00:00.000Z');
    expect(addWorkingMinutes(new Date('2026-01-06T03:00:00Z'), 30, cal).toISOString()).toBe('2026-01-06T09:30:00.000Z');
  });

  it('works in the workspace timezone', () => {
    const tokyo: WorkCalendar = { ...cal, tz: 'Asia/Tokyo' };
    // 01:00 UTC is 10:00 in Tokyo; two hours later is 12:00 there, which is 03:00 UTC
    expect(addWorkingMinutes(new Date('2026-01-05T01:00:00Z'), 120, tokyo).toISOString()).toBe('2026-01-05T03:00:00.000Z');
  });
});
