# Project Research Summary

**Project:** CalDAV MCP Server
**Domain:** Local MCP server providing AI-agent access to calendar accounts via CalDAV protocol
**Researched:** 2026-03-28
**Confidence:** MEDIUM (stack versions unverified; protocol and architecture HIGH)

## Executive Summary

The CalDAV MCP Server is a local TypeScript/Node.js process that speaks the Model Context Protocol on one side and RFC 4791 CalDAV on the other. Experts build this class of tool as a thin, stateless HTTP adapter — the CalDAV server (iCloud, Google, Fastmail, Radicale) holds all state; the MCP server holds only credentials (in the OS keychain) and a short-lived in-memory cache. The project has a direct architectural predecessor in `mail_mcp`, which already solves the MCP wiring, confirmation gate, keychain storage, and account-config patterns. The correct strategy is to mirror that structure precisely and layer the CalDAV-specific concerns (service discovery, iCalendar parsing, ETag discipline, RRULE expansion) on top.

The recommended stack is `tsdav` for CalDAV HTTP operations and `ical.js` for iCalendar parsing and serialization, on top of the skeleton's already-locked dependencies (`@modelcontextprotocol/sdk`, `cross-keychain`, `zod`, `typescript`, `vitest`). These two additions cover the entire protocol surface and are the only actively-maintained TypeScript-native options in the Node.js ecosystem. `googleapis` is needed only if Google Calendar support is in scope, and that decision must be made before Phase 1 because it changes the credential-storage schema.

The dominant risks are front-loaded in Phase 1: ETag-less writes cause silent data loss and must be present from the first write operation; CalDAV service discovery must follow the full RFC 6764 chain or multi-provider support is impossible to retrofit; and the iCloud/Google auth split (app-specific password vs OAuth2) must be designed into the credential store from day one. None of these risks are exotic — they are well-documented in open-source CalDAV client issue trackers and the sabre/dav guide. Mitigation is straightforward if addressed early.

## Key Findings

### Recommended Stack

The project skeleton already pins six of the eight needed packages. Only `tsdav` and `ical.js` need to be added for core functionality; `googleapis` is an optional addition for Google Calendar OAuth2. All three library versions must be verified against npm before installation (`npm info tsdav`, `npm info ical.js`, `npm info googleapis`) — training-data versions are estimates.

**Core technologies:**
- `@modelcontextprotocol/sdk ^1.27.1`: MCP server implementation — already locked, official Anthropic SDK, only correct choice
- `tsdav ^2.0.0` (verify): CalDAV HTTP client — only actively-maintained TypeScript-native CalDAV library; handles PROPFIND/REPORT/PUT/DELETE, Basic Auth, OAuth2, and all major providers including iCloud and Google
- `ical.js ^2.0.0` (verify): iCalendar parse + generate — Mozilla-backed; handles RRULE, VTIMEZONE, VALARM; can both parse and generate iCal strings (required for event creation and RSVP)
- `cross-keychain ^1.1.0`: Credential storage — already locked; macOS Keychain via security CLI; consistent with mail_mcp
- `zod ^4.3.6`: Schema validation — already locked; validates tool call arguments at runtime
- `googleapis ^144.0.0` (optional, verify): Google OAuth2 token exchange — needed only for Google Calendar; tsdav handles CalDAV requests once a bearer token is obtained
- `luxon` (unlisted, needs version): Timezone-aware date handling — required for correct TZID resolution; do NOT use `moment-timezone` (deprecated) or raw UTC normalization

### Expected Features

**Must have (table stakes):**
- CalDAV service discovery (RFC 6764 `/.well-known/caldav` chain) — nothing works without this
- List calendars via PROPFIND — users have multiple calendars; must enumerate them
- List events with date-range filter — unbounded fetch is unusably slow and hits provider timeouts
- Read event details (iCalendar parse) — the payload of all downstream operations
- Create event via conditional PUT — first write op; establishes ETag discipline
- Update and delete event with `If-Match` ETag — prevents silent data loss on concurrent edits
- Parse incoming `.ics` data from mail_mcp pipeline — enables the core email-to-calendar workflow
- Secure credential storage via keychain — macOS expectation; never plaintext config
- Timezone handling (TZID preservation, IANA tz database) — without this, every time is wrong

**Should have (differentiators for AI-agent value):**
- Conflict detection — AI warns before booking overlapping events; requires RRULE expansion for accuracy
- Write confirmation gate (always-on, no opt-out) — calendar writes are high-stakes; matches PROJECT.md requirement
- Available time slot suggestion — AI proposes alternatives, not just blocks; depends on conflict detection
- Recurring event RRULE expansion — required for accurate conflict checking; use ical.js, never hand-roll
- RSVP / iTIP REPLY (accept/decline/tentative) — closes the invite workflow; iTIP email leg delegates to mail_mcp
- Multi-account support — design from day one; architecture already supports it via per-account service instances

**Defer to v2+:**
- Free-busy query REPORT — server-side efficiency improvement; event-range scan is an acceptable MVP fallback
- Google Calendar OAuth2 full flow — decision required in Phase 1 design, but full implementation can follow core CRUD
- Sync-collection polling (RFC 6578) — needed for background sync; not required for on-demand MCP tools
- `COUNTER` iTIP (counter-propose) — rare workflow; complex state machine; out of scope

### Architecture Approach

The architecture is a six-layer dependency hierarchy mirrored from mail_mcp: MCP Transport (stdio) → Tool Dispatcher (index.ts, confirmation gate, service map) → CalendarService (domain logic, conflict detection, caching) → CalDAVClient (tsdav wrapper, RFC 4791 HTTP) → ICalParser (pure ical.js wrapper, zero I/O). Cross-cutting utilities (KeychainStore, ConfirmationStore, EventCache, AuditLogger, Zod validation) and config/CLI sit outside the main chain. Each layer has no knowledge of layers above it, making all layers independently testable.

**Major components:**
1. `index.ts` — MCP server + tool dispatcher; enforces `WRITE_TOOLS` confirmation gate (always-on, no exceptions); manages `Map<accountId, CalendarService>` with lazy init and 1-retry backoff
2. `services/calendar.ts` — CalendarService; all domain operations (list/read/create/update/delete/conflict/RSVP); owns EventCache (TTL 5 min, 200 entries); delegates network to CalDAVClient and parsing to ICalParser
3. `protocol/caldav.ts` — CalDAVClient; tsdav wrapper; returns raw `{ href, etag, data: string }` to CalendarService (no parsing here); injects credentials from keychain on connect
4. `utils/ical-parser.ts` — ICalParser; pure functions only; parse VCALENDAR text → typed objects; serialize typed objects → VCALENDAR text; expand RRULE within bounded range; manipulate ATTENDEE PARTSTAT
5. `security/keychain.ts` + `security/oauth2.ts` — credential lifecycle; mirrors mail_mcp exactly; service name `ch.honest-magic.config.caldav-server`
6. `config.ts` + `cli/` — account config at `~/.config/caldav-mcp/accounts.json`; `fs.watch` invalidation; CLI for account add/remove/list and Claude Desktop install

### Critical Pitfalls

1. **ETag-less writes cause silent data loss** — always store ETag from GET/REPORT; send `If-Match` on every PUT/DELETE; handle 412 by re-fetching and surfacing conflict; send `If-None-Match: *` on new resource PUT. Non-negotiable from the first write operation.
2. **Hardcoded CalDAV URLs break multi-provider support** — implement full RFC 6764 discovery chain (`/.well-known/caldav` → PROPFIND `current-user-principal` → PROPFIND `calendar-home-set`); never construct provider-specific paths from email addresses; test against iCloud, Fastmail, and one self-hosted server.
3. **UTC normalization corrupts timezone-aware events** — preserve `TZID` parameters verbatim; never strip to UTC; use `luxon` or `date-fns-tz` with IANA database for display; treat `VALUE=DATE` (all-day) as floating and never convert.
4. **Auth architecture must accommodate both Basic Auth and OAuth2 from day one** — iCloud requires app-specific password (not Apple ID password); Google requires OAuth2 Bearer tokens (no Basic Auth accepted); credential schema must support both auth types before any provider is connected.
5. **RRULE expansion must use a library** — hand-rolled RRULE expansion reliably misses EXDATE exceptions, RECURRENCE-ID overrides, and DST interactions; use `ical.js` (bundled) or `rrule` (npm); always bound expansion to a date range to avoid infinite series.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation + Core Read
**Rationale:** Service discovery, auth, and read operations are the prerequisite for everything else. The ETag and timezone pitfalls must both be addressed here — they cannot be retrofitted later without breaking changes. This phase produces a working read-only MCP server with multi-provider support.
**Delivers:** Working `list_calendars`, `list_events` (date-range), `read_event` tools; multi-provider CalDAV connection with full discovery chain; credential storage for Basic Auth (iCloud, Fastmail, self-hosted) and OAuth2 structure (Google-ready); timezone-safe event representation; EventCache; ICalParser (parse only)
**Addresses features:** Service discovery, list calendars, list events with date range, read event details, secure credential storage, timezone handling, parse `.ics` input (standalone tool, no write needed)
**Avoids:** Hardcoded URLs (P2), iCloud URL structure (P8), timezone normalization (P5), unbounded fetches (P13), redirect handling (P15), XML namespace issues (P9), 207 Multi-Status parsing (P16)
**Research flag:** Standard patterns (tsdav handles discovery; mirror mail_mcp auth structure) — skip `/gsd:research-phase`

### Phase 2: Write Operations (CRUD)
**Rationale:** Writes depend on confirmed reads from Phase 1. ETag discipline must be central to the implementation from the first write, not added later. The two-step confirmation gate (always-on) must be wired before any write tool is exposed.
**Delivers:** `create_event`, `update_event`, `delete_event` tools with mandatory two-step confirmation; conditional PUT with `If-Match`/`If-None-Match`; ICalParser serialize path; VTIMEZONE inclusion; UUID-based resource naming; AuditLogger; `parse_ics` tool (full pipeline: parse + conflict pre-check before write)
**Addresses features:** Create event, update event, delete event, write confirmation gate, multi-account routing
**Avoids:** ETag-less writes (P1), missing Content-Type header (P14), VTIMEZONE omission (P10), URL encoding (P11), skipping confirmation for "low-risk" writes (architecture anti-pattern)
**Research flag:** Standard patterns (mirror mail_mcp confirmation gate exactly) — skip `/gsd:research-phase`

### Phase 3: Conflict Detection + Scheduling Intelligence
**Rationale:** Conflict detection is the primary AI-agent differentiator and depends on accurate RRULE expansion. This phase upgrades the value proposition from "calendar CRUD tool" to "calendar assistant." RRULE expansion scoped to read/display is the gating dependency.
**Delivers:** `detect_conflicts` tool (expand recurring events within query window, compare time overlaps across calendars); `suggest_available_slots` tool (gap analysis within search window); RRULE expansion in ICalParser (bounded range only); recurring event read/display support
**Addresses features:** Conflict detection, available time slot suggestion, recurring event expansion (read path)
**Avoids:** Hand-rolled RRULE (P6), unbounded recurrence expansion (P6), conflict check against unexpanded recurring events
**Research flag:** RRULE expansion edge cases (EXDATE, RECURRENCE-ID, DST) — consider `/gsd:research-phase` to confirm ical.js API for bounded expansion

### Phase 4: RSVP + mail_mcp Integration
**Rationale:** RSVP closes the invite workflow but depends on stable write operations (Phase 2) and requires coordination with mail_mcp for the iTIP email reply leg. The two-step RSVP nature (CalDAV PUT for local copy + mail_mcp for organizer notification) must be explicit in tool design.
**Delivers:** `rsvp_event` tool (accept/decline/tentative); ATTENDEE PARTSTAT manipulation in ICalParser; iTIP REPLY VCALENDAR construction; coordination interface with mail_mcp for iMIP email send; CalDAV scheduling inbox read for incoming invites
**Addresses features:** RSVP / iTIP REPLY, `.ics` parsing from mail_mcp pipeline (full round-trip), scheduling inbox
**Avoids:** RSVP scope confusion — CalDAV PUT updates local copy only; organizer notification always requires mail_mcp email step (P12)
**Research flag:** iTIP/iMIP state machine and mail_mcp interface contract — `/gsd:research-phase` recommended to confirm handoff protocol

### Phase 5: Polish + Extended Provider Support
**Rationale:** Google OAuth2 full flow, free-busy queries, and sync optimizations are improvements over what earlier phases deliver. None are blocking for the core use case.
**Delivers:** Google Calendar OAuth2 full setup flow (if not done in Phase 1); `free_busy_query` tool; CLI account management (`accounts add/remove/list`, `install-claude`); sync-collection polling support (if background sync is desired); RSVP write semantics for recurring event instances
**Addresses features:** Free-busy query, multi-account CLI management, Google Calendar full support, recurring event write semantics (this/this-and-future/all)
**Avoids:** ETag vs sync-token confusion (P7), iCloud rate limiting (P17)
**Research flag:** Free-busy query server support variance across providers — `/gsd:research-phase` to verify tsdav API for free-busy REPORT and provider-specific behavior

### Phase Ordering Rationale

- Phase 1 before Phase 2: All write operations require a working read path (need current ETag before every PUT). Auth and discovery must be proven before writes add risk surface.
- Phase 2 before Phase 3: Conflict detection is only useful if writes can act on it. Detecting a conflict and having no way to create an alternative time is a dead-end workflow.
- Phase 3 before Phase 4: RSVP acceptance may trigger conflict detection ("this meeting conflicts with your standup — accept anyway?"). That check requires Phase 3 to exist.
- Phase 4 before Phase 5: Free-busy and polling are optimizations; RSVP is the last workflow-closing feature before the tool is "complete" for the core AI-assistant use case.
- Google OAuth2 is a Phase 1 design decision (credential schema) but can be implemented in Phase 5 — design the schema to accommodate tokens from day one, implement the full flow later.

### Research Flags

Phases needing deeper research during planning:
- **Phase 3:** ical.js RRULE bounded expansion API — confirm exact method signatures and EXDATE/RECURRENCE-ID handling before designing the ICalParser interface
- **Phase 4:** mail_mcp interface contract for iTIP iMIP handoff — confirm whether mail_mcp has a `send_email` tool that accepts raw VCALENDAR body, or whether a new tool needs to be designed
- **Phase 5:** Free-busy REPORT provider coverage — iCloud and Google may not support `free-busy-query` REPORT; need to confirm fallback behavior and tsdav support

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1:** tsdav handles discovery chain; credential schema mirrors mail_mcp; well-documented patterns
- **Phase 2:** Confirmation gate pattern is a direct copy from mail_mcp; ETag conditional PUT is specified by RFC 4791

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core packages (MCP SDK, zod, vitest, etc.) are HIGH — sourced from skeleton. `tsdav`, `ical.js`, `googleapis` versions are MEDIUM — training data only, must verify with npm before Phase 1 |
| Features | HIGH | All table-stakes features are protocol-defined (stable RFCs). AI-agent UX patterns (confirmation gate design) are MEDIUM — validate against mail_mcp's established approach |
| Architecture | HIGH | Direct pattern reference from mail_mcp source code (read during research). Layer boundaries and component responsibilities are well-defined and tested in the predecessor project |
| Pitfalls | MEDIUM | RFC-grounded pitfalls (ETag, discovery, timezone) are HIGH confidence. Provider-specific behavior (iCloud dsid URL, Google OAuth2 scopes) is MEDIUM — stable in practice but needs live verification |

**Overall confidence:** MEDIUM-HIGH — the architecture and feature set are well-understood; the main uncertainty is library version verification and provider-specific behavior that requires live testing against real servers.

### Gaps to Address

- **Library version verification:** Run `npm info tsdav`, `npm info ical.js`, `npm info googleapis` before Phase 1 begins. Versions in STACK.md are estimates from training data.
- **Google Calendar scope decision:** Must be made before designing the credential schema in Phase 1. If Google support is in scope, `authType: 'oauth2'` must be in the account schema from day one.
- **luxon (or timezone library) not in skeleton:** Timezone handling is a table-stakes requirement but no timezone library is currently in the stack. Add `luxon` (or verify ical.js handles IANA resolution natively) before Phase 1 event-display work.
- **mail_mcp interface contract for RSVP:** The exact tool name and parameter shape for sending iMIP emails from caldav_mcp needs to be confirmed against the live mail_mcp implementation before Phase 4 design.
- **Provider live testing:** iCloud app-specific password flow and Google CalDAV OAuth2 redirect chain need live verification during Phase 1 — training data on these is MEDIUM confidence.

## Sources

### Primary (HIGH confidence)
- `/Users/mis/dev/caldav_mcp/package.json` — skeleton dependency versions (authoritative)
- `/Users/mis/dev/mail_mcp/package.json` — companion project dependency versions (authoritative)
- `/Users/mis/dev/caldav_mcp/.planning/PROJECT.md` — project requirements (authoritative)
- `~/dev/mail_mcp/src/` — architecture pattern reference (direct code read, HIGH confidence)
- RFC 4791 — CalDAV: Calendaring Extensions to WebDAV (stable standard)
- RFC 5545 — iCalendar Data Format (stable standard)
- RFC 5546 — iTIP: iCalendar Transport-Independent Interoperability Protocol (stable standard)
- RFC 6047 — iMIP: iCalendar Message-Based Interoperability Protocol (stable standard)
- RFC 6578 — Collection Synchronization for WebDAV (stable standard)
- RFC 6638 — Scheduling Extensions to CalDAV (stable standard)
- RFC 6764 — Locating Services for Calendaring Extensions (stable standard)

### Secondary (MEDIUM confidence)
- tsdav library (npm) — TypeScript CalDAV client; version unverified from training data (cutoff August 2025)
- ical.js library (npm) — Mozilla-backed iCalendar parser; version unverified from training data
- sabre/dav "Building a CalDAV client" guide — provider quirks and discovery patterns
- DAVx5 GitHub issues/wiki — real-world provider-specific CalDAV behavior documentation
- iCloud CalDAV behavior (app-specific passwords, dsid URLs) — stable Apple behavior, unverified against current docs
- Google CalDAV OAuth2 requirements — long-standing Google policy, unverified against current API docs

### Tertiary (LOW-MEDIUM confidence)
- caldav.io, CalConnect resources — community knowledge on provider quirks
- googleapis npm package — Google OAuth2 token exchange; version unverified

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
