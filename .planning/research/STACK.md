# Technology Stack

**Project:** CalDAV MCP Server
**Researched:** 2026-03-28
**Confidence note:** External web tools (WebSearch, WebFetch, npm registry) were unavailable during this research session. Stack versions for already-pinned dependencies are sourced directly from the project skeleton's `package.json` (HIGH confidence). CalDAV/iCal library versions are from training data (knowledge cutoff August 2025) and should be verified before install.

---

## Recommended Stack

### Already Locked (from project skeleton `package.json`)

These are set and should not change — they match the companion `mail_mcp` project exactly.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@modelcontextprotocol/sdk` | `^1.27.1` | MCP server implementation | Official Anthropic SDK; already in skeleton and mail_mcp; only correct choice for MCP compliance |
| `cross-keychain` | `^1.1.0` | OS keychain credential storage | Consistent with mail_mcp; macOS Keychain via security CLI; no plaintext secrets |
| `zod` | `^4.3.6` | Schema validation / tool input parsing | Standard in MCP tooling; already used in mail_mcp; validates tool call arguments at runtime |
| `typescript` | `^5.9.3` | Language | Consistent with mail_mcp; modern TS with ESM support |
| `vitest` | `^4.1.0` | Unit + integration testing | Consistent with mail_mcp; ESM-native, fast, same test patterns |
| `@types/node` | `^25.5.0` | Node.js type definitions | Matches Node >=18 engine constraint |

**Node.js engine:** `>=18.0.0` (matches mail_mcp)
**Module system:** `"type": "module"` (ESM throughout)

---

### CalDAV Client Library

**Recommendation: `tsdav`**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tsdav` | `^2.0.0` (verify on npm) | CalDAV/CardDAV HTTP protocol client | Only actively-maintained TypeScript-native CalDAV library; handles PROPFIND, REPORT, PUT, DELETE; supports Basic Auth and OAuth2; tested against iCloud, Google, Fastmail, Radicale |

**Confidence: MEDIUM** — tsdav is the clear ecosystem choice based on training knowledge (it was the dominant option as of mid-2025), but the exact latest version must be confirmed via `npm info tsdav` before pinning.

**Why tsdav over alternatives:**
- Native TypeScript (not a JS wrapper) — no `@types/` package needed
- Explicit iCloud support with app-specific password handling
- Explicit Google Calendar OAuth2 support (fetches token, handles `DAV:` namespace)
- Handles the CalDAV discovery dance (`.well-known/caldav`, `PROPFIND` principal lookup) automatically
- `fetchCalendarObjects` returns parsed objects with URLs suitable for PUT/DELETE
- Active maintenance as of 2025

**Do NOT use:**
- `node-caldav` — abandoned, last published ~2018, no TypeScript, no OAuth
- `dav` — unmaintained, outdated HTTP client internals, no types
- Writing raw `PROPFIND`/`REPORT` XML by hand — fragile, provider-specific quirks multiply quickly; use tsdav instead

---

### iCalendar Parsing Library

**Recommendation: `ical.js`**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ical.js` | `^2.0.0` (verify on npm) | Parse and generate iCalendar (RFC 5545) data | Mozilla-backed, handles VEVENT, VTIMEZONE, RRULE, VALARM; mature and spec-compliant; works in Node.js ESM |

**Confidence: MEDIUM** — ical.js is the reference implementation in the Node.js ecosystem as of training cutoff. Exact latest version needs npm verification.

**Why ical.js over alternatives:**
- Mozilla-developed; treats RFC 5545 compliance as a first-class concern
- Handles recurrence rules (RRULE) correctly — this matters for calendar conflict detection
- Handles VTIMEZONE components, which are required for cross-timezone attendee events
- Can both parse and generate iCal strings (needed for RSVP response generation)
- Used by Thunderbird/Lightning internally, so edge cases are battle-tested

**Secondary option: `node-ical`** — simpler API, fine for read-only parsing of straightforward events, but weaker RRULE/VTIMEZONE support. Use ical.js when generating iCal output (RSVP) or handling recurring events.

**Do NOT use:**
- `icalendar` — Python library, wrong ecosystem
- `rrule` standalone — handles recurrence expansion but not full iCal parsing; use ical.js which includes RRULE support
- Rolling a custom iCal parser — RFC 5545 has enough edge cases (folded lines, TZID parameters, DURATION vs DTEND) that hand-rolling is a trap

---

### Authentication Helpers

CalDAV authentication varies by provider. No single auth library covers all cases; handle per-provider:

| Provider | Auth Method | Implementation |
|----------|-------------|----------------|
| iCloud | Basic Auth + App-Specific Password | `tsdav` handles natively; credentials stored in keychain via `cross-keychain` |
| Google Calendar | OAuth2 (Bearer token) | `googleapis` package for token acquisition; `tsdav` accepts the token; store refresh token in keychain |
| Fastmail | Basic Auth | `tsdav` handles natively |
| Radicale / Baikal / Nextcloud | Basic Auth or no auth | `tsdav` handles natively |

**For Google OAuth2:** Use `googleapis ^144.x` (or latest — verify) only for the token exchange flow. tsdav handles the actual CalDAV requests once you have a bearer token.

**Confidence: MEDIUM** — googleapis version needs verification. The auth pattern (OAuth2 for Google, Basic for everything else) is well-established and unlikely to have changed.

---

### Infrastructure / Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | `>=18.0.0` | Runtime | Locked by project; matches mail_mcp; fetch API built-in (no node-fetch needed) |
| ESM (`"type": "module"`) | — | Module system | Consistent with mail_mcp; required by `@modelcontextprotocol/sdk` |

**No HTTP client library needed** — Node.js 18+ has `fetch` built in; `tsdav` uses it internally.

---

## Complete `dependencies` Block

```json
{
  "@modelcontextprotocol/sdk": "^1.27.1",
  "cross-keychain": "^1.1.0",
  "ical.js": "^2.0.0",
  "tsdav": "^2.0.0",
  "zod": "^4.3.6"
}
```

Add `googleapis` only if Google Calendar support is in scope for the current phase:

```json
"googleapis": "^144.0.0"
```

---

## `devDependencies` Block

```json
{
  "@types/node": "^25.5.0",
  "typescript": "^5.9.3",
  "vitest": "^4.1.0"
}
```

No `@types/` package needed for tsdav (native TypeScript) or ical.js (types bundled).

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CalDAV client | `tsdav` | `node-caldav` | Abandoned since 2018, no TypeScript, no OAuth2 |
| CalDAV client | `tsdav` | `dav` | Unmaintained, no types, stale HTTP internals |
| CalDAV client | `tsdav` | Raw XML + fetch | Fragile; every provider has quirks; tsdav already solves them |
| iCal parsing | `ical.js` | `node-ical` | Weaker RRULE/VTIMEZONE; no iCal generation (needed for RSVP) |
| iCal parsing | `ical.js` | Custom parser | RFC 5545 edge cases are a trap |
| Validation | `zod` (already locked) | `ajv` | Already in skeleton and mail_mcp; no reason to diverge |
| Testing | `vitest` (already locked) | `jest` | Already in skeleton; ESM-native; faster |

---

## Installation

```bash
# Core runtime additions (skeleton already has MCP SDK, cross-keychain, zod)
npm install tsdav ical.js

# Optional: Google Calendar OAuth2 only
npm install googleapis

# Verify latest versions before installing
npm info tsdav version
npm info ical.js version
npm info googleapis version
```

---

## Version Verification Required

The following versions are from training data (knowledge cutoff August 2025) and **must be verified** before starting Phase 1 implementation:

| Package | Version Used Here | Verify With |
|---------|------------------|-------------|
| `tsdav` | `^2.0.0` | `npm info tsdav` |
| `ical.js` | `^2.0.0` | `npm info ical.js` |
| `googleapis` | `^144.0.0` | `npm info googleapis` |

Already-pinned packages (`@modelcontextprotocol/sdk`, `cross-keychain`, `zod`, `typescript`, `vitest`, `@types/node`) are sourced from the project skeleton and do not need re-verification.

---

## Sources

- Project skeleton `package.json`: `/Users/mis/dev/caldav_mcp/package.json` (HIGH confidence — authoritative)
- Companion `mail_mcp/package.json`: `/Users/mis/dev/mail_mcp/package.json` (HIGH confidence — authoritative)
- Project context: `/Users/mis/dev/caldav_mcp/.planning/PROJECT.md` (HIGH confidence — authoritative)
- tsdav library knowledge: Training data, knowledge cutoff August 2025 (MEDIUM confidence — version unverified)
- ical.js library knowledge: Training data, knowledge cutoff August 2025 (MEDIUM confidence — version unverified)
- CalDAV protocol (RFC 4791): Well-established standard, no version concern (HIGH confidence)
