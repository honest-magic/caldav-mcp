# Phase 3: Scheduling Intelligence - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Add conflict detection with recurring event expansion and available time slot suggestion. By end of phase, an AI agent can check for scheduling conflicts across all calendars (including expanded RRULE instances with EXDATE/RECURRENCE-ID handling) and propose alternative time slots when conflicts exist.

</domain>

<decisions>
## Implementation Decisions

### RRULE Expansion & Conflict Detection
- Use ical.js built-in `ICAL.RecurExpansion` for RRULE expansion — already in deps, handles EXDATE/RDATE natively
- Expansion bounded to query window only (start/end params) — never expand infinitely
- Check all calendars across all accounts by default, with optional calendar filter parameter
- All-day events treated as full-day blocks for conflict detection purposes

### Slot Suggestion Algorithm
- Gap analysis approach: collect all busy periods in search window, find gaps >= requested duration
- Default search window: 7 days from proposed start, configurable via tool param
- Return max 5 suggested slots (configurable via tool param)
- Optional `workingHours` param (e.g., {start: 9, end: 17}) — defaults to no filter (24h)

### Claude's Discretion
- Internal data structures for busy period collection and merging
- How to handle overlapping busy periods from multiple calendars (merge before gap analysis)
- Performance optimization for large calendars with many recurring events
- Edge cases: events spanning midnight, DST transitions during expansion

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/ical-parser.ts` — parseICS() returns ParsedEvent with recurrenceRule field
- `src/services/calendar.ts` — CalendarService with listEvents(), readEvent() across multi-account
- `src/protocol/caldav.ts` — CalDAVClient fetches raw iCal data from servers
- `src/types.ts` — EventTime with dateTime/timezone, ParsedEvent with all event fields
- ical.js already installed — ICAL.RecurExpansion available

### Established Patterns
- CalendarService orchestrates across CalDAVClient instances per account
- ical-parser.ts wraps ical.js for parsing — same pattern for expansion
- MCP tool handlers in index.ts switch statement

### Integration Points
- New utility: `src/utils/recurrence-expander.ts` wrapping ICAL.RecurExpansion
- New utility: `src/utils/conflict-detector.ts` for busy period analysis + gap finding
- CalendarService needs: checkConflicts(), suggestSlots() methods
- index.ts needs: check_conflicts, suggest_slots MCP tool handlers

</code_context>

<specifics>
## Specific Ideas

- RRULE expansion should produce concrete EventTime instances for each occurrence within the window
- Conflict detector should work with a flat list of time ranges (from expanded events), not raw iCal
- Slot suggestion should respect the duration of the proposed event, not just find any gap

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
