import { describe, expect, it } from 'vitest';
import {
  addDays,
  isRealDate,
  isValidTimezone,
  isoWeekday,
  localDate,
  tzOffsetMinutes,
  weekOf,
  zonedTimeToUtc,
} from '../src/lib/time.js';

describe('localDate: a day is the person’s own calendar date, not UTC', () => {
  // 2026-01-15 23:30 UTC
  const instant = new Date('2026-01-15T23:30:00Z');

  it('rolls forward for zones ahead of UTC and back for zones behind', () => {
    expect(localDate(instant, 'UTC')).toBe('2026-01-15');
    expect(localDate(instant, 'Asia/Colombo')).toBe('2026-01-16'); // UTC+5:30, already past midnight
    expect(localDate(instant, 'Pacific/Auckland')).toBe('2026-01-16'); // UTC+13 in January
    expect(localDate(instant, 'Pacific/Kiritimati')).toBe('2026-01-16'); // UTC+14
    expect(localDate(instant, 'America/New_York')).toBe('2026-01-15');
    expect(localDate(instant, 'Pacific/Pago_Pago')).toBe('2026-01-15'); // UTC-11
  });

  it('handles the exact boundaries', () => {
    expect(localDate(new Date('2026-06-30T18:29:59Z'), 'Asia/Colombo')).toBe('2026-06-30');
    expect(localDate(new Date('2026-06-30T18:30:00Z'), 'Asia/Colombo')).toBe('2026-07-01');
    expect(localDate(new Date('2026-12-31T23:59:59Z'), 'UTC')).toBe('2026-12-31');
    expect(localDate(new Date('2027-01-01T00:00:00Z'), 'UTC')).toBe('2027-01-01');
  });

  it('knows about leap days', () => {
    expect(localDate(new Date('2028-02-29T12:00:00Z'), 'UTC')).toBe('2028-02-29');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});

describe('tzOffsetMinutes and daylight saving', () => {
  it('reports offsets, including half-hour zones and DST changes', () => {
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Asia/Colombo')).toBe(330);
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(60);
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Asia/Kathmandu')).toBe(345);
  });
});

describe('zonedTimeToUtc: when does the wall clock read HH:MM?', () => {
  it('converts ordinary days', () => {
    expect(zonedTimeToUtc('2026-01-15', '20:00', 'UTC').toISOString()).toBe(
      '2026-01-15T20:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '20:00', 'Asia/Colombo').toISOString()).toBe(
      '2026-01-15T14:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '20:00', 'America/New_York').toISOString()).toBe(
      '2026-01-16T01:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '03:00', 'Pacific/Auckland').toISOString()).toBe(
      '2026-01-14T14:00:00.000Z',
    );
  });

  it('uses the offset that applies on that day across a DST change', () => {
    // US clocks spring forward on 2026-03-08: 20:00 is EST (-5) the day before, EDT (-4) the day after.
    expect(zonedTimeToUtc('2026-03-07', '20:00', 'America/New_York').toISOString()).toBe(
      '2026-03-08T01:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-08', '20:00', 'America/New_York').toISOString()).toBe(
      '2026-03-09T00:00:00.000Z',
    );
    // UK clocks go back on 2026-10-25.
    expect(zonedTimeToUtc('2026-10-24', '20:00', 'Europe/London').toISOString()).toBe(
      '2026-10-24T19:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-25', '20:00', 'Europe/London').toISOString()).toBe(
      '2026-10-25T20:00:00.000Z',
    );
  });

  it('round-trips with localDate', () => {
    for (const tz of [
      'Asia/Colombo',
      'America/New_York',
      'Pacific/Auckland',
      'Europe/London',
      'Pacific/Pago_Pago',
    ]) {
      const at = zonedTimeToUtc('2026-05-20', '20:00', tz);
      expect(localDate(at, tz)).toBe('2026-05-20');
      expect(localDate(new Date(at.getTime() + 4 * 3600_000 + 60_000), tz)).toBe('2026-05-21');
    }
  });
});

describe('calendar helpers', () => {
  it('numbers weekdays Monday=1 to Sunday=7', () => {
    expect(isoWeekday('2026-10-12')).toBe(1); // Monday
    expect(isoWeekday('2026-10-17')).toBe(6);
    expect(isoWeekday('2026-10-18')).toBe(7);
  });

  it('builds Monday-to-Sunday weeks, also across month and year ends', () => {
    expect(weekOf('2026-10-15')).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(weekOf('2026-10-18')[0]).toBe('2026-10-12'); // Sunday belongs to the week before
    expect(weekOf('2027-01-01')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('validates dates and timezones', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('26-1-1')).toBe(false);
    expect(isValidTimezone('Asia/Colombo')).toBe(true);
    expect(isValidTimezone('Mars/Base')).toBe(false);
  });
});
