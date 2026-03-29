---
phase: quick
plan: 260329-hhq
subsystem: cli
tags: [cli, accounts, keychain, readline]

requires:
  - phase: 01-foundation-read
    provides: config.ts account management (getAccounts, saveAccount), keychain.ts credential storage
provides:
  - CLI accounts subcommands (add, list, remove) via handleAccountsCommand
  - removeAccount function in config.ts
  - CLI routing in index.ts entrypoint (args check before MCP server startup)
affects: [04-invite-workflow, user-onboarding]

tech-stack:
  added: []
  patterns: [CLI subcommand routing in main() before MCP server, node:readline/promises for interactive prompts]

key-files:
  created: [src/cli/accounts.ts]
  modified: [src/config.ts, src/index.ts]

key-decisions:
  - "OAuth2 add exits with message to use register_oauth2_account MCP tool -- too many fields for interactive CLI"

patterns-established:
  - "CLI routing: process.argv checked at top of main(), handleAccountsCommand returns boolean to control flow"
  - "CLI table output: dynamic column widths using padEnd, matching mail_mcp pattern"

requirements-completed: [CLI-ACCOUNTS]

duration: 2min
completed: 2026-03-29
---

# Quick Plan 260329-hhq: CLI Accounts Subcommands Summary

**CLI accounts add/list/remove subcommands matching mail_mcp pattern, with CalDAV-specific fields and keychain credential storage**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-29T10:38:35Z
- **Completed:** 2026-03-29T10:40:11Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- CLI `accounts list` prints dynamic-width table of configured CalDAV accounts
- CLI `accounts add` interactively prompts for CalDAV fields (id, name, serverUrl, username, authType, password) and stores credentials in OS keychain
- CLI `accounts remove <id>` deletes config entry and keychain credentials
- Running with no args still starts MCP server as before (no regression)
- OAuth2 account add redirects to `register_oauth2_account` MCP tool

## Task Commits

Each task was committed atomically:

1. **Task 1: Add removeAccount to config.ts and create CLI accounts handler** - `2143697` (feat)
2. **Task 2: Wire CLI routing into index.ts entrypoint** - `f23419c` (feat)

## Files Created/Modified
- `src/cli/accounts.ts` - CLI accounts subcommand handler with add/list/remove
- `src/config.ts` - Added removeAccount(id) function
- `src/index.ts` - CLI routing at top of main() before MCP server startup

## Decisions Made
- OAuth2 add exits with message to use register_oauth2_account MCP tool (too many fields for interactive CLI prompts)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CLI account management ready for user onboarding
- Pattern established for adding more CLI subcommands if needed

## Self-Check: PASSED

- All 3 files exist on disk
- Both task commits (2143697, f23419c) found in git history

---
*Plan: quick/260329-hhq*
*Completed: 2026-03-29*
