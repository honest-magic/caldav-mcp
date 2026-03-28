---
phase: 01-foundation-read
plan: 03
subsystem: mcp-server
tags: [mcp, caldav, calendar-service, orchestration, oauth2]
dependency_graph:
  requires: [01-01, 01-02]
  provides: [CalendarService, CalDAVMCPServer, saveAccount]
  affects: []
tech_stack:
  added: []
  patterns: [MCP stdio server, service orchestration, multi-account routing]
key_files:
  created:
    - src/services/calendar.ts
    - src/index.ts
  modified:
    - src/config.ts
key_decisions:
  - saveAccount uses upsert semantics with resetConfigCache() call after write
  - CalendarService silently skips accounts that fail to connect during initialize()
  - registerOAuth2Account is non-fatal on connection test failure — credentials still saved
  - parse_ics tool works standalone with no server connection (for mail_mcp .ics attachments)
  - All logging uses console.error() — stdout reserved exclusively for JSON-RPC
metrics:
  duration: 150s
  completed_date: "2026-03-28T16:43:18Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 01 Plan 03: CalendarService and MCP Server Entry Point Summary

## One-liner

CalendarService orchestrating multi-account CalDAV operations + CalDAVMCPServer exposing 5 MCP tools via stdio transport.

## What Was Built

### Task 1: saveAccount helper + CalendarService

**src/config.ts** — added `saveAccount(account)`:
- Validates account via `calDAVAccountSchema.parse()` before writing
- Creates `~/.config/caldav-mcp/` directory if absent
- Upserts by `account.id` (replace existing or append)
- Calls `resetConfigCache()` after write to invalidate the in-memory cache

**src/services/calendar.ts** — new `CalendarService` class:
- `initialize()`: connects to all configured accounts, silently skips failures
- `listCalendars(accountId?)`: returns `CalendarSummary[]` across one or all accounts
- `listEvents(calendarUrl, startDate, endDate, accountId?)`: ISO 8601 inputs converted to UTC via luxon; client-side date filter as defensive net; returns `EventSummary[]`
- `readEvent(eventUrl, calendarUrl, accountId?)`: fetches single object, parses with `parseICS`
- `registerOAuth2Account(params)`: saves credentials to keychain + account to config + attempts connect; non-fatal on connection failure
- `getConnectedAccountIds()`: returns connected account IDs

### Task 2: CalDAVMCPServer with 5 tool handlers

**src/index.ts** — new `CalDAVMCPServer` class:
- Registers 5 tools: `list_calendars`, `list_events`, `read_event`, `parse_ics`, `register_oauth2_account`
- `run()`: initializes CalendarService, connects stdio transport, starts serving
- Error handling: `CalDAVMCPError` returns structured `{ error, code }` JSON; unknown errors return `{ error: 'Internal error', details }`
- `main()` entry point with fatal error handler

## Decisions Made

1. **saveAccount upsert semantics**: Replace existing account with same `id`, append if new. This allows updating accounts via re-registration without duplication.

2. **Silent account connection failures**: During `initialize()`, accounts that fail to connect are logged to stderr and skipped. The server starts with partial connectivity rather than crashing entirely.

3. **Non-fatal registerOAuth2Account**: Connection test failure after registration returns a warning message but keeps the saved credentials. Account will be available after server restart.

4. **Client-side date filter**: `listEvents` applies a secondary local filter after fetching from the CalDAV server, guarding against servers that ignore the REPORT time-range.

5. **parse_ics standalone**: The `parse_ics` tool calls `parseICS()` directly without any CalDAV server connection, making it useful for processing .ics files from mail_mcp email attachments.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed tsdav displayName type mismatch**
- **Found during:** Task 1 TypeScript compile check
- **Issue:** `cal.displayName` in tsdav is typed as `string | Record<string, unknown>`, not `string`
- **Fix:** Used `typeof cal.displayName === 'string' ? cal.displayName : null` guard before `?? 'Untitled'`
- **Files modified:** src/services/calendar.ts
- **Commit:** 32c5c7e

## Verification Results

- `npx tsc --noEmit` exits 0 (no source file errors; node_modules type declaration issues pre-exist)
- `npm run build` exits 0 — produces dist/index.js
- dist/index.js starts with `#!/usr/bin/env node` shebang
- All 5 tool names present in ListTools handler
- `grep -r "console.log" src/ --include="*.ts" | grep -v test | wc -l` returns 0
- No known stubs — all data flows are wired to real CalDAV/keychain operations

## Commits

- `32c5c7e` — feat(01-03): add saveAccount helper and CalendarService orchestration layer
- `ce5b738` — feat(01-03): create CalDAVMCPServer with 5 tool handlers and main entry point

## Self-Check: PASSED
