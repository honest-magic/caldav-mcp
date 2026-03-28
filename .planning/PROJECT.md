# CalDAV MCP Server

## What This Is

A local MCP server that provides calendar tools to AI agents via CalDAV. It lets an AI assistant read calendars, create/update/delete events, parse calendar invites from email, check for scheduling conflicts, and suggest alternatives — then act on the user's confirmation. Designed to work alongside mail_mcp as the calendar half of an AI-powered email + calendar workflow.

## Core Value

AI agents can act as a personal calendar assistant: find invites in email, check for conflicts, and manage calendar events — only acting after explicit user confirmation.

## Requirements

### Validated

- ✓ Connect to any CalDAV provider (iCloud, Google, self-hosted like Radicale/Baikal) — Phase 1
- ✓ List available calendars across configured accounts — Phase 1
- ✓ List events with date range filtering — Phase 1
- ✓ Read full event details (time, location, attendees, description, recurrence) — Phase 1
- ✓ Parse .ics data (from email attachments via mail_mcp) — Phase 1
- ✓ Store credentials securely in OS keychain — Phase 1
- ✓ Support multiple calendar accounts simultaneously — Phase 1

### Active

- [ ] Create new calendar events
- [ ] Update existing events (time, details, attendees)
- [ ] Delete/cancel events
- [ ] Detect scheduling conflicts against existing events
- [ ] Suggest available time slots when conflicts exist
- [ ] Confirm before any write operation (create, update, delete, RSVP)
- [ ] RSVP to calendar invites (accept, decline, tentative)

### Out of Scope

- CalDAV server implementation — this is a client only
- Email sending — mail_mcp handles that (RSVP replies go through mail_mcp)
- GUI or web interface — MCP tools only
- Real-time calendar sync/push notifications — poll-based reads only
- Calendar sharing/delegation management — focus on personal calendar ops

## Context

- **Companion to mail_mcp** (`~/dev/mail_mcp`): A TypeScript MCP server (28 tools) for IMAP/SMTP email access. mail_mcp can list attachments and download .ics files but has no calendar intelligence. caldav_mcp closes that gap.
- **Shared architecture patterns**: Same MCP SDK (`@modelcontextprotocol/sdk`), same credential approach (OS keychain via `cross-keychain`), same confirmation pattern for write operations, same TypeScript + Vitest stack.
- **Workflow**: AI scans inbox via mail_mcp → finds calendar invite → passes .ics to caldav_mcp → checks conflicts → presents options to user → on confirmation, creates event via CalDAV and sends RSVP via mail_mcp.
- **CalDAV protocol**: RFC 4791. Uses HTTP methods (PROPFIND, REPORT, PUT, DELETE) against calendar servers. Most providers support it — iCloud, Google (with OAuth2), Fastmail, Radicale, Baikal, Nextcloud.

## Constraints

- **Protocol**: Must use CalDAV (RFC 4791) for broad provider compatibility
- **Environment**: Must run locally on macOS, Windows, and Linux
- **Interface**: Must follow MCP specification via `@modelcontextprotocol/sdk`
- **Credentials**: Must use OS keychain (consistent with mail_mcp approach)
- **Node.js**: >=18.0.0 (matches mail_mcp)
- **Write safety**: All write operations require explicit user confirmation before execution

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + same stack as mail_mcp | Consistent developer experience, shared patterns, proven approach | — Pending |
| CalDAV over provider-specific APIs | Broad compatibility across iCloud, Google, self-hosted servers | — Pending |
| OS keychain for credentials | Security best practice, consistent with mail_mcp | — Pending |
| Separate server from mail_mcp | Separation of concerns, independent deployment, focused tool surface | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after Phase 1 completion*
