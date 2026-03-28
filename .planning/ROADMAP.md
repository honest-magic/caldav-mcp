# Roadmap: CalDAV MCP Server

## Overview

Four phases take the project from a working read-only calendar client to a full AI-agent calendar assistant. Phase 1 lays the credential, discovery, and read foundation — nothing else can exist without it. Phase 2 adds safe writes with the mandatory confirmation gate and ETag discipline. Phase 3 upgrades the value proposition from CRUD to intelligence by adding conflict detection and slot suggestion. Phase 4 closes the invite workflow with RSVP and adds extended protocol capabilities.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation + Read** - Credential storage, CalDAV discovery, multi-provider auth, and all read tools (completed 2026-03-28)
- [ ] **Phase 2: Write Operations** - Create, update, delete events with ETag safety and mandatory confirmation gate
- [ ] **Phase 3: Scheduling Intelligence** - Conflict detection, RRULE expansion, and available slot suggestion
- [ ] **Phase 4: RSVP + Extended Capabilities** - RSVP workflow, free-busy queries, and Google OAuth2 full flow

## Phase Details

### Phase 1: Foundation + Read
**Goal**: AI agents can connect to any CalDAV provider and read calendar data safely
**Depends on**: Nothing (first phase)
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, READ-01, READ-02, READ-03, READ-04, CORE-02, CORE-04
**Success Criteria** (what must be TRUE):
  1. User can configure a CalDAV account (iCloud, Google, or self-hosted) and credentials are stored in the OS keychain — never in plaintext
  2. User can list all calendars across one or more configured accounts in a single tool call
  3. User can list events within a specified date range, with results showing correct local times (TZID preserved, never normalized to UTC)
  4. User can read full event details including attendees, location, description, and recurrence rule
  5. User can pass raw .ics text as input and receive a parsed event structure (standalone parse, no write required)
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Foundation: deps, types, errors, config, keychain, OAuth2 refresh
- [x] 01-02-PLAN.md — Protocol: CalDAV client wrapper + iCal parser with unit tests
- [x] 01-03-PLAN.md — Service + MCP: CalendarService orchestration + MCP server with 4 tool handlers

**UI hint**: no

### Phase 2: Write Operations
**Goal**: AI agents can create, update, and delete events safely, with no data loss on concurrent edits and no write executing without explicit user confirmation
**Depends on**: Phase 1
**Requirements**: WRITE-01, WRITE-02, WRITE-03, CORE-01, CORE-03
**Success Criteria** (what must be TRUE):
  1. User can create a new calendar event; the operation requires explicit confirmation before any data is written to the server
  2. User can update an existing event; if the event was modified on the server since last read, the tool surfaces a conflict rather than silently overwriting
  3. User can delete an event; the operation requires explicit confirmation and fails safely if the event has changed since it was fetched
  4. No write tool (create, update, delete) executes without a preceding confirmation step — this gate cannot be bypassed
**Plans:** 1/2 plans executed

Plans:
- [x] 02-01-PLAN.md — Types, ConflictError, ConfirmationStore, iCal generator
- [x] 02-02-PLAN.md — CalDAVClient write methods, CalendarService confirmation gate, MCP tool handlers

### Phase 3: Scheduling Intelligence
**Goal**: AI agents can detect conflicts across all calendars (including recurring events) and propose alternative time slots
**Depends on**: Phase 2
**Requirements**: SCHED-01, SCHED-02, SCHED-03
**Success Criteria** (what must be TRUE):
  1. User can check whether a proposed event time conflicts with any existing event, including instances of recurring events expanded within the query window
  2. Conflict detection correctly handles recurring events with EXDATE exceptions and RECURRENCE-ID overrides, not just the base RRULE
  3. When a conflict exists, the tool returns a list of available time slots within a specified search window as alternatives
**Plans**: TBD

### Phase 4: RSVP + Extended Capabilities
**Goal**: AI agents can respond to calendar invites and query server-side free-busy data
**Depends on**: Phase 3
**Requirements**: WRITE-04, SCHED-04
**Success Criteria** (what must be TRUE):
  1. User can RSVP to a calendar invite (accept, decline, or tentative); the local calendar copy is updated via CalDAV PUT and the iTIP REPLY VCALENDAR body is returned for mail_mcp to send
  2. User can query free-busy availability for a time range; when the server supports the free-busy REPORT, it is used; when not supported, an event-range scan fallback is used automatically
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + Read | 3/3 | Complete   | 2026-03-28 |
| 2. Write Operations | 1/2 | In Progress|  |
| 3. Scheduling Intelligence | 0/TBD | Not started | - |
| 4. RSVP + Extended Capabilities | 0/TBD | Not started | - |
