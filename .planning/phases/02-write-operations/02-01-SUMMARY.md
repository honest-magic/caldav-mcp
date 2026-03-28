---
phase: 02-write-operations
plan: 01
subsystem: core-utilities
tags: [types, errors, confirmation-store, ical-generator, tdd]
dependency_graph:
  requires: []
  provides:
    - WritePreview type for CalendarService/tool confirmation flow
    - ETagConflict type for 412 conflict handling
    - ConflictError class for CalDAVClient write methods
    - ConfirmationStore for two-step write confirmation gate
    - generateICS for creating VCALENDAR strings for CalDAV PUT
  affects:
    - src/protocol/caldav.ts (will use ConflictError on 412 responses)
    - src/services/calendar.ts (will use ConfirmationStore and WritePreview)
    - src/index.ts (tool handlers will use WritePreview return shape)
tech_stack:
  added: []
  patterns:
    - TDD red/green for all new utilities
    - structuredClone for defensive argument copying in ConfirmationStore
    - ical.js Component/Property API for iCal generation
    - Lazy eviction pattern in ConfirmationStore._evictExpired()
key_files:
  created:
    - src/utils/confirmation-store.ts
    - src/utils/confirmation-store.test.ts
    - src/utils/ical-generator.ts
    - src/utils/ical-generator.test.ts
  modified:
    - src/types.ts (added WritePreview, ETagConflict)
    - src/errors.ts (added ConflictError enum value and class)
decisions:
  - Use ICAL.Timezone.utcTimezone (not time.isUtc = true) to emit Z suffix — ical.js only adds Z via zone assignment
  - Skip VTIMEZONE component generation per RESEARCH.md open question #1 — most providers accept without
  - Lazy eviction in ConfirmationStore.consume() keeps _evictExpired() simple without timers
metrics:
  duration: 156s
  completed: "2026-03-28"
  tasks: 2
  files: 6
---

# Phase 2 Plan 1: Write Foundations — Types, Errors, Confirmation Store, iCal Generator Summary

**One-liner:** UUID-based two-step confirmation store with 5-min TTL, ConflictError for ETag 412s, WritePreview/ETagConflict types, and iCal VCALENDAR generator with IANA/UTC/floating timezone support.

## What Was Built

Four foundational artifacts required by all write operations in Phase 2:

1. **`src/types.ts`** — Added `WritePreview` and `ETagConflict` interfaces for confirmation flow and ETag conflict diff.

2. **`src/errors.ts`** — Added `ConflictError = 'ConflictError'` to `CalDAVErrorCode` enum and `ConflictError` class carrying an `ETagConflict` on `.conflict` property.

3. **`src/utils/confirmation-store.ts`** — `ConfirmationStore` class with `create()` / `consume()` API. Uses `randomUUID()` for token generation, `structuredClone()` for arg deep-copy, lazy eviction on consume. 5-minute default TTL configurable for testing.

4. **`src/utils/ical-generator.ts`** — `generateICS()` function using ical.js `Component`/`Property` API. Handles three timezone modes: IANA (TZID parameter), UTC (Z suffix via `ICAL.Timezone.utcTimezone`), floating (no TZID, no Z). Round-trip with `parseICS` verified.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add write types, ConflictError, ConfirmationStore | 8091d88 | src/types.ts, src/errors.ts, src/utils/confirmation-store.ts, src/utils/confirmation-store.test.ts |
| 2 | Create iCal generator utility | a932cc2 | src/utils/ical-generator.ts, src/utils/ical-generator.test.ts |

## Test Results

- `confirmation-store.test.ts`: 11 tests passed (create, consume, expiry, deep copy, size)
- `ical-generator.test.ts`: 19 tests passed (structure, UID, timezone modes, optional fields, round-trip)
- `npx tsc --noEmit`: clean (no errors)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ical.js UTC timezone rendering**

- **Found during:** Task 2 GREEN phase
- **Issue:** Setting `time.isUtc = true` on `ICAL.Time` does not emit Z suffix in `toICALString()`. The Z suffix requires assigning `time.zone = ICAL.Timezone.utcTimezone`.
- **Fix:** Changed `buildICALTime()` to use `time.zone = ICAL.Timezone.utcTimezone` for UTC mode. Same fix applied to DTSTAMP.
- **Files modified:** `src/utils/ical-generator.ts`
- **Commit:** a932cc2

## Known Stubs

None — all implementations are fully functional.

## Self-Check: PASSED

- `src/utils/confirmation-store.ts`: FOUND
- `src/utils/confirmation-store.test.ts`: FOUND
- `src/utils/ical-generator.ts`: FOUND
- `src/utils/ical-generator.test.ts`: FOUND
- Commit 8091d88: FOUND
- Commit a932cc2: FOUND
