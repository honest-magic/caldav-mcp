# Phase 2: Write Operations - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Add create, update, and delete event tools to the MCP server with mandatory confirmation gate and ETag-based optimistic concurrency. By end of phase, all write operations require explicit user confirmation before execution, and concurrent edit conflicts are detected and surfaced rather than silently overwritten.

</domain>

<decisions>
## Implementation Decisions

### Confirmation Gate Design
- Two-step confirmation pattern matching mail_mcp: first call returns preview + confirmationId, second call with confirmationId executes the write
- Always-on for all writes — not opt-in. Per PROJECT.md requirement CORE-01, no write executes without confirmation
- Confirmation tokens expire after 5 minutes (matches mail_mcp)
- Preview content includes event summary (title, time, calendar, attendees) so user/AI can verify before confirming

### ETag & Write Safety
- Automatic ETag handling: read_event/list_events returns etag in response; create/update/delete tools require etag parameter
- ETag conflict response returns structured error with both versions (local vs server) so the AI can present the diff to the user
- Use ical.js to generate valid VCALENDAR with UID, DTSTAMP, VTIMEZONE for event creation — mirrors the parse path from Phase 1
- Event UID generation via `crypto.randomUUID()` — Node.js 18+ built-in, RFC 4122 compliant

### Claude's Discretion
- Confirmation store implementation details (in-memory Map with TTL cleanup)
- Error message formatting for ETag conflicts
- Which event fields are editable via update_event vs requiring delete+create

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types.ts` — ParsedEvent, EventTime types already defined
- `src/protocol/caldav.ts` — CalDAVClient with connect(), listCalendars(), listEvents() already working
- `src/utils/ical-parser.ts` — parseICS() for reading events
- `src/services/calendar.ts` — CalendarService orchestration layer
- `src/index.ts` — CalDAVMCPServer with 5 read tools registered
- `src/errors.ts` — Error hierarchy (CalDAVMCPError, AuthError, NetworkError, ValidationError, ParseError)
- `src/security/keychain.ts` — Credential CRUD
- mail_mcp confirmation-store.ts pattern (~/dev/mail_mcp/src/utils/confirmation-store.ts)

### Established Patterns
- MCP tool registration in index.ts switch statement
- CalendarService methods called by tool handlers
- CalDAVClient wraps tsdav calls
- ical.js for iCal parse/generate
- All errors extend CalDAVMCPError

### Integration Points
- CalDAVClient needs: createEvent(calendarUrl, icalData, etag?), updateEvent(eventUrl, icalData, etag), deleteEvent(eventUrl, etag) methods
- CalendarService needs: createEvent(), updateEvent(), deleteEvent() with confirmation gate
- index.ts needs: create_event, update_event, delete_event tool handlers
- types.ts needs: ConfirmationToken, WritePreview types
- New file: src/utils/confirmation-store.ts

</code_context>

<specifics>
## Specific Ideas

- Mirror mail_mcp's confirmation-store.ts for the two-step pattern
- ETags should be returned in list_events and read_event responses so they're available for write operations
- Phase 1 read tools may need minor updates to include ETags in their responses

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
