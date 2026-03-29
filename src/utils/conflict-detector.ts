import { DateTime } from 'luxon';
import type { EventTime } from '../types.js';
import type { BusyPeriod } from './recurrence-expander.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlotSuggestion {
  startMs: number;
  endMs: number;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: BusyPeriod[];
  suggestions?: SlotSuggestion[];
}

// ---------------------------------------------------------------------------
// mergePeriods
//
// Sort busy periods by startMs, then merge overlapping or adjacent intervals.
// Returns a new sorted, non-overlapping list.
// ---------------------------------------------------------------------------

export function mergePeriods(periods: BusyPeriod[]): BusyPeriod[] {
  if (periods.length === 0) return [];
  const sorted = [...periods].sort((a, b) => a.startMs - b.startMs);
  const merged: BusyPeriod[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const curr = sorted[i]!;
    if (curr.startMs <= last.endMs) {
      // Overlapping or adjacent — extend end
      last.endMs = Math.max(last.endMs, curr.endMs);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// detectConflicts
//
// Return all busy periods that overlap the proposed time window.
// Boundary touching (end == start) is NOT considered an overlap.
// ---------------------------------------------------------------------------

export function detectConflicts(
  proposedStartMs: number,
  proposedEndMs: number,
  busyPeriods: BusyPeriod[],
): BusyPeriod[] {
  return busyPeriods.filter(
    (p) => p.startMs < proposedEndMs && p.endMs > proposedStartMs,
  );
}

// ---------------------------------------------------------------------------
// findAvailableSlots
//
// Scan the search window for gaps >= durationMs between merged busy periods.
// Advances candidates in 30-minute increments for clean UX slot times.
// Optionally filters by working hours (inclusive start, exclusive end hour).
// ---------------------------------------------------------------------------

export function findAvailableSlots(params: {
  searchWindowStartMs: number;
  searchWindowEndMs: number;
  durationMs: number;
  busyPeriods: BusyPeriod[]; // should already be merged
  workingHoursStart?: number; // 0-23, inclusive (e.g. 9)
  workingHoursEnd?: number; // 0-23, exclusive (e.g. 17 = up to 17:00)
  maxSlots: number;
  slotTzid?: string; // for working hours filtering
}): SlotSuggestion[] {
  const {
    searchWindowStartMs,
    searchWindowEndMs,
    durationMs,
    busyPeriods,
    workingHoursStart,
    workingHoursEnd,
    maxSlots,
    slotTzid = 'UTC',
  } = params;

  const slots: SlotSuggestion[] = [];
  const thirtyMinMs = 30 * 60 * 1000;
  const hasWorkingHours =
    workingHoursStart !== undefined && workingHoursEnd !== undefined;

  // Build true gap list: intervals between busy periods (not inside them)
  // Sort busy periods by start, then enumerate free windows between them
  const sortedBusy = [...busyPeriods].sort((a, b) => a.startMs - b.startMs);

  // Compute gap intervals: [windowStart, busy[0].start], [busy[0].end, busy[1].start], ..., [busy[n].end, windowEnd]
  const gapIntervals: Array<{ start: number; end: number }> = [];
  let cursor = searchWindowStartMs;
  for (const period of sortedBusy) {
    if (period.startMs > cursor) {
      gapIntervals.push({ start: cursor, end: period.startMs });
    }
    if (period.endMs > cursor) {
      cursor = period.endMs;
    }
  }
  if (cursor < searchWindowEndMs) {
    gapIntervals.push({ start: cursor, end: searchWindowEndMs });
  }

  for (const gap of gapIntervals) {
    if (slots.length >= maxSlots) break;
    const gapStart = Math.max(gap.start, searchWindowStartMs);
    const gapEnd = Math.min(gap.end, searchWindowEndMs);

    // Skip gaps that are too small to hold even one slot
    if (gapEnd - gapStart < durationMs) continue;

    let candidate = gapStart;

    while (candidate + durationMs <= gapEnd && slots.length < maxSlots) {
      if (hasWorkingHours) {
        const dt = DateTime.fromMillis(candidate, { zone: slotTzid });
        const hour = dt.hour;
        const minute = dt.minute;

        if (hour < workingHoursStart!) {
          // Before working hours — advance to working hours start today
          const todayWorkStart = dt
            .set({ hour: workingHoursStart!, minute: 0, second: 0, millisecond: 0 })
            .toMillis();
          candidate = todayWorkStart;
          continue;
        }

        if (hour >= workingHoursEnd!) {
          // After working hours — advance to start of next day's working hours
          const nextDayWorkStart = dt
            .plus({ days: 1 })
            .set({ hour: workingHoursStart!, minute: 0, second: 0, millisecond: 0 })
            .toMillis();
          candidate = nextDayWorkStart;
          continue;
        }

        // Check slot end fits within working hours
        const slotEndMs = candidate + durationMs;
        const slotEndDt = DateTime.fromMillis(slotEndMs, { zone: slotTzid });
        const slotEndTotalMinutes = slotEndDt.hour * 60 + slotEndDt.minute;
        const workingEndTotalMinutes = workingHoursEnd! * 60;

        if (slotEndTotalMinutes > workingEndTotalMinutes) {
          // Slot end exceeds working hours — advance to next day
          const nextDayWorkStart = dt
            .plus({ days: 1 })
            .set({ hour: workingHoursStart!, minute: 0, second: 0, millisecond: 0 })
            .toMillis();
          candidate = nextDayWorkStart;
          continue;
        }
      }

      slots.push({ startMs: candidate, endMs: candidate + durationMs });
      // Advance in 30-minute increments for clean slot times (Pitfall 6)
      candidate += thirtyMinMs;
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// eventTimeToMs
//
// Convert EventTime (localTime + tzid) to UTC epoch milliseconds.
// Floating times are mapped to local machine time (consistent with rest of codebase).
// ---------------------------------------------------------------------------

export function eventTimeToMs(et: EventTime): number {
  const zone = et.tzid === 'floating' ? 'local' : et.tzid;
  return DateTime.fromISO(et.localTime, { zone }).toMillis();
}

// ---------------------------------------------------------------------------
// msToEventTime
//
// Convert UTC epoch milliseconds back to an EventTime in the given timezone.
// ---------------------------------------------------------------------------

export function msToEventTime(ms: number, tzid: string): EventTime {
  const zone = tzid === 'floating' ? 'local' : tzid;
  const dt = DateTime.fromMillis(ms, { zone });
  return {
    localTime: dt.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    tzid,
  };
}
