import { describe, it, expect } from 'vitest';
import { expandToBusyPeriods, icalTimeToMs, BusyPeriod } from './recurrence-expander.js';
import { DateTime } from 'luxon';

// ---------------------------------------------------------------------------
// Helper: build minimal ICS strings for testing
// ---------------------------------------------------------------------------

function makeNonRecurringICS(uid: string, dtstart: string, dtend: string, tzid?: string): string {
  const startProp = tzid
    ? `DTSTART;TZID=${tzid}:${dtstart}`
    : `DTSTART:${dtstart}`;
  const endProp = tzid
    ? `DTEND;TZID=${tzid}:${dtend}`
    : `DTEND:${dtend}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:Test Event ${uid}`,
    startProp,
    endProp,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function makeAllDayICS(uid: string, dtstart: string, dtend: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:All Day Event ${uid}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function makeRecurringICS(uid: string, dtstart: string, dtend: string, rrule: string, tzid?: string, exdates?: string[]): string {
  const startProp = tzid
    ? `DTSTART;TZID=${tzid}:${dtstart}`
    : `DTSTART:${dtstart}`;
  const endProp = tzid
    ? `DTEND;TZID=${tzid}:${dtend}`
    : `DTEND:${dtend}`;
  const exdateLines = (exdates ?? []).map((exdate) =>
    tzid ? `EXDATE;TZID=${tzid}:${exdate}` : `EXDATE:${exdate}`
  );
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:Recurring ${uid}`,
    startProp,
    endProp,
    `RRULE:${rrule}`,
    ...exdateLines,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function makeRecurrenceIdOverrideICS(uid: string, recurrenceId: string, dtstart: string, dtend: string, tzid?: string): string {
  const ridProp = tzid
    ? `RECURRENCE-ID;TZID=${tzid}:${recurrenceId}`
    : `RECURRENCE-ID:${recurrenceId}`;
  const startProp = tzid
    ? `DTSTART;TZID=${tzid}:${dtstart}`
    : `DTSTART:${dtstart}`;
  const endProp = tzid
    ? `DTEND;TZID=${tzid}:${dtend}`
    : `DTEND:${dtend}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:Override for ${uid}`,
    ridProp,
    startProp,
    endProp,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Known epoch values for testing (UTC)
// 2024-03-01T00:00:00Z = 1709251200000
// 2024-03-08T00:00:00Z = 1709856000000
// 2024-03-15T00:00:00Z = 1710460800000
// 2024-03-22T00:00:00Z = 1711065600000
// 2024-04-01T00:00:00Z = 1711929600000
// ---------------------------------------------------------------------------

const D_2024_03_01 = DateTime.fromISO('2024-03-01T00:00:00', { zone: 'UTC' }).toMillis();
const D_2024_03_08 = DateTime.fromISO('2024-03-08T00:00:00', { zone: 'UTC' }).toMillis();
const D_2024_03_15 = DateTime.fromISO('2024-03-15T00:00:00', { zone: 'UTC' }).toMillis();
const D_2024_03_22 = DateTime.fromISO('2024-03-22T00:00:00', { zone: 'UTC' }).toMillis();
const D_2024_04_01 = DateTime.fromISO('2024-04-01T00:00:00', { zone: 'UTC' }).toMillis();

describe('expandToBusyPeriods', () => {
  describe('non-recurring events', () => {
    it('produces one BusyPeriod for a non-recurring UTC event within the window', () => {
      const ics = makeNonRecurringICS(
        'test-nonrecur-1',
        '20240310T090000Z',
        '20240310T100000Z',
      );
      const windowStart = D_2024_03_01;
      const windowEnd = D_2024_04_01;
      const result = expandToBusyPeriods([ics], windowStart, windowEnd);
      expect(result).toHaveLength(1);
      const expected9am = DateTime.fromISO('2024-03-10T09:00:00', { zone: 'UTC' }).toMillis();
      const expected10am = DateTime.fromISO('2024-03-10T10:00:00', { zone: 'UTC' }).toMillis();
      expect(result[0]!.startMs).toBe(expected9am);
      expect(result[0]!.endMs).toBe(expected10am);
    });

    it('produces no BusyPeriod for a non-recurring event outside the window', () => {
      const ics = makeNonRecurringICS(
        'test-nonrecur-outside',
        '20240501T090000Z',
        '20240501T100000Z',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(0);
    });

    it('produces BusyPeriod for event that starts before but ends within the window', () => {
      const ics = makeNonRecurringICS(
        'test-nonrecur-overlap-start',
        '20240229T230000Z',
        '20240301T010000Z',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(1);
    });
  });

  describe('all-day events', () => {
    it('produces UTC midnight-to-midnight BusyPeriod for an all-day event', () => {
      const ics = makeAllDayICS('test-allday-1', '20240310', '20240311');
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(1);
      const expectedStart = DateTime.fromISO('2024-03-10T00:00:00', { zone: 'UTC' }).toMillis();
      const expectedEnd = DateTime.fromISO('2024-03-11T00:00:00', { zone: 'UTC' }).toMillis();
      expect(result[0]!.startMs).toBe(expectedStart);
      expect(result[0]!.endMs).toBe(expectedEnd);
    });
  });

  describe('recurring events with RRULE', () => {
    it('produces correct number of BusyPeriods for FREQ=DAILY;COUNT=5', () => {
      const ics = makeRecurringICS(
        'test-daily-5',
        '20240301T090000Z',
        '20240301T100000Z',
        'FREQ=DAILY;COUNT=5',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(5);
    });

    it('produces BusyPeriods only within the window for FREQ=DAILY;COUNT=10', () => {
      // Window only covers first 3 days
      const windowEnd = DateTime.fromISO('2024-03-04T00:00:00', { zone: 'UTC' }).toMillis();
      const ics = makeRecurringICS(
        'test-daily-window',
        '20240301T090000Z',
        '20240301T100000Z',
        'FREQ=DAILY;COUNT=10',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, windowEnd);
      expect(result).toHaveLength(3);
    });

    it('stops at window end for unbounded RRULE (no COUNT or UNTIL)', () => {
      // An unbounded FREQ=DAILY should produce only occurrences within the 7-day window
      const windowEnd = DateTime.fromISO('2024-03-08T00:00:00', { zone: 'UTC' }).toMillis();
      const ics = makeRecurringICS(
        'test-daily-unbounded',
        '20240301T090000Z',
        '20240301T100000Z',
        'FREQ=DAILY',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, windowEnd);
      // 7 days: Mar 1, 2, 3, 4, 5, 6, 7 (Mar 8 start is at window end, should be excluded)
      expect(result).toHaveLength(7);
    });

    it('excludes EXDATE occurrences from expansion', () => {
      // 5 daily occurrences, with EXDATE on day 3 (2024-03-03)
      const ics = makeRecurringICS(
        'test-daily-exdate',
        '20240301T090000Z',
        '20240301T100000Z',
        'FREQ=DAILY;COUNT=5',
        undefined,
        ['20240303T090000Z'],
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      // Should have 4 occurrences (day 3 excluded)
      expect(result).toHaveLength(4);
    });

    it('applies RECURRENCE-ID override — overridden time replaces original', () => {
      // Master: daily for 3 days starting 2024-03-01 09:00 UTC
      const masterICS = makeRecurringICS(
        'test-recid-1',
        '20240301T090000Z',
        '20240301T100000Z',
        'FREQ=DAILY;COUNT=3',
      );
      // Override: RECURRENCE-ID=20240302T090000Z → move to 14:00 UTC on same day
      const overrideICS = makeRecurrenceIdOverrideICS(
        'test-recid-1',
        '20240302T090000Z',
        '20240302T140000Z',
        '20240302T150000Z',
      );
      const result = expandToBusyPeriods([masterICS, overrideICS], D_2024_03_01, D_2024_04_01);
      // Still 3 occurrences total
      expect(result).toHaveLength(3);
      // The overridden occurrence should be at 14:00, not 09:00
      const overriddenOccurrence = result.find(
        (p) => p.startMs === DateTime.fromISO('2024-03-02T14:00:00', { zone: 'UTC' }).toMillis()
      );
      expect(overriddenOccurrence).toBeDefined();
      // Original 09:00 on Mar 2 should NOT be present
      const originalOccurrence = result.find(
        (p) => p.startMs === DateTime.fromISO('2024-03-02T09:00:00', { zone: 'UTC' }).toMillis()
      );
      expect(originalOccurrence).toBeUndefined();
    });
  });

  describe('timezone handling', () => {
    it('produces DST-correct epoch values for America/Chicago event', () => {
      // 2024-03-08 09:00 America/Chicago = UTC-6 (before DST change at 2am) = 15:00 UTC
      // 2024-03-15 09:00 America/Chicago = UTC-5 (after DST change) = 14:00 UTC
      const ics = makeRecurringICS(
        'test-chicago-dst',
        '20240308T090000',
        '20240308T100000',
        'FREQ=WEEKLY;COUNT=2',
        'America/Chicago',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(2);
      // First: Mar 8 09:00 America/Chicago = UTC-6 → 15:00 UTC
      const firstStart = DateTime.fromISO('2024-03-08T09:00:00', { zone: 'America/Chicago' }).toMillis();
      expect(result[0]!.startMs).toBe(firstStart);
      // Second: Mar 15 09:00 America/Chicago = UTC-5 → 14:00 UTC
      const secondStart = DateTime.fromISO('2024-03-15T09:00:00', { zone: 'America/Chicago' }).toMillis();
      expect(result[1]!.startMs).toBe(secondStart);
    });

    it('produces correct epoch for non-UTC timezone non-recurring event', () => {
      const ics = makeNonRecurringICS(
        'test-tz-nonrecur',
        '20240310T090000',
        '20240310T100000',
        'America/New_York',
      );
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(1);
      const expectedStart = DateTime.fromISO('2024-03-10T09:00:00', { zone: 'America/New_York' }).toMillis();
      const expectedEnd = DateTime.fromISO('2024-03-10T10:00:00', { zone: 'America/New_York' }).toMillis();
      expect(result[0]!.startMs).toBe(expectedStart);
      expect(result[0]!.endMs).toBe(expectedEnd);
    });
  });

  describe('edge cases', () => {
    it('handles multiple ICS objects from same UID as a group', () => {
      // Two non-recurring events with different UIDs
      const ics1 = makeNonRecurringICS('uid-a', '20240310T090000Z', '20240310T100000Z');
      const ics2 = makeNonRecurringICS('uid-b', '20240311T090000Z', '20240311T100000Z');
      const result = expandToBusyPeriods([ics1, ics2], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(2);
    });

    it('returns empty array for empty ICS list', () => {
      const result = expandToBusyPeriods([], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(0);
    });

    it('handles event with no DTEND by using startDate as endDate (zero duration)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//Test//EN',
        'BEGIN:VEVENT',
        'UID:test-no-dtend',
        'SUMMARY:No End',
        'DTSTART:20240310T090000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const result = expandToBusyPeriods([ics], D_2024_03_01, D_2024_04_01);
      expect(result).toHaveLength(1);
      const expectedMs = DateTime.fromISO('2024-03-10T09:00:00', { zone: 'UTC' }).toMillis();
      expect(result[0]!.startMs).toBe(expectedMs);
      expect(result[0]!.endMs).toBe(expectedMs);
    });
  });
});
