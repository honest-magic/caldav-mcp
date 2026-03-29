---
phase: 03-scheduling-intelligence
plan: "01"
subsystem: utils
tags: [scheduling, conflict-detection, recurrence, ical, luxon, pure-functions]
dependency_graph:
  requires:
    - ical.js@2.2.1
    - luxon@3.7.2
    - src/types.ts (EventTime)
  provides:
    - src/utils/recurrence-expander.ts (BusyPeriod, expandToBusyPeriods, icalTimeToMs)
    - src/utils/conflict-detector.ts (mergePeriods, detectConflicts, findAvailableSlots, eventTimeToMs, msToEventTime)
  affects:
    - CalendarService (Phase 3 plan 02 — will call these utilities)
    - MCP tool handlers for conflict checking and slot suggestion
tech_stack:
  added: []
  patterns:
    - ical.js event.iterator() with no arguments (RECURRENCE-ID-safe expansion)
    - luxon DateTime.fromISO with explicit zone for TZID-safe epoch conversion
    - Gap-scan algorithm with 30-minute alignment for slot suggestion
    - Sorted merge algorithm for overlapping interval reduction
key_files:
  created:
    - src/utils/recurrence-expander.ts
    - src/utils/recurrence-expander.test.ts
    - src/utils/conflict-detector.ts
    - src/utils/conflict-detector.test.ts
  modified: []
decisions:
  - "event.iterator() called with no arguments (never pass startDate) to preserve RECURRENCE-ID override matching"
  - "icalTimeToMs uses luxon DateTime.fromISO with TZID string for DST-correct epoch conversion; floating mapped to local"
  - "Gap scan advances in 30-min increments for clean UX slot start times; working hours filter advances to next valid window"
  - "Adjacent intervals (end == start) are merged in mergePeriods; detectConflicts treats boundary touch as non-overlapping"
metrics:
  duration: "~20min (prior session) + continuation"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_created: 4
---

# Phase 03 Plan 01: Recurrence Expander and Conflict Detector Summary

Pure-function scheduling utilities: RRULE/EXDATE/RECURRENCE-ID expansion to BusyPeriod intervals, interval merge, conflict detection, and working-hours-aware slot suggestion with 30-min alignment.

## What Was Built

### Task 1: Recurrence Expander (committed: 9c3813c)

`src/utils/recurrence-expander.ts` — Converts raw ICS strings into flat `BusyPeriod[]` intervals within a time window.

Key exports:
- `BusyPeriod` — `{ startMs: number; endMs: number }` — the primitive type for all scheduling operations
- `icalTimeToMs(time, tzid)` — luxon-based TZID-safe conversion; all-day events produce UTC midnight; floating uses 'local'
- `expandToBusyPeriods(allICSObjects, windowStartMs, windowEndMs)` — groups ICS strings by UID, applies RECURRENCE-ID exceptions via `relateException()`, iterates recurring events with `event.iterator()` (no startDate argument — critical for override correctness)

Covers: non-recurring events, all-day events, RRULE with COUNT/UNTIL, EXDATE exclusions, RECURRENCE-ID overrides, unbounded rules (stops at window), non-UTC timezones with DST.

### Task 2: Conflict Detector (committed: 2bcad4c)

`src/utils/conflict-detector.ts` — Interval algebra and slot suggestion for scheduling.

Key exports:
- `mergePeriods(periods)` — sort + merge overlapping/adjacent intervals into non-overlapping list
- `detectConflicts(proposedStartMs, proposedEndMs, busyPeriods)` — returns all periods where `p.startMs < proposedEndMs && p.endMs > proposedStartMs` (boundary touch = no conflict)
- `findAvailableSlots(params)` — gap-scan algorithm: enumerates free intervals between busy periods, scans in 30-min increments, applies working hours filter with next-day advancement
- `eventTimeToMs(et)` / `msToEventTime(ms, tzid)` — bidirectional EventTime conversion via luxon

## Test Results

Full suite: 169 tests across 11 test files — all passing.

- `recurrence-expander.test.ts`: 9 tests covering all ICS scenarios
- `conflict-detector.test.ts`: 26 tests covering merge edge cases, conflict boundary conditions, slot finding with/without working hours, EventTime round-trips

## Deviations from Plan

None — plan executed exactly as written. Both files existed as untracked files at start of this session; tests ran clean on first execution; committed directly.

## Known Stubs

None. All functions are fully implemented and wired. No placeholder data flows to any consumer.

## Self-Check: PASSED

Files exist:
- src/utils/recurrence-expander.ts: FOUND
- src/utils/conflict-detector.ts: FOUND
- src/utils/recurrence-expander.test.ts: FOUND
- src/utils/conflict-detector.test.ts: FOUND

Commits exist:
- 9c3813c (recurrence-expander): FOUND
- 2bcad4c (conflict-detector): FOUND
