---
phase: 01-foundation-read
plan: "02"
subsystem: protocol
tags: [caldav, tsdav, ical, parsing, timezone, oauth2, basic-auth]
dependency_graph:
  requires: ["01-01"]
  provides: ["src/protocol/caldav.ts", "src/utils/ical-parser.ts"]
  affects: ["all tools that fetch or parse calendar data"]
tech_stack:
  added: []
  patterns: ["tsdav createDAVClient for CalDAV HTTP operations", "ical.js ICAL.parse for iCalendar parsing", "timezone-preserving EventTime { localTime, tzid } pattern"]
key_files:
  created:
    - src/protocol/caldav.ts
    - src/utils/ical-parser.ts
    - src/utils/ical-parser.test.ts
  modified: []
decisions:
  - "Use Awaited<ReturnType<typeof createDAVClient>> instead of DAVClient class type — createDAVClient returns a plain object not a class instance"
  - "Use time.timezone (TZID string) and time.zone?.tzid as fallback for UTC/floating — ical.js Time object uses these two separate properties for timezone identification"
  - "Strip trailing Z from ICAL.Time.toString() output to get consistent localTime format across UTC and TZID events"
metrics:
  duration: "~3 minutes"
  completed: "2026-03-28"
  tasks_completed: 2
  files_created: 3
---

# Phase 01 Plan 02: CalDAV Protocol Client and iCal Parser Summary

CalDAVClient wrapping tsdav with Basic Auth and OAuth2, plus a timezone-preserving parseICS utility backed by 13 unit tests.

## What Was Built

**Task 1: CalDAVClient Protocol Wrapper** (`src/protocol/caldav.ts`)

A `CalDAVClient` class that wraps tsdav's `createDAVClient`:
- `connect()` loads credentials from keychain, supports Basic Auth (password) and OAuth2 (client credentials + refresh token)
- `fetchCalendars()` returns `DAVCalendar[]` via tsdav
- `fetchCalendarObjects(calendar, timeRange?)` returns `DAVObject[]` with optional date filtering
- `fetchSingleObject(calendar, objectUrl)` returns `DAVObject | null`
- All network errors wrapped as `NetworkError`; auth failures (401/403) wrapped as `AuthError`
- RFC 6764 CalDAV auto-discovery handled by tsdav's `defaultAccountType: 'caldav'`

**Task 2: iCal Parser with Unit Tests** (`src/utils/ical-parser.ts`, `src/utils/ical-parser.test.ts`)

A `parseICS(raw: string): ParsedEvent` function that:
- Parses raw ICS strings via `ICAL.parse` + `ICAL.Component` + `ICAL.Event`
- Extracts all fields: uid, summary, description, location, start, end, rrule, attendees, organizer, raw
- Timezone preservation: reads `time.timezone` (TZID parameter string) or `time.zone.tzid` (UTC/floating fallback) — never calls `.toJSDate()`
- Attendees and organizer: strips `mailto:` prefix from values, extracts `cn`, `role`, `partstat` parameters
- Throws `ParseError` on empty input, invalid ICS, or missing VEVENT
- 13 unit tests covering timezone, all-day, UTC, attendees, organizer, RRULE, description/location, error cases, and raw preservation

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `Awaited<ReturnType<typeof createDAVClient>>` as client type | tsdav's `createDAVClient` returns a plain object not a `DAVClient` class instance; the class type has extra properties (`serverUrl`, `credentials`, etc.) that the factory return doesn't match |
| `time.timezone` string (not `time.zone.tzid`) for TZID events | ical.js sets `time.timezone` as the raw TZID string when a TZID parameter is present; `time.zone` resolves lazily to a floating timezone object even when TZID is set |
| Strip trailing `Z` from `time.toString()` | UTC times output `"2024-03-15T14:00:00Z"` — stripping Z gives consistent `localTime` format across all event types |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ICAL.Time timezone extraction used wrong property path**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Plan specified `time.timezone?.tzid` but ical.js Time object uses `time.timezone` as a flat string (the TZID) and `time.zone.tzid` for the resolved timezone object name. Using `.tzid` on a string returns `undefined`.
- **Fix:** Use `t.timezone ?? t.zone?.tzid ?? 'floating'` matching the actual ical.js object structure. Verified via Node.js REPL inspection of live ical.js output.
- **Files modified:** `src/utils/ical-parser.ts`
- **Commit:** 5a3a59e

**2. [Rule 1 - Bug] UTC time toString() includes trailing Z**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** `ICAL.Time.toString()` for UTC events returns `"2024-03-15T14:00:00Z"` — the Z suffix would make `localTime` inconsistent with TZID events.
- **Fix:** Strip trailing `Z` from `rawTime` before storing as `localTime`.
- **Files modified:** `src/utils/ical-parser.ts`
- **Commit:** 5a3a59e

**3. [Rule 1 - Bug] TypeScript type errors in extractAttendee**
- **Found during:** Task 2 (TypeScript verification)
- **Issue:** `ICAL.Property.getParameter()` returns `string | string[]` but we need `string | null`. Also `new ICAL.Component(jcal)` requires `string | unknown[]` not `unknown`.
- **Fix:** Added Array.isArray guards for parameter values; cast `jcal` to `string | unknown[]` for Component constructor.
- **Files modified:** `src/utils/ical-parser.ts`
- **Commit:** 5a3a59e

## Known Stubs

None — all methods are fully implemented and tested.

## Self-Check

- [x] `src/protocol/caldav.ts` exists and compiles
- [x] `src/utils/ical-parser.ts` exists and compiles
- [x] `src/utils/ical-parser.test.ts` exists with 13 passing tests
- [x] No `.toJSDate()` calls in ical-parser.ts
- [x] No `console.log` calls in any file
- [x] `npx tsc --noEmit` exits 0 (excluding pre-existing zod node_modules declaration issues)
- [x] `npx vitest run src/utils/ical-parser.test.ts` exits 0 (13 tests pass)
