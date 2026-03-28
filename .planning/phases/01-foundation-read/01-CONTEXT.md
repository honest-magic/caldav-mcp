# Phase 1: Foundation + Read - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the foundational CalDAV MCP server: account configuration, credential storage, CalDAV protocol client, iCalendar parser, and all read-only MCP tools. By end of phase, an AI agent can connect to any CalDAV provider (iCloud, Google, self-hosted) and read calendar data with correct timezone handling.

</domain>

<decisions>
## Implementation Decisions

### Account Configuration & Auth
- Config file at `~/.config/caldav-mcp/accounts.json` — matches mail_mcp pattern
- Google OAuth2 included in Phase 1 — credential schema must accommodate tokens (access + refresh + expiry) from day one per research findings
- Account setup via JSON config file + `register_oauth2_account` tool — consistent with mail_mcp
- Full RFC 6764 auto-discovery via tsdav with manual URL fallback for non-compliant servers

### MCP Tool Design
- Tool naming: `list_calendars`, `list_events`, `read_event`, `parse_ics` — verb_noun pattern matching mail_mcp
- Optional `account` parameter on each tool, defaults to first configured account — matches mail_mcp pattern
- Date range as ISO 8601 strings with optional timezone
- Structured JSON output with key fields extracted + raw iCal available on request

### Architecture & Dependencies
- Mirror mail_mcp structure: `src/{index,config,types,errors}.ts`, `src/protocol/caldav.ts`, `src/services/calendar.ts`, `src/security/`, `src/utils/`
- Separate `src/utils/ical-parser.ts` wrapping ical.js — independently testable with .ics fixtures
- `luxon` for IANA timezone resolution (research recommendation — preserves TZID, handles DST correctly)
- Custom error hierarchy: CalDAVError, AuthError, NetworkError — matches mail_mcp pattern

### Claude's Discretion
- Internal caching strategy for calendar/event data
- Specific tsdav configuration options
- Error message formatting and detail level
- Test fixture selection and coverage scope

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Project skeleton with package.json (MCP SDK, cross-keychain, zod already configured)
- tsconfig.json with ESM module configuration
- Empty src/ directory ready for implementation

### Established Patterns
- mail_mcp (~/dev/mail_mcp) provides the reference architecture:
  - MailMCPServer class pattern → CalDAVMCPServer
  - MailService per-account pattern → CalendarService per-account
  - ImapClient/SmtpClient protocol layer → CalDAVClient
  - Keychain credential storage via cross-keychain
  - StdioServerTransport for MCP communication
  - Confirmation gate pattern for write operations (Phase 2)

### Integration Points
- `@modelcontextprotocol/sdk` Server + StdioServerTransport for MCP entry point
- `cross-keychain` for credential storage
- `tsdav` for CalDAV HTTP protocol operations
- `ical.js` for iCalendar parsing and generation
- `luxon` for timezone handling

</code_context>

<specifics>
## Specific Ideas

- Cross-platform credential storage (macOS, Windows, Linux) — not macOS-only
- mail_mcp companion: design tool outputs so AI can easily pass .ics data between the two servers
- Account config structure should closely mirror mail_mcp's accounts.json for user familiarity

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
