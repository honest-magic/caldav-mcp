#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { CalendarService } from './services/calendar.js';
import { handleAccountsCommand } from './cli/accounts.js';
import { CalDAVMCPError, ConflictError } from './errors.js';
import { parseICS } from './utils/ical-parser.js';
import { msToEventTime } from './utils/conflict-detector.js';
import type { EventTime } from './types.js';

export class CalDAVMCPServer {
  private server: Server;
  private calendarService: CalendarService;

  constructor() {
    this.server = new Server(
      { name: 'caldav-mcp-server', version: '0.1.0' },
      { capabilities: { tools: {} } },
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
            const result = await this.calendarService.listCalendars(
              args.account as string | undefined,
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'list_events': {
            const result = await this.calendarService.listEvents(
              args.calendarUrl as string,
              args.startDate as string,
              args.endDate as string,
              args.account as string | undefined,
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'read_event': {
            const result = await this.calendarService.readEvent(
              args.eventUrl as string,
              args.calendarUrl as string,
              args.account as string | undefined,
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'parse_ics': {
            const result = parseICS(args.icsData as string);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'register_oauth2_account': {
            const result = await this.calendarService.registerOAuth2Account(
              args as {
                accountId: string;
                serverUrl: string;
                username: string;
                clientId: string;
                clientSecret: string;
                refreshToken: string;
                tokenUrl: string;
                name?: string;
              },
            );
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'create_event': {
            const start: EventTime = {
              localTime: args.startDate as string,
              tzid: args.startTzid as string,
            };
            const end: EventTime = {
              localTime: args.endDate as string,
              tzid: args.endTzid as string,
            };
            const result = await this.calendarService.createEvent({
              calendarUrl: args.calendarUrl as string,
              summary: args.summary as string,
              start,
              end,
              description: args.description as string | undefined ?? null,
              location: args.location as string | undefined ?? null,
              accountId: args.account as string | undefined,
              confirmationId: args.confirmationId as string | undefined,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'update_event': {
            let start: EventTime | undefined;
            if (args.startDate && args.startTzid) {
              start = {
                localTime: args.startDate as string,
                tzid: args.startTzid as string,
              };
            }
            let end: EventTime | undefined;
            if (args.endDate && args.endTzid) {
              end = {
                localTime: args.endDate as string,
                tzid: args.endTzid as string,
              };
            }
            const result = await this.calendarService.updateEvent({
              eventUrl: args.eventUrl as string,
              calendarUrl: args.calendarUrl as string,
              etag: args.etag as string,
              summary: args.summary as string | undefined,
              start,
              end,
              description: args.description !== undefined ? args.description as string | null : undefined,
              location: args.location !== undefined ? args.location as string | null : undefined,
              accountId: args.account as string | undefined,
              confirmationId: args.confirmationId as string | undefined,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'delete_event': {
            const result = await this.calendarService.deleteEvent({
              eventUrl: args.eventUrl as string,
              calendarUrl: args.calendarUrl as string,
              etag: args.etag as string,
              accountId: args.account as string | undefined,
              confirmationId: args.confirmationId as string | undefined,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          case 'check_conflicts': {
            const start: EventTime = {
              localTime: args.startDate as string,
              tzid: args.startTzid as string,
            };
            const end: EventTime = {
              localTime: args.endDate as string,
              tzid: args.endTzid as string,
            };
            const result = await this.calendarService.checkConflicts({
              start,
              end,
              calendarUrls: args.calendarUrls as string[] | undefined,
              accountId: args.account as string | undefined,
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
            const searchStart: EventTime = {
              localTime: args.searchStartDate as string,
              tzid: args.searchStartTzid as string,
            };
            const slots = await this.calendarService.suggestSlots({
              durationMinutes: args.durationMinutes as number,
              searchStart,
              searchDays: args.searchDays as number | undefined,
              calendarUrls: args.calendarUrls as string[] | undefined,
              accountId: args.account as string | undefined,
              workingHoursStart: args.workingHoursStart as number | undefined,
              workingHoursEnd: args.workingHoursEnd as number | undefined,
              maxSlots: args.maxSlots as number | undefined,
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
  if (args.length > 0) {
    const handled = await handleAccountsCommand(args);
    if (handled) return;
  }

  const server = new CalDAVMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
