# Domain Pitfalls

**Domain:** CalDAV MCP Client (TypeScript, local macOS, multi-provider)
**Researched:** 2026-03-28
**Confidence:** MEDIUM — based on training knowledge of RFC 4791/5545, DAVx5/sabre/dav community documentation, and open-source CalDAV client issue trackers. Web verification unavailable in this session; flag HIGH-RISK items for manual validation before implementation.

---

## Critical Pitfalls

Mistakes that cause data loss, silent failures, or full rewrites.

---

### Pitfall 1: Overwriting Events Due to Missing ETag Validation

**What goes wrong:** Client fetches an event, user edits it, client PUTs back without sending `If-Match: <etag>` header. If the event was modified server-side between fetch and PUT (e.g., another device synced), the server silently overwrites the newer version. No error is raised. Data is permanently lost.

**Why it happens:** Developers treat CalDAV like a REST API and ignore conditional request headers. ETags look optional until you lose data.

**Consequences:** Silent data loss on concurrent edits. Attendee lists, recurrence rules, or description fields written by another client are destroyed with no warning.

**Prevention:**
- Always store the `ETag` returned in GET/REPORT responses alongside the event object.
- Always send `If-Match: <etag>` on every PUT and DELETE.
- Handle `412 Precondition Failed` explicitly — re-fetch the event, present conflict to the user, do not silently retry.
- For new events (POST/PUT to a new URL), send `If-None-Match: *` to prevent overwriting an existing resource at that URL.

**Detection:** PUT returning 200 instead of 204 on update (some servers signal a conflict this way). Missing `ETag` in response headers after a REPORT.

**Phase:** Address in the first phase that implements write operations (create/update/delete). Non-negotiable before any write tool goes live.

---

### Pitfall 2: Incorrect Service Discovery — Hardcoding Principal/Calendar URLs

**What goes wrong:** Developer hardcodes known calendar URL patterns (e.g., `https://caldav.icloud.com/`) and skips the RFC 4791 service discovery chain: `/.well-known/caldav` → PROPFIND `{DAV:}current-user-principal` → PROPFIND `{urn:ietf:params:xml:ns:caldav}calendar-home-set`. Works for one provider, breaks silently on another.

**Why it happens:** The discovery chain is multi-step and poorly documented. iCloud, Google, and Fastmail all use different base URLs. Developers short-circuit it to save time.

**Consequences:** Client only works with one provider. Adding self-hosted (Radicale, Baikal, Nextcloud) requires full rewrite of URL logic. Breaks when providers change URL structure (iCloud has done this before).

**Prevention:**
- Implement the full discovery chain from RFC 6764/5785: resolve `/.well-known/caldav` first, follow redirects, then walk the PROPFIND chain.
- Never hardcode `/calendars/<username>/` style paths — always derive from `calendar-home-set`.
- Test against at minimum: iCloud, Fastmail, and one self-hosted server (Radicale or Baikal) during development.

**Detection:** Provider works in dev but fails for users with different providers. URL assumptions that include username in path.

**Phase:** Phase 1 (connection/discovery). Must be correct before any other feature works.

---

### Pitfall 3: iCloud Requires App-Specific Passwords, Not Apple ID Password

**What goes wrong:** Client prompts for username/password, user enters their Apple ID email and Apple ID password. iCloud CalDAV rejects it with HTTP 401. User thinks CalDAV is broken. It is not — iCloud requires an app-specific password generated at appleid.apple.com when 2FA is enabled (which is effectively mandatory for all Apple accounts now).

**Why it happens:** This is iCloud-specific behavior that deviates from standard HTTP Basic Auth expectations. No clear documentation in CalDAV specs.

**Consequences:** Users cannot connect iCloud calendars without understanding this requirement. Poor onboarding experience leads to support burden.

**Prevention:**
- Document prominently in setup instructions: iCloud requires an app-specific password from https://appleid.apple.com (Account > App-Specific Passwords).
- Detect iCloud by hostname (`caldav.icloud.com`) and show provider-specific setup guidance during credential configuration.
- Do not mention "Apple ID password" — call it "app-specific password" explicitly.

**Detection:** Persistent 401 from `caldav.icloud.com` with correct email address.

**Phase:** Phase 1 (authentication/credential storage). Document before shipping.

---

### Pitfall 4: Google Calendar Uses OAuth2, Not Basic Auth

**What goes wrong:** Client implements HTTP Basic Auth only. Google Calendar CalDAV endpoint (`apidata.googleusercontent.com`) requires OAuth2 Bearer tokens. Basic auth is completely rejected. Developers either skip Google support or bolt on OAuth2 late, requiring architectural changes.

**Why it happens:** RFC 4791 doesn't mandate OAuth2. Most self-hosted providers use Basic Auth. Google is the major exception that requires OAuth2 with specific scopes.

**Consequences:** Google Calendar is one of the most common providers. If not supported, user base is severely limited. Late OAuth2 addition requires credential store redesign.

**Prevention:**
- Decide on Google Calendar support in Phase 1 before designing credential storage. OAuth2 tokens (access token + refresh token + expiry) have a fundamentally different structure than username/password pairs.
- Required Google OAuth2 scope: `https://www.googleapis.com/auth/calendar` (full access) or `https://www.googleapis.com/auth/calendar.readonly`.
- Google's CalDAV base URL: `https://apidata.googleusercontent.com/caldav/v2/<email>/` — not discoverable via standard `/.well-known/caldav` (returns redirect that requires OAuth2 to follow).
- If deferring Google support initially, design the credential store to accommodate token-based auth from day one.

**Detection:** Google auth fails with 401 even with correct credentials. No Basic Auth support at `www.google.com/calendar/dav/`.

**Phase:** Phase 1 design decision. Cannot be retrofitted cheaply.

---

### Pitfall 5: Timezone Handling — Floating Times vs UTC vs TZID

**What goes wrong:** Client converts all datetimes to UTC for storage/display. Events with `DTSTART;TZID=America/New_York:20260601T090000` get stored as UTC equivalent. When DST changes happen between now and the event date, the event shifts by 1 hour relative to local wall-clock time. The stored UTC time was correct at creation but wrong after DST transition.

**Why it happens:** UTC normalization is the standard web developer reflex. iCalendar's timezone model (TZID parameter on DTSTART/DTEND) is fundamentally different from epoch-based timestamps.

**Consequences:** Events silently shift by 1 hour after DST changes. Meeting at "9am NYC time" becomes "10am" after spring forward. Scheduling conflicts calculated against shifted times are wrong.

**Prevention:**
- Preserve `TZID` parameters verbatim from iCalendar data. Never strip or normalize to UTC during storage.
- When displaying times, resolve `TZID` using a current IANA timezone database (not system TZ, which may be stale).
- Use a library with full IANA timezone support: `luxon` (preferred), `date-fns-tz`, or `@js-joda/timezone`. Do NOT use `moment-timezone` (deprecated).
- For `DATE` (all-day) values like `DTSTART;VALUE=DATE:20260601`, these are floating — never convert to UTC. Store as-is.
- For `DTSTART:20260601T090000Z` (with trailing Z), these ARE UTC — no conversion needed.

**Detection:** Events at round hours that are off by 1 after DST transition. All-day events appearing on wrong day in non-UTC timezones.

**Phase:** Phase 1 (event read/display). Any date handling library choice here is load-bearing.

---

### Pitfall 6: Recurring Event Expansion — RRULE Complexity

**What goes wrong:** Client stores a single master event with `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR` and tries to expand it client-side for conflict checking. Edge cases multiply: `EXDATE` exceptions, `RDATE` additions, `THISANDFUTURE` modifications (RECURRENCE-ID), overriding a single occurrence vs. all future occurrences, COUNT vs UNTIL semantics with DST transitions.

**Why it happens:** RRULE looks simple at first glance (just generate dates) until the full RFC 5545 grammar is encountered. Many developers underestimate it and write a partial implementation.

**Consequences:** Recurring event expansions miss exceptions, generate phantom events, or fail to detect real conflicts. "Delete this and all following" modifies wrong instances.

**Prevention:**
- Do NOT hand-roll RRULE expansion. Use `rrule` (npm: `rrule`) or `ical.js` which handles full RFC 5545 RRULE, EXDATE, RDATE, and RECURRENCE-ID.
- For conflict checking, expand recurring events within a bounded date range only. Never expand unbounded recurring events (FREQ=DAILY with no UNTIL creates infinite series).
- Store and pass through `RECURRENCE-ID` instances untouched — they are exception overrides tied to a specific occurrence.
- When updating a recurring event, distinguish three operations: (1) this occurrence only, (2) this and future, (3) all occurrences. Each has different CalDAV write semantics.
- Use server-side time-range filtering via CalDAV REPORT (VCALENDAR-QUERY with `time-range`) where possible, rather than fetching all events and filtering client-side.

**Detection:** Conflict check misses a recurring meeting. "This and following" delete removes wrong instances.

**Phase:** Phase 1 (event reading/conflict detection) for read expansion; Phase 2 (update/delete) for write semantics.

---

### Pitfall 7: ETag Changes on PROPFIND — Sync Token vs ETag Confusion

**What goes wrong:** Client uses individual ETags to detect changes during sync. Server returns a different ETag for the same resource on every PROPFIND even when the resource hasn't changed (some servers do this for caching reasons). Client re-downloads all events on every poll cycle, consuming bandwidth and rate-limiting budget.

**Why it happens:** Conflating two different sync mechanisms: ETag-based per-resource change detection vs. collection sync tokens (RFC 6578 `sync-collection` REPORT).

**Consequences:** Excessive HTTP requests, hitting rate limits on iCloud/Google, slow sync, high memory pressure from re-parsing unchanged events.

**Prevention:**
- Use `sync-collection` REPORT (RFC 6578) for incremental sync when the server advertises `DAV: sync-collection` in its `DAV:` capability header.
- Fall back to PROPFIND-based ETag comparison only when sync-collection is unavailable (e.g., Radicale older versions).
- Cache ETags locally per resource URL. Only re-fetch an event's content when its ETag changes in a PROPFIND response.
- Implement exponential backoff + minimum poll interval (suggested: 60 seconds minimum) to avoid rate limits regardless of sync strategy.

**Detection:** All events being re-fetched on every poll cycle. HTTP 429 responses from iCloud or Google.

**Phase:** Phase 2 or later (sync/polling). Not needed for initial read-on-demand tool calls.

---

## Moderate Pitfalls

---

### Pitfall 8: iCloud CalDAV URL Structure

**What goes wrong:** iCloud's CalDAV principal URL is `https://caldav.icloud.com/<dsid>/principal/` where `<dsid>` is a numeric user ID, not the Apple ID email. Standard discovery (`/.well-known/caldav` → PROPFIND current-user-principal) returns this. Developers who skip discovery and try to construct the URL from the email address get 404.

**Prevention:** Always follow the full discovery chain. Never construct iCloud URLs from email address components. The `dsid` is only available via PROPFIND discovery.

**Phase:** Phase 1 (discovery).

---

### Pitfall 9: XML Namespace Handling in PROPFIND/REPORT Responses

**What goes wrong:** CalDAV responses use multiple XML namespaces: `DAV:`, `urn:ietf:params:xml:ns:caldav`, `http://apple.com/ns/ical/` (Apple extensions), `http://calendarserver.org/ns/` (CalendarServer extensions). XML parsers that don't handle namespace prefixes correctly (or that treat prefix strings as opaque) silently miss properties.

**Prevention:**
- Use an XML parser with namespace support. In Node.js: `fast-xml-parser` with namespace awareness, or `xmldom` + `xpath` with namespace resolvers.
- Always resolve properties by namespace URI, not by prefix (prefix `D:` and `d:` and `DAV` may all refer to `DAV:` namespace depending on server).
- Test response parsing against all target providers — iCloud uses different namespace prefixes than Google.

**Phase:** Phase 1 (any PROPFIND parsing).

---

### Pitfall 10: VTIMEZONE Component Inclusion on Write

**What goes wrong:** Client PUTs a VCALENDAR with `DTSTART;TZID=America/New_York:...` but omits the `VTIMEZONE` component defining `America/New_York`. RFC 5545 requires VTIMEZONE to be included when TZID is used. Most servers accept it anyway (they know IANA zones), but some strict servers (older Exchange, some Baikal configs) reject it with 400 or silently store wrong times.

**Prevention:**
- When creating/updating events with TZID references, include the full `VTIMEZONE` definition in the VCALENDAR wrapper.
- Use a library like `ical.js` or `rrule` that generates proper VTIMEZONE blocks, or embed pre-generated VTIMEZONE definitions for common zones.

**Phase:** Phase 2 (create/update events).

---

### Pitfall 11: URL Encoding and Resource Naming

**What goes wrong:** Client generates event UIDs or filenames containing characters that break HTTP URLs: spaces, `@`, non-ASCII characters, `/`. `PUT /calendars/user/work/My Event.ics` sends a malformed request. The UID in the iCalendar `UID` property and the resource filename (URL path segment) are separate — they need not match, but the URL must be properly percent-encoded.

**Prevention:**
- Generate event UIDs as UUIDs (e.g., `crypto.randomUUID()`). Use the UID as the filename basis: `<uid>.ics`.
- Always percent-encode resource URLs. In Node.js: `encodeURIComponent(uid) + '.ics'` for the filename portion.
- Never reuse UIDs across different calendar accounts — UID must be globally unique per RFC 5545.

**Phase:** Phase 2 (create events).

---

### Pitfall 12: RSVP/ATTENDEE Status Update Scope

**What goes wrong:** To RSVP to a calendar invite, client modifies the `ATTENDEE` property's `PARTSTAT` parameter (e.g., `PARTSTAT=ACCEPTED`) and PUTs the event back. But the event was created by an organizer on a different server. The PUT updates the local copy but does NOT send an iTIP reply to the organizer. The organizer never knows the RSVP was sent.

**Why it happens:** CalDAV RSVP via PUT updates the local calendar copy. The actual RSVP notification to the organizer goes through iTIP (iCalendar Transport-Independent Interoperability Protocol), typically delivered by email as a REPLY VCALENDAR attachment.

**Consequences:** User thinks they RSVP'd. Organizer sees no response. Meeting attendee count is wrong. User shows up to a cancelled meeting they never got the cancellation for.

**Prevention:**
- Distinguish between two operations: (1) updating local PARTSTAT via CalDAV PUT (updates what YOUR calendar shows), (2) sending iTIP REPLY to organizer (via mail_mcp sending an email with VCALENDAR attachment).
- The project already scopes RSVP email sending to mail_mcp — ensure the caldav_mcp RSVP tool calls the mail_mcp tool for the iTIP reply.
- Document this two-step nature clearly in tool descriptions so the AI agent knows both steps are required.

**Phase:** Phase 3 (RSVP). Must coordinate with mail_mcp interface design.

---

### Pitfall 13: Overly Broad Event Fetching Without Time Bounds

**What goes wrong:** Client issues REPORT to fetch all events in a calendar without a `time-range` filter. Calendar with 10 years of events returns thousands of VCALENDAR objects. Parsing all of them blocks the event loop, exceeds memory limits, and hits provider timeout (iCloud times out REPORT requests > 30 seconds).

**Prevention:**
- Always use `time-range` element in CalDAV REPORT requests. Default to a reasonable window (e.g., 90 days past to 1 year future for general queries).
- Expose `start_date`/`end_date` parameters on MCP event listing tools. Never fetch unbounded.
- For conflict detection, fetch only the relevant time window around the proposed event time.

**Phase:** Phase 1 (list/read events). Must be in the initial implementation.

---

## Minor Pitfalls

---

### Pitfall 14: Content-Type Header on PUT

**What goes wrong:** Client PUTs iCalendar data without setting `Content-Type: text/calendar; charset=utf-8`. Some strict servers (Baikal, older Nextcloud) reject with 415 Unsupported Media Type. Some servers silently accept but store metadata incorrectly.

**Prevention:** Always include `Content-Type: text/calendar; charset=utf-8` on every PUT request. Include `charset=utf-8` explicitly.

**Phase:** Phase 2 (any write operation).

---

### Pitfall 15: Redirect Handling (301/302/307) During Discovery

**What goes wrong:** `/.well-known/caldav` and PROPFIND both commonly return redirects. An HTTP client that doesn't follow redirects (or that strips the `Authorization` header on redirect) silently fails. Some HTTP libraries drop auth headers on cross-origin redirects.

**Prevention:**
- Use an HTTP client configured to follow redirects (up to a reasonable limit, e.g., 5 hops).
- Verify that Authorization headers are preserved across redirects to the same host. For cross-host redirects (uncommon but possible), re-authenticate.
- iCloud's `caldav.icloud.com` commonly redirects to region-specific endpoints.

**Phase:** Phase 1 (discovery/connection).

---

### Pitfall 16: Handling Multi-Status (207) Responses

**What goes wrong:** CalDAV PROPFIND and REPORT responses return `207 Multi-Status` — a single HTTP response containing per-resource status codes in XML. Client checks only the top-level HTTP status code (207 = "ok"), ignores per-resource `<status>` elements inside the XML, and silently misses 404s or 403s for individual calendars/events.

**Prevention:**
- Parse the full `<multistatus>` XML body. Check each `<propstat>/<status>` element for HTTP status codes.
- Log or surface per-resource errors separately from the request-level success.

**Phase:** Phase 1 (any PROPFIND/REPORT parsing).

---

### Pitfall 17: iCloud Rate Limiting and 503 Responses

**What goes wrong:** Client polls iCloud CalDAV frequently (e.g., every 5 seconds) or issues many parallel requests. iCloud returns HTTP 503 with `Retry-After` header. Client that doesn't honor `Retry-After` gets into a retry storm and may trigger temporary IP-level blocking.

**Prevention:**
- Implement exponential backoff. Honor `Retry-After` response header.
- For an MCP tool that reads on-demand (not continuous sync), this is less of an issue — but applies if background polling is added later.
- Minimum poll interval: 60 seconds. Recommended: 5 minutes for passive sync.

**Phase:** Any phase adding polling or background sync.

---

### Pitfall 18: PRODID and VERSION Fields on Generated iCalendar

**What goes wrong:** Client generates VCALENDAR without required `PRODID` and `VERSION:2.0` fields. Strictly-conformant servers reject with 400. Most servers accept it, but interoperability with other clients reading the same calendar is broken.

**Prevention:** Always include `VERSION:2.0` and a meaningful `PRODID:-//caldav-mcp//caldav-mcp//EN` in every generated VCALENDAR object.

**Phase:** Phase 2 (create/update).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Connection/Discovery | Hardcoded URLs (P2), iCloud URL structure (P8), redirect handling (P15) | Implement full RFC 6764 discovery chain; test all providers |
| Authentication | iCloud app-specific password (P3), Google OAuth2 vs Basic Auth (P4) | Decide Google scope early; document iCloud setup requirement |
| Event Read/List | Unbounded fetches (P13), timezone normalization (P5), 207 Multi-Status (P16) | Always time-bound REPORT; preserve TZID verbatim; parse per-resource status |
| Event Write (create/update/delete) | ETag validation (P1), Content-Type header (P14), VTIMEZONE inclusion (P10), URL encoding (P11) | If-Match on every write; include VTIMEZONE; UUID-based filenames |
| Recurring Events | RRULE expansion (P6), EXDATE/RECURRENCE-ID (P6) | Use `rrule` or `ical.js`; never hand-roll; bound expansion range |
| RSVP | Two-step RSVP gap (P12) | CalDAV PUT updates local copy only; iTIP reply requires mail_mcp email send |
| Sync/Polling | ETag vs sync-token confusion (P7), iCloud rate limiting (P17) | Use sync-collection when available; honor Retry-After; minimum 60s poll interval |
| XML Parsing | Namespace handling (P9), Multi-Status (P16) | Parse by namespace URI not prefix; check per-resource status codes |

---

## Sources

**Confidence note:** Web search and fetch tools were unavailable in this session. All findings are based on training knowledge (cutoff August 2025) from:

- RFC 4791 (CalDAV), RFC 5545 (iCalendar), RFC 6578 (sync-collection), RFC 6764 (service discovery) — HIGH confidence on RFC requirements
- sabre/dav documentation and "Building a CalDAV client" guide — MEDIUM confidence (well-established open source project, patterns unlikely to have changed)
- DAVx5 (Android CalDAV client) GitHub issues and wiki — MEDIUM confidence (rich real-world provider quirk documentation)
- iCloud CalDAV specifics (app-specific passwords, dsid URLs) — MEDIUM confidence (stable Apple behavior, unlikely to change)
- Google CalDAV/OAuth2 requirements — MEDIUM confidence (Google OAuth2 requirement is long-standing policy)
- Community knowledge from caldav.io, CalConnect resources — LOW-MEDIUM confidence

**Recommended verification before implementation:**
- Verify iCloud discovery URL chain against current Apple documentation
- Verify Google Calendar CalDAV base URL and current OAuth2 scopes
- Cross-check `rrule` npm package for current maintenance status and RFC 5545 compliance coverage
- Test redirect behavior of target providers with a simple HTTP client before committing to HTTP library choice
