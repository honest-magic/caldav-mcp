# Phase 3: Scheduling Intelligence - Research

**Researched:** 2026-03-28
**Domain:** ical.js recurrence expansion, conflict detection algorithms, slot suggestion
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Use ical.js built-in `ICAL.RecurExpansion` for RRULE expansion — already in deps, handles EXDATE/RDATE natively
- Expansion bounded to query window only (start/end params) — never expand infinitely
- Check all calendars across all accounts by default, with optional calendar filter parameter
- All-day events treated as full-day blocks for conflict detection purposes
- Gap analysis approach: collect all busy periods in search window, find gaps >= requested duration
- Default search window: 7 days from proposed start, configurable via tool param
- Return max 5 suggested slots (configurable via tool param)
- Optional `workingHours` param (e.g., {start: 9, end: 17}) — defaults to no filter (24h)

### Claude's Discretion

- Internal data structures for busy period collection and merging
- How to handle overlapping busy periods from multiple calendars (merge before gap analysis)
- Performance optimization for large calendars with many recurring events
- Edge cases: events spanning midnight, DST transitions during expansion

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHED-01 | System detects scheduling conflicts against existing events across calendars | `event.iterator()` + `getOccurrenceDetails()` expands all recurring instances; flat BusyPeriod list enables O(n) conflict detection |
| SCHED-02 | System suggests available time slots when conflicts exist | Gap analysis on sorted/merged busy periods; luxon for arithmetic with DST-safe slot generation |
| SCHED-03 | System expands recurring events (RRULE) for accurate conflict detection | `ICAL.Event.iterator()` (no argument) + `relateException()` is the correct expansion path; verified with live ical.js 2.2.1 |

</phase_requirements>

---

## Summary

Phase 3 adds two new MCP tools: `check_conflicts` and `suggest_slots`. The core work is (1) expanding recurring events within a time window — including EXDATE exceptions and RECURRENCE-ID overrides — and (2) merging all busy periods across calendars to detect overlaps and find available gaps.

The ical.js library (already installed at 2.2.1) provides all primitives needed. `ICAL.Event.iterator()` + `getOccurrenceDetails()` is the correct expansion path — it handles EXDATE natively and applies RECURRENCE-ID overrides when exceptions are related via `event.relateException()`. Critical: do NOT pass a `startDate` argument to `event.iterator()` as it breaks RECURRENCE-ID matching (verified empirically). Instead, iterate from the master's DTSTART and filter results by window boundaries.

For timezone-safe UTC epoch conversion of ICAL.Time objects produced by the iterator, use luxon with the TZID string extracted from the DTSTART property — this is consistent with the existing `ical-parser.ts` pattern and correctly handles DST transitions (verified: Chicago event on 2024-03-08 converts to UTC-6 and 2024-03-15 converts to UTC-5 correctly).

**Primary recommendation:** Build `recurrence-expander.ts` around `ICAL.Event.iterator()` (no args) + `getOccurrenceDetails()` with manual window filtering. Build `conflict-detector.ts` using sorted BusyPeriod intervals with merge-then-gap-scan. Both utilities work in epoch milliseconds internally; convert EventTime inputs via luxon.

---

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ical.js | 2.2.1 | RRULE expansion, EXDATE, RECURRENCE-ID | Already in deps; RecurExpansion and ICAL.Event.iterator() verified working |
| luxon | 3.7.2 | TZID → epoch ms conversion, slot arithmetic | Already in deps; used by CalendarService; DST-safe |

### No New Dependencies Required

All Phase 3 functionality uses the existing stack. No `npm install` step needed.

---

## Architecture Patterns

### New Files to Create

```
src/utils/
├── recurrence-expander.ts   # ICAL.Event.iterator() wrapper → BusyPeriod[]
├── conflict-detector.ts     # BusyPeriod merge + gap analysis
src/services/
└── calendar.ts              # Add checkConflicts(), suggestSlots() methods
```

MCP tool handlers added to existing `src/index.ts` switch statement (established pattern).

### Pattern 1: Recurrence Expansion to BusyPeriod[]

**What:** Given a raw ICS string (single calendar object from CalDAV), produce a flat list of `{startMs, endMs}` intervals for all occurrences within the window.

**When to use:** Called for every event fetched during conflict/slot check.

**Key implementation detail — grouping VEVENTs by UID:**

CalDAV servers may return RECURRENCE-ID overrides as separate calendar objects (separate ICS files), not as additional VEVENTs within the master's ICS. The expander must:
1. Parse all fetched ICS objects.
2. Group VEVENTs by UID — separate master from exceptions (`getFirstProperty('recurrence-id')` null check).
3. Call `event.relateException(new ICAL.Event(excVEvent))` for each exception.
4. Call `event.iterator()` with NO argument (critical — see Pitfall 1).

**Verified example:**
```typescript
// Source: empirical test against ical.js 2.2.1
import ICAL from 'ical.js';
import { DateTime } from 'luxon';

export interface BusyPeriod {
  startMs: number;
  endMs: number;
}

function icalTimeToMs(time: ICAL.Time, tzid: string): number {
  // Use luxon with the TZID string — consistent with ical-parser.ts pattern
  // Do NOT call time.toUnixTime() without VTIMEZONE component (may treat as floating/UTC)
  const localStr = time.toString(); // e.g. "2024-03-15T09:00:00"
  if (time.isDate) {
    // All-day: treat as UTC midnight to midnight
    return DateTime.fromISO(localStr, { zone: 'UTC' }).toMillis();
  }
  const zone = tzid === 'floating' ? 'local' : tzid;
  return DateTime.fromISO(localStr, { zone }).toMillis();
}

export function expandToBusyPeriods(
  allICSObjects: string[],  // all fetched calendar objects
  windowStartMs: number,
  windowEndMs: number,
): BusyPeriod[] {
  // Group VEVENTs by UID
  const masters = new Map<string, ICAL.Component>();
  const exceptions = new Map<string, ICAL.Component[]>();

  for (const ics of allICSObjects) {
    const comp = new ICAL.Component(ICAL.parse(ics));
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      const uid = vevent.getFirstPropertyValue('uid') as string;
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

  for (const [uid, masterVEvent] of masters) {
    const event = new ICAL.Event(masterVEvent);
    for (const excVEvent of exceptions.get(uid) ?? []) {
      event.relateException(new ICAL.Event(excVEvent));
    }

    // Get master TZID for conversion fallback
    const dtStartProp = masterVEvent.getFirstProperty('dtstart');
    const masterTzid = (dtStartProp?.getParameter('tzid') as string) ?? 'UTC';

    if (!event.isRecurring()) {
      // Non-recurring: single occurrence
      const startMs = icalTimeToMs(event.startDate, masterTzid);
      const endMs = event.endDate
        ? icalTimeToMs(event.endDate, masterTzid)
        : startMs;
      if (endMs > windowStartMs && startMs < windowEndMs) {
        busy.push({ startMs, endMs });
      }
      continue;
    }

    // Recurring: iterate from DTSTART (no arg!), filter to window
    const iter = event.iterator(); // NO startDate argument
    let next: ICAL.Time | null;
    while ((next = iter.next())) {
      const details = event.getOccurrenceDetails(next);
      // Get TZID from the specific occurrence's DTSTART (may differ for exceptions)
      const itemVEvent = details.item?.component;
      const itemDtStartProp = itemVEvent?.getFirstProperty('dtstart');
      const itemTzid = (itemDtStartProp?.getParameter('tzid') as string) ?? masterTzid;

      const startMs = icalTimeToMs(details.startDate, itemTzid);
      const endMs = details.endDate
        ? icalTimeToMs(details.endDate, itemTzid)
        : startMs;

      // Past window: stop iterating
      if (startMs >= windowEndMs) break;
      // Before window: skip
      if (endMs <= windowStartMs) continue;

      busy.push({ startMs, endMs });
    }
  }
  return busy;
}
```

### Pattern 2: BusyPeriod Merge + Conflict Detection

**What:** Merge overlapping intervals, then check if a proposed time overlaps any merged period.

**When to use:** In `conflict-detector.ts`, called after `expandToBusyPeriods`.

**Example:**
```typescript
// Source: standard interval merge algorithm, no external library needed
export function mergePeriods(periods: BusyPeriod[]): BusyPeriod[] {
  if (periods.length === 0) return [];
  const sorted = [...periods].sort((a, b) => a.startMs - b.startMs);
  const merged: BusyPeriod[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const curr = sorted[i]!;
    if (curr.startMs <= last.endMs) {
      // Overlapping or adjacent — extend
      last.endMs = Math.max(last.endMs, curr.endMs);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

export function detectConflict(
  proposedStartMs: number,
  proposedEndMs: number,
  busyPeriods: BusyPeriod[],
): BusyPeriod[] {
  // Return all busy periods that overlap the proposed window
  return busyPeriods.filter(
    (p) => p.startMs < proposedEndMs && p.endMs > proposedStartMs,
  );
}
```

### Pattern 3: Gap Analysis for Slot Suggestion

**What:** After merging busy periods, scan the search window for gaps >= requested duration, optionally filtered by working hours.

**When to use:** In `conflict-detector.ts` `findAvailableSlots()`.

**Example:**
```typescript
// Source: gap-scan algorithm, empirically designed
export interface SlotSuggestion {
  startMs: number;
  endMs: number;
}

export function findAvailableSlots(params: {
  searchWindowStartMs: number;
  searchWindowEndMs: number;
  durationMs: number;
  busyPeriods: BusyPeriod[];        // already merged
  workingHoursStart?: number;       // 0-23, inclusive
  workingHoursEnd?: number;         // 0-23, exclusive (e.g. 17 = up to 17:00)
  maxSlots: number;
  slotTzid?: string;                // for working hours filtering
}): SlotSuggestion[] {
  const { searchWindowStartMs, searchWindowEndMs, durationMs, busyPeriods,
          workingHoursStart, workingHoursEnd, maxSlots, slotTzid = 'UTC' } = params;

  const slots: SlotSuggestion[] = [];

  // Gaps are the spaces between busy periods within the search window
  const boundaries = [
    searchWindowStartMs,
    ...busyPeriods.flatMap((p) => [p.startMs, p.endMs]),
    searchWindowEndMs,
  ].sort((a, b) => a - b);

  for (let i = 0; i < boundaries.length - 1 && slots.length < maxSlots; i++) {
    const gapStart = Math.max(boundaries[i]!, searchWindowStartMs);
    const gapEnd   = Math.min(boundaries[i + 1]!, searchWindowEndMs);
    if (gapEnd - gapStart < durationMs) continue;

    // Scan through gap in durationMs increments (or align to hours for cleaner slots)
    let candidate = gapStart;
    while (candidate + durationMs <= gapEnd && slots.length < maxSlots) {
      // Apply working hours filter if provided
      if (workingHoursStart !== undefined && workingHoursEnd !== undefined) {
        const dt = DateTime.fromMillis(candidate, { zone: slotTzid });
        const hour = dt.hour;
        if (hour < workingHoursStart || hour >= workingHoursEnd) {
          // Advance to next working hours window
          const nextStart = dt.set({ hour: workingHoursStart, minute: 0, second: 0, millisecond: 0 });
          const next = hour >= workingHoursEnd
            ? nextStart.plus({ days: 1 }).toMillis()
            : nextStart.toMillis();
          candidate = next;
          continue;
        }
        // Ensure slot fits within working hours
        const slotEndHour = DateTime.fromMillis(candidate + durationMs, { zone: slotTzid }).hour;
        if (slotEndHour > workingHoursEnd) {
          candidate = DateTime.fromMillis(candidate, { zone: slotTzid })
            .plus({ days: 1 }).set({ hour: workingHoursStart, minute: 0, second: 0, millisecond: 0 })
            .toMillis();
          continue;
        }
      }
      slots.push({ startMs: candidate, endMs: candidate + durationMs });
      // Advance to next clean slot (e.g., 30-min increments for UX quality)
      candidate += 30 * 60 * 1000;
    }
  }
  return slots;
}
```

### Pattern 4: EventTime ↔ Epoch ms Conversion

The CalendarService methods accept/return `EventTime` (localTime + tzid). The conflict/slot utilities work in epoch ms. A thin adapter lives in `conflict-detector.ts`:

```typescript
// Source: consistent with calendar.ts and ical-parser.ts patterns
import { DateTime } from 'luxon';

export function eventTimeToMs(et: EventTime): number {
  const zone = et.tzid === 'floating' ? 'local' : et.tzid;
  return DateTime.fromISO(et.localTime, { zone }).toMillis();
}

export function msToEventTime(ms: number, tzid: string): EventTime {
  const dt = DateTime.fromMillis(ms, { zone: tzid === 'floating' ? 'local' : tzid });
  return { localTime: dt.toFormat("yyyy-MM-dd'T'HH:mm:ss"), tzid };
}
```

### Anti-Patterns to Avoid

- **Calling `event.iterator(startDate)`:** Passing a startDate argument breaks RECURRENCE-ID matching — verified empirically. Always call `event.iterator()` with no arguments.
- **Using `ICAL.RecurExpansion` directly for conflict detection:** It handles EXDATE natively but does NOT apply RECURRENCE-ID overrides. Use `ICAL.Event.iterator()` + `getOccurrenceDetails()` instead.
- **Calling `time.toUnixTime()` without VTIMEZONE:** Without a VTIMEZONE component in the parsed ICS, timezone-aware ICAL.Time objects have `.zone.tzid = 'floating'` and `toUnixTime()` treats them as UTC. Use luxon with the raw TZID string from the DTSTART property parameter instead.
- **Filtering in the iterator call:** Do not skip occurrences before the window using `continue` and later `break` — some iterators may not produce results in strictly ascending order for complex RRULE expressions. Collect then filter.
- **Expanding without window bound:** Always break the iterator loop when `startMs >= windowEndMs`. Infinite loops are possible for `RRULE:FREQ=DAILY` without COUNT or UNTIL.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EXDATE exception filtering | Custom EXDATE date-string comparator | ical.js `ICAL.Event.iterator()` | Handles timezone-aware EXDATE matching including floating and UTC; custom comparator would miss edge cases |
| RECURRENCE-ID override lookup | Map from recurrence-id string to exception VEVENT | ical.js `relateException()` + `getOccurrenceDetails()` | ical.js correctly matches RECURRENCE-ID despite timezone representation differences |
| Duration computation (DTEND from DURATION) | Add duration to DTSTART manually | `ICAL.Event.endDate` | ical.js computes `endDate` from DURATION when DTEND absent |
| Interval merging | Custom merge loop | Standard sort-then-scan (4 lines) | No library needed — this is simpler than any dependency |
| DST-safe time arithmetic | Manual UTC offset calculation | luxon `DateTime.plus()` | luxon handles DST gaps/folds correctly |

**Key insight:** ical.js handles all iCalendar semantics; the phase only needs to wire its primitives into a flat interval list.

---

## Common Pitfalls

### Pitfall 1: `event.iterator(startDate)` Breaks RECURRENCE-ID Matching
**What goes wrong:** Occurrences that have RECURRENCE-ID overrides show the master DTSTART/DTEND instead of the overridden values. The modified instance appears with the wrong time.
**Why it happens:** Internally, `iterator(startDate)` skips the RECURRENCE-ID key lookup when fast-forwarding. The exception storage key is derived from the original DTSTART, not the override.
**How to avoid:** Always call `event.iterator()` with no arguments. Apply window filtering by checking `startMs >= windowEndMs` for break and `endMs <= windowStartMs` for continue.
**Warning signs:** Modified recurring instances showing original (not updated) times in conflict output.

### Pitfall 2: RECURRENCE-ID Exceptions as Separate CalDAV Objects
**What goes wrong:** If only the master ICS object is expanded, modified instances are silently missed — the override is returned as a separate CalDAV object with its own URL.
**Why it happens:** RFC 5545 allows RECURRENCE-ID components to be stored as separate calendar objects on the server. `tsdav`'s `fetchCalendarObjects` returns them individually.
**How to avoid:** After fetching all calendar objects in the window, group VEVENTs by UID. Identify exceptions by presence of a `recurrence-id` property. Call `event.relateException()` for each before iterating.
**Warning signs:** A recurring event's instances appear with wrong times on some occurrences; the same UID appears in multiple fetched objects.

### Pitfall 3: ICAL.Time.toUnixTime() Floating-Time Ambiguity
**What goes wrong:** `toUnixTime()` on an ICAL.Time object returns UTC-interpreted epoch seconds even when the original DTSTART had `TZID=America/New_York`, because ical.js only sets the zone correctly when a matching VTIMEZONE component is present in the parsed ICS.
**Why it happens:** ical.js needs a VTIMEZONE ICAL.Component in the parent VCALENDAR to resolve TZID strings to offsets. Many CalDAV servers omit VTIMEZONE blocks.
**How to avoid:** Extract the TZID string from the DTSTART property parameter (`.getParameter('tzid')`), then use luxon `DateTime.fromISO(localStr, { zone: tzid })` for conversion. This is already the established pattern in `ical-parser.ts`.
**Warning signs:** Events in non-UTC timezones appearing shifted by the UTC offset (e.g., an America/New_York 9am event appearing as if it were 9am UTC).

### Pitfall 4: Infinite Iteration on Unbounded RRULE
**What goes wrong:** An event with `RRULE:FREQ=DAILY` and no COUNT or UNTIL causes `event.iterator()` to loop forever.
**Why it happens:** `ICAL.RecurIterator` happily produces dates indefinitely for unbounded rules.
**How to avoid:** Always break when `startMs >= windowEndMs`. Never rely on the iterator terminating on its own unless COUNT or UNTIL is known to be set.
**Warning signs:** `checkConflicts` tool call never returns.

### Pitfall 5: All-Day Event Timezone Ambiguity
**What goes wrong:** An all-day event on 2024-03-15 interpreted as UTC midnight may not overlap a 23:30 event on 2024-03-14 in America/New_York (which is 04:30 UTC on 2024-03-15).
**Why it happens:** All-day events have no timezone — they're floating calendar-dates. Converting to UTC midnight is a policy decision.
**How to avoid:** The decision is locked: treat all-day events as full-day blocks. Use UTC midnight-to-midnight for the date string. This is consistent and predictable.
**Warning signs:** All-day events appearing to not overlap same-day timed events near midnight.

### Pitfall 6: Gap Scan Producing Low-Quality Slot Suggestions
**What goes wrong:** `findAvailableSlots` returns many slots at odd times (e.g., 09:17, 09:47, 10:17) that look unnatural.
**Why it happens:** Scanning in `durationMs` increments from gap boundaries produces start times aligned to event boundaries, not clean hour/half-hour marks.
**How to avoid:** Advance candidate in 30-minute increments (or align to next :00/:30 on first entry into a gap). This keeps suggestions clean without being overly restrictive.
**Warning signs:** Suggested slots with non-round-number minute values.

---

## Code Examples

### Detecting Non-Recurring vs Recurring Events
```typescript
// Source: empirical test against ical.js 2.2.1
const event = new ICAL.Event(vevent);
if (event.isRecurring()) {
  // Use iterator() approach
} else {
  // Single occurrence: use event.startDate / event.endDate directly
}
```

### Grouping Multi-VEVENT ICS by UID
```typescript
// Source: verified with CalDAV multi-object scenario
const masters = new Map<string, ICAL.Component>();
const exceptions = new Map<string, ICAL.Component[]>();

for (const vevent of comp.getAllSubcomponents('vevent')) {
  const uid = vevent.getFirstPropertyValue('uid') as string;
  if (vevent.getFirstProperty('recurrence-id')) {
    if (!exceptions.has(uid)) exceptions.set(uid, []);
    exceptions.get(uid)!.push(vevent);
  } else {
    masters.set(uid, vevent);
  }
}
```

### EXDATE Verification
```typescript
// EXDATE is handled automatically by event.iterator().
// Verified: RRULE FREQ=DAILY;COUNT=5 with EXDATE on day 3 produces 4 occurrences.
// No special handling needed in expandToBusyPeriods().
```

### Detecting All-Day Events
```typescript
// Source: empirical test, ical.js 2.2.1
const isAllDay = event.startDate.isDate; // true for VALUE=DATE properties
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `ICAL.RecurExpansion` directly | `ICAL.Event.iterator()` + `getOccurrenceDetails()` | RecurExpansion does not apply RECURRENCE-ID overrides; Event.iterator does |
| `event.iterator(startDate)` for windowed expansion | `event.iterator()` then manual filter | Passing startDate breaks RECURRENCE-ID matching |
| `time.toJSDate()` for conversion | `luxon.DateTime.fromISO(time.toString(), { zone: tzid })` | Consistent with codebase; handles missing VTIMEZONE |

---

## Open Questions

1. **Working hours slot suggestion — which timezone?**
   - What we know: `workingHours` param gives start/end hours; proposed event has an EventTime with tzid.
   - What's unclear: Should working hours apply in the proposed event's timezone, the user's local timezone, or UTC?
   - Recommendation: Apply in the proposed event's timezone (use `start.tzid` from the check_conflicts call). Document this in the tool description. The user providing the proposed event time presumably thinks in that timezone.

2. **How to handle events with no DTEND and no DURATION**
   - What we know: RFC 5545 §3.6.1 says DTSTART-only VEVENT has implied zero duration for DATE-TIME, or one-day duration for DATE.
   - What's unclear: Does `ICAL.Event.endDate` handle this edge case?
   - Recommendation: Add a fallback: if `event.endDate == null`, use `event.startDate` as the end (zero-duration busy period). This is safe — a zero-duration period won't match any slot gap.

3. **CalDAV server time-range filtering for `fetchCalendarObjects`**
   - What we know: `tsdav` supports time-range REPORT for fetching objects. CalendarService.listEvents uses it.
   - What's unclear: Will the server return recurring master events whose occurrences fall within the window but whose DTSTART is outside the window? Some servers expand server-side; others return only the master.
   - Recommendation: Always fetch with a window slightly wider than needed (e.g., expand window back 2 years to catch masters), OR fetch all events without a time filter for the conflict check. The decision is at the CalendarService layer — document and choose conservatively (wider window).

---

## Environment Availability

Step 2.6: SKIPPED — Phase 3 is purely code changes using libraries already installed and verified in `package.json`. No new external dependencies.

---

## Validation Architecture

`nyquist_validation` is set to `false` in `.planning/config.json`. This section is omitted per the research instructions.

---

## Sources

### Primary (HIGH confidence)
- ical.js 2.2.1 installed at `/Users/mis/dev/caldav_mcp/node_modules/ical.js` — all API behavior verified with live Node.js execution
- Empirical test results from 6 REPL sessions covering: RecurExpansion vs Event.iterator, EXDATE handling, RECURRENCE-ID override application, `iterator(startDate)` breakage, ICAL.Time timezone conversion, all-day event detection, DURATION-only event endDate computation, DST transitions

### Secondary (MEDIUM confidence)
- Existing codebase patterns in `ical-parser.ts`, `ical-generator.ts`, `calendar.ts` — confirmed established conventions (luxon for tz, EventTime shape, ICAL property access patterns)

### Tertiary (LOW confidence)
- RFC 5545 §3.6.1 re: zero-duration VEVENT — not verified against ical.js behavior; recommend defensive coding

---

## Metadata

**Confidence breakdown:**
- ICAL.Event.iterator() API and RECURRENCE-ID behavior: HIGH — live-tested against installed 2.2.1
- EXDATE handling: HIGH — live-tested, 4 results returned from 5-occurrence rule with 1 EXDATE
- Timezone conversion via luxon: HIGH — consistent with existing codebase, DST verified
- Gap analysis / slot suggestion algorithm: HIGH — standard algorithm, no external dependencies
- Working hours slot quality: MEDIUM — the 30-minute increment heuristic is a design choice, not empirically tested
- CalDAV server behavior re: recurring masters and time-range REPORT: LOW — depends on server implementation

**Research date:** 2026-03-28
**Valid until:** 2026-06-28 (ical.js 2.x API is stable; luxon 3.x is stable)
