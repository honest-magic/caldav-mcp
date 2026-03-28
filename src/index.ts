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
import { CalDAVMCPError } from './errors.js';
import { parseICS } from './utils/ical-parser.js';

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
          'Read full details of a calendar event including attendees, location, description, and recurrence rule.',
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

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (err) {
        if (err instanceof McpError) throw err;
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
  const server = new CalDAVMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
