import { describe, it, expect } from 'vitest';
import {
  mergePeriods,
  detectConflicts,
  findAvailableSlots,
  eventTimeToMs,
  msToEventTime,
} from './conflict-detector.js';
import type { BusyPeriod } from './recurrence-expander.js';
import { DateTime } from 'luxon';

// ---------------------------------------------------------------------------
// Helper: create a BusyPeriod from ISO strings in UTC
// ---------------------------------------------------------------------------
function bp(startISO: string, endISO: string): BusyPeriod {
  return {
    startMs: DateTime.fromISO(startISO, { zone: 'UTC' }).toMillis(),
    endMs: DateTime.fromISO(endISO, { zone: 'UTC' }).toMillis(),
  };
}

// ---------------------------------------------------------------------------
// mergePeriods
// ---------------------------------------------------------------------------
describe('mergePeriods', () => {
  it('returns empty for empty input', () => {
    expect(mergePeriods([])).toEqual([]);
  });

  it('returns single period unchanged', () => {
    const periods = [bp('2024-03-01T09:00:00', '2024-03-01T10:00:00')];
    const result = mergePeriods(periods);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(periods[0]);
  });

  it('leaves non-overlapping periods as separate entries', () => {
    const periods = [
      bp('2024-03-01T09:00:00', '2024-03-01T10:00:00'),
      bp('2024-03-01T11:00:00', '2024-03-01T12:00:00'),
    ];
    const result = mergePeriods(periods);
    expect(result).toHaveLength(2);
  });

  it('merges overlapping periods into one', () => {
    const periods = [
      bp('2024-03-01T09:00:00', '2024-03-01T10:30:00'),
      bp('2024-03-01T10:00:00', '2024-03-01T11:00:00'),
    ];
    const result = mergePeriods(periods);
    expect(result).toHaveLength(1);
    const expectedStart = DateTime.fromISO('2024-03-01T09:00:00', { zone: 'UTC' }).toMillis();
    const expectedEnd = DateTime.fromISO('2024-03-01T11:00:00', { zone: 'UTC' }).toMillis();
    expect(result[0]!.startMs).toBe(expectedStart);
    expect(result[0]!.endMs).toBe(expectedEnd);
  });

  it('merges adjacent periods (end == start) into one', () => {
    const periods = [
      bp('2024-03-01T09:00:00', '2024-03-01T10:00:00'),
      bp('2024-03-01T10:00:00', '2024-03-01T11:00:00'),
    ];
    const result = mergePeriods(periods);
    expect(result).toHaveLength(1);
    const expectedEnd = DateTime.fromISO('2024-03-01T11:00:00', { zone: 'UTC' }).toMillis();
    expect(result[0]!.endMs).toBe(expectedEnd);
  });

  it('handles complex mix: some overlapping, some separate', () => {
    const periods = [
      bp('2024-03-01T09:00:00', '2024-03-01T10:30:00'),
      bp('2024-03-01T10:00:00', '2024-03-01T11:00:00'),
      bp('2024-03-01T13:00:00', '2024-03-01T14:00:00'),
      bp('2024-03-01T13:30:00', '2024-03-01T14:30:00'),
      bp('2024-03-01T16:00:00', '2024-03-01T17:00:00'),
    ];
    const result = mergePeriods(periods);
    expect(result).toHaveLength(3);
    // First merged: 09:00 - 11:00
    expect(result[0]!.endMs).toBe(DateTime.fromISO('2024-03-01T11:00:00', { zone: 'UTC' }).toMillis());
    // Second merged: 13:00 - 14:30
    expect(result[1]!.endMs).toBe(DateTime.fromISO('2024-03-01T14:30:00', { zone: 'UTC' }).toMillis());
    // Third unchanged: 16:00 - 17:00
    expect(result[2]!.startMs).toBe(DateTime.fromISO('2024-03-01T16:00:00', { zone: 'UTC' }).toMillis());
  });

  it('sorts unsorted input before merging', () => {
    const periods = [
      bp('2024-03-01T11:00:00', '2024-03-01T12:00:00'),
      bp('2024-03-01T09:00:00', '2024-03-01T10:00:00'),
    ];
    const result = mergePeriods(periods);
    expect(result).toHaveLength(2);
    // First should be the 09:00 one
    expect(result[0]!.startMs).toBe(DateTime.fromISO('2024-03-01T09:00:00', { zone: 'UTC' }).toMillis());
  });
});

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------
describe('detectConflicts', () => {
  it('returns empty when no overlap exists', () => {
    const busy = [bp('2024-03-01T09:00:00', '2024-03-01T10:00:00')];
    const result = detectConflicts(
      DateTime.fromISO('2024-03-01T11:00:00', { zone: 'UTC' }).toMillis(),
      DateTime.fromISO('2024-03-01T12:00:00', { zone: 'UTC' }).toMillis(),
      busy,
    );
    expect(result).toHaveLength(0);
  });

  it('returns conflicting period when overlap exists', () => {
    const conflictingPeriod = bp('2024-03-01T09:30:00', '2024-03-01T10:30:00');
    const busy = [
      bp('2024-03-01T08:00:00', '2024-03-01T09:00:00'),
      conflictingPeriod,
    ];
    const result = detectConflicts(
      DateTime.fromISO('2024-03-01T10:00:00', { zone: 'UTC' }).toMillis(),
      DateTime.fromISO('2024-03-01T11:00:00', { zone: 'UTC' }).toMillis(),
      busy,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(conflictingPeriod);
  });

  it('returns empty when proposed end == busy start (exact boundary, non-overlapping)', () => {
    const busy = [bp('2024-03-01T10:00:00', '2024-03-01T11:00:00')];
    const result = detectConflicts(
      DateTime.fromISO('2024-03-01T09:00:00', { zone: 'UTC' }).toMillis(),
      DateTime.fromISO('2024-03-01T10:00:00', { zone: 'UTC' }).toMillis(),
      busy,
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty when proposed start == busy end (exact boundary, non-overlapping)', () => {
    const busy = [bp('2024-03-01T09:00:00', '2024-03-01T10:00:00')];
    const result = detectConflicts(
      DateTime.fromISO('2024-03-01T10:00:00', { zone: 'UTC' }).toMillis(),
      DateTime.fromISO('2024-03-01T11:00:00', { zone: 'UTC' }).toMillis(),
      busy,
    );
    expect(result).toHaveLength(0);
  });

  it('returns multiple conflicts when proposed time overlaps multiple busy periods', () => {
    const busy = [
      bp('2024-03-01T09:00:00', '2024-03-01T09:30:00'),
      bp('2024-03-01T10:00:00', '2024-03-01T10:30:00'),
      bp('2024-03-01T11:00:00', '2024-03-01T12:00:00'),
    ];
    const result = detectConflicts(
      DateTime.fromISO('2024-03-01T09:15:00', { zone: 'UTC' }).toMillis(),
      DateTime.fromISO('2024-03-01T10:15:00', { zone: 'UTC' }).toMillis(),
      busy,
    );
    expect(result).toHaveLength(2);
  });

  it('returns empty for empty busy list', () => {
    const result = detectConflicts(
      DateTime.fromISO('2024-03-01T09:00:00', { zone: 'UTC' }).toMillis(),
      DateTime.fromISO('2024-03-01T10:00:00', { zone: 'UTC' }).toMillis(),
      [],
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findAvailableSlots
// ---------------------------------------------------------------------------
describe('findAvailableSlots', () => {
  const windowStart = DateTime.fromISO('2024-03-01T08:00:00', { zone: 'UTC' }).toMillis();
  const windowEnd = DateTime.fromISO('2024-03-01T18:00:00', { zone: 'UTC' }).toMillis();
  const oneHourMs = 60 * 60 * 1000;

  it('returns slots at window start when no busy periods', () => {
    const result = findAvailableSlots({
      searchWindowStartMs: windowStart,
      searchWindowEndMs: windowEnd,
      durationMs: oneHourMs,
      busyPeriods: [],
      maxSlots: 3,
    });
    expect(result.length).toBeGreaterThan(0);
    // First slot should start at windowStart
    expect(result[0]!.startMs).toBe(windowStart);
    expect(result[0]!.endMs).toBe(windowStart + oneHourMs);
  });

  it('respects maxSlots count', () => {
    const result = findAvailableSlots({
      searchWindowStartMs: windowStart,
      searchWindowEndMs: windowEnd,
      durationMs: oneHourMs,
      busyPeriods: [],
      maxSlots: 3,
    });
    expect(result).toHaveLength(3);
  });

  it('finds gaps between busy periods', () => {
    const busy = [bp('2024-03-01T09:00:00', '2024-03-01T11:00:00')];
    const result = findAvailableSlots({
      searchWindowStartMs: windowStart,
      searchWindowEndMs: windowEnd,
      durationMs: oneHourMs,
      busyPeriods: busy,
      maxSlots: 5,
    });
    // Gaps: 08:00-09:00 (1h), 11:00-18:00 (7h)
    // Should find at least 2 slots (one before, multiple after)
    expect(result.length).toBeGreaterThanOrEqual(2);
    // No slot should overlap the busy period
    for (const slot of result) {
      const overlaps = slot.startMs < busy[0]!.endMs && slot.endMs > busy[0]!.startMs;
      expect(overlaps).toBe(false);
    }
  });

  it('does not return slots shorter than duration', () => {
    // Gap of 30 min: too small for 1 hour slot
    const busy = [
      bp('2024-03-01T09:00:00', '2024-03-01T11:00:00'),
      bp('2024-03-01T11:30:00', '2024-03-01T18:00:00'),
    ];
    const result = findAvailableSlots({
      searchWindowStartMs: windowStart,
      searchWindowEndMs: windowEnd,
      durationMs: oneHourMs,
      busyPeriods: busy,
      maxSlots: 5,
    });
    // Only 08:00-09:00 is 1h gap; 11:00-11:30 is 30 min (too small)
    expect(result).toHaveLength(1);
    expect(result[0]!.startMs).toBe(windowStart);
  });

  it('applies working hours filter — skips slots outside hours', () => {
    // Window 00:00-24:00 UTC, working hours 9-17, slot in UTC timezone
    const fullDayStart = DateTime.fromISO('2024-03-01T00:00:00', { zone: 'UTC' }).toMillis();
    const fullDayEnd = DateTime.fromISO('2024-03-02T00:00:00', { zone: 'UTC' }).toMillis();
    const result = findAvailableSlots({
      searchWindowStartMs: fullDayStart,
      searchWindowEndMs: fullDayEnd,
      durationMs: oneHourMs,
      busyPeriods: [],
      workingHoursStart: 9,
      workingHoursEnd: 17,
      maxSlots: 10,
      slotTzid: 'UTC',
    });
    // All slots should be within 09:00-17:00
    for (const slot of result) {
      const startHour = DateTime.fromMillis(slot.startMs, { zone: 'UTC' }).hour;
      expect(startHour).toBeGreaterThanOrEqual(9);
      expect(startHour).toBeLessThan(17);
    }
    // maxSlots = 10; with 30-min increments 10 slots can fit in 9-17 window
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('slot end respects working hours upper boundary', () => {
    const fullDayStart = DateTime.fromISO('2024-03-01T00:00:00', { zone: 'UTC' }).toMillis();
    const fullDayEnd = DateTime.fromISO('2024-03-02T00:00:00', { zone: 'UTC' }).toMillis();
    const result = findAvailableSlots({
      searchWindowStartMs: fullDayStart,
      searchWindowEndMs: fullDayEnd,
      durationMs: oneHourMs,
      busyPeriods: [],
      workingHoursStart: 9,
      workingHoursEnd: 17,
      maxSlots: 10,
      slotTzid: 'UTC',
    });
    // No slot should end after 17:00
    for (const slot of result) {
      const endDt = DateTime.fromMillis(slot.endMs, { zone: 'UTC' });
      const endHour = endDt.hour;
      const endMinute = endDt.minute;
      // endMs should be <= 17:00
      expect(endHour * 60 + endMinute).toBeLessThanOrEqual(17 * 60);
    }
  });

  it('advances to next day when outside working hours at end of day', () => {
    // Two-day window with working hours 9-17
    const start = DateTime.fromISO('2024-03-01T00:00:00', { zone: 'UTC' }).toMillis();
    const end = DateTime.fromISO('2024-03-03T00:00:00', { zone: 'UTC' }).toMillis();
    // Busy periods fill all working hours on day 1
    const busy = [bp('2024-03-01T09:00:00', '2024-03-01T17:00:00')];
    const result = findAvailableSlots({
      searchWindowStartMs: start,
      searchWindowEndMs: end,
      durationMs: oneHourMs,
      busyPeriods: busy,
      workingHoursStart: 9,
      workingHoursEnd: 17,
      maxSlots: 3,
      slotTzid: 'UTC',
    });
    // Slots should be on day 2
    for (const slot of result) {
      const dt = DateTime.fromMillis(slot.startMs, { zone: 'UTC' });
      expect(dt.day).toBe(2);
    }
  });

  it('slots are aligned to 30-minute increments', () => {
    const result = findAvailableSlots({
      searchWindowStartMs: windowStart,
      searchWindowEndMs: windowEnd,
      durationMs: oneHourMs,
      busyPeriods: [],
      maxSlots: 5,
    });
    for (const slot of result) {
      const dt = DateTime.fromMillis(slot.startMs, { zone: 'UTC' });
      // Minute should be 0 or 30 (30-minute aligned)
      expect([0, 30]).toContain(dt.minute);
    }
  });
});

// ---------------------------------------------------------------------------
// eventTimeToMs and msToEventTime
// ---------------------------------------------------------------------------
describe('eventTimeToMs', () => {
  it('converts EventTime to epoch ms correctly', () => {
    const et = { localTime: '2024-03-10T09:00:00', tzid: 'UTC' };
    const ms = eventTimeToMs(et);
    const expected = DateTime.fromISO('2024-03-10T09:00:00', { zone: 'UTC' }).toMillis();
    expect(ms).toBe(expected);
  });

  it('handles non-UTC timezone correctly', () => {
    const et = { localTime: '2024-03-10T09:00:00', tzid: 'America/New_York' };
    const ms = eventTimeToMs(et);
    const expected = DateTime.fromISO('2024-03-10T09:00:00', { zone: 'America/New_York' }).toMillis();
    expect(ms).toBe(expected);
  });

  it('maps floating timezone to local', () => {
    // We just check it doesn't throw for floating
    const et = { localTime: '2024-03-10T09:00:00', tzid: 'floating' };
    expect(() => eventTimeToMs(et)).not.toThrow();
  });
});

describe('msToEventTime', () => {
  it('converts epoch ms to EventTime correctly', () => {
    const ms = DateTime.fromISO('2024-03-10T09:00:00', { zone: 'UTC' }).toMillis();
    const et = msToEventTime(ms, 'UTC');
    expect(et.localTime).toBe('2024-03-10T09:00:00');
    expect(et.tzid).toBe('UTC');
  });

  it('round-trips eventTimeToMs → msToEventTime', () => {
    const original = { localTime: '2024-03-10T14:30:00', tzid: 'America/Chicago' };
    const ms = eventTimeToMs(original);
    const restored = msToEventTime(ms, original.tzid);
    expect(restored.localTime).toBe(original.localTime);
    expect(restored.tzid).toBe(original.tzid);
  });
});
