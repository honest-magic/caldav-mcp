# Feature Landscape

**Domain:** CalDAV MCP Server — AI agent calendar assistant
**Researched:** 2026-03-28
**Confidence:** HIGH for protocol-defined features (stable RFCs); MEDIUM for AI-agent UX patterns

---

## Table Stakes

Features users expect from any CalDAV client tool. Missing = product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Connect to CalDAV providers | Core protocol requirement; without it nothing works | Medium | Must support service-discovery (RFC 6764: `/.well-known/caldav`), Basic Auth, and app-specific passwords (iCloud, Google require these) |
| List calendars (PROPFIND) | Users have multiple calendars; must enumerate them | Low | `PROPFIND` on principal URL; need to traverse `calendar-home-set` property |
| List events with date range filter | Without filtering, fetching a large calendar is unusably slow | Medium | CalDAV `calendar-query` REPORT with `<time-range>` filter (RFC 4791 §7.8) |
| Read full event details | The payload of every downstream operation | Low | Parse iCalendar (RFC 5545) `VEVENT` components from fetched `.ics` data |
| Create events (PUT) | Core write operation | Medium | Must generate valid UID, DTSTAMP, handle ETag for safe creation |
| Update events (PUT with ETag) | Events change; updating is expected | Medium | Must use `If-Match` ETag header to prevent lost-update conflicts with server |
| Delete events (DELETE) | Lifecycle completeness | Low | Must handle ETag and `If-Match` to avoid deleting stale resource |
| Parse `.ics` / iCalendar data | Required to handle invites passed from mail_mcp | Medium | RFC 5545 parsing: VEVENT, VTIMEZONE, VALARM components; handle folded lines, encoding |
| Multi-calendar support | Users have personal + work + family calendars | Low | Treat each calendar as an independent resource collection; already implicit in CalDAV model |
| Secure credential storage | macOS keychain is the expected approach for local tools | Low | Use `cross-keychain` (consistent with mail_mcp); never store credentials in plaintext config |
| Timezone handling | Without correct timezone conversion, every time is wrong | High | iCalendar stores times as UTC or with TZID; must map VTIMEZONE blocks and handle DST; use a well-tested tz library (e.g., `luxon`) |

**Confidence:** HIGH — these are protocol-defined or security-baseline requirements.

---

## Differentiators

Features that make this tool distinctly valuable beyond basic CRUD. Not expected, but high leverage for the AI-agent use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Conflict detection | AI can proactively warn before booking overlapping events | Medium | Compare proposed event time window against existing events in affected calendars; must handle all-day events, floating times, and multi-calendar scope |
| Available time slot suggestion | AI can propose alternatives when conflicts exist, not just block | Medium | Given a duration and a search window, find gaps in busy periods; requires fetching a range of events and gap-analysis logic |
| RSVP / invite acceptance (iTIP REPLY) | Close the invite workflow loop; without this, the AI cannot complete "accept this meeting" | High | Construct iTIP REPLY (RFC 5546) with PARTSTAT=ACCEPTED/DECLINED/TENTATIVE; PUT to organizer's scheduling inbox or server scheduling endpoint; send email reply via mail_mcp for iMIP (RFC 6047) |
| Free-busy queries (FREEBUSY report) | Efficient conflict checking without fetching full event data; used by organizers | High | CalDAV `free-busy-query` REPORT (RFC 4791 §7.10); many servers support it but response coverage varies; fallback to event-range scan |
| Recurring event expansion | Many real-world events recur; must read/create them correctly | High | RFC 5545 RRULE parsing (FREQ, INTERVAL, BYDAY, COUNT, UNTIL, EXDATE); expand instances for conflict checking; write RRULE on create; editing "this and future" requires splitting with DTSTART adjustment |
| `.ics` data extraction from mail_mcp pipeline | Enables the core AI workflow: email → calendar | Low | Accept raw `.ics` string as tool input; parse and present structured data before any write |
| Write confirmation gate | Safety contract: AI never mutates calendar without user sign-off | Low | Tool design pattern: read tools return data; write tools require a `confirmed: true` parameter or a two-step confirm tool |
| Multi-account support | Users have iCloud personal + Google Work; must operate across both | Low | Store multiple account configs; route operations to the correct account by calendar identifier |

**Confidence:** HIGH for CalDAV protocol features. MEDIUM for AI-agent UX patterns (confirmation gate design).

---

## Anti-Features

Features to explicitly NOT build. Either out-of-scope for an MCP server, handled by mail_mcp, or complexity traps.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| CalDAV server implementation | Out of scope by design; massive complexity, no user value here | Client-only; connect to existing servers (iCloud, Google, Radicale) |
| Email sending for RSVP replies | mail_mcp owns SMTP; duplicating it creates coupling and maintenance burden | Pass the iMIP reply body back to the AI; let mail_mcp send it |
| Real-time push / webhook / EventSource | CalDAV push (RFC 5056 / Apple push) requires persistent connections and TLS cert; inappropriate for an MCP server | Poll on demand; cache last-known ETags to detect changes on next read |
| GUI / web interface | MCP tools are the interface; a GUI is a separate product | Structured tool outputs; let the AI model render them |
| Calendar sharing / delegation management | ACL management (RFC 3744) is deep infrastructure work not needed for personal assistant use | Personal ops only; if server supports delegation, user sets it up outside this tool |
| Attendee availability lookup across organizations | Requires cross-org CalDAV access; rarely available; privacy implications | Use free-busy on own server only; suggest times based on own calendar |
| iTIP COUNTER (counter-propose) | Rare workflow; complex state machine; organizer must be on same server | Document as not supported; user can counter-propose manually |
| iCalendar VALARM / reminder management as primary feature | Reminders are properties of events, not a standalone workflow for an AI agent | Read and write VALARM components when creating events; don't expose as a top-level tool |
| Offline cache / local database | Adds complexity (sync state, invalidation) beyond what an MCP server needs | Fetch on demand; use ETags for conditional GET to reduce bandwidth |

---

## Feature Dependencies

```
connect_to_server
  → list_calendars
      → list_events (date range)
          → read_event_details
              → detect_conflicts        (requires list_events across relevant calendars)
              → suggest_available_slots (requires list_events + gap analysis)
          → parse_ics_input             (standalone: no server needed for parse-only)
              → create_event            (requires connect + list_calendars to pick target)
              → rsvp_to_invite          (requires create_event path + mail_mcp for iMIP email)

update_event → read_event_details (need current ETag before PUT)
delete_event → read_event_details (need current ETag before DELETE)

recurring_event_expansion → list_events (expansion needed before conflict detection)

free_busy_query → connect_to_server (server-side report; alternative path to conflict detection)

timezone_handling → ALL time-based operations (cross-cutting concern)
secure_credential_storage → connect_to_server
```

Key dependency notes:

- **Conflict detection depends on recurring event expansion.** Without expanding RRULEs, a daily standup appears as one event, so conflicts with its instances go undetected.
- **RSVP depends on mail_mcp** for the iMIP email reply leg. The CalDAV leg (PUT to scheduling inbox) is independent but the full workflow requires both.
- **ETag discipline is a prerequisite for all writes.** Lost-update bugs (overwriting a server-side change) happen when PUT is issued without a current ETag.

---

## MVP Recommendation

Prioritize in this order:

1. **Connect + list calendars** — foundational; nothing else works without it
2. **List events (date range)** — enables all read workflows
3. **Read event details + iCalendar parser** — enables AI to surface structured data
4. **Create event** — first write operation; validates auth and PUT flow
5. **Update event + delete event** — complete CRUD
6. **Conflict detection** — first differentiator; core to the AI-assistant value prop
7. **Parse `.ics` from mail_mcp** — enables the email→calendar workflow

Defer to later phases:
- **Recurring event full RRULE expansion** — start with read-only display of the rule; full expansion is needed for accurate conflict detection but is a scope of its own
- **RSVP / iTIP REPLY** — requires iTIP state machine and mail_mcp coordination; schedule after core CRUD is stable
- **Free-busy query** — useful but complex; event-range scan is an acceptable fallback for MVP
- **Suggest available slots** — layer on top of conflict detection once that's solid
- **Multi-account** — architecture should support it from day one (no account-specific coupling), but only test with one account in MVP

---

## Protocol Feature Coverage Reference

For reference, the CalDAV and iCalendar RFCs define these capabilities. This maps which ones are in scope.

| RFC Feature | RFC Reference | In Scope? | Notes |
|-------------|--------------|-----------|-------|
| Calendar collection CRUD | RFC 4791 §5 | Partial — read/query only | Don't create/delete calendar collections |
| calendar-query REPORT | RFC 4791 §7.8 | YES — table stakes | Date range filtering |
| calendar-multiget REPORT | RFC 4791 §7.9 | YES — needed for batch fetch | Fetch multiple events by URL |
| free-busy-query REPORT | RFC 4791 §7.10 | YES — differentiator | With event-range fallback |
| VEVENT create/update/delete | RFC 5545 + RFC 4791 | YES — table stakes | Core CRUD |
| RRULE / recurrence | RFC 5545 §3.8.5 | YES — differentiator | Complex; phase 2+ |
| VTIMEZONE parsing | RFC 5545 §3.6.5 | YES — table stakes | Cross-cutting concern |
| VALARM | RFC 5545 §3.6.6 | Partial — read/write as event property | Not a primary feature |
| iTIP REQUEST/REPLY/CANCEL | RFC 5546 | REPLY only — differentiator | Accept/decline/tentative |
| iMIP email transport | RFC 6047 | Via mail_mcp | Don't send email directly |
| CalDAV scheduling inbox/outbox | RFC 6638 | Partial — inbox read for invites | Outbox for REPLY |
| Well-known URI discovery | RFC 6764 | YES — table stakes | Provider auto-discovery |
| ACL / delegation | RFC 3744 | NO | Out of scope |

**Confidence:** HIGH — all references are stable, published RFCs.

---

## Sources

- RFC 4791 — CalDAV: Calendaring Extensions to WebDAV (2007, stable)
- RFC 5545 — iCalendar Data Format (2009, stable)
- RFC 5546 — iTIP: iCalendar Transport-Independent Interoperability Protocol (2009, stable)
- RFC 6047 — iMIP: iCalendar Message-Based Interoperability Protocol (2010, stable)
- RFC 6638 — Scheduling Extensions to CalDAV (2012, stable)
- RFC 6764 — Locating Services for Calendaring Extensions (2013, stable)
- RFC 3744 — WebDAV Access Control Protocol (2004, stable)
- Project context: `/Users/mis/dev/caldav_mcp/.planning/PROJECT.md`

Note: Web search and WebFetch were unavailable during this research session. All findings are based on published RFCs (stable standards, HIGH confidence) and project context. No community/ecosystem WebSearch findings are included. Confidence in the protocol feature mapping is HIGH; confidence in AI-agent UX patterns (confirmation gate design) is MEDIUM — validate against mail_mcp's established patterns.
