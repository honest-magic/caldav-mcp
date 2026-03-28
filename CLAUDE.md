## Project

**CalDAV MCP Server**

A local Model Context Protocol (MCP) server that provides tools to interact with calendars via CalDAV. It allows AI models to list, read, create, update, and delete calendar events.

**Core Value:** Empower AI agents to act as a personal calendar assistant by providing structured, tool-based access to existing calendar accounts through CalDAV.

### Constraints

- **Protocol**: Must use CalDAV for broad compatibility.
- **Environment**: Must run locally on macOS (Darwin).
- **Interface**: Must adhere to the Model Context Protocol (MCP) specification.

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**CalDAV MCP Server**

A local MCP server that provides calendar tools to AI agents via CalDAV. It lets an AI assistant read calendars, create/update/delete events, parse calendar invites from email, check for scheduling conflicts, and suggest alternatives — then act on the user's confirmation. Designed to work alongside mail_mcp as the calendar half of an AI-powered email + calendar workflow.

**Core Value:** AI agents can act as a personal calendar assistant: find invites in email, check for conflicts, and manage calendar events — only acting after explicit user confirmation.

### Constraints

- **Protocol**: Must use CalDAV (RFC 4791) for broad provider compatibility
- **Environment**: Must run locally on macOS, Windows, and Linux
- **Interface**: Must follow MCP specification via `@modelcontextprotocol/sdk`
- **Credentials**: Must use OS keychain (consistent with mail_mcp approach)
- **Node.js**: >=18.0.0 (matches mail_mcp)
- **Write safety**: All write operations require explicit user confirmation before execution
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Already Locked (from project skeleton `package.json`)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | `^1.27.1` | MCP server implementation | Official Anthropic SDK; already in skeleton and mail_mcp; only correct choice for MCP compliance |
| `cross-keychain` | `^1.1.0` | OS keychain credential storage | Consistent with mail_mcp; macOS Keychain via security CLI; no plaintext secrets |
| `zod` | `^4.3.6` | Schema validation / tool input parsing | Standard in MCP tooling; already used in mail_mcp; validates tool call arguments at runtime |
| `typescript` | `^5.9.3` | Language | Consistent with mail_mcp; modern TS with ESM support |
| `vitest` | `^4.1.0` | Unit + integration testing | Consistent with mail_mcp; ESM-native, fast, same test patterns |
| `@types/node` | `^25.5.0` | Node.js type definitions | Matches Node >=18 engine constraint |
### CalDAV Client Library
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tsdav` | `^2.0.0` (verify on npm) | CalDAV/CardDAV HTTP protocol client | Only actively-maintained TypeScript-native CalDAV library; handles PROPFIND, REPORT, PUT, DELETE; supports Basic Auth and OAuth2; tested against iCloud, Google, Fastmail, Radicale |
- Native TypeScript (not a JS wrapper) — no `@types/` package needed
- Explicit iCloud support with app-specific password handling
- Explicit Google Calendar OAuth2 support (fetches token, handles `DAV:` namespace)
- Handles the CalDAV discovery dance (`.well-known/caldav`, `PROPFIND` principal lookup) automatically
- `fetchCalendarObjects` returns parsed objects with URLs suitable for PUT/DELETE
- Active maintenance as of 2025
- `node-caldav` — abandoned, last published ~2018, no TypeScript, no OAuth
- `dav` — unmaintained, outdated HTTP client internals, no types
- Writing raw `PROPFIND`/`REPORT` XML by hand — fragile, provider-specific quirks multiply quickly; use tsdav instead
### iCalendar Parsing Library
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ical.js` | `^2.0.0` (verify on npm) | Parse and generate iCalendar (RFC 5545) data | Mozilla-backed, handles VEVENT, VTIMEZONE, RRULE, VALARM; mature and spec-compliant; works in Node.js ESM |
- Mozilla-developed; treats RFC 5545 compliance as a first-class concern
- Handles recurrence rules (RRULE) correctly — this matters for calendar conflict detection
- Handles VTIMEZONE components, which are required for cross-timezone attendee events
- Can both parse and generate iCal strings (needed for RSVP response generation)
- Used by Thunderbird/Lightning internally, so edge cases are battle-tested
- `icalendar` — Python library, wrong ecosystem
- `rrule` standalone — handles recurrence expansion but not full iCal parsing; use ical.js which includes RRULE support
- Rolling a custom iCal parser — RFC 5545 has enough edge cases (folded lines, TZID parameters, DURATION vs DTEND) that hand-rolling is a trap
### Authentication Helpers
| Provider | Auth Method | Implementation |
|----------|-------------|----------------|
| iCloud | Basic Auth + App-Specific Password | `tsdav` handles natively; credentials stored in keychain via `cross-keychain` |
| Google Calendar | OAuth2 (Bearer token) | `googleapis` package for token acquisition; `tsdav` accepts the token; store refresh token in keychain |
| Fastmail | Basic Auth | `tsdav` handles natively |
| Radicale / Baikal / Nextcloud | Basic Auth or no auth | `tsdav` handles natively |
### Infrastructure / Runtime
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | `>=18.0.0` | Runtime | Locked by project; matches mail_mcp; fetch API built-in (no node-fetch needed) |
| ESM (`"type": "module"`) | — | Module system | Consistent with mail_mcp; required by `@modelcontextprotocol/sdk` |
## Complete `dependencies` Block
## `devDependencies` Block
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CalDAV client | `tsdav` | `node-caldav` | Abandoned since 2018, no TypeScript, no OAuth2 |
| CalDAV client | `tsdav` | `dav` | Unmaintained, no types, stale HTTP internals |
| CalDAV client | `tsdav` | Raw XML + fetch | Fragile; every provider has quirks; tsdav already solves them |
| iCal parsing | `ical.js` | `node-ical` | Weaker RRULE/VTIMEZONE; no iCal generation (needed for RSVP) |
| iCal parsing | `ical.js` | Custom parser | RFC 5545 edge cases are a trap |
| Validation | `zod` (already locked) | `ajv` | Already in skeleton and mail_mcp; no reason to diverge |
| Testing | `vitest` (already locked) | `jest` | Already in skeleton; ESM-native; faster |
## Installation
# Core runtime additions (skeleton already has MCP SDK, cross-keychain, zod)
# Optional: Google Calendar OAuth2 only
# Verify latest versions before installing
## Version Verification Required
| Package | Version Used Here | Verify With |
|---------|------------------|-------------|
| `tsdav` | `^2.0.0` | `npm info tsdav` |
| `ical.js` | `^2.0.0` | `npm info ical.js` |
| `googleapis` | `^144.0.0` | `npm info googleapis` |
## Sources
- Project skeleton `package.json`: `/Users/mis/dev/caldav_mcp/package.json` (HIGH confidence — authoritative)
- Companion `mail_mcp/package.json`: `/Users/mis/dev/mail_mcp/package.json` (HIGH confidence — authoritative)
- Project context: `/Users/mis/dev/caldav_mcp/.planning/PROJECT.md` (HIGH confidence — authoritative)
- tsdav library knowledge: Training data, knowledge cutoff August 2025 (MEDIUM confidence — version unverified)
- ical.js library knowledge: Training data, knowledge cutoff August 2025 (MEDIUM confidence — version unverified)
- CalDAV protocol (RFC 4791): Well-established standard, no version concern (HIGH confidence)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
