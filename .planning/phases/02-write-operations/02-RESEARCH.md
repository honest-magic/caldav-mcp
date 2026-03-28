# Phase 2: Write Operations - Research

**Researched:** 2026-03-28
**Domain:** CalDAV write operations — iCal generation, ETag concurrency, two-step confirmation gate
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Confirmation Gate:** Two-step pattern matching mail_mcp. First call returns preview + confirmationId. Second call with confirmationId executes write.
- **Always-on:** No opt-in. CORE-01 requires no write executes without confirmation — no bypass possible.
- **Token TTL:** 5 minutes (matches mail_mcp).
- **Preview content:** Title, time, calendar, attendees included so user/AI can verify before confirming.
- **ETag flow:** `list_events` / `read_event` return `etag`; create/update/delete tools require `etag` parameter.
- **ETag conflict response:** Structured error with both versions (local vs server) so AI can diff for user.
- **iCal generation:** Use ical.js to generate valid VCALENDAR with UID, DTSTAMP, VTIMEZONE — mirrors the parse path.
- **UID generation:** `crypto.randomUUID()` — Node.js 18+ built-in, RFC 4122 compliant.

### Claude's Discretion

- Confirmation store implementation details (in-memory Map with TTL cleanup).
- Error message formatting for ETag conflicts.
- Which event fields are editable via `update_event` vs requiring delete+create.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WRITE-01 | User can create a new calendar event (with confirmation gate) | Two-step confirmation store + ical.js VCALENDAR generation + tsdav `createCalendarObject` |
| WRITE-02 | User can update an existing event (ETag-safe, with confirmation gate) | tsdav `updateCalendarObject` passes `calendarObject.etag` as `If-Match`; confirmation gate same pattern |
| WRITE-03 | User can delete an event (ETag-safe, with confirmation gate) | tsdav `deleteCalendarObject` passes `calendarObject.etag` as `If-Match`; confirmation gate same pattern |
| CORE-01 | All write operations require explicit user confirmation before execution | ConfirmationStore.create() / ConfirmationStore.consume() enforced in CalendarService before every write dispatch |
| CORE-03 | All write operations use ETag/If-Match for safe concurrent updates | tsdav natively sends `If-Match: <etag>` when `calendarObject.etag` is set; 412 response surface as ConflictError |
</phase_requirements>

---

## Summary

Phase 2 adds three write tools (`create_event`, `update_event`, `delete_event`) to the existing MCP server. Each tool is split into two calls: a preview call that returns a `confirmationId`, and an execute call that consumes the token and performs the actual write. This two-step pattern is already proven in the companion `mail_mcp` project, whose `ConfirmationStore` class can be ported almost verbatim.

ETag-based concurrency safety is handled natively by tsdav. `updateCalendarObject` and `deleteCalendarObject` accept a `DAVCalendarObject` whose `etag` field is forwarded as an `If-Match` HTTP header. A 412 Precondition Failed response from the server means a conflict; the service layer must catch this, re-fetch the current server version, and return a structured conflict error containing both versions. The AI can then present a diff to the user.

iCal generation for `create_event` uses `ical.js` `Component.toString()` — the same library already used for parsing. The generate path builds a `VCALENDAR` > `VEVENT` tree in-memory, sets required RFC 5545 properties (UID, DTSTAMP, DTSTART, DTEND, SUMMARY), and serializes. VTIMEZONE components are required when events have a non-UTC TZID; `ical.js` provides `TimezoneService` but callers must inject the VTIMEZONE data — the safest approach is to embed the timezone data from the parsed event or from a bundled IANA timezone source.

**Primary recommendation:** Port `mail_mcp`'s `ConfirmationStore` directly, extend `CalDAVClient` with three write methods, extend `CalendarService` with preview+execute pairs, and add three tools to `index.ts`. Add `ConflictError` to `errors.ts`. Patch `readEvent` to return `etag`.

---

## Project Constraints (from CLAUDE.md)

- Protocol: CalDAV (RFC 4791) for broad provider compatibility.
- Interface: MCP specification via `@modelcontextprotocol/sdk`.
- Credentials: OS keychain via `cross-keychain`.
- Node.js: >=18.0.0.
- Write safety: All write operations require explicit user confirmation before execution (CORE-01).
- Stack locked: TypeScript, tsdav 2.1.8, ical.js 2.2.1, zod 4.3.6, vitest 4.1.0.
- GSD workflow: All file changes through GSD entry points.

---

## Standard Stack

All packages are already installed. No new dependencies needed for this phase.

### Core (already in package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsdav | 2.1.8 | CalDAV HTTP client — `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject` | Only actively-maintained TS-native CalDAV library; handles PUT/DELETE with If-Match natively |
| ical.js | 2.2.1 | iCal generation via `Component.toString()` | Already used for parsing; same library covers generation |
| `node:crypto` | built-in (Node 18+) | `randomUUID()` for event UID generation | RFC 4122 compliant, no external dependency |
| zod | 4.3.6 | Tool input validation | Already used; validates tool arguments before service call |
| @modelcontextprotocol/sdk | 1.27.1 | MCP tool registration | Official SDK; established pattern in index.ts |

### No New Packages Required

All required functionality is covered by existing dependencies. Confirmed by:
- tsdav 2.1.8: has `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject` (verified in `node_modules/tsdav/dist/calendar.d.ts`)
- ical.js 2.2.1: `Component.toString()` serializes to valid iCal string (verified in `node_modules/ical.js/dist/types/component.d.ts`)
- `crypto.randomUUID()`: available since Node 18, engine constraint already `>=18.0.0`

---

## Architecture Patterns

### Recommended Project Structure (additions only)

```
src/
├── protocol/
│   └── caldav.ts          # ADD: createEvent(), updateEvent(), deleteEvent() methods
├── services/
│   └── calendar.ts        # ADD: createEvent(), updateEvent(), deleteEvent() with preview+confirm
├── utils/
│   ├── ical-parser.ts     # existing — no changes needed
│   └── confirmation-store.ts   # NEW — port from mail_mcp
├── types.ts               # ADD: ConfirmationToken, WritePreview, ETagConflict types
├── errors.ts              # ADD: ConflictError class
└── index.ts               # ADD: 3 tool definitions + handlers
```

### Pattern 1: tsdav Write Methods

tsdav's `createCalendarObject` sends `PUT` with `If-None-Match: *` (prevents overwrite of existing).
`updateCalendarObject` and `deleteCalendarObject` send `If-Match: <etag>` when `calendarObject.etag` is set.

**Verified from tsdav source:**
```typescript
// createCalendarObject — PUT to calendar.url + filename, adds If-None-Match: *
createCalendarObject({ calendar, iCalString, filename })
// filename convention: `${uid}.ics`

// updateCalendarObject — PUT to calendarObject.url, adds If-Match: calendarObject.etag
updateCalendarObject({ calendarObject: { url, data: iCalString, etag } })

// deleteCalendarObject — DELETE to calendarObject.url, adds If-Match: calendarObject.etag
deleteCalendarObject({ calendarObject: { url, etag } })
```

**Key finding:** tsdav's write methods operate on `DAVCalendarObject` shaped inputs — just `{ url, data?, etag? }`. The `etag` field maps directly to the `If-Match` header. This means `CalDAVClient` can pass the etag from its arguments through to tsdav without any custom header manipulation.

### Pattern 2: CalDAVClient Write Methods

```typescript
// Source: verified against tsdav/dist/calendar.d.ts
async createEvent(calendarUrl: string, iCalString: string, uid: string): Promise<Response> {
  this.assertConnected();
  const calendar = await this._findCalendar(calendarUrl);
  return this.client!.createCalendarObject({
    calendar,
    iCalString,
    filename: `${uid}.ics`,
  });
}

async updateEvent(eventUrl: string, iCalString: string, etag: string): Promise<Response> {
  this.assertConnected();
  return this.client!.updateCalendarObject({
    calendarObject: { url: eventUrl, data: iCalString, etag },
  });
}

async deleteEvent(eventUrl: string, etag: string): Promise<Response> {
  this.assertConnected();
  return this.client!.deleteCalendarObject({
    calendarObject: { url: eventUrl, etag },
  });
}
```

### Pattern 3: ETag Conflict Detection

tsdav returns the raw `Response` object from write operations. A 412 Precondition Failed means the server's ETag does not match — concurrent modification. The service layer must:

1. Check `response.ok` — if false and status is 412, it's a conflict.
2. Re-fetch the current server version of the event.
3. Throw `ConflictError` with both the local (proposed) data and the server (current) data.

```typescript
// In CalendarService.updateEvent()
const response = await client.updateEvent(eventUrl, iCalString, etag);
if (!response.ok) {
  if (response.status === 412) {
    // Re-fetch current server state
    const serverObj = await client.fetchSingleObject(calendar, eventUrl);
    const serverParsed = serverObj?.data ? parseICS(serverObj.data) : null;
    throw new ConflictError('ETag conflict: event modified on server', {
      localData: proposedData,
      serverData: serverParsed,
      serverEtag: serverObj?.etag ?? null,
    });
  }
  throw new NetworkError(`Write failed: HTTP ${response.status}`);
}
```

### Pattern 4: ConfirmationStore (port from mail_mcp)

The `ConfirmationStore` class from `~/dev/mail_mcp/src/utils/confirmation-store.ts` can be ported with zero logic changes. It uses:
- `Map<string, PendingConfirmation>` for storage
- `randomUUID()` from `node:crypto`
- Lazy eviction on `consume()` — expired entries are removed when accessed
- Injectable TTL for tests

```typescript
// mail_mcp pattern — port verbatim with caldav-specific PendingConfirmation shape
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PendingConfirmation {
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
  ttlMs: number;
}

export class ConfirmationStore {
  private readonly store = new Map<string, PendingConfirmation>();
  create(toolName: string, args: Record<string, unknown>): string { ... }
  consume(id: string): PendingConfirmation | undefined { ... }
  get size(): number { ... }
}
```

### Pattern 5: Two-Step Tool Flow

Each write tool has a dual mode: preview and execute. The tool name is reused — the presence of `confirmationId` in args switches behavior.

```
Tool call 1 (no confirmationId):
  → validate inputs
  → generate preview (format event details for human review)
  → store in ConfirmationStore → get id
  → return { preview, confirmationId, expiresIn: "5 minutes" }

Tool call 2 (with confirmationId):
  → consume(confirmationId) — fails if expired or not found
  → verify args match stored args (prevents replay with different data)
  → execute write
  → return success result
```

### Pattern 6: iCal Generation for create_event

```typescript
// Source: ical.js 2.2.1 — Component.toString() verified in dist/types/component.d.ts
import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';

function generateICS(params: {
  uid: string;
  summary: string;
  start: EventTime;
  end: EventTime;
  description?: string | null;
  location?: string | null;
}): string {
  const vcalendar = new ICAL.Component(['vcalendar', [], []]);
  vcalendar.updatePropertyWithValue('version', '2.0');
  vcalendar.updatePropertyWithValue('prodid', '-//honest-magic//caldav-mcp//EN');

  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', params.uid);
  vevent.updatePropertyWithValue('summary', params.summary);
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.now());

  // DTSTART with TZID parameter
  const dtstart = new ICAL.Property('dtstart');
  const startTime = ICAL.Time.fromDateTimeString(params.start.localTime);
  if (params.start.tzid !== 'floating' && params.start.tzid !== 'UTC') {
    dtstart.setParameter('tzid', params.start.tzid);
  }
  dtstart.setValue(startTime);
  vevent.addProperty(dtstart);

  // similar for DTEND...

  vcalendar.addSubcomponent(vevent);
  return vcalendar.toString();
}
```

**VTIMEZONE note:** When generating events with a non-UTC TZID, RFC 5545 requires a VTIMEZONE component in the VCALENDAR. Some servers (Google, iCloud) accept events without it because they resolve TZID from their own registry. However, strict servers (Radicale, Baikal) may reject events lacking VTIMEZONE. The safest approach: include VTIMEZONE when the TZID is not UTC and not floating. ical.js provides `TimezoneService` but does not bundle IANA timezone data — a practical approach is to use the `ical-timezones` package or embed VTIMEZONE strings from a small lookup table. This is Claude's discretion per CONTEXT.md.

### Anti-Patterns to Avoid

- **Calling `response.json()` on tsdav write responses:** tsdav returns raw `Response` — CalDAV servers return no body on success (201/204). Check `response.ok` and `response.status`.
- **Using `If-Match: *` for updates:** Means "match any etag" — bypasses concurrency protection. Always use the specific etag from the fetch.
- **Generating timestamps with `new Date().toISOString()`:** This produces UTC. Must use `ICAL.Time.now()` to get a `DTSTAMP` in the correct format, and EventTime's `localTime` + `tzid` for DTSTART/DTEND to preserve timezone per CORE-02.
- **Storing write data as separate first-class args to ConfirmationStore:** Store the full serialized args including the etag. When consuming, verify the etag in the stored args matches what was previewed — prevents a race where the event is modified between preview and execute.
- **Forgetting to patch `readEvent` to return etag:** Current `readEvent` returns `ParsedEvent` with no etag. Update callers need the etag from `readEvent` too, not just `listEvents`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CalDAV PUT with If-Match | Custom fetch + header assembly | `tsdav.updateCalendarObject` / `deleteCalendarObject` | tsdav already handles header naming, content-type, auth injection |
| iCal string serialization | String concatenation / template literal | `ical.js Component.toString()` | Line folding, property escaping, CRLF line endings are RFC 5545 requirements; hand-rolled output fails strict parsers |
| UUID generation | Custom UUID v4 | `crypto.randomUUID()` | Built-in since Node 14, RFC 4122 compliant, cryptographically random |
| Confirmation token storage | Custom TTL store | Port `mail_mcp`'s `ConfirmationStore` | Already tested, lazy eviction semantics match the MCP request pattern |
| 412 conflict re-fetch | Inline re-fetch in tool handler | `CalendarService` conflict handler (service layer) | Keeps tool handlers thin; service layer owns error enrichment |

---

## Common Pitfalls

### Pitfall 1: ETag Quoting

**What goes wrong:** ETags from CalDAV servers are typically returned with surrounding quotes: `"abc123"`. When stored in `EventSummary.etag` and passed back as `If-Match`, some servers accept unquoted, some require quoted. tsdav passes the etag value as-is in `If-Match` — so whatever is stored in `obj.etag` from `fetchCalendarObjects` goes straight to the header.

**Why it happens:** The tsdav `cleanupFalsy` + `If-Match` header assignment passes the raw string — no quote stripping or wrapping.

**How to avoid:** Store the etag exactly as returned by tsdav — do not strip quotes. Pass it back exactly as received. Do not add or remove quotes in the service layer.

**Warning signs:** 412 errors on valid updates where the event has not changed since fetch.

### Pitfall 2: readEvent Missing ETag

**What goes wrong:** `CalendarService.readEvent()` currently returns `ParsedEvent` (no etag field). A user who calls `read_event` to get event details before `update_event` will not have the etag and cannot pass it to the update tool.

**Why it happens:** Phase 1 `readEvent` was scoped to read-only and `ParsedEvent` type has no `etag` field.

**How to avoid:** Two options: (a) return `{ event: ParsedEvent, etag: string | null }` from `readEvent`, or (b) add `etag` to `ParsedEvent`. Option (a) is less disruptive — it doesn't change the existing type and doesn't break the tool handler's output format.

**Action required:** Patch `CalendarService.readEvent()` to return a wrapper object with etag. Update `read_event` tool handler. This is a Wave 0 task.

### Pitfall 3: 412 vs Network Error Conflation

**What goes wrong:** `tsdav.updateCalendarObject` returns a `Response`. If the code checks `!response.ok` and throws a generic `NetworkError`, ETag conflicts are indistinguishable from connection failures.

**Why it happens:** Easy to write `if (!response.ok) throw new NetworkError(...)` without checking status.

**How to avoid:** Always check `response.status === 412` before the generic error branch. Throw `ConflictError` for 412, `NetworkError` for everything else.

### Pitfall 4: Confirmation Args Mismatch on Execute

**What goes wrong:** The two-step pattern stores the full args at preview time. On execute, the user passes the same tool arguments plus `confirmationId`. If the service only checks the token exists (not that args match), a client could change the `eventUrl` or `etag` between calls.

**Why it happens:** mail_mcp's ConfirmationStore stores args but the execute call re-reads from the request args, not the stored args.

**How to avoid:** On execute, use the args from the stored confirmation — not the args from the execute request (except `confirmationId` itself). This ensures the execute call performs exactly the write that was previewed.

### Pitfall 5: VTIMEZONE Omission

**What goes wrong:** Creating an event with a non-UTC TZID but without a VTIMEZONE component causes strict CalDAV servers (Radicale, Baikal, some Nextcloud) to reject with 400 or silently corrupt the timezone.

**Why it happens:** ical.js generates DTSTART with TZID parameter but does not auto-include VTIMEZONE unless explicitly added.

**How to avoid:** For any DTSTART/DTEND with a non-UTC, non-floating TZID, include the matching VTIMEZONE component. At minimum, include a minimal VTIMEZONE with TZOFFSETFROM/TZOFFSETTO for the standard time period. The full IANA data approach is more correct but complex — acceptable to start with a comment in the code noting the limitation.

---

## Code Examples

### tsdav createCalendarObject Signature (verified)

```typescript
// Source: node_modules/tsdav/dist/calendar.d.ts
createCalendarObject(params: {
  calendar: DAVCalendar;
  iCalString: string;
  filename: string;           // convention: `${uid}.ics`
  headers?: Record<string, string>;
  fetchOptions?: RequestInit;
}): Promise<Response>
// Sends: PUT {calendar.url}/{filename}
// Headers added: content-type: text/calendar; charset=utf-8, If-None-Match: *
```

### tsdav updateCalendarObject Signature (verified)

```typescript
// Source: node_modules/tsdav/dist/calendar.d.ts
updateCalendarObject(params: {
  calendarObject: DAVCalendarObject;  // { url: string, data?: any, etag?: string }
  headers?: Record<string, string>;
  fetchOptions?: RequestInit;
}): Promise<Response>
// Sends: PUT {calendarObject.url}
// Headers added: content-type: text/calendar; charset=utf-8, If-Match: {calendarObject.etag}
```

### tsdav deleteCalendarObject Signature (verified)

```typescript
// Source: node_modules/tsdav/dist/calendar.d.ts
deleteCalendarObject(params: {
  calendarObject: DAVCalendarObject;  // { url: string, etag?: string }
  headers?: Record<string, string>;
  fetchOptions?: RequestInit;
}): Promise<Response>
// Sends: DELETE {calendarObject.url}
// Headers added: If-Match: {calendarObject.etag}
```

### ConfirmationStore (verified — port from mail_mcp)

```typescript
// Source: ~/dev/mail_mcp/src/utils/confirmation-store.ts (read directly)
// Port verbatim — no changes required for this project
import { randomUUID } from 'node:crypto';

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface PendingConfirmation {
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
  ttlMs: number;
}

export class ConfirmationStore {
  private readonly store = new Map<string, PendingConfirmation>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = CONFIRMATION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  create(toolName: string, args: Record<string, unknown>): string {
    const id = randomUUID();
    this.store.set(id, { toolName, args: { ...args }, createdAt: Date.now(), ttlMs: this.ttlMs });
    return id;
  }

  consume(id: string): PendingConfirmation | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    this.store.delete(id);
    if (Date.now() - entry.createdAt >= entry.ttlMs) return undefined;
    return entry;
  }

  get size(): number { return this.store.size; }
}
```

### New Types Required

```typescript
// Add to src/types.ts

// Preview returned on first (no-confirmationId) call to a write tool
export interface WritePreview {
  confirmationId: string;
  expiresIn: string;           // human-readable: "5 minutes"
  operation: 'create' | 'update' | 'delete';
  preview: {
    summary: string;
    calendarUrl: string;
    start?: string;
    end?: string;
    attendees?: string[];      // email addresses
  };
  warning?: string;            // e.g., "Event has been modified since you last read it"
}

// ETag conflict detail returned by ConflictError
export interface ETagConflict {
  localData: Record<string, unknown>;   // the proposed change
  serverData: ParsedEvent | null;       // current server state
  serverEtag: string | null;
}
```

### New ConflictError

```typescript
// Add to src/errors.ts
export enum CalDAVErrorCode {
  // ... existing codes ...
  ConflictError = 'ConflictError',
}

export class ConflictError extends CalDAVMCPError {
  public readonly conflict: ETagConflict;
  constructor(message: string, conflict: ETagConflict, options?: ErrorOptions) {
    super(CalDAVErrorCode.ConflictError, message, options);
    this.conflict = conflict;
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual PUT/DELETE with raw fetch | `tsdav.createCalendarObject` / `updateCalendarObject` / `deleteCalendarObject` | tsdav 2.x | No hand-rolled If-Match headers needed |
| Storing credentials in code | OS keychain via cross-keychain | Phase 1 (done) | No change needed for Phase 2 |
| Optimistic writes (no ETag) | If-Match mandatory (CORE-03) | This phase | 412 conflicts surfaced, not silently lost |

---

## Open Questions

1. **VTIMEZONE inclusion strategy**
   - What we know: ical.js does not auto-include VTIMEZONE; some servers require it; some don't.
   - What's unclear: Which of the target providers (iCloud, Google, Radicale, Baikal) are strict vs lenient about VTIMEZONE on creation.
   - Recommendation: Start without bundled VTIMEZONE data (generate minimal or omit). Document the limitation. Add full IANA data in a future patch if strict-server failures are reported. Claude's discretion per CONTEXT.md.

2. **readEvent etag return shape**
   - What we know: `readEvent` currently returns `ParsedEvent` with no etag. Phase 2 needs etag from `read_event`.
   - What's unclear: Whether to wrap `ParsedEvent` in `{ event, etag }` or add `etag` to `ParsedEvent`.
   - Recommendation: Return `{ event: ParsedEvent; etag: string | null }` from `CalendarService.readEvent` — minimizes type churn and keeps `ParsedEvent` as the canonical event shape.

3. **Editable fields for update_event**
   - What we know: CalDAV replaces the entire VCALENDAR object on PUT — no partial update.
   - What's unclear: Whether to expose all fields as editable or restrict to safe subset (summary, start, end, location, description).
   - Recommendation: Start with safe subset (summary, start, end, location, description). Attendee changes involve iMIP emails — defer to Phase 4 (WRITE-04). Claude's discretion per CONTEXT.md.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 adds write methods to the existing CalDAV stack. No new external dependencies, runtimes, or CLI tools are introduced. All requirements are satisfied by packages already in `node_modules`.

---

## Validation Architecture

Nyquist validation is explicitly disabled (`workflow.nyquist_validation: false` in `.planning/config.json`). Section skipped per instructions.

---

## Sources

### Primary (HIGH confidence)

- `node_modules/tsdav/dist/calendar.d.ts` — `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject` type signatures verified directly
- `node_modules/tsdav/dist/tsdav.cjs.js` lines 1144–1183 — implementation verified: If-None-Match for create, If-Match for update/delete
- `node_modules/ical.js/dist/types/component.d.ts` — `Component.toString()`, `addSubcomponent`, `addPropertyWithValue`, `updatePropertyWithValue` verified
- `~/dev/mail_mcp/src/utils/confirmation-store.ts` — full source read; ConfirmationStore interface and implementation verified
- `src/protocol/caldav.ts` — existing CalDAVClient pattern; confirmed `DAVClientInstance` type; write method integration points identified
- `src/services/calendar.ts` — existing CalendarService; confirmed `etag` already returned in `listEvents` but not `readEvent`
- `src/types.ts` — confirmed `EventSummary.etag: string | null` exists; `ParsedEvent` lacks etag
- `src/errors.ts` — full error hierarchy; confirmed `ConflictError` does not exist and must be added

### Secondary (MEDIUM confidence)

- RFC 5545 §3.6.1 — VTIMEZONE requirement for non-UTC events; DTSTAMP, UID, DTSTART required properties
- RFC 4918 §10.4 — If-Match header semantics; 412 Precondition Failed meaning

### Tertiary (LOW confidence)

- Provider-specific VTIMEZONE leniency (Google, iCloud) — not verified against live servers; based on general knowledge of major provider behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in node_modules, signatures read from type definitions
- Architecture patterns: HIGH — tsdav implementation read from source; mail_mcp pattern read from source; existing codebase fully mapped
- Pitfalls: HIGH for ETag/412 handling (verified from source); MEDIUM for VTIMEZONE provider behavior (not live-tested)

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable stack; 30-day window reasonable)
