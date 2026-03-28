---
phase: 02-write-operations
plan: 02
subsystem: write-operations
tags: [caldav, write, confirmation, etag, conflict, mcp-tools]
dependency_graph:
  requires:
    - 02-01 (WritePreview, ETagConflict, ConflictError, ConfirmationStore, generateICS)
    - 01-03 (CalDAVClient, CalendarService base, MCP server scaffold)
  provides:
    - CalDAVClient.createEvent wrapping tsdav createCalendarObject
    - CalDAVClient.updateEvent wrapping tsdav updateCalendarObject
    - CalDAVClient.deleteEvent wrapping tsdav deleteCalendarObject
    - CalendarService.createEvent with two-step confirmation gate
    - CalendarService.updateEvent with ETag safety and confirmation gate
    - CalendarService.deleteEvent with ETag safety and confirmation gate
    - create_event MCP tool (preview + execute)
    - update_event MCP tool (preview + execute)
    - delete_event MCP tool (preview + execute)
    - read_event now returns { event: ParsedEvent, etag: string | null }
  affects:
    - src/protocol/caldav.ts
    - src/services/calendar.ts
    - src/index.ts
tech_stack:
  added: []
  patterns:
    - Two-step confirmation gate: preview returns confirmationId, execute consumes it
    - Stored args used on execute (not request args) per Pitfall 4 — prevents arg tampering
    - ETag passed as-is to tsdav per Pitfall 1 — no quote stripping
    - 412 response triggers ConflictError with local+server state diff
    - ConflictError checked before CalDAVMCPError in error handler (subclass-first)
key_files:
  created: []
  modified:
    - src/protocol/caldav.ts (createEvent, updateEvent, deleteEvent, _findCalendar)
    - src/services/calendar.ts (createEvent, updateEvent, deleteEvent, readEvent patched, confirmationStore)
    - src/index.ts (create_event, update_event, delete_event tools + handlers, ConflictError handler)
decisions:
  - Use stored confirmation args on execute (not incoming request args) to prevent parameter substitution attacks
  - ConflictError handler placed before generic CalDAVMCPError handler since ConflictError extends CalDAVMCPError
  - ETags passed through as-is to tsdav without stripping quotes per RESEARCH.md Pitfall 1
  - readEvent return type changed from ParsedEvent to { event, etag } — breaking change absorbed by updating index.ts handler
metrics:
  duration: ~15min
  completed: "2026-03-28"
  tasks: 2
  files: 3
---

# Phase 2 Plan 2: Write Operations End-to-End Summary

**One-liner:** CalDAVClient write methods (create/update/delete) wired through CalendarService confirmation gate with ETag conflict detection, exposed as three new MCP tools (create_event, update_event, delete_event).

## What Was Built

Three files modified to complete the write operations pipeline:

1. **`src/protocol/caldav.ts`** — Added three write methods to `CalDAVClient`:
   - `createEvent(calendarUrl, iCalString, uid)` — uses `_findCalendar` helper then `createCalendarObject`
   - `updateEvent(eventUrl, iCalString, etag)` — wraps `updateCalendarObject` with ETag passthrough
   - `deleteEvent(eventUrl, etag)` — wraps `deleteCalendarObject` with ETag passthrough
   - Private `_findCalendar(calendarUrl)` helper fetches calendars and finds by URL

2. **`src/services/calendar.ts`** — Added write methods with two-step confirmation pattern:
   - `createEvent` — preview mode stores args and returns WritePreview; execute mode consumes token and calls `client.createEvent`
   - `updateEvent` — preview mode returns WritePreview; execute mode fetches current event, merges updates, detects 412 as ConflictError
   - `deleteEvent` — preview mode fetches event for summary display; execute mode calls `client.deleteEvent` with 412 detection
   - `readEvent` patched to return `{ event: ParsedEvent, etag: string | null }` (breaking change, absorbed in Task 2)

3. **`src/index.ts`** — Added three new MCP tool definitions and handlers:
   - `create_event`: requires calendarUrl, summary, startDate/Tzid, endDate/Tzid; optional confirmationId
   - `update_event`: requires eventUrl, calendarUrl, etag; optional field updates and confirmationId
   - `delete_event`: requires eventUrl, calendarUrl, etag; optional confirmationId
   - Updated `read_event` handler output shape now includes etag alongside event
   - Added `ConflictError`-specific handler before generic `CalDAVMCPError` handler

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add CalDAVClient write methods and patch readEvent | 6989fd4 | src/protocol/caldav.ts, src/services/calendar.ts |
| 2 | Add CalendarService write methods and MCP tool handlers | 7ebf0e3 | src/services/calendar.ts, src/index.ts |

## Verification Results

- `npx tsc --noEmit`: clean (no errors)
- `npm run build`: succeeds, produces dist/index.js
- All 8 MCP tools registered (5 existing + 3 new)
- Both 412 conflict paths (update + delete) verified in source
- ConflictError handler placed before CalDAVMCPError handler (subclass-first)

## Deviations from Plan

### Baseline Merge

The parallel worktree (agent-a54cc0a8) started at the initial skeleton commit and did not have the Plan 01 artifacts (confirmation-store.ts, ical-generator.ts, updated types.ts, updated errors.ts). A merge commit from `worktree-agent-a3d848a2` (the Plan 01 worktree) was added as a baseline before implementing Plan 02 changes. This is an expected parallel execution artifact, not a functional deviation.

None — plan executed as written after baseline was established.

## Known Stubs

None — all write operations are fully implemented end-to-end.

## Self-Check: PASSED

- src/protocol/caldav.ts: FOUND — createEvent, updateEvent, deleteEvent, _findCalendar present
- src/services/calendar.ts: FOUND — confirmationStore, createEvent, updateEvent, deleteEvent present
- src/index.ts: FOUND — create_event, update_event, delete_event tools and handlers present
- Commit 6989fd4: FOUND
- Commit 7ebf0e3: FOUND
- dist/index.js: FOUND (build succeeded)
