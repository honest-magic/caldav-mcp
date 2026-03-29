---
phase: 03-scheduling-intelligence
plan: "02"
subsystem: services, index
tags: [scheduling, conflict-detection, slot-suggestion, mcp-tools, caldav, calendar-service]
dependency_graph:
  requires:
    - src/utils/recurrence-expander.ts (BusyPeriod, expandToBusyPeriods)
    - src/utils/conflict-detector.ts (mergePeriods, detectConflicts, findAvailableSlots, eventTimeToMs, msToEventTime)
    - src/services/calendar.ts (CalendarService, _resolveClients, _resolveClientForCalendar)
    - src/protocol/caldav.ts (fetchCalendarObjects)
  provides:
    - src/services/calendar.ts (checkConflicts, suggestSlots, _fetchAllICS methods)
    - src/index.ts (check_conflicts, suggest_slots MCP tools)
  affects:
    - AI agent workflows: agents can now check conflicts and find available slots via MCP
tech_stack:
  added: []
  patterns:
    - 1-year wide fetch window for recurring event master discovery
    - Private _fetchAllICS() helper de-duplicates calendar fetching logic
    - Flat startDate/startTzid fields consistent with existing create_event/update_event tool pattern
    - Human-readable slot/conflict formatting in tool responses
key_files:
  created: []
  modified:
    - src/services/calendar.ts
    - src/index.ts
decisions:
  - "Wide fetch window (proposed start minus 1 year) for _fetchAllICS to catch recurring masters whose DTSTART predates the proposed range"
  - "suggestSlots defaults: searchDays=7 and maxSlots=5 per locked Plan 01 decisions"
  - "Tool input uses flat startDate/startTzid fields (not nested object) for consistency with existing create_event/update_event MCP tools"
  - "check_conflicts returns human-readable text lines for conflicts; suggest_slots returns numbered slot list — matches MCP tool response conventions"
  - "_fetchAllICS silently skips calendars that fail to fetch (logs error), consistent with initialize() partial-connectivity pattern"
metrics:
  duration: "~10 min"
  completed_date: "2026-03-28"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 03 Plan 02: CalendarService + MCP Tool Wiring Summary

Wire scheduling intelligence utilities (Plan 01) into CalendarService and expose `check_conflicts` and `suggest_slots` as MCP tools.

## What Was Built

### Task 1: CalendarService methods (committed: a7786e7)

`src/services/calendar.ts` — Three new methods added:

**`checkConflicts(params)`**
- Accepts `start: EventTime`, `end: EventTime`, optional `calendarUrls[]` and `accountId`
- Computes a wide fetch window (1 year before proposed start) to catch recurring masters
- Calls `_fetchAllICS()`, `expandToBusyPeriods()`, `mergePeriods()`, `detectConflicts()`
- Returns `ConflictResult` with `hasConflict` and `conflicts: BusyPeriod[]`

**`suggestSlots(params)`**
- Accepts `durationMinutes`, `searchStart: EventTime`, optional `searchDays` (default 7), `calendarUrls[]`, `accountId`, `workingHoursStart/End`, `maxSlots` (default 5)
- Uses same wide fetch window pattern
- Calls `findAvailableSlots()` with all params, returns `SlotSuggestion[]`

**`_fetchAllICS(params)` (private helper)**
- Accepts `windowStartMs`, `windowEndMs`, optional `calendarUrls[]`, `accountId`
- Handles all three routing paths: specific calendar URLs, filtered by account, or all accounts
- Logs per-calendar errors and continues (partial-connectivity pattern)

### Task 2: MCP tool handlers (committed: 7d802e3)

`src/index.ts` — Two new MCP tools:

**`check_conflicts`**
- Input: `startDate`, `startTzid`, `endDate`, `endTzid`, optional `calendarUrls[]`, `account`
- Calls `calendarService.checkConflicts()`
- Response: "No conflicts found." or numbered list of conflict time ranges in the requested timezone

**`suggest_slots`**
- Input: `durationMinutes`, `searchStartDate`, `searchStartTzid`, optional `searchDays`, `calendarUrls[]`, `account`, `workingHoursStart`, `workingHoursEnd`, `maxSlots`
- Calls `calendarService.suggestSlots()`
- Response: "No available slots found in the search window." or numbered list of slot time ranges

Both tools follow the existing `msToEventTime()` pattern to convert epoch ms back to human-readable times in the caller's timezone.

## Test Results

Full suite: 169 tests across 11 test files — all passing after both tasks.

No new test files were required for this plan — the CalendarService methods depend on CalDAV network calls (integration-level), and the utility functions they orchestrate are already covered by Plan 01's 35 tests.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both tools are fully implemented and wired to CalDAV data via the utility functions from Plan 01.

## Self-Check: PASSED

Files modified:
- src/services/calendar.ts: FOUND (checkConflicts, suggestSlots, _fetchAllICS present)
- src/index.ts: FOUND (check_conflicts, suggest_slots tools present)

Commits exist:
- a7786e7 (CalendarService methods): FOUND
- 7d802e3 (MCP tool handlers): FOUND
