# Architecture Patterns

**Domain:** CalDAV MCP Server (calendar client, AI agent interface)
**Researched:** 2026-03-28
**Reference pattern:** mail_mcp (`~/dev/mail_mcp`) — direct architectural predecessor

---

## Recommended Architecture

Six layers arranged in a strict dependency hierarchy. Lower layers have no knowledge of
higher layers. Each layer has a single responsibility and a clear boundary.

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Transport                       │
│           (stdio via @modelcontextprotocol/sdk)         │
└───────────────────┬─────────────────────────────────────┘
                    │ tool calls (name + args JSON)
┌───────────────────▼─────────────────────────────────────┐
│                  Tool Dispatcher (index.ts)              │
│  • Route tool name → handler                            │
│  • Enforce confirmation gate for WRITE_TOOLS set        │
│  • Manage ConfirmationStore (TTL 5 min, UUID tokens)    │
│  • Manage CalDAVService map (accountId → instance)      │
│  • Rate limiting, graceful shutdown, in-flight drain    │
└──────┬────────────────────────┬────────────────────────-┘
       │ read ops               │ write ops (confirmed)
┌──────▼────────────────────────▼────────────────────────┐
│                 CalendarService (services/calendar.ts)   │
│  • High-level domain operations                         │
│  • Conflict detection, free-slot suggestions            │
│  • ICS parsing for incoming invite data                 │
│  • Delegates network ops to CalDAVClient                │
│  • Owns EventCache (TTL, per-account)                   │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP verbs + raw iCalendar strings
┌───────────────────▼─────────────────────────────────────┐
│               CalDAVClient (protocol/caldav.ts)          │
│  • RFC 4791 HTTP layer (PROPFIND, REPORT, PUT, DELETE)  │
│  • tsdav library wrapping                               │
│  • Credential injection from KeychainStore              │
│  • Auth strategy: Basic or OAuth2 token                 │
│  • Returns raw VObject strings / DAV response objects   │
└───────────────────┬─────────────────────────────────────┘
                    │ raw iCalendar text (VCALENDAR/VEVENT)
┌───────────────────▼─────────────────────────────────────┐
│             ICalParser (utils/ical-parser.ts)            │
│  • Parse iCalendar text → typed CalendarEvent objects   │
│  • Serialize CalendarEvent → iCalendar text for PUT     │
│  • Recurrence expansion (RRULE)                         │
│  • RSVP ATTENDEE property manipulation                  │
│  Based on: ical.js (proven browser + Node compat)       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│          Cross-cutting: security/ and utils/             │
│  • security/keychain.ts — cross-keychain read/write     │
│  • security/oauth2.ts   — token refresh for Google      │
│  • utils/confirmation-store.ts — UUID→pending op map    │
│  • utils/event-cache.ts — TTL cache (mirror msg-cache)  │
│  • utils/audit-logger.ts — write op audit trail         │
│  • utils/validation.ts  — Zod schema guards             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   config.ts + cli/                       │
│  • ~/.config/caldav-mcp/accounts.json                   │
│  • fs.watch invalidation (identical to mail_mcp)        │
│  • cli/accounts.ts — add/remove/list accounts           │
│  • cli/install-claude.ts — write claude_desktop_config  │
└─────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### index.ts — MCP Server + Tool Dispatcher

| Responsibility | Details |
|----------------|---------|
| MCP entrypoint | `new Server(...)`, `StdioServerTransport`, `ListTools` + `CallTool` handlers |
| Write gate | `WRITE_TOOLS` Set; first call without `confirmationId` → store pending op, return UUID |
| Confirmation | `ConfirmationStore.create()` → UUID returned to AI; second call with UUID → `consume()` → execute |
| Service lifecycle | `Map<accountId, CalendarService>`; lazy init on first tool call; auto-reconnect with 1-retry backoff |
| Graceful shutdown | Drain in-flight count, disconnect all services |

Communicates with: `CalendarService` (one instance per account), `ConfirmationStore`, `RateLimiter`, `AuditLogger`, `config.getAccounts()`.

Does NOT communicate directly with: `CalDAVClient`, `ICalParser`, `KeychainStore`. Those are CalendarService's concern.

---

### services/calendar.ts — CalendarService

| Responsibility | Details |
|----------------|---------|
| List calendars | PROPFIND principal → enumerate calendar collections |
| List/search events | REPORT with time-range filter → parse → return typed events |
| Read event | Fetch single VEVENT by UID or href |
| Create event | Serialize CalendarEvent → PUT new resource (UID-based URL) |
| Update event | Fetch current ETag, serialize modified event, conditional PUT |
| Delete event | DELETE by href, conditional on ETag |
| Parse ICS input | Delegate raw .ics string → ICalParser → CalendarEvent |
| Conflict detection | Load events for time range → compare start/end overlap |
| Free-slot suggestions | Walk candidate slots until N non-conflicting windows found |
| RSVP | Manipulate ATTENDEE PARTSTAT, PUT updated event |
| Caching | `EventCache` (TTL-based, key: `accountId:calendarHref:eventUid`) |

Communicates with: `CalDAVClient` (all network), `ICalParser` (parsing/serialization), `EventCache`.

Does NOT communicate with: `ConfirmationStore`, `KeychainStore` (injected at construction via account config).

---

### protocol/caldav.ts — CalDAVClient

| Responsibility | Details |
|----------------|---------|
| HTTP transport | Wraps `tsdav` DAVClient; manages session object |
| PROPFIND | Discover calendars on principal URL |
| REPORT | Time-range or UID-based event query (CalDAV `calendar-query`) |
| PUT | Create or update VEVENT; sets `Content-Type: text/calendar` |
| DELETE | Remove VEVENT by href |
| Credential injection | Pulls password from `KeychainStore` on `connect()`; stores nothing in memory beyond session lifetime |
| Auth strategies | `Basic` (iCloud, Fastmail, self-hosted); `Bearer` token (Google via OAuth2 refresh) |

Communicates with: `KeychainStore` (credential fetch), `OAuth2` (token refresh), CalDAV server over HTTPS.

Does NOT communicate with: `ICalParser`, `CalendarService` domain logic.

---

### utils/ical-parser.ts — ICalParser

| Responsibility | Details |
|----------------|---------|
| Parse | `VCALENDAR` text → `CalendarEvent[]` typed objects |
| Serialize | `CalendarEvent` → `VCALENDAR` text for PUT |
| Recurrence | Expand `RRULE` into concrete instances within a time range |
| RSVP mutation | Set `ATTENDEE;PARTSTAT=ACCEPTED/DECLINED/TENTATIVE` |
| Attachment detection | Detect embedded `.ics` attachments (for mail_mcp integration) |

Communicates with: nothing — pure functions, zero I/O.

---

### utils/event-cache.ts — EventCache

Mirrors `MessageBodyCache` exactly:
- In-memory `Map<string, CacheEntry>` with TTL + max-size eviction
- Key: `${accountId}:${calendarHref}:${eventUid}`
- TTL: 5 minutes (same as mail_mcp)
- Max size: 200 entries (calendars tend to have more discrete objects than inboxes)
- Lost on restart — acceptable, reads are cheap
- Instantiated per `CalendarService`, NOT as module singleton

---

### utils/confirmation-store.ts — ConfirmationStore

Copied directly from mail_mcp (identical semantics):
- UUID → `{ toolName, args, createdAt, ttlMs }` map
- `create()` → UUID string returned to AI
- `consume(id)` → undefined if expired or not found; removes entry
- TTL: 5 minutes
- Lazy eviction on `consume()`

---

### security/keychain.ts and security/oauth2.ts

Mirrors mail_mcp exactly:
- `saveCredentials(accountId, secret)` → `cross-keychain` setPassword
- `loadCredentials(accountId)` → `cross-keychain` getPassword
- `removeCredentials(accountId)` → `cross-keychain` deletePassword
- Service name: `ch.honest-magic.config.caldav-server` (distinct from mail_mcp's `mail-server`)
- `oauth2.ts`: Google CalDAV requires OAuth2; stores refresh token in keychain, exchanges for Bearer on connect

---

### config.ts

Mirrors mail_mcp exactly:
- Accounts file: `~/.config/caldav-mcp/accounts.json`
- Audit log: `~/.config/caldav-mcp/audit.log`
- `fs.watch` invalidation — cache nulled when file changes
- Zod schema for account validation with `safeParse` per-item (bad entries skip, don't crash)
- Account schema: `{ id, name, caldavUrl, user, authType: 'basic' | 'oauth2', displayName? }`

---

### cli/ — Account Management CLI

| File | Purpose |
|------|---------|
| `cli/accounts.ts` | `accounts add/remove/list` commands; writes accounts.json |
| `cli/install-claude.ts` | Writes entry into `~/Library/Application Support/Claude/claude_desktop_config.json` |

---

## Data Flow

### Read Path (e.g., list_events)

```
AI → MCP tool call "list_events" {accountId, calendarId, from, to}
  → index.ts: not in WRITE_TOOLS → pass through
  → getService(accountId) → CalendarService (lazy init)
  → CalendarService.listEvents(calendarId, from, to)
      → EventCache.get(key) → HIT: return cached events
      → EventCache.get(key) → MISS:
          → CalDAVClient.reportEvents(calendarHref, from, to)
              → tsdav REPORT request → CalDAV server HTTPS
              ← array of { href, etag, data: "BEGIN:VCALENDAR..." }
          → ICalParser.parseMany(dataStrings) → CalendarEvent[]
          → EventCache.set(key, events)
  → format as JSON text content → MCP response → AI
```

### Write Path (e.g., create_event) — Two-Step Confirmation

```
Step 1 — AI first call (no confirmationId):
  AI → MCP tool call "create_event" {accountId, ...eventData}
  → index.ts: in WRITE_TOOLS, no confirmationId present
  → ConfirmationStore.create("create_event", args) → UUID
  → Return to AI: "Confirm? confirmationId: <UUID>" with human-readable summary

Step 2 — AI confirmed call (includes confirmationId):
  AI → MCP tool call "create_event" {accountId, ...eventData, confirmationId: UUID}
  → index.ts: WRITE_TOOLS, confirmationId present
  → ConfirmationStore.consume(UUID) → PendingConfirmation (or expired → error)
  → getService(accountId) → CalendarService
  → CalendarService.createEvent(calendarId, eventData)
      → ICalParser.serialize(eventData) → iCalendar string
      → CalDAVClient.putEvent(calendarHref, uid, icalString)
          → KeychainStore.loadCredentials(accountId) → password/token
          → tsdav PUT → CalDAV server
          ← 201 Created + ETag
      → EventCache.delete(key) [invalidate]
  → AuditLogger.log(accountId, "create_event", eventData)
  → Return success with event UID → AI
```

### ICS Parsing Path (from mail_mcp)

```
AI (with mail_mcp context) → reads .ics attachment via mail_mcp get_attachment
  → passes raw ICS string to caldav_mcp "parse_ics" tool
  → index.ts → CalendarService.parseIcs(icsString)
      → ICalParser.parse(icsString) → CalendarEvent
      → CalendarService.checkConflicts(event.start, event.end)
          → listEvents for overlapping window (with cache)
          → return conflicting events or empty
  → Return: { event: CalendarEvent, conflicts: CalendarEvent[] } → AI
```

---

## Patterns to Follow

### Pattern 1: Lazy Service Init with Auto-Reconnect

Identical to mail_mcp `getService()`:

```typescript
private async getService(accountId: string): Promise<CalendarService> {
  if (this.services.has(accountId)) return this.services.get(accountId)!;
  try {
    return await this._createAndCacheService(accountId);
  } catch (firstErr) {
    await new Promise(r => setTimeout(r, 1_000));
    return await this._createAndCacheService(accountId); // throws NetworkError on second fail
  }
}
```

**Why:** CalDAV connections are HTTP-based (stateless), so "reconnect" means re-establishing auth
headers. One retry with 1-second backoff covers transient failures without hanging.

---

### Pattern 2: Two-Step Confirmation for All Writes

Identical to mail_mcp `--confirm` mode, but **always on** (not opt-in flag) for caldav_mcp. Calendar
writes are higher stakes — deleting an event or mass-accepting invites should never fire silently.

```typescript
const WRITE_TOOLS = new Set([
  'create_event', 'update_event', 'delete_event', 'rsvp_event',
]);

// In CallTool handler:
if (WRITE_TOOLS.has(toolName)) {
  const id = args.confirmationId as string | undefined;
  if (!id) {
    const token = this.confirmStore.create(toolName, args);
    return confirmationResponse(toolName, args, token); // human-readable summary + UUID
  }
  const pending = this.confirmStore.consume(id);
  if (!pending) return expiredConfirmationError();
  // proceed with execution
}
```

---

### Pattern 3: Conditional PUT with ETag

CalDAV servers use ETags for optimistic concurrency. Always fetch ETag before update, use
`If-Match` header on PUT. If 412 Precondition Failed, re-fetch and retry once.

```typescript
async updateEvent(calendarHref: string, event: CalendarEvent): Promise<void> {
  const current = await this.client.fetchCalendarObject({ url: event.href });
  const ical = ICalParser.serialize({ ...event });
  await this.client.updateCalendarObject({
    calendarObject: { url: event.href, data: ical, etag: current.etag }
  });
}
```

---

### Pattern 4: Account Schema with Zod + safeParse

Each account in `accounts.json` is independently validated. Invalid entries are logged and
skipped; they do not crash the server. Matches mail_mcp behavior exactly.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Global CalDAV Session Singleton

**What:** One shared tsdav DAVClient across all accounts.
**Why bad:** Sessions carry auth credentials. Multi-account usage means different users/passwords.
Shared session leads to auth bleed or connection pool exhaustion.
**Instead:** One `CalendarService` (and one `CalDAVClient`) per `accountId`, lazy-initialized
and stored in the server's `Map<string, CalendarService>`.

---

### Anti-Pattern 2: Parsing iCalendar Inline in the Protocol Layer

**What:** CalDAVClient returns parsed `CalendarEvent` objects instead of raw iCal strings.
**Why bad:** Mixes transport concerns with domain parsing. Makes CalDAVClient harder to test
(now requires calendar fixture data). Breaks the single-responsibility boundary.
**Instead:** CalDAVClient returns raw `{ href, etag, data: string }`. ICalParser is a separate
utility called by CalendarService.

---

### Anti-Pattern 3: Eager Event Loading on Server Start

**What:** Pre-fetch all calendars and events at startup to warm the cache.
**Why bad:** Startup is time-sensitive for MCP (Claude Desktop blocks on it). Large calendars
can have thousands of events. Credentials may not yet be in keychain on first run.
**Instead:** Lazy init — connect and fetch only when a tool call arrives.

---

### Anti-Pattern 4: Skipping ETag on Writes

**What:** PUT without `If-Match`, or ignoring 412 responses.
**Why bad:** Silent data loss. Two agents (or the user + agent) updating the same event
concurrently. Server-side update wins without notice to the agent.
**Instead:** Always use conditional PUT; handle 412 by re-fetching and surfacing conflict to AI.

---

### Anti-Pattern 5: Storing Credentials in accounts.json

**What:** Putting passwords or tokens in the JSON config file alongside account metadata.
**Why bad:** File is plaintext, readable by any process. Violates macOS security model.
**Instead:** `accounts.json` holds only non-secret metadata (host, port, user, authType).
Secrets live exclusively in OS keychain via `cross-keychain`.

---

### Anti-Pattern 6: Skipping Confirmation for "Low-Risk" Writes

**What:** Making RSVP (accept/decline) or small updates bypass confirmation because they
seem minor.
**Why bad:** An AI accepting a conflicting meeting or declining on behalf of the user without
confirmation is a trust violation. All calendar writes — however minor — should be
confirmed. The PROJECT.md requirement is explicit: all writes need confirmation.
**Instead:** `WRITE_TOOLS` is exhaustive. No exceptions.

---

## Component Dependencies (Build Order)

Dependencies flow strictly bottom-up. Each layer can be built and tested independently.

```
Layer 1 (no deps):
  config.ts              — account schema, file I/O, cache invalidation
  utils/ical-parser.ts   — pure iCal parsing, no I/O
  utils/event-cache.ts   — in-memory TTL cache, no I/O
  utils/confirmation-store.ts — in-memory map, no I/O
  utils/validation.ts    — Zod schemas
  security/keychain.ts   — cross-keychain wrapper
  errors.ts              — error class hierarchy

Layer 2 (depends on Layer 1):
  security/oauth2.ts     — depends on keychain.ts
  protocol/caldav.ts     — depends on keychain.ts, oauth2.ts, config.ts

Layer 3 (depends on Layer 2):
  services/calendar.ts   — depends on caldav.ts, ical-parser.ts, event-cache.ts

Layer 4 (depends on Layer 3):
  index.ts               — depends on calendar.ts, confirmation-store.ts, config.ts, audit-logger.ts

Layer 5 (depends on Layer 1 + config):
  cli/accounts.ts        — depends on config.ts, keychain.ts
  cli/install-claude.ts  — depends on config.ts
```

**Recommended phase build order:**

1. `config.ts` + `errors.ts` + `utils/` — foundation, all testable immediately
2. `security/keychain.ts` + `security/oauth2.ts` — auth foundation
3. `utils/ical-parser.ts` — parseable with .ics fixture files, no network needed
4. `protocol/caldav.ts` — network layer, integration-tested against real or mock CalDAV
5. `services/calendar.ts` — domain logic, unit-tested with mocked CalDAVClient
6. `index.ts` — MCP wiring; tested end-to-end with MCP client
7. `cli/` — account management; can be built last, not on critical path

---

## Scalability Considerations

This is a local MCP server for personal use. Scalability concerns are about reliability and
resource usage, not horizontal scaling.

| Concern | Approach |
|---------|----------|
| Multiple calendar accounts | One `CalendarService` per account in server Map; lazy init keeps unused accounts free |
| Large calendars (1000+ events) | Time-range REPORT filters at protocol level; EventCache prevents redundant fetches |
| Long-running server sessions | Graceful shutdown with in-flight drain; CalDAV is HTTP so no persistent socket to maintain |
| iCloud-specific quirks | iCloud CalDAV requires app-specific password (not iCloud password); account schema has `authType: 'basic'` for this |
| Google OAuth2 token expiry | `oauth2.ts` handles refresh transparently before each PUT/REPORT |
| ETag conflicts | 412 handling in CalDAVClient with one re-fetch retry surfaced to CalendarService |

---

## File/Directory Layout

```
src/
  index.ts                    # MCP server + tool dispatcher
  config.ts                   # Account config, fs.watch cache
  errors.ts                   # Error class hierarchy
  types/
    index.ts                  # CalendarEvent, CalendarAccount, shared types
  protocol/
    caldav.ts                 # tsdav wrapper, RFC 4791 HTTP ops
  services/
    calendar.ts               # Domain operations (list, create, conflict, rsvp)
  security/
    keychain.ts               # cross-keychain read/write
    oauth2.ts                 # Google token refresh
  utils/
    ical-parser.ts            # ical.js wrapper, parse + serialize
    event-cache.ts            # TTL cache for fetched events
    confirmation-store.ts     # UUID → pending write map
    audit-logger.ts           # Write op log to ~/.config/caldav-mcp/audit.log
    validation.ts             # Zod schemas for tool input validation
  cli/
    accounts.ts               # CLI: add/remove/list accounts
    install-claude.ts         # CLI: write claude_desktop_config.json
```

---

## Sources

- mail_mcp source (`~/dev/mail_mcp/src/`) — direct pattern reference (HIGH confidence)
  - `index.ts`: confirmation gate, service map, WRITE_TOOLS pattern
  - `services/mail.ts`: service layer structure
  - `protocol/imap.ts`: protocol client pattern
  - `utils/confirmation-store.ts`: confirmation store implementation
  - `utils/message-cache.ts`: TTL cache implementation
  - `security/keychain.ts`: keychain wrapper pattern
  - `config.ts`: account config with fs.watch invalidation
- RFC 4791 (CalDAV): PROPFIND/REPORT/PUT/DELETE verb semantics (HIGH confidence — specification)
- tsdav library: TypeScript CalDAV/CardDAV client for Node.js (MEDIUM confidence — known library, unverified current version from training)
- ical.js: iCalendar parsing library, browser + Node compatible (MEDIUM confidence — known library)
- PROJECT.md requirements: explicit write-confirmation requirement, multi-account, keychain (HIGH confidence — authoritative)
