# Requirements: CalDAV MCP Server

**Defined:** 2026-03-28
**Core Value:** AI agents can act as a personal calendar assistant: find invites in email, check for conflicts, and manage calendar events — only acting after explicit user confirmation.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Connection & Auth

- [ ] **CONN-01**: Server auto-discovers CalDAV endpoint via RFC 6764 (.well-known/caldav)
- [ ] **CONN-02**: User can authenticate with Basic Auth (self-hosted, iCloud app-specific passwords)
- [ ] **CONN-03**: User can authenticate with OAuth2 (Google Calendar)
- [ ] **CONN-04**: Credentials stored securely in OS keychain via cross-keychain (macOS, Windows, Linux)
- [ ] **CONN-05**: User can configure and use multiple CalDAV accounts simultaneously

### Calendar Read

- [ ] **READ-01**: User can list all calendars across configured accounts
- [ ] **READ-02**: User can list events within a date range
- [ ] **READ-03**: User can read full event details (time, location, attendees, description, recurrence)
- [ ] **READ-04**: User can parse raw .ics data passed as input (from mail_mcp attachments)

### Calendar Write

- [ ] **WRITE-01**: User can create a new calendar event (with confirmation gate)
- [ ] **WRITE-02**: User can update an existing event (ETag-safe, with confirmation gate)
- [ ] **WRITE-03**: User can delete an event (ETag-safe, with confirmation gate)
- [ ] **WRITE-04**: User can RSVP to calendar invites (accept/decline/tentative via CalDAV + mail_mcp for iMIP email)

### Scheduling Intelligence

- [ ] **SCHED-01**: System detects scheduling conflicts against existing events across calendars
- [ ] **SCHED-02**: System suggests available time slots when conflicts exist
- [ ] **SCHED-03**: System expands recurring events (RRULE) for accurate conflict detection
- [ ] **SCHED-04**: System supports free-busy queries (RFC 4791 §7.10) with event-range fallback

### Cross-Cutting

- [ ] **CORE-01**: All write operations require explicit user confirmation before execution
- [ ] **CORE-02**: Timezone handling preserves TZID (never normalizes to UTC)
- [ ] **CORE-03**: All write operations use ETag/If-Match for safe concurrent updates
- [ ] **CORE-04**: Server runs on macOS, Windows, and Linux

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Extended Scheduling

- **SCHED-05**: Attendee availability lookup across shared calendars
- **SCHED-06**: iTIP COUNTER (counter-propose alternative times)

### Management

- **MGMT-01**: Interactive CLI account setup wizard (like mail_mcp)
- **MGMT-02**: Connection validation on startup (--validate-accounts flag)

### Observability

- **OBS-01**: Audit logging of all tool calls (JSONL format, like mail_mcp)
- **OBS-02**: Read-only mode flag (--read-only)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| CalDAV server implementation | Client only — connect to existing servers |
| Email sending for RSVP | mail_mcp owns SMTP; pass iMIP body back to AI for mail_mcp to send |
| Real-time push/webhooks | Inappropriate for MCP server; poll on demand |
| GUI or web interface | MCP tools are the interface |
| Calendar sharing/delegation (ACL) | Deep infrastructure work not needed for personal assistant |
| VALARM as primary feature | Read/write as event property only, not a standalone tool |
| Offline cache/local database | Fetch on demand; use ETags for conditional GET |
| iTIP COUNTER (counter-propose) | Rare workflow, complex state machine — deferred to v2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 | Phase 1 | Pending |
| CONN-02 | Phase 1 | Pending |
| CONN-03 | Phase 1 | Pending |
| CONN-04 | Phase 1 | Pending |
| CONN-05 | Phase 1 | Pending |
| READ-01 | Phase 1 | Pending |
| READ-02 | Phase 1 | Pending |
| READ-03 | Phase 1 | Pending |
| READ-04 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| WRITE-01 | Phase 2 | Pending |
| WRITE-02 | Phase 2 | Pending |
| WRITE-03 | Phase 2 | Pending |
| CORE-01 | Phase 2 | Pending |
| CORE-03 | Phase 2 | Pending |
| SCHED-01 | Phase 3 | Pending |
| SCHED-02 | Phase 3 | Pending |
| SCHED-03 | Phase 3 | Pending |
| WRITE-04 | Phase 4 | Pending |
| SCHED-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after roadmap creation*
