---
phase: 01-foundation-read
verified: 2026-03-28T17:45:30Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 01: Foundation + Read Verification Report

**Phase Goal:** AI agents can connect to any CalDAV provider and read calendar data safely
**Verified:** 2026-03-28T17:45:30Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | CalDAV account schema validates both Basic Auth and OAuth2 account types | VERIFIED | `calDAVAccountSchema` uses `z.enum(['basic', 'oauth2'])` in `src/config.ts:27` |
| 2  | Credentials are stored/retrieved from OS keychain, never in plaintext config | VERIFIED | `calDAVAccountSchema` has no password/token fields; all credential access through `src/security/keychain.ts` |
| 3  | OAuth2 tokens can be refreshed with 60-second expiry buffer | VERIFIED | `Date.now() + 60000 < tokens.expiryDate` check in `src/security/oauth2.ts:33` |
| 4  | Multiple accounts can be loaded from accounts.json simultaneously | VERIFIED | `getAccounts()` returns `CalDAVAccount[]`; `CalendarService.initialize()` connects all accounts |
| 5  | CalDAV client auto-discovers endpoint via tsdav with RFC 6764 .well-known/caldav | VERIFIED | `defaultAccountType: 'caldav'` in `createDAVClient` calls in `src/protocol/caldav.ts:43,60` |
| 6  | CalDAV client supports both Basic Auth and OAuth2 connection methods | VERIFIED | `authMethod: 'Basic'` and `authMethod: 'Oauth'` branches in `src/protocol/caldav.ts:34-62` |
| 7  | iCal parser extracts all event fields: uid, summary, description, location, start, end, rrule, attendees, organizer | VERIFIED | All fields extracted in `src/utils/ical-parser.ts:77-105`; 13 unit tests pass |
| 8  | Timezone handling preserves TZID — output uses localTime + tzid, never UTC-collapsed Date objects | VERIFIED | `time.timezone ?? t.zone?.tzid` in `src/utils/ical-parser.ts:24`; `.toJSDate()` absent from file |
| 9  | User can list all calendars across configured accounts in a single tool call | VERIFIED | `list_calendars` tool in `src/index.ts:175-179` routes to `CalendarService.listCalendars()` |
| 10 | User can list events within a date range with correct local times and TZID preserved | VERIFIED | `list_events` tool with ISO 8601 inputs; luxon UTC conversion + client-side filter in `src/services/calendar.ts:57-113` |
| 11 | MCP server starts via stdio transport and responds to ListTools and CallTool requests | VERIFIED | `StdioServerTransport`, `ListToolsRequestSchema`, `CallToolRequestSchema` wired in `src/index.ts`; `node dist/index.js` starts cleanly |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/types.ts` | CalDAVAccount, CalendarSummary, EventSummary, ParsedEvent, EventTime types | VERIFIED | All 7 interfaces present; exported; 59 lines, substantive |
| `src/errors.ts` | Error hierarchy: CalDAVMCPError, AuthError, NetworkError, ValidationError, ParseError | VERIFIED | All 5 classes + enum present; exported; 42 lines |
| `src/config.ts` | ACCOUNTS_PATH, calDAVAccountSchema, getAccounts, config, saveAccount, resetConfigCache | VERIFIED | All 6 exports present; 131 lines; fs.watch cache invalidation implemented |
| `src/security/keychain.ts` | Keychain CRUD wrapping cross-keychain | VERIFIED | saveCredentials, loadCredentials, removeCredentials; 19 lines; uses config.serviceName |
| `src/security/oauth2.ts` | OAuth2 token refresh with keychain persistence | VERIFIED | OAuth2Tokens interface, getValidAccessToken with refresh + 60s buffer; 69 lines |
| `src/protocol/caldav.ts` | CalDAVClient class wrapping tsdav createDAVClient | VERIFIED | connect(), fetchCalendars(), fetchCalendarObjects(), fetchSingleObject(); 123 lines |
| `src/utils/ical-parser.ts` | parseICS function wrapping ical.js with timezone preservation | VERIFIED | parseICS exported; extractEventTime never calls toJSDate(); 119 lines |
| `src/utils/ical-parser.test.ts` | Unit tests for iCal parser | VERIFIED | 13 tests in 9 describe blocks; all pass |
| `src/services/calendar.ts` | CalendarService orchestrating CalDAVClient + parseICS across accounts | VERIFIED | CalendarService with initialize/listCalendars/listEvents/readEvent/registerOAuth2Account; 237 lines |
| `src/index.ts` | CalDAVMCPServer class with 5 tool handlers + main() entry point | VERIFIED | 5 tools registered; stdio transport; main() entry point; 267 lines |
| `dist/index.js` | Compiled runnable entry point | VERIFIED | File exists; starts with `#!/usr/bin/env node`; server starts cleanly |

---

### Key Link Verification

All key links from plan frontmatter verified against actual source:

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `src/config.ts` | `src/types.ts` | `CalDAVAccount = z.infer<typeof calDAVAccountSchema>` | WIRED | `export type CalDAVAccount = z.infer<typeof calDAVAccountSchema>` at line 31 |
| `src/security/oauth2.ts` | `src/security/keychain.ts` | `loadCredentials` / `saveCredentials` | WIRED | `import { loadCredentials, saveCredentials } from './keychain.js'` at line 1 |
| `src/security/keychain.ts` | `src/config.ts` | `config.serviceName` | WIRED | `config.serviceName` used as first arg to all cross-keychain calls |
| `src/protocol/caldav.ts` | `src/config.ts` | `CalDAVAccount` type | WIRED | `import type { CalDAVAccount } from '../config.js'` at line 2 |
| `src/protocol/caldav.ts` | `src/security/keychain.ts` | `loadCredentials` | WIRED | `import { loadCredentials } from '../security/keychain.js'` at line 5 |
| `src/protocol/caldav.ts` | `src/security/oauth2.ts` | `getValidAccessToken` | WIRED | `import { getValidAccessToken } from '../security/oauth2.js'` at line 6 |
| `src/utils/ical-parser.ts` | `src/types.ts` | Returns `ParsedEvent` with `EventTime` | WIRED | `import type { ParsedEvent, Attendee, EventTime } from '../types.js'` at line 2 |
| `src/services/calendar.ts` | `src/protocol/caldav.ts` | `CalDAVClient` for server communication | WIRED | `import { CalDAVClient } from '../protocol/caldav.js'` at line 1 |
| `src/services/calendar.ts` | `src/utils/ical-parser.ts` | `parseICS` for transforming ICS data | WIRED | `import { parseICS } from '../utils/ical-parser.js'` at line 2 |
| `src/services/calendar.ts` | `src/security/keychain.ts` | `saveCredentials` for registerOAuth2Account | WIRED | `import { saveCredentials } from '../security/keychain.js'` at line 5 |
| `src/services/calendar.ts` | `src/config.ts` | `saveAccount` for persisting new account | WIRED | `import { getAccounts, saveAccount } from '../config.js'` at line 3 |
| `src/index.ts` | `src/services/calendar.ts` | `CalendarService` for all tool logic | WIRED | `import { CalendarService } from './services/calendar.js'` at line 10 |
| `src/index.ts` | `@modelcontextprotocol/sdk` | `Server` + `StdioServerTransport` | WIRED | SDK imports at lines 2-9; `new StdioServerTransport()` at line 253 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/services/calendar.ts` (listCalendars) | `results: CalendarSummary[]` | `client.fetchCalendars()` → tsdav HTTP PROPFIND | Yes — tsdav live CalDAV queries | FLOWING |
| `src/services/calendar.ts` (listEvents) | `results: EventSummary[]` | `client.fetchCalendarObjects()` → `parseICS(obj.data)` | Yes — tsdav + ical.js pipeline | FLOWING |
| `src/services/calendar.ts` (readEvent) | `ParsedEvent` | `client.fetchSingleObject()` → `parseICS(obj.data)` | Yes — tsdav + ical.js pipeline | FLOWING |
| `src/utils/ical-parser.ts` (parseICS) | `ParsedEvent` | `ICAL.parse(raw)` + `ICAL.Component` + `ICAL.Event` | Yes — ical.js parses real ICS text | FLOWING |
| `src/index.ts` (parse_ics tool) | return JSON | `parseICS(args.icsData)` | Yes — standalone, no network | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `parseICS` produces real EventTime with correct tzid | `node --input-type=module` importing `dist/utils/ical-parser.js` | `America/New_York 2024-03-15T09:00:00 spot-check@test` | PASS |
| All 13 ical-parser unit tests pass | `npx vitest run src/utils/ical-parser.test.ts` | 13 passed, 1 test file | PASS |
| TypeScript compiles with zero errors | `npx tsc --noEmit` | exit 0, no output | PASS |
| Full build produces `dist/index.js` | `npm run build` | exit 0, `dist/index.js` exists | PASS |
| `CalDAVMCPServer` class exported from dist | `import { CalDAVMCPServer }` from `dist/index.js` | `typeof CalDAVMCPServer === 'function'` | PASS |
| `CalendarService` all methods present | `import { CalendarService }` from `dist/services/calendar.js` | all 5 methods: `function` | PASS |
| `config.serviceName` correct value | `import { config }` from `dist/config.js` | `'ch.honest-magic.config.caldav-server'` | PASS |
| No `console.log` in source files | `grep -r "console.log" src/ --include="*.ts"` | 0 matches | PASS |
| MCP server starts cleanly | `node dist/index.js` (background) | Logs `CalDAV MCP server running on stdio` | PASS |

---

### Requirements Coverage

All 11 requirement IDs claimed by this phase (across all three plans) are accounted for:

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONN-01 | Plan 02 | Server auto-discovers CalDAV endpoint via RFC 6764 | SATISFIED | `defaultAccountType: 'caldav'` in tsdav createDAVClient; tsdav handles `.well-known/caldav` discovery internally |
| CONN-02 | Plan 01, 03 | User can authenticate with Basic Auth | SATISFIED | `authMethod: 'Basic'` branch in `caldav.ts:34-44`; `list_calendars` / `list_events` tools available |
| CONN-03 | Plan 01 | User can authenticate with OAuth2 | SATISFIED | `authMethod: 'Oauth'` branch in `caldav.ts:46-62`; token refresh in `oauth2.ts` |
| CONN-04 | Plan 01 | Credentials stored in OS keychain | SATISFIED | `cross-keychain` wrapping in `keychain.ts`; no password fields in `calDAVAccountSchema` |
| CONN-05 | Plan 01 | Multiple CalDAV accounts simultaneously | SATISFIED | `clients: Map<string, CalDAVClient>` in `CalendarService`; `getAccounts()` returns array |
| READ-01 | Plan 03 | User can list all calendars across accounts | SATISFIED | `list_calendars` MCP tool routes to `CalendarService.listCalendars()` |
| READ-02 | Plan 03 | User can list events within a date range | SATISFIED | `list_events` MCP tool with ISO 8601 date params; luxon UTC conversion |
| READ-03 | Plan 03 | User can read full event details | SATISFIED | `read_event` MCP tool routes to `CalendarService.readEvent()` returning `ParsedEvent` |
| READ-04 | Plan 02 | User can parse raw .ics data | SATISFIED | `parse_ics` MCP tool calls `parseICS()` standalone with no server connection |
| CORE-02 | Plan 02 | Timezone handling preserves TZID | SATISFIED | `EventTime { localTime, tzid }` pattern; never calls `.toJSDate()`; UTC event test passes |
| CORE-04 | Plan 01 | Server runs on macOS, Windows, and Linux | SATISFIED | `cross-keychain` handles all three OSes; Node.js >=18 runtime; no OS-specific code paths in source |

**Orphaned requirements check:** REQUIREMENTS.md traceability table maps exactly these 11 IDs to Phase 1. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found |

Scan result: No `TODO`, `FIXME`, placeholder comments, empty handlers, stubbed returns, or `console.log` calls found in any source file. All data paths are wired to real CalDAV/keychain/ical.js operations.

---

### Human Verification Required

#### 1. Basic Auth Provider Connectivity

**Test:** Configure an iCloud account in `~/.config/caldav-mcp/accounts.json`, store an app-specific password in keychain, then call `list_calendars` via MCP client.
**Expected:** Returns the user's iCloud calendars with correct displayName, URL, and ctag.
**Why human:** Requires a live CalDAV server and real credentials. Cannot test network I/O programmatically in this verification.

#### 2. OAuth2 Token Refresh End-to-End

**Test:** Register a Google Calendar account via `register_oauth2_account` with real OAuth2 credentials, then force token expiry and call `list_calendars`.
**Expected:** `getValidAccessToken` automatically refreshes the token, updates keychain, and returns fresh calendars.
**Why human:** Requires live Google OAuth2 token endpoint and real refresh token.

#### 3. Multiple Accounts Simultaneous Operation

**Test:** Configure two accounts from different providers (e.g. iCloud + Fastmail), call `list_calendars` without `account` filter.
**Expected:** Returns calendars from both accounts in a single response, each with correct `accountId`.
**Why human:** Requires two live CalDAV accounts.

#### 4. Client-Side Date Filter Defensive Behavior

**Test:** Connect to a CalDAV server that does not respect REPORT time-range filters, call `list_events` with a narrow date window.
**Expected:** Events outside the requested range are silently dropped by the client-side luxon filter in `CalendarService.listEvents`.
**Why human:** Requires a CalDAV server that specifically ignores time-range in REPORT requests.

---

### Gaps Summary

No gaps found. All 11 must-have truths are verified, all 11 artifacts pass three-level verification (exists, substantive, wired), all data flows are connected to real CalDAV/ical.js operations, and all 11 required requirement IDs are fully satisfied.

---

_Verified: 2026-03-28T17:45:30Z_
_Verifier: Claude (gsd-verifier)_
