---
phase: 01-foundation-read
plan: "01"
subsystem: auth
tags: [tsdav, ical.js, luxon, zod, cross-keychain, typescript, caldav]

# Dependency graph
requires: []
provides:
  - TypeScript type system (EventTime, ParsedEvent, Attendee, CalendarSummary, EventSummary, BasicCredentials, OAuth2Credentials)
  - Error hierarchy (CalDAVMCPError base + AuthError, NetworkError, ValidationError, ParseError)
  - Account config loader with zod validation and fs.watch cache invalidation
  - OS keychain credential CRUD via cross-keychain
  - OAuth2 token refresh with 60-second expiry buffer and keychain persistence
affects: [02-caldav-client, 03-event-rw, 04-parsing, 01-02-accounts-setup, 01-03-mcp-server]

# Tech tracking
tech-stack:
  added: [tsdav@2.1.8, ical.js@2.2.1, luxon@3.7.2, "@types/luxon@3.7.1"]
  patterns:
    - "Zod schema-driven type inference: CalDAVAccount = z.infer<typeof calDAVAccountSchema>"
    - "In-memory cache with fs.watch invalidation for config files"
    - "Per-item safeParse with console.error logging for invalid accounts"
    - "OAuth2 token refresh with 60s buffer and keychain round-trip persistence"
    - "AuthError (not generic Error) for credential failures"

key-files:
  created:
    - src/types.ts
    - src/errors.ts
    - src/config.ts
    - src/security/keychain.ts
    - src/security/oauth2.ts
  modified:
    - package.json

key-decisions:
  - "tokenUrl (not tokenEndpoint) in OAuth2Tokens to match tsdav credential naming"
  - "calDAVAccountSchema has no password/token fields — credentials live only in keychain"
  - "serviceName defaults to ch.honest-magic.config.caldav-server for keychain service identifier"
  - "ACCOUNTS_PATH at ~/.config/caldav-mcp/accounts.json (caldav-mcp, not mail-mcp)"

patterns-established:
  - "Error hierarchy: CalDAVMCPError base class with CalDAVErrorCode enum; subclasses AuthError/NetworkError/ValidationError/ParseError"
  - "Credential isolation: config schema has no password fields; credentials go through keychain.ts only"
  - "No console.log — only console.error for diagnostics"

requirements-completed: [CONN-02, CONN-03, CONN-04, CONN-05, CORE-04]

# Metrics
duration: 3min
completed: 2026-03-28
---

# Phase 01 Plan 01: Foundation Types and Security Layer Summary

**CalDAV type system, error hierarchy, zod-validated account config, and OS keychain + OAuth2 credential layer mirroring mail_mcp architecture**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-28T16:31:11Z
- **Completed:** 2026-03-28T16:34:06Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Installed tsdav, ical.js, luxon, and @types/luxon; all compile with project tsconfig
- Created complete TypeScript type system covering EventTime (timezone-preserving), ParsedEvent, CalendarSummary, EventSummary, and credential types
- Built CalDAVMCPError error hierarchy with AuthError, NetworkError, ValidationError, ParseError subclasses
- Config loader reads ~/.config/caldav-mcp/accounts.json with zod validation, per-item safeParse, and fs.watch cache invalidation
- Keychain wrapper mirrors mail_mcp exactly — saveCredentials/loadCredentials/removeCredentials via cross-keychain
- OAuth2 token refresh with 60-second buffer, tokenUrl field (tsdav naming), and full keychain round-trip

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, create types.ts and errors.ts** - `fb0b35b` (feat)
2. **Task 2: Create config.ts, security/keychain.ts, and security/oauth2.ts** - `1d733b3` (feat)

## Files Created/Modified

- `src/types.ts` - EventTime, ParsedEvent, Attendee, CalendarSummary, EventSummary, BasicCredentials, OAuth2Credentials interfaces
- `src/errors.ts` - CalDAVErrorCode enum, CalDAVMCPError base class, AuthError/NetworkError/ValidationError/ParseError subclasses
- `src/config.ts` - ACCOUNTS_PATH, calDAVAccountSchema, config, getAccounts, resetConfigCache with fs.watch cache invalidation
- `src/security/keychain.ts` - saveCredentials, loadCredentials, removeCredentials wrapping cross-keychain
- `src/security/oauth2.ts` - OAuth2Tokens interface, getValidAccessToken with refresh and keychain persistence
- `package.json` - Added tsdav, ical.js, luxon runtime deps and @types/luxon dev dep

## Decisions Made

- Used `tokenUrl` (not `tokenEndpoint`) in OAuth2Tokens to match tsdav's credential field naming
- Zod v4 `$ZodIssue.path` is `PropertyKey[]` (includes symbols) — used `i.path.map(String).join('.')` instead of direct `.join('.')`
- calDAVAccountSchema deliberately has no password or token fields — credentials are keychain-only
- serviceName `ch.honest-magic.config.caldav-server` identifies keychain entries consistently

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod v4 PropertyKey[] type mismatch in config.ts**
- **Found during:** Task 2 (config.ts creation)
- **Issue:** Zod v4's `$ZodIssue.path` is typed as `PropertyKey[]` (which includes `symbol`), not `(string | number)[]`. The original explicit type annotation caused a TypeScript error.
- **Fix:** Changed `i.path.join('.')` to `i.path.map(String).join('.')` and removed the now-unnecessary inline type annotation
- **Files modified:** src/config.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** 1d733b3 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type bug)
**Impact on plan:** Single-line fix required for Zod v4 compatibility. No scope creep.

## Issues Encountered

- The plan's per-file tsc verify command (`npx tsc --noEmit src/errors.ts`) fails because `ErrorOptions` requires the full tsconfig lib context. The full project compile (`npx tsc --noEmit`) passes cleanly — this is the correct verification.

## User Setup Required

None - no external service configuration required at this stage.

## Next Phase Readiness

- All 5 source files compile with zero TypeScript errors
- Type system is complete for all CalDAV data structures
- Error hierarchy ready for use in all subsequent modules
- Config/keychain/OAuth2 foundation ready for Plan 02 (account management CLI) and Plan 03 (MCP server entry point)
- No blockers

---
*Phase: 01-foundation-read*
*Completed: 2026-03-28*
