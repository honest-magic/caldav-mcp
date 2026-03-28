# Phase 1: Foundation + Read - Research

**Researched:** 2026-03-28
**Domain:** CalDAV client, iCalendar parsing, MCP server, credential management, timezone handling
**Confidence:** HIGH (core stack verified against npm registry and official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Account Configuration & Auth**
- Config file at `~/.config/caldav-mcp/accounts.json` — matches mail_mcp pattern
- Google OAuth2 included in Phase 1 — credential schema must accommodate tokens (access + refresh + expiry) from day one per research findings
- Account setup via JSON config file + `register_oauth2_account` tool — consistent with mail_mcp
- Full RFC 6764 auto-discovery via tsdav with manual URL fallback for non-compliant servers

**MCP Tool Design**
- Tool naming: `list_calendars`, `list_events`, `read_event`, `parse_ics` — verb_noun pattern matching mail_mcp
- Optional `account` parameter on each tool, defaults to first configured account — matches mail_mcp pattern
- Date range as ISO 8601 strings with optional timezone
- Structured JSON output with key fields extracted + raw iCal available on request

**Architecture & Dependencies**
- Mirror mail_mcp structure: `src/{index,config,types,errors}.ts`, `src/protocol/caldav.ts`, `src/services/calendar.ts`, `src/security/`, `src/utils/`
- Separate `src/utils/ical-parser.ts` wrapping ical.js — independently testable with .ics fixtures
- `luxon` for IANA timezone resolution (research recommendation — preserves TZID, handles DST correctly)
- Custom error hierarchy: CalDAVError, AuthError, NetworkError — matches mail_mcp pattern

### Claude's Discretion
- Internal caching strategy for calendar/event data
- Specific tsdav configuration options
- Error message formatting and detail level
- Test fixture selection and coverage scope

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-01 | Server auto-discovers CalDAV endpoint via RFC 6764 (.well-known/caldav) | tsdav `createDAVClient` with `defaultAccountType: 'caldav'` handles RFC 6764 auto-discovery; manual URL fallback is a config field |
| CONN-02 | User can authenticate with Basic Auth (self-hosted, iCloud app-specific passwords) | tsdav `authMethod: 'Basic'` with `credentials: { username, password }` |
| CONN-03 | User can authenticate with OAuth2 (Google Calendar) | tsdav `authMethod: 'Oauth'` with `credentials: { tokenUrl, clientId, clientSecret, refreshToken }`; Google CalDAV base URL `https://apidata.googleusercontent.com/caldav/v2/` |
| CONN-04 | Credentials stored securely in OS keychain via cross-keychain | cross-keychain 1.1.0 already in skeleton; JSON-encode OAuth token blob; identical pattern to mail_mcp `src/security/keychain.ts` |
| CONN-05 | User can configure and use multiple CalDAV accounts simultaneously | `accounts.json` array + per-account CalDAVClient map (mirroring mail_mcp `services` Map) |
| READ-01 | User can list all calendars across configured accounts | tsdav `client.fetchCalendars()` returns `DAVCalendar[]`; iterate accounts |
| READ-02 | User can list events within a date range | tsdav `fetchCalendarObjects({ calendar, timeRange: { start, end } })` returns `DAVObject[]` with `.data` containing raw ICS |
| READ-03 | User can read full event details (time, location, attendees, description, recurrence) | ical.js `ICAL.Event` exposes summary, description, location, startDate, endDate, attendees; RRULE via `getFirstPropertyValue('rrule')` |
| READ-04 | User can parse raw .ics data passed as input (from mail_mcp attachments) | ical.js standalone parse: `new ICAL.Component(ICAL.parse(icsString))` — no network required |
| CORE-02 | Timezone handling preserves TZID (never normalizes to UTC) | ical.js `ICAL.Time` preserves TZID; `timezone.tzid` gives IANA name; luxon `DateTime.fromISO(localStr, { zone: tzid })` for display; never call `.toJSDate()` for output |
| CORE-04 | Server runs on macOS, Windows, and Linux | Node.js 18+ target; cross-keychain is cross-platform; `node:path`/`node:os` for config path; no macOS-only APIs |
</phase_requirements>

---

## Summary

This phase builds a TypeScript MCP server that connects to CalDAV providers (iCloud, Google, self-hosted) and exposes four read-only tools. The stack is fully determined: tsdav 2.1.8 as the CalDAV protocol client, ical.js 2.2.1 for iCalendar parsing, luxon 3.7.2 for timezone-aware display, and cross-keychain 1.1.0 for credential storage. All are verified against the npm registry as of 2026-03-28.

The architecture mirrors mail_mcp exactly. The MCP layer uses the `Server` class (not `McpServer`) with `ListToolsRequestSchema` / `CallToolRequestSchema` handlers — this matches what mail_mcp uses with SDK 1.27.1 and avoids any migration risk. The existing mail_mcp codebase at `~/dev/mail_mcp` serves as the authoritative reference for config file structure, keychain wrapper, OAuth2 token refresh, and error hierarchy patterns.

The most technically nuanced part of this phase is timezone handling. CalDAV returns raw `.ics` data; DTSTART may carry a TZID parameter (e.g., `DTSTART;TZID=America/New_York:20240315T090000`). The requirement is to surface that local time and timezone identifier to the AI agent, never silently collapsing it to UTC. The ical.js `ICAL.Time` object preserves the original TZID; luxon is used only for display formatting, not normalization.

**Primary recommendation:** Implement in the order: config + keychain layer → tsdav CalDAV client wrapper → ical.js parser utility → CalendarService → MCP tool handlers. This matches mail_mcp's construction order and keeps each layer independently testable.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsdav | 2.1.8 | CalDAV/WebDAV client — discovery, auth, REPORT/GET | Only TypeScript-native CalDAV client with iCloud + Google OAuth2 support; used in production at Cal.com |
| ical.js | 2.2.1 | iCalendar (RFC 5545) parser and generator | Mozilla-maintained; handles VTIMEZONE, RRULE, EXDATE, ATTENDEE correctly; ESM + CJS exports |
| luxon | 3.7.2 | IANA timezone-aware date formatting | Immutable, uses Intl API natively, understands IANA zone identifiers directly from TZID |
| cross-keychain | 1.1.0 | OS keychain access (macOS Keychain, Windows Credential Store, libsecret) | Already in skeleton; identical to mail_mcp pattern |
| @modelcontextprotocol/sdk | 1.27.1 (skeleton) | MCP Server + StdioServerTransport | Already in skeleton |
| zod | 4.3.6 (skeleton) | Schema validation for config + tool inputs | Already in skeleton |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/luxon | 3.7.1 | TypeScript types for luxon | Always (devDependency) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdav | node-caldav-adapter | tsdav is client-side and more maintained; node-caldav-adapter is a server implementation |
| ical.js | node-ical | ical.js has typed API and handles RRULE expansion; node-ical has simpler API but weaker recurrence support |
| luxon | date-fns-tz | luxon is immutable and IANA-native; date-fns-tz requires separate tz data package |

**Installation (packages to add to skeleton):**
```bash
npm install tsdav ical.js luxon
npm install --save-dev @types/luxon
```

**Version verification (confirmed 2026-03-28):**
```
tsdav@2.1.8     (npm view tsdav version)
ical.js@2.2.1   (npm view ical.js version)
luxon@3.7.2     (npm view luxon version)
@types/luxon@3.7.1 (npm view @types/luxon version)
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── index.ts              # CalDAVMCPServer class + main() entry point
├── config.ts             # ACCOUNTS_PATH, calDAVAccountSchema, getAccounts(), saveAccounts()
├── types.ts              # CalDAVAccount, CalendarSummary, EventSummary, ParsedEvent types
├── errors.ts             # CalDAVMCPError, AuthError, NetworkError, ValidationError
├── protocol/
│   └── caldav.ts         # CalDAVClient class wrapping tsdav createDAVClient
├── services/
│   └── calendar.ts       # CalendarService — fetchCalendars, fetchEvents, fetchEvent
├── security/
│   ├── keychain.ts       # saveCredentials, loadCredentials, removeCredentials (cross-keychain)
│   └── oauth2.ts         # getValidAccessToken — refresh flow for Google OAuth2
└── utils/
    └── ical-parser.ts    # parseICS(raw: string): ParsedEvent — wraps ical.js
```

### Pattern 1: Config File Schema (accounts.json)

The credential schema must support both Basic Auth and OAuth2 from day one. Store the secret JSON blob in the keychain keyed by `account.id`; the accounts.json never contains secrets.

```typescript
// src/config.ts
export const calDAVAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  serverUrl: z.string().url(),
  authType: z.enum(['basic', 'oauth2']),
  username: z.string().min(1),
  // No password/token field — stored in keychain only
});

export type CalDAVAccount = z.infer<typeof calDAVAccountSchema>;
```

Keychain value is JSON-encoded, discriminated by `authType`:
- Basic: `{ password: string }`
- OAuth2: `{ clientId, clientSecret, refreshToken, accessToken?, expiryDate?, tokenUrl }`

### Pattern 2: CalDAV Client Construction

```typescript
// src/protocol/caldav.ts
import { createDAVClient, DAVClient } from 'tsdav';

// Basic Auth (iCloud, self-hosted)
const client = await createDAVClient({
  serverUrl: 'https://caldav.icloud.com',
  credentials: { username: 'user@icloud.com', password: 'app-specific-password' },
  authMethod: 'Basic',
  defaultAccountType: 'caldav',
});

// OAuth2 (Google Calendar)
const client = await createDAVClient({
  serverUrl: 'https://apidata.googleusercontent.com/caldav/v2/',
  credentials: {
    tokenUrl: 'https://accounts.google.com/o/oauth2/token',
    username: 'user@gmail.com',
    clientId: 'CLIENT_ID',
    clientSecret: 'CLIENT_SECRET',
    refreshToken: 'REFRESH_TOKEN',
  },
  authMethod: 'Oauth',
  defaultAccountType: 'caldav',
});
```

tsdav handles RFC 6764 `.well-known/caldav` redirect automatically when `defaultAccountType: 'caldav'` is set. For non-compliant servers, use explicit `serverUrl` from the config.

### Pattern 3: Fetching Events with Date Range

```typescript
// src/services/calendar.ts
const objects = await client.fetchCalendarObjects({
  calendar: davCalendar,
  timeRange: {
    start: '2024-03-01T00:00:00.000Z',  // ISO 8601 required by tsdav
    end: '2024-03-31T23:59:59.000Z',
  },
});
// objects[n].data contains raw ICS string
// objects[n].etag is the current ETag (needed for Phase 2 writes)
// objects[n].url is the object URL
```

**Important:** tsdav's `timeRange` values must be ISO 8601. Convert the user-supplied date range using luxon before passing.

### Pattern 4: iCalendar Parsing

```typescript
// src/utils/ical-parser.ts
import ICAL from 'ical.js';

export function parseICS(raw: string): ParsedEvent {
  const jcal = ICAL.parse(raw);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent('vevent');
  const event = new ICAL.Event(vevent);

  // Timezone-preserving approach — DO NOT use event.startDate.toJSDate()
  const dtstart = vevent.getFirstPropertyValue('dtstart') as ICAL.Time;
  const tzid = dtstart.timezone?.tzid ?? 'UTC';          // IANA name
  const localStr = dtstart.toString();                    // "2024-03-15T09:00:00"

  // Attendees
  const attendeeProps = vevent.getAllProperties('attendee');
  const attendees = attendeeProps.map(p => ({
    email: (p.getFirstValue() as string).replace(/^mailto:/i, ''),
    cn: p.getParameter('cn') ?? null,
    role: p.getParameter('role') ?? null,
    partstat: p.getParameter('partstat') ?? null,
  }));

  return {
    uid: event.uid,
    summary: event.summary,
    description: event.description ?? null,
    location: event.location ?? null,
    start: { localTime: localStr, tzid },
    end: { localTime: vevent.getFirstPropertyValue('dtend')?.toString() ?? null, tzid },
    rrule: vevent.getFirstPropertyValue('rrule')?.toString() ?? null,
    attendees,
    raw: raw,
  };
}
```

### Pattern 5: MCP Server Tool Registration (mail_mcp style)

Use the `Server` class with manual `ListToolsRequestSchema` / `CallToolRequestSchema` handlers — this is what mail_mcp uses with SDK 1.27.1 and what the architecture decision locks in.

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode }
  from '@modelcontextprotocol/sdk/types.js';

export class CalDAVMCPServer {
  private server: Server;
  private services: Map<string, CalendarService> = new Map();

  constructor() {
    this.server = new Server(
      { name: 'caldav-mcp-server', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // dispatch by request.params.name
    });
  }
}
```

**Critical:** Never use `console.log()` in MCP servers — it writes to stdout and corrupts JSON-RPC. Use `console.error()` for all logging (goes to stderr).

### Pattern 6: OAuth2 Token Refresh

Mirror mail_mcp `src/security/oauth2.ts` exactly. Store the full token blob JSON-encoded in keychain. On each CalDAV call, check expiry with a 60-second buffer; refresh via `https://accounts.google.com/o/oauth2/token` if needed. Write updated tokens back to keychain after refresh.

Google CalDAV OAuth2 scope: `https://www.googleapis.com/auth/calendar`

### Anti-Patterns to Avoid

- **Calling `.toJSDate()` on ICAL.Time for output:** Converts to local machine time, destroying the original TZID. Use `.toString()` + `timezone.tzid` instead.
- **Storing credentials in accounts.json:** Only non-secret metadata goes in the config file. All passwords and tokens live in the OS keychain.
- **Using `console.log()` anywhere in the MCP server process:** Pollutes stdout, breaks JSON-RPC framing.
- **Hardcoding Google's CalDAV URL as a principal home URL:** The correct base URL is `https://apidata.googleusercontent.com/caldav/v2/` (not `googleapis.com/calendar/v3`).
- **Assuming tsdav's time range filter is purely server-side:** Some servers may not respect `REPORT` time-range filters; defensive client-side filtering is prudent.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CalDAV protocol | Custom HTTP + XML | tsdav | REPORT, PROPFIND, MKCALENDAR, multiGet, sync-collection — ~2000 lines of XML/HTTP |
| iCalendar parsing | Custom RFC 5545 parser | ical.js | RRULE expansion, VTIMEZONE handling, EXDATE, RDATE, multi-value properties |
| OS keychain access | Spawning `security` CLI | cross-keychain | macOS Keychain API, Windows Credential Store, libsecret unified |
| RFC 6764 discovery | Manual .well-known + SRV | tsdav (built-in) | DNS SRV lookup + HTTP redirect following already implemented |
| OAuth2 token refresh | Custom refresh logic | oauth2.ts pattern from mail_mcp | Expiry buffering, token persistence, refresh token rotation already solved |
| Timezone IANA lookup | Custom offset tables | luxon + Intl API | DST transitions, historical offsets, IANA database embedded in Node.js runtime |

**Key insight:** CalDAV's protocol complexity (REPORT queries, ETags, WebDAV property handling, multi-status responses) is the hardest part of this domain. tsdav encapsulates all of it. The remaining complexity — iCalendar semantics — is encapsulated by ical.js. The implementation work is in the glue layer (CalDAVClient, CalendarService, ical-parser).

---

## Common Pitfalls

### Pitfall 1: Google CalDAV OAuth2 — Wrong Server URL

**What goes wrong:** Using `https://www.googleapis.com/calendar/v3` (the REST API base) as the CalDAV server URL. CalDAV requests return 404 or 405.

**Why it happens:** Google has both a REST Calendar API and a CalDAV API at different base URLs.

**How to avoid:** Always use `https://apidata.googleusercontent.com/caldav/v2/` as the `serverUrl` in the tsdav client for Google accounts.

**Warning signs:** 404/405 on PROPFIND requests against Google.

### Pitfall 2: iCloud Requires App-Specific Passwords

**What goes wrong:** User's Apple ID password doesn't work; connection rejected with 401.

**Why it happens:** iCloud enforces two-factor authentication. Normal Apple ID password does not work for third-party CalDAV clients.

**How to avoid:** Document clearly in `register_oauth2_account` tool description that iCloud requires an app-specific password generated at appleid.apple.com, not the main Apple ID password.

**Warning signs:** 401 Unauthorized with `www-authenticate: Basic realm="..."` from caldav.icloud.com.

### Pitfall 3: DTSTART UTC Collapsing

**What goes wrong:** Event shows wrong time in tool output; TZID is lost.

**Why it happens:** Calling `ical.Event.startDate.toJSDate()` converts to UTC-based JavaScript Date, which loses the original timezone name.

**How to avoid:** Read `vevent.getFirstPropertyValue('dtstart')` as an `ICAL.Time` object; use `.toString()` for the local datetime string and `.timezone.tzid` for the IANA name.

**Warning signs:** All events appear in UTC (times ending in `Z`), no TZID in output.

### Pitfall 4: tsdav's timeRange Requires UTC ISO 8601

**What goes wrong:** Date range filter silently ignored or throws an error.

**Why it happens:** tsdav validates that timeRange.start/end are ISO 8601 format. If user passes "2024-03-01" (date-only), tsdav rejects it.

**How to avoid:** Convert user-supplied date strings to full ISO 8601 UTC timestamps before passing to `fetchCalendarObjects`. Use luxon: `DateTime.fromISO(userDate, { zone: userTz }).toUTC().toISO()`.

**Warning signs:** Empty results or "Invalid time range" errors; or unexpectedly large result sets when filter silently fails.

### Pitfall 5: `console.log` Corrupts MCP stdout

**What goes wrong:** MCP client (Claude Desktop) receives malformed JSON; server appears to crash or tools fail.

**Why it happens:** MCP uses stdout for JSON-RPC framing. Any non-JSON bytes on stdout break the protocol.

**How to avoid:** Use `console.error()` for all debug/info logging. The `Server.onerror` handler also uses `console.error`.

**Warning signs:** MCP client reports parse errors; tools intermittently fail.

### Pitfall 6: Google CalDAV — Object Filename != UID

**What goes wrong:** Fetching by URL fails; recreating a deleted event with same UID fails silently.

**Why it happens:** Google assigns its own filenames to calendar objects (not based on UID). Also, once a UID is deleted, it cannot be recreated with the same UID — returns conflict.

**How to avoid:** Always use the `url` field from `DAVObject` as the canonical reference, not a constructed URL from the UID. For Phase 1 (read-only) this is informational only; becomes important in Phase 2.

---

## Code Examples

### Creating a CalDAV client for iCloud (Basic Auth)

```typescript
// Source: https://tsdav.vercel.app/docs/intro
import { createDAVClient } from 'tsdav';

const client = await createDAVClient({
  serverUrl: 'https://caldav.icloud.com',
  credentials: {
    username: 'user@icloud.com',
    password: 'xxxx-xxxx-xxxx-xxxx', // app-specific password
  },
  authMethod: 'Basic',
  defaultAccountType: 'caldav',
});
```

### Creating a CalDAV client for Google (OAuth2)

```typescript
// Source: https://tsdav.vercel.app/docs/intro
import { createDAVClient } from 'tsdav';

const client = await createDAVClient({
  serverUrl: 'https://apidata.googleusercontent.com/caldav/v2/',
  credentials: {
    tokenUrl: 'https://accounts.google.com/o/oauth2/token',
    username: 'user@gmail.com',
    clientId: 'CLIENT_ID',
    clientSecret: 'CLIENT_SECRET',
    refreshToken: 'REFRESH_TOKEN',
  },
  authMethod: 'Oauth',
  defaultAccountType: 'caldav',
});
```

### Listing all calendars

```typescript
// Source: https://tsdav.vercel.app/docs/caldav/fetchCalendarObjects
const calendars = await client.fetchCalendars();
// calendars[n].displayName, .url, .ctag, .syncToken
```

### Fetching events in a date range

```typescript
// Source: https://tsdav.vercel.app/docs/caldav/fetchCalendarObjects
const objects = await client.fetchCalendarObjects({
  calendar: calendars[0],
  timeRange: {
    start: '2024-03-01T00:00:00.000Z',
    end: '2024-03-31T23:59:59.999Z',
  },
});
// objects[n].data = raw ICS string
// objects[n].etag = '"abc123"'
// objects[n].url  = 'https://caldav.icloud.com/.../xyz.ics'
```

### Parsing iCalendar — timezone-preserving

```typescript
// Source: https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar
import ICAL from 'ical.js';

const jcal = ICAL.parse(rawICS);
const comp = new ICAL.Component(jcal);
const vevent = comp.getFirstSubcomponent('vevent');
const event = new ICAL.Event(vevent);

const dtstart = vevent.getFirstPropertyValue('dtstart') as ICAL.Time;
const tzid = dtstart.timezone?.tzid ?? 'UTC';  // e.g. "America/New_York"
const localStr = dtstart.toString();            // e.g. "2024-03-15T09:00:00"

// Display via luxon (preserves IANA zone)
import { DateTime } from 'luxon';
const display = DateTime.fromISO(localStr, { zone: tzid })
  .toFormat("yyyy-MM-dd HH:mm ZZZZ");  // "2024-03-15 09:00 EDT"
```

### Iterating recurrences

```typescript
// Source: https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar
import ICAL from 'ical.js';

const expand = new ICAL.RecurExpansion({
  component: vevent,
  dtstart: vevent.getFirstPropertyValue('dtstart'),
});

const occurrences: ICAL.Time[] = [];
let next: ICAL.Time | null;
const limit = new ICAL.Time();
limit.fromJSDate(rangeEnd, false);

while ((next = expand.next()) && next.compare(limit) <= 0) {
  occurrences.push(next.clone());
}
```

### Error hierarchy (mirroring mail_mcp)

```typescript
// src/errors.ts
export enum CalDAVErrorCode {
  AuthError = 'AuthError',
  NetworkError = 'NetworkError',
  ValidationError = 'ValidationError',
  ParseError = 'ParseError',
}

export class CalDAVMCPError extends Error {
  constructor(public readonly code: CalDAVErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = code;
  }
}

export class AuthError extends CalDAVMCPError {
  constructor(message: string, options?: ErrorOptions) {
    super(CalDAVErrorCode.AuthError, message, options);
  }
}

export class NetworkError extends CalDAVMCPError {
  constructor(message: string, options?: ErrorOptions) {
    super(CalDAVErrorCode.NetworkError, message, options);
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Google CalDAV with Basic Auth (app password) | Google CalDAV requires OAuth2 | Summer 2024 | Basic Auth no longer works for new Google CalDAV connections; OAuth2 mandatory |
| Legacy `Server` + manual schemas | `McpServer.registerTool()` | MCP SDK ~1.5+ | mail_mcp uses legacy Server; new API is cleaner but migration not warranted here |
| Separate IANA timezone database | `luxon` uses built-in Intl API | Node.js 18+ | No external timezone data file needed |

**Deprecated/outdated:**
- Google app-specific passwords for CalDAV: No longer accepted as of mid-2024. OAuth2 is the only supported method.
- `tsdav` v1.x: v2.x has breaking changes in client construction API; always use v2.

---

## Open Questions

1. **ical.js IANA timezone database gap**
   - What we know: ical.js docs state it does not ship the full IANA timezone database; VTIMEZONE components embedded in the `.ics` file are used for resolution
   - What's unclear: If a server sends an event with `TZID=America/New_York` but no VTIMEZONE block, ical.js may fail to resolve the timezone
   - Recommendation: In `ical-parser.ts`, fall back to luxon's Intl-backed zone lookup if `ICAL.Time.timezone` is null; this is a common gap for events fetched from servers that assume the client knows the IANA database

2. **Google OAuth2 initial token acquisition**
   - What we know: tsdav's `authMethod: 'Oauth'` needs a refresh_token already in hand; tsdav does not implement the authorization code flow
   - What's unclear: How should the user obtain the initial refresh token for the `register_oauth2_account` tool?
   - Recommendation: For Phase 1, implement the `register_oauth2_account` tool to accept the refresh token directly (user must complete OAuth2 flow externally or via a helper script). Document this clearly. A full PKCE/browser flow is out of scope for Phase 1.

3. **tsdav behavior on servers that don't support REPORT time-range**
   - What we know: `fetchCalendarObjects` with `timeRange` sends a CalDAV REPORT request; not all servers implement it
   - What's unclear: Whether tsdav silently returns all objects or throws when time-range isn't supported
   - Recommendation: Implement client-side date-range filtering in `CalendarService.fetchEvents()` as a safety net after tsdav returns results

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 18 | Runtime | ✓ | v20.19.0 | — |
| npm | Package installation | ✓ | (with Node) | — |
| TypeScript (devDep) | Build | in skeleton | ^5.9.3 | — |
| vitest (devDep) | Tests | in skeleton | ^4.1.0 | — |
| tsdav | CalDAV protocol | not yet installed | 2.1.8 (latest) | — |
| ical.js | iCalendar parsing | not yet installed | 2.2.1 (latest) | — |
| luxon | Timezone display | not yet installed | 3.7.2 (latest) | — |
| cross-keychain | Credential storage | in skeleton | ^1.1.0 | — |
| @modelcontextprotocol/sdk | MCP server | in skeleton | ^1.27.1 | — |

**Missing dependencies with no fallback:**
- tsdav, ical.js, luxon: must be installed before implementation begins (`npm install tsdav ical.js luxon && npm install --save-dev @types/luxon`)

**Missing dependencies with fallback:**
- None that affect Phase 1 scope.

---

## Project Constraints (from CLAUDE.md)

- **Protocol:** Must use CalDAV (satisfied by tsdav)
- **Environment:** Must run locally on macOS (Darwin), but CORE-04 extends this to Windows + Linux via cross-platform libraries
- **Interface:** Must adhere to MCP specification (satisfied by `@modelcontextprotocol/sdk`)
- **GSD Workflow:** All file edits must go through GSD commands (`/gsd:execute-phase`); no direct repo edits

---

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`) — verified versions for tsdav 2.1.8, ical.js 2.2.1, luxon 3.7.2, @types/luxon 3.7.1 (2026-03-28)
- https://tsdav.vercel.app/docs/intro — createDAVClient API, auth methods
- https://tsdav.vercel.app/docs/caldav/fetchCalendarObjects — timeRange parameter, DAVObject structure
- https://tsdav.vercel.app/docs/types/DAVObject — DAVObject `{ url, data, etag }` structure
- https://github.com/kewisch/ical.js/wiki/Common-Use-Cases — ICAL.Event, VEVENT parsing
- https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar — Component model, RecurExpansion
- https://developers.google.com/workspace/calendar/caldav/v2/guide — Google CalDAV base URL, unsupported methods
- mail_mcp source at `~/dev/mail_mcp` — config.ts, errors.ts, security/keychain.ts, security/oauth2.ts patterns (read directly)

### Secondary (MEDIUM confidence)
- https://www.onecal.io/blog/how-to-integrate-icloud-calendar-api-into-your-app — iCloud app-specific password requirement (corroborated by tsdav docs)
- https://support.google.com/calendar/thread/302141783/caldav-transition-to-oauth2-0 — Google's deprecation of Basic Auth for CalDAV (corroborated by developer guide)
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md — MCP server patterns

### Tertiary (LOW confidence)
- WebSearch findings on ical.js IANA timezone gap — requires validation via code test with a TZID-only event (no VTIMEZONE)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all package versions verified against npm registry 2026-03-28
- Architecture: HIGH — mirrors mail_mcp directly; patterns read from live source code
- tsdav API: HIGH — verified against official docs; Google/iCloud URLs confirmed
- ical.js API: MEDIUM — wiki examples confirmed; IANA timezone gap is LOW/needs testing
- Pitfalls: HIGH for Google OAuth2 + iCloud + console.log; MEDIUM for timezone behavior details

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable libraries; Google OAuth2 policy could change faster)
