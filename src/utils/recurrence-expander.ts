import ICAL from 'ical.js';
import { DateTime } from 'luxon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BusyPeriod {
  startMs: number;
  endMs: number;
}

export interface ExpandedOccurrence {
  uid: string;
  summary: string;
  start: { localTime: string; tzid: string };
  end: { localTime: string; tzid: string } | null;
  isRecurring: boolean;
}

// ---------------------------------------------------------------------------
// Helper: convert ICAL.Time to UTC epoch milliseconds using luxon
//
// CRITICAL: Do NOT use time.toUnixTime() without VTIMEZONE component.
// Without a VTIMEZONE component in the parsed ICS, timezone-aware ICAL.Time
// objects may have their zone treated as floating/UTC, causing incorrect epoch
// values. Use luxon with the TZID string from the DTSTART property parameter
// instead — consistent with the ical-parser.ts pattern.
// ---------------------------------------------------------------------------

export function icalTimeToMs(time: ICAL.Time, tzid: string): number {
  // time.toString() returns the local time string e.g. "2024-03-15T09:00:00"
  const localStr = time.toString();
  // Strip trailing Z if present to get consistent localTime format for luxon
  const cleanStr = localStr.endsWith('Z') ? localStr.slice(0, -1) : localStr;

  if (time.isDate) {
    // All-day: treat as UTC midnight (policy decision per RESEARCH.md Pitfall 5)
    return DateTime.fromISO(cleanStr, { zone: 'UTC' }).toMillis();
  }
  const zone = tzid === 'floating' ? 'local' : tzid;
  return DateTime.fromISO(cleanStr, { zone }).toMillis();
}

// ---------------------------------------------------------------------------
// Public: expandToBusyPeriods
//
// Converts raw ICS strings (single VCALENDAR objects as returned by CalDAV)
// into a flat list of BusyPeriod intervals within the specified time window.
//
// Handles:
//   - Non-recurring events
//   - Recurring events (RRULE) with EXDATE exclusions
//   - RECURRENCE-ID overrides (CalDAV may return these as separate objects)
//   - All-day events (VALUE=DATE)
//   - Events in non-UTC timezones (DST-correct via luxon)
//   - Unbounded RRULEs (stops at window end)
// ---------------------------------------------------------------------------

export function expandToBusyPeriods(
  allICSObjects: string[],
  windowStartMs: number,
  windowEndMs: number,
  options?: { excludeAllDay?: boolean },
): BusyPeriod[] {
  const excludeAllDay = options?.excludeAllDay ?? false;
  // Step 1: Group VEVENTs by UID — separate masters (no recurrence-id) from exceptions
  const masters = new Map<string, ICAL.Component>();
  const exceptions = new Map<string, ICAL.Component[]>();

  for (const ics of allICSObjects) {
    let jcal: unknown;
    try {
      jcal = ICAL.parse(ics);
    } catch {
      // Skip malformed ICS objects
      continue;
    }
    const comp = new ICAL.Component(jcal as string | unknown[]);
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      const uid = vevent.getFirstPropertyValue('uid') as string | null;
      if (!uid) continue;
      const isException = !!vevent.getFirstProperty('recurrence-id');
      if (isException) {
        if (!exceptions.has(uid)) exceptions.set(uid, []);
        exceptions.get(uid)!.push(vevent);
      } else {
        masters.set(uid, vevent);
      }
    }
  }

  const busy: BusyPeriod[] = [];

  // Step 2: Process each master VEVENT
  for (const [uid, masterVEvent] of masters) {
    const event = new ICAL.Event(masterVEvent);

    // Relate all RECURRENCE-ID exceptions to the master event
    for (const excVEvent of exceptions.get(uid) ?? []) {
      event.relateException(new ICAL.Event(excVEvent));
    }

    // Extract master TZID for fallback in conversion
    const dtStartProp = masterVEvent.getFirstProperty('dtstart');
    const masterTzid = (dtStartProp?.getParameter('tzid') as string | null) ?? 'UTC';

    // Skip all-day events when excludeAllDay is set
    if (excludeAllDay && event.startDate.isDate) continue;

    if (!event.isRecurring()) {
      // Non-recurring: compute single BusyPeriod, check window overlap
      const startMs = icalTimeToMs(event.startDate, masterTzid);
      const endMs = event.endDate ? icalTimeToMs(event.endDate, masterTzid) : startMs;
      // Overlap check: event overlaps window if startMs < windowEnd AND endMs > windowStart
      if (endMs > windowStartMs && startMs < windowEndMs) {
        busy.push({ startMs, endMs });
      }
      continue;
    }

    // Recurring: iterate from DTSTART (NO argument — passing startDate breaks RECURRENCE-ID matching)
    // See RESEARCH.md Pitfall 1 for why this is critical.
    const iter = event.iterator(); // NO startDate argument
    let next: ICAL.Time | null;
    while ((next = iter.next())) {
      const details = event.getOccurrenceDetails(next);

      // Extract TZID from the specific occurrence's item component (may differ for overridden occurrences)
      const itemVEvent = details.item?.component;
      const itemDtStartProp = itemVEvent?.getFirstProperty('dtstart');
      const itemTzid = (itemDtStartProp?.getParameter('tzid') as string | null) ?? masterTzid;

      const startMs = icalTimeToMs(details.startDate, itemTzid);
      const endMs = details.endDate ? icalTimeToMs(details.endDate, itemTzid) : startMs;

      // Past window: stop iterating (iterator produces ascending dates)
      if (startMs >= windowEndMs) break;
      // Before window: skip this occurrence
      if (endMs <= windowStartMs) continue;

      busy.push({ startMs, endMs });
    }
  }

  return busy;
}

// ---------------------------------------------------------------------------
// Public: expandToOccurrences
//
// Like expandToBusyPeriods but returns rich event data per occurrence.
// Used by listEvents to show actual occurrence dates for recurring events.
// ---------------------------------------------------------------------------

function icalTimeToEventTime(time: ICAL.Time, tzid: string): { localTime: string; tzid: string } {
  const localStr = time.toString();
  const cleanStr = localStr.endsWith('Z') ? localStr.slice(0, -1) : localStr;
  return { localTime: cleanStr, tzid: time.isDate ? 'floating' : tzid };
}

export function expandToOccurrences(
  icsData: string,
  windowStartMs: number,
  windowEndMs: number,
): ExpandedOccurrence[] {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(icsData);
  } catch {
    return [];
  }
  const comp = new ICAL.Component(jcal as string | unknown[]);
  const vevents = comp.getAllSubcomponents('vevent');
  if (vevents.length === 0) return [];

  // Find master and exceptions
  let masterVEvent: ICAL.Component | null = null;
  const excs: ICAL.Component[] = [];
  for (const ve of vevents) {
    if (ve.getFirstProperty('recurrence-id')) {
      excs.push(ve);
    } else {
      masterVEvent = ve;
    }
  }
  if (!masterVEvent) return [];

  const event = new ICAL.Event(masterVEvent);
  for (const exc of excs) {
    event.relateException(new ICAL.Event(exc));
  }

  const uid = (masterVEvent.getFirstPropertyValue('uid') as string | null) ?? '';
  const summary = (masterVEvent.getFirstPropertyValue('summary') as string | null) ?? '';
  const dtStartProp = masterVEvent.getFirstProperty('dtstart');
  const masterTzid = (dtStartProp?.getParameter('tzid') as string | null) ?? 'UTC';

  if (!event.isRecurring()) {
    // Non-recurring: return as-is if in window
    const startMs = icalTimeToMs(event.startDate, masterTzid);
    const endMs = event.endDate ? icalTimeToMs(event.endDate, masterTzid) : startMs;
    if (endMs > windowStartMs && startMs < windowEndMs) {
      return [{
        uid,
        summary,
        start: icalTimeToEventTime(event.startDate, masterTzid),
        end: event.endDate ? icalTimeToEventTime(event.endDate, masterTzid) : null,
        isRecurring: false,
      }];
    }
    return [];
  }

  // Recurring: expand occurrences in window
  const results: ExpandedOccurrence[] = [];
  const iter = event.iterator();
  let next: ICAL.Time | null;
  while ((next = iter.next())) {
    const details = event.getOccurrenceDetails(next);
    const itemVEvent = details.item?.component;
    const itemDtStartProp = itemVEvent?.getFirstProperty('dtstart');
    const itemTzid = (itemDtStartProp?.getParameter('tzid') as string | null) ?? masterTzid;
    const itemSummary = (itemVEvent?.getFirstPropertyValue('summary') as string | null) ?? summary;

    const startMs = icalTimeToMs(details.startDate, itemTzid);
    const endMs = details.endDate ? icalTimeToMs(details.endDate, itemTzid) : startMs;

    if (startMs >= windowEndMs) break;
    if (endMs <= windowStartMs) continue;

    results.push({
      uid,
      summary: itemSummary,
      start: icalTimeToEventTime(details.startDate, itemTzid),
      end: details.endDate ? icalTimeToEventTime(details.endDate, itemTzid) : null,
      isRecurring: true,
    });
  }

  return results;
}
