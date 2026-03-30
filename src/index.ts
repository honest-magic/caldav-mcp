#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CalendarService } from './services/calendar.js';
import { handleAccountsCommand } from './cli/accounts.js';
import { installClaude } from './cli/install-claude.js';
import { CalDAVMCPError, ConflictError, ValidationError } from './errors.js';
import { parseICS } from './utils/ical-parser.js';
import { msToEventTime } from './utils/conflict-detector.js';
import type { EventTime } from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// ---------------------------------------------------------------------------
// Zod schemas for tool argument validation
// ---------------------------------------------------------------------------

/** @internal — exported for testing only */
export const listCalendarsArgs = z.object({
  account: z.string().optional(),
});

export const listEventsArgs = z.object({
  calendarUrl: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  account: z.string().optional(),
});

export const readEventArgs = z.object({
  eventUrl: z.string(),
  calendarUrl: z.string(),
  account: z.string().optional(),
});

export const parseIcsArgs = z.object({
  icsData: z.string(),
});

export const registerOAuth2Args = z.object({
  accountId: z.string(),
  serverUrl: z.string(),
  username: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  refreshToken: z.string(),
  tokenUrl: z.string(),
  name: z.string().optional(),
});

export const createEventArgs = z.object({
  calendarUrl: z.string(),
  summary: z.string(),
  startDate: z.string(),
  startTzid: z.string(),
  endDate: z.string(),
  endTzid: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  account: z.string().optional(),
  confirmationId: z.string().optional(),
});

export const updateEventArgs = z.object({
  eventUrl: z.string(),
  calendarUrl: z.string(),
  etag: z.string(),
  summary: z.string().optional(),
  startDate: z.string().optional(),
  startTzid: z.string().optional(),
  endDate: z.string().optional(),
  endTzid: z.string().optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  account: z.string().optional(),
  confirmationId: z.string().optional(),
});

export const deleteEventArgs = z.object({
  eventUrl: z.string(),
  calendarUrl: z.string(),
  etag: z.string(),
  account: z.string().optional(),
  confirmationId: z.string().optional(),
});

export const checkConflictsArgs = z.object({
  startDate: z.string(),
  startTzid: z.string(),
  endDate: z.string(),
  endTzid: z.string(),
  calendarUrls: z.array(z.string()).optional(),
  account: z.string().optional(),
  includeAllDay: z.boolean().optional(),
});

export const suggestSlotsArgs = z.object({
  durationMinutes: z.number(),
  searchStartDate: z.string(),
  searchStartTzid: z.string(),
  searchDays: z.number().optional(),
  calendarUrls: z.array(z.string()).optional(),
  account: z.string().optional(),
  workingHoursStart: z.number().optional(),
  workingHoursEnd: z.number().optional(),
  maxSlots: z.number().optional(),
  includeAllDay: z.boolean().optional(),
});

export class CalDAVMCPServer {
  private server: Server;
  private calendarService: CalendarService;

  constructor() {
    this.server = new Server(
      { name: 'caldav-mcp-server', version: pkg.version },
      {
        capabilities: { tools: {} },
        instructions:
          'Use caldav-mcp for calendar operations — listing calendars, reading/creating/updating/deleting events, checking scheduling conflicts, and suggesting available time slots. Use this server whenever the user asks about their schedule, meetings, appointments, availability, or calendar events.',
      },
    );
    this.calendarService = new CalendarService();
    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  private getTools() {
    return [
      {
        name: 'list_calendars',
        description:
          'List all calendars across configured CalDAV accounts. Returns calendar names, URLs, and sync tokens.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            account: {
              type: 'string',
              description: 'Optional account ID to filter by. Defaults to all accounts.',
            },
          },
          required: [],
        },
      },
      {
        name: 'list_events',
        description:
          'List calendar events within a date range. Returns event summaries with UIDs, times, and URLs.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            calendarUrl: {
              type: 'string',
              description: 'Calendar URL (from list_calendars)',
            },
            startDate: {
              type: 'string',
              description: 'Start of range, ISO 8601 (e.g. 2024-03-01 or 2024-03-01T00:00:00)',
            },
            endDate: {
              type: 'string',
              description: 'End of range, ISO 8601 (e.g. 2024-03-31 or 2024-03-31T23:59:59)',
            },
            account: {
              type: 'string',
              description: 'Optional account ID',
            },
          },
          required: ['calendarUrl', 'startDate', 'endDate'],
        },
      },
      {
        name: 'read_event',
        description:
          'Read full details of a calendar event including attendees, location, description, recurrence rule, and etag. The etag is required for update_event and delete_event.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            eventUrl: {
              type: 'string',
              description: 'Event URL (from list_events)',
            },
            calendarUrl: {
              type: 'string',
              description: 'Calendar URL containing the event',
            },
            account: {
              type: 'string',
              description: 'Optional account ID',
            },
          },
          required: ['eventUrl', 'calendarUrl'],
        },
      },
      {
        name: 'parse_ics',
        description:
          'Parse raw iCalendar (.ics) text into structured event data. No server connection needed — works with .ics content from email attachments or files.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            icsData: {
              type: 'string',
              description: 'Raw iCalendar (.ics) text content',
            },
          },
          required: ['icsData'],
        },
      },
      {
        name: 'register_oauth2_account',
        description:
          'Register a new OAuth2 CalDAV account. Saves credentials to OS keychain and account config to accounts.json. Use this after obtaining OAuth2 tokens from the provider\'s consent flow.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            accountId: {
              type: 'string',
              description: 'Unique account identifier (e.g. "google-personal")',
            },
            serverUrl: {
              type: 'string',
              description: 'CalDAV server URL (e.g. "https://apidata.googleusercontent.com/caldav/v2")',
            },
            username: {
              type: 'string',
              description: 'Account username or email address',
            },
            clientId: {
              type: 'string',
              description: 'OAuth2 client ID from provider',
            },
            clientSecret: {
              type: 'string',
              description: 'OAuth2 client secret from provider',
            },
            refreshToken: {
              type: 'string',
              description: 'OAuth2 refresh token obtained from consent flow',
            },
            tokenUrl: {
              type: 'string',
              description: 'OAuth2 token endpoint URL (e.g. "https://oauth2.googleapis.com/token")',
            },
            name: {
              type: 'string',
              description: 'Optional human-friendly account name',
            },
          },
          required: [
            'accountId',
            'serverUrl',
            'username',
            'clientId',
            'clientSecret',
            'refreshToken',
            'tokenUrl',
          ],
        },
      },
      {
        name: 'create_event',
        description:
          'Create a new calendar event. Call without confirmationId to get a preview. Call with confirmationId to execute the write.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            calendarUrl: {
              type: 'string',
              description: 'Calendar URL (from list_calendars)',
            },
            summary: {
              type: 'string',
              description: 'Event title / summary',
            },
            startDate: {
              type: 'string',
              description: 'Event start date-time, ISO 8601 (e.g. 2024-03-15T09:00:00)',
            },
            startTzid: {
              type: 'string',
              description: 'IANA timezone for start (e.g. "America/New_York" or "UTC")',
            },
            endDate: {
              type: 'string',
              description: 'Event end date-time, ISO 8601 (e.g. 2024-03-15T10:00:00)',
            },
            endTzid: {
              type: 'string',
              description: 'IANA timezone for end (e.g. "America/New_York" or "UTC")',
            },
            description: {
              type: 'string',
              description: 'Optional event description',
            },
            location: {
              type: 'string',
              description: 'Optional event location',
            },
            account: {
              type: 'string',
              description: 'Optional account ID',
            },
            confirmationId: {
              type: 'string',
              description: 'Confirmation token from the preview response. Required to execute the write.',
            },
          },
          required: ['calendarUrl', 'summary', 'startDate', 'startTzid', 'endDate', 'endTzid'],
        },
      },
      {
        name: 'update_event',
        description:
          'Update an existing calendar event. Requires etag from read_event or list_events. Call without confirmationId to preview. Call with confirmationId to execute.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            eventUrl: {
              type: 'string',
              description: 'Event URL (from list_events or read_event)',
            },
            calendarUrl: {
              type: 'string',
              description: 'Calendar URL containing the event',
            },
            etag: {
              type: 'string',
              description: 'ETag from read_event or list_events. Used for conflict detection.',
            },
            summary: {
              type: 'string',
              description: 'New event title (omit to keep unchanged)',
            },
            startDate: {
              type: 'string',
              description: 'New start date-time, ISO 8601 (omit to keep unchanged)',
            },
            startTzid: {
              type: 'string',
              description: 'IANA timezone for new start (required if startDate is provided)',
            },
            endDate: {
              type: 'string',
              description: 'New end date-time, ISO 8601 (omit to keep unchanged)',
            },
            endTzid: {
              type: 'string',
              description: 'IANA timezone for new end (required if endDate is provided)',
            },
            description: {
              type: 'string',
              description: 'New description (omit to keep unchanged)',
            },
            location: {
              type: 'string',
              description: 'New location (omit to keep unchanged)',
            },
            account: {
              type: 'string',
              description: 'Optional account ID',
            },
            confirmationId: {
              type: 'string',
              description: 'Confirmation token from the preview response. Required to execute the write.',
            },
          },
          required: ['eventUrl', 'calendarUrl', 'etag'],
        },
      },
      {
        name: 'delete_event',
        description:
          'Delete a calendar event. Requires etag from read_event or list_events. Call without confirmationId to preview. Call with confirmationId to execute.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            eventUrl: {
              type: 'string',
              description: 'Event URL (from list_events or read_event)',
            },
            calendarUrl: {
              type: 'string',
              description: 'Calendar URL containing the event',
            },
            etag: {
              type: 'string',
              description: 'ETag from read_event or list_events. Used for conflict detection.',
            },
            account: {
              type: 'string',
              description: 'Optional account ID',
            },
            confirmationId: {
              type: 'string',
              description: 'Confirmation token from the preview response. Required to execute the delete.',
            },
          },
          required: ['eventUrl', 'calendarUrl', 'etag'],
        },
      },
      {
        name: 'check_conflicts',
        description:
          'Check if a proposed event time conflicts with existing events across calendars. Expands recurring events (RRULE) including EXDATE exceptions and RECURRENCE-ID overrides. Returns conflicting time periods.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            startDate: {
              type: 'string',
              description: 'Proposed event start date-time, ISO 8601 (e.g. 2024-03-15T09:00:00)',
            },
            startTzid: {
              type: 'string',
              description: 'IANA timezone for start (e.g. "America/New_York" or "UTC")',
            },
            endDate: {
              type: 'string',
              description: 'Proposed event end date-time, ISO 8601 (e.g. 2024-03-15T10:00:00)',
            },
            endTzid: {
              type: 'string',
              description: 'IANA timezone for end (e.g. "America/New_York" or "UTC")',
            },
            calendarUrls: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of calendar URLs to check. Defaults to all calendars across all accounts.',
            },
            account: {
              type: 'string',
              description: 'Optional account ID to restrict the conflict check to one account.',
            },
            includeAllDay: {
              type: 'boolean',
              description: 'Include all-day events in conflict detection. Defaults to false (all-day events like holidays/vacations are excluded).',
            },
          },
          required: ['startDate', 'startTzid', 'endDate', 'endTzid'],
        },
      },
      {
        name: 'suggest_slots',
        description:
          'Find available time slots for scheduling. Searches across all calendars, expands recurring events, and suggests gaps that fit the requested duration. Optionally filters by working hours.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            durationMinutes: {
              type: 'number',
              description: 'Duration of the event to schedule, in minutes (e.g. 60 for a 1-hour meeting)',
            },
            searchStartDate: {
              type: 'string',
              description: 'Start of the search window, ISO 8601 (e.g. 2024-03-15T00:00:00)',
            },
            searchStartTzid: {
              type: 'string',
              description: 'IANA timezone for the search start (e.g. "America/New_York" or "UTC")',
            },
            searchDays: {
              type: 'number',
              description: 'Number of days to search from searchStart. Defaults to 7.',
            },
            calendarUrls: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of calendar URLs to check. Defaults to all calendars across all accounts.',
            },
            account: {
              type: 'string',
              description: 'Optional account ID to restrict the search to one account.',
            },
            workingHoursStart: {
              type: 'number',
              description: 'Start of working hours (0-23, inclusive). Only suggest slots within working hours when set together with workingHoursEnd.',
            },
            workingHoursEnd: {
              type: 'number',
              description: 'End of working hours (0-23, exclusive, e.g. 17 means up to 17:00). Only suggest slots within working hours when set together with workingHoursStart.',
            },
            maxSlots: {
              type: 'number',
              description: 'Maximum number of slot suggestions to return. Defaults to 5.',
            },
            includeAllDay: {
              type: 'boolean',
              description: 'Include all-day events as busy periods. Defaults to false (all-day events like holidays/vacations are excluded).',
            },
          },
          required: ['durationMinutes', 'searchStartDate', 'searchStartTzid'],
        },
      },
    ];
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.getTools() };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;

      try {
        switch (name) {
          case 'list_calendars': {
            const v = listCalendarsArgs.parse(args);
            const result = await this.calendarService.listCalendars(v.account);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'list_events': {
            const v = listEventsArgs.parse(args);
            const result = await this.calendarService.listEvents(
              v.calendarUrl, v.startDate, v.endDate, v.account,
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'read_event': {
            const v = readEventArgs.parse(args);
            const result = await this.calendarService.readEvent(
              v.eventUrl, v.calendarUrl, v.account,
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'parse_ics': {
            const v = parseIcsArgs.parse(args);
            const result = parseICS(v.icsData);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'register_oauth2_account': {
            const v = registerOAuth2Args.parse(args);
            const result = await this.calendarService.registerOAuth2Account(v);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'create_event': {
            const v = createEventArgs.parse(args);
            const start: EventTime = { localTime: v.startDate, tzid: v.startTzid };
            const end: EventTime = { localTime: v.endDate, tzid: v.endTzid };
            const result = await this.calendarService.createEvent({
              calendarUrl: v.calendarUrl,
              summary: v.summary,
              start,
              end,
              description: v.description ?? null,
              location: v.location ?? null,
              accountId: v.account,
              confirmationId: v.confirmationId,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'update_event': {
            const v = updateEventArgs.parse(args);
            let start: EventTime | undefined;
            if (v.startDate && v.startTzid) {
              start = { localTime: v.startDate, tzid: v.startTzid };
            }
            let end: EventTime | undefined;
            if (v.endDate && v.endTzid) {
              end = { localTime: v.endDate, tzid: v.endTzid };
            }
            const result = await this.calendarService.updateEvent({
              eventUrl: v.eventUrl,
              calendarUrl: v.calendarUrl,
              etag: v.etag,
              summary: v.summary,
              start,
              end,
              description: v.description,
              location: v.location,
              accountId: v.account,
              confirmationId: v.confirmationId,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'delete_event': {
            const v = deleteEventArgs.parse(args);
            const result = await this.calendarService.deleteEvent({
              eventUrl: v.eventUrl,
              calendarUrl: v.calendarUrl,
              etag: v.etag,
              accountId: v.account,
              confirmationId: v.confirmationId,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'check_conflicts': {
            const v = checkConflictsArgs.parse(args);
            const start: EventTime = { localTime: v.startDate, tzid: v.startTzid };
            const end: EventTime = { localTime: v.endDate, tzid: v.endTzid };
            const result = await this.calendarService.checkConflicts({
              start,
              end,
              calendarUrls: v.calendarUrls,
              accountId: v.account,
              includeAllDay: v.includeAllDay,
            });
            let text: string;
            if (!result.hasConflict) {
              text = 'No conflicts found.';
            } else {
              const lines = ['Conflicts detected:'];
              for (const conflict of result.conflicts) {
                const conflictStart = msToEventTime(conflict.startMs, start.tzid);
                const conflictEnd = msToEventTime(conflict.endMs, start.tzid);
                lines.push(`  - ${conflictStart.localTime} to ${conflictEnd.localTime} (${conflictStart.tzid})`);
              }
              text = lines.join('\n');
            }
            return { content: [{ type: 'text' as const, text }] };
          }

          case 'suggest_slots': {
            const v = suggestSlotsArgs.parse(args);
            const searchStart: EventTime = { localTime: v.searchStartDate, tzid: v.searchStartTzid };
            const slots = await this.calendarService.suggestSlots({
              durationMinutes: v.durationMinutes,
              searchStart,
              searchDays: v.searchDays,
              calendarUrls: v.calendarUrls,
              accountId: v.account,
              workingHoursStart: v.workingHoursStart,
              workingHoursEnd: v.workingHoursEnd,
              maxSlots: v.maxSlots,
              includeAllDay: v.includeAllDay,
            });
            let text: string;
            if (slots.length === 0) {
              text = 'No available slots found in the search window.';
            } else {
              const lines = ['Available slots:'];
              slots.forEach((slot, i) => {
                const slotStart = msToEventTime(slot.startMs, searchStart.tzid);
                const slotEnd = msToEventTime(slot.endMs, searchStart.tzid);
                lines.push(`  Slot ${i + 1}: ${slotStart.localTime} - ${slotEnd.localTime} (${slotStart.tzid})`);
              });
              text = lines.join('\n');
            }
            return { content: [{ type: 'text' as const, text }] };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (err) {
        if (err instanceof McpError) throw err;
        if (err instanceof z.ZodError) {
          const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Invalid arguments: ${issues}`, code: 'ValidationError' }) }],
            isError: true,
          };
        }
        // ConflictError must be checked before CalDAVMCPError (it extends it)
        if (err instanceof ConflictError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: err.message,
                  code: err.code,
                  conflict: err.conflict,
                }),
              },
            ],
            isError: true,
          };
        }
        if (err instanceof CalDAVMCPError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: err.message, code: err.code }),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Internal error', details: String(err) }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run(): Promise<void> {
    await this.calendarService.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('CalDAV MCP server running on stdio');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log(pkg.version);
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`caldav-mcp v${pkg.version} — MCP server for CalDAV calendar access

Usage: caldav-mcp [options] [command]

Commands:
  accounts add        Add a new CalDAV account (interactive)
  accounts list       List configured accounts
  accounts remove ID  Remove an account

Options:
  --validate-accounts Probe CalDAV connections for all accounts and exit
  --install-claude    Write caldav-mcp to Claude Desktop config and exit
  --version           Show version number
  -h, --help          Show this help message`);
    process.exit(0);
  }

  if (args.includes('--install-claude')) {
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { execSync } = await import('node:child_process');

    let binaryPath: string;
    try {
      binaryPath = execSync('which caldav-mcp', { encoding: 'utf8' }).trim();
    } catch {
      binaryPath = process.argv[1];
    }

    const configPath = join(
      homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );

    try {
      const writtenPath = await installClaude(configPath, binaryPath);
      console.log(`caldav-mcp configured for Claude Desktop at: ${writtenPath}`);
      console.log(`Server path: ${binaryPath}`);
      console.log('Restart Claude Desktop to activate.');
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes('--validate-accounts')) {
    const { getAccounts } = await import('./config.js');
    const { CalDAVClient } = await import('./protocol/caldav.js');
    const accounts = await getAccounts();
    if (accounts.length === 0) {
      console.log('No accounts configured.');
      process.exit(0);
    }
    let allOk = true;
    for (const account of accounts) {
      const client = new CalDAVClient(account);
      try {
        await client.connect();
        const cals = await client.fetchCalendars();
        console.log(`  ✓ ${account.id} — ${cals.length} calendar(s)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${account.id} — ${msg}`);
        allOk = false;
      }
    }
    process.exit(allOk ? 0 : 1);
  }

  if (args.length > 0) {
    const handled = await handleAccountsCommand(args);
    if (handled) process.exit(0);
  }

  const server = new CalDAVMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
