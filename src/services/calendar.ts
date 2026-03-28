import { CalDAVClient } from '../protocol/caldav.js';
import { parseICS } from '../utils/ical-parser.js';
import { getAccounts, saveAccount } from '../config.js';
import type { CalDAVAccount } from '../config.js';
import { saveCredentials } from '../security/keychain.js';
import { ValidationError, ConflictError, NetworkError } from '../errors.js';
import type { CalendarSummary, EventSummary, ParsedEvent, EventTime, WritePreview } from '../types.js';
import { DateTime } from 'luxon';
import { ConfirmationStore } from '../utils/confirmation-store.js';
import { generateICS } from '../utils/ical-generator.js';
import { randomUUID } from 'node:crypto';

export class CalendarService {
  private clients: Map<string, CalDAVClient> = new Map();
  private confirmationStore = new ConfirmationStore();

  /**
   * Initialise all configured accounts: create clients, attempt connect().
   * Accounts that fail to connect are logged and skipped — server still starts.
   */
  async initialize(): Promise<void> {
    const accounts = await getAccounts();
    for (const account of accounts) {
      const client = new CalDAVClient(account);
      try {
        await client.connect();
        this.clients.set(account.id, client);
      } catch (err) {
        console.error(`[CalendarService] Failed to connect account "${account.id}":`, err);
      }
    }
  }

  /**
   * List all calendars across connected accounts.
   * If accountId is provided, only that account's calendars are returned.
   */
  async listCalendars(accountId?: string): Promise<CalendarSummary[]> {
    const entries = this._resolveClients(accountId);
    const results: CalendarSummary[] = [];

    for (const [accId, client] of entries) {
      const cals = await client.fetchCalendars();
      for (const cal of cals) {
        results.push({
          url: cal.url,
          displayName: (typeof cal.displayName === 'string' ? cal.displayName : null) ?? 'Untitled',
          ctag: (cal as unknown as { ctag?: string | null }).ctag ?? null,
          syncToken: cal.syncToken ?? null,
          accountId: accId,
        });
      }
    }
    return results;
  }

  /**
   * List events in a given calendar URL within an ISO 8601 date range.
   * Returns EventSummary objects (no full body).
   */
  async listEvents(
    calendarUrl: string,
    startDate: string,
    endDate: string,
    accountId?: string,
  ): Promise<EventSummary[]> {
    const start = DateTime.fromISO(startDate).toUTC().toISO();
    const end = DateTime.fromISO(endDate).toUTC().toISO();
    if (!start || !DateTime.fromISO(startDate).isValid) {
      throw new ValidationError(`Invalid date format: ${startDate}`);
    }
    if (!end || !DateTime.fromISO(endDate).isValid) {
      throw new ValidationError(`Invalid date format: ${endDate}`);
    }

    const { client, accId } = await this._resolveClientForCalendar(calendarUrl, accountId);
    const cals = await client.fetchCalendars();
    const calendar = cals.find((c) => c.url === calendarUrl);
    if (!calendar) {
      throw new ValidationError(`Calendar not found: ${calendarUrl}`);
    }

    const objects = await client.fetchCalendarObjects(calendar, { start, end });

    const results: EventSummary[] = [];
    const startDT = DateTime.fromISO(startDate).toUTC();
    const endDT = DateTime.fromISO(endDate).toUTC();

    for (const obj of objects) {
      if (!obj.data) continue;
      let parsed: ParsedEvent;
      try {
        parsed = parseICS(obj.data);
      } catch (err) {
        console.error(`[CalendarService] Failed to parse event at ${obj.url}:`, err);
        continue;
      }

      // Client-side date filter — defensive against servers that ignore REPORT time-range
      const eventStart = DateTime.fromISO(parsed.start.localTime, {
        zone: parsed.start.tzid === 'floating' ? 'local' : parsed.start.tzid,
      }).toUTC();
      if (eventStart < startDT || eventStart > endDT) continue;

      results.push({
        uid: parsed.uid,
        url: obj.url,
        etag: obj.etag ?? null,
        summary: parsed.summary,
        start: parsed.start,
        end: parsed.end,
        accountId: accId,
        calendarUrl,
      });
    }
    return results;
  }

  /**
   * Fetch and parse a single event by URL. Returns the parsed event and its ETag.
   */
  async readEvent(
    eventUrl: string,
    calendarUrl: string,
    accountId?: string,
  ): Promise<{ event: ParsedEvent; etag: string | null }> {
    const { client } = await this._resolveClientForCalendar(calendarUrl, accountId);
    const cals = await client.fetchCalendars();
    const calendar = cals.find((c) => c.url === calendarUrl);
    if (!calendar) {
      throw new ValidationError(`Calendar not found: ${calendarUrl}`);
    }

    const obj = await client.fetchSingleObject(calendar, eventUrl);
    if (!obj || !obj.data) {
      throw new ValidationError(`Event not found: ${eventUrl}`);
    }
    return { event: parseICS(obj.data), etag: obj.etag ?? null };
  }

  /**
   * Register a new OAuth2 account: save credentials to keychain, persist account
   * to accounts.json, and attempt to connect.
   */
  async registerOAuth2Account(params: {
    accountId: string;
    serverUrl: string;
    username: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    tokenUrl: string;
    name?: string;
  }): Promise<{ accountId: string; message: string }> {
    const account: CalDAVAccount = {
      id: params.accountId,
      name: params.name ?? params.accountId,
      serverUrl: params.serverUrl,
      authType: 'oauth2' as const,
      username: params.username,
    };

    // Save OAuth2 credentials to OS keychain
    await saveCredentials(
      params.accountId,
      JSON.stringify({
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        refreshToken: params.refreshToken,
        tokenUrl: params.tokenUrl,
      }),
    );

    // Persist account definition to accounts.json
    await saveAccount(account);

    // Attempt to connect — failure is non-fatal
    const client = new CalDAVClient(account);
    try {
      await client.connect();
      this.clients.set(params.accountId, client);
      return {
        accountId: params.accountId,
        message: 'Account registered and connected successfully',
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CalendarService] registerOAuth2Account: connection test failed for "${params.accountId}":`, err);
      return {
        accountId: params.accountId,
        message: `Account registered but connection test failed: ${errMsg}. Credentials saved — retry by restarting server.`,
      };
    }
  }

  /**
   * Return the IDs of all currently connected accounts.
   */
  getConnectedAccountIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Create a new calendar event. Call without confirmationId to get a preview.
   * Call with confirmationId (from the preview) to execute the write.
   */
  async createEvent(params: {
    calendarUrl: string;
    summary: string;
    start: EventTime;
    end: EventTime;
    description?: string | null;
    location?: string | null;
    accountId?: string;
    confirmationId?: string;
  }): Promise<WritePreview | { success: true; eventUrl: string; uid: string }> {
    if (!params.confirmationId) {
      // Preview mode — store args and return preview
      const id = this.confirmationStore.create('create_event', { ...params });
      return {
        confirmationId: id,
        expiresIn: '5 minutes',
        operation: 'create' as const,
        preview: {
          summary: params.summary,
          calendarUrl: params.calendarUrl,
          start: params.start.localTime,
          end: params.end.localTime,
        },
      };
    }
    // Execute mode — consume token and write
    const pending = this.confirmationStore.consume(params.confirmationId);
    if (!pending) {
      throw new ValidationError('Confirmation expired or invalid. Please request a new preview.');
    }
    // Use stored args, not the execute-call args (per Pitfall 4 in RESEARCH.md)
    const storedArgs = pending.args as typeof params;
    const uid = randomUUID();
    const icsString = generateICS({
      uid,
      summary: storedArgs.summary,
      start: storedArgs.start as EventTime,
      end: storedArgs.end as EventTime,
      description: storedArgs.description,
      location: storedArgs.location,
    });
    const { client } = await this._resolveClientForCalendar(storedArgs.calendarUrl, storedArgs.accountId);
    const response = await client.createEvent(storedArgs.calendarUrl, icsString, uid);
    if (!response.ok) {
      throw new NetworkError(`Create event failed: HTTP ${response.status}`);
    }
    return { success: true, eventUrl: `${storedArgs.calendarUrl}${uid}.ics`, uid };
  }

  /**
   * Update an existing calendar event. Requires etag from readEvent.
   * Call without confirmationId to preview. Call with confirmationId to execute.
   */
  async updateEvent(params: {
    eventUrl: string;
    calendarUrl: string;
    etag: string;
    summary?: string;
    start?: EventTime;
    end?: EventTime;
    description?: string | null;
    location?: string | null;
    accountId?: string;
    confirmationId?: string;
  }): Promise<WritePreview | { success: true }> {
    if (!params.confirmationId) {
      // Preview mode
      const id = this.confirmationStore.create('update_event', { ...params });
      return {
        confirmationId: id,
        expiresIn: '5 minutes',
        operation: 'update' as const,
        preview: {
          summary: params.summary ?? '(unchanged)',
          calendarUrl: params.calendarUrl,
          start: params.start?.localTime,
          end: params.end?.localTime,
        },
      };
    }
    // Execute mode
    const pending = this.confirmationStore.consume(params.confirmationId);
    if (!pending) {
      throw new ValidationError('Confirmation expired or invalid. Please request a new preview.');
    }
    const storedArgs = pending.args as typeof params;
    // Fetch current event to get the raw ICS as base for update
    const { client } = await this._resolveClientForCalendar(storedArgs.calendarUrl, storedArgs.accountId);
    const calendars = await client.fetchCalendars();
    const calendar = calendars.find((c) => c.url === storedArgs.calendarUrl);
    if (!calendar) throw new ValidationError(`Calendar not found: ${storedArgs.calendarUrl}`);
    const obj = await client.fetchSingleObject(calendar, storedArgs.eventUrl);
    if (!obj || !obj.data) throw new ValidationError(`Event not found: ${storedArgs.eventUrl}`);

    // Parse current event, apply updates, regenerate ICS
    const currentEvent = parseICS(obj.data);
    const updatedICS = generateICS({
      uid: currentEvent.uid,
      summary: storedArgs.summary ?? currentEvent.summary,
      start: storedArgs.start ?? currentEvent.start,
      end: storedArgs.end ?? currentEvent.end ?? storedArgs.start ?? currentEvent.start,
      description: storedArgs.description !== undefined ? storedArgs.description : currentEvent.description,
      location: storedArgs.location !== undefined ? storedArgs.location : currentEvent.location,
    });

    const response = await client.updateEvent(storedArgs.eventUrl, updatedICS, storedArgs.etag);
    if (!response.ok) {
      if (response.status === 412) {
        // ETag conflict — re-fetch server state
        const serverObj = await client.fetchSingleObject(calendar, storedArgs.eventUrl);
        const serverParsed = serverObj?.data ? parseICS(serverObj.data) : null;
        throw new ConflictError('Event was modified on the server since you last read it.', {
          localData: storedArgs as unknown as Record<string, unknown>,
          serverData: serverParsed,
          serverEtag: serverObj?.etag ?? null,
        });
      }
      throw new NetworkError(`Update event failed: HTTP ${response.status}`);
    }
    return { success: true };
  }

  /**
   * Delete a calendar event. Requires etag from readEvent.
   * Call without confirmationId to preview. Call with confirmationId to execute.
   */
  async deleteEvent(params: {
    eventUrl: string;
    calendarUrl: string;
    etag: string;
    accountId?: string;
    confirmationId?: string;
  }): Promise<WritePreview | { success: true }> {
    if (!params.confirmationId) {
      // Preview mode — fetch event details for preview
      const { event } = await this.readEvent(params.eventUrl, params.calendarUrl, params.accountId);
      const id = this.confirmationStore.create('delete_event', { ...params });
      return {
        confirmationId: id,
        expiresIn: '5 minutes',
        operation: 'delete' as const,
        preview: {
          summary: event.summary,
          calendarUrl: params.calendarUrl,
          start: event.start.localTime,
          end: event.end?.localTime,
        },
      };
    }
    // Execute mode
    const pending = this.confirmationStore.consume(params.confirmationId);
    if (!pending) {
      throw new ValidationError('Confirmation expired or invalid. Please request a new preview.');
    }
    const storedArgs = pending.args as typeof params;
    const { client } = await this._resolveClientForCalendar(storedArgs.calendarUrl, storedArgs.accountId);
    const response = await client.deleteEvent(storedArgs.eventUrl, storedArgs.etag);
    if (!response.ok) {
      if (response.status === 412) {
        const calendars = await client.fetchCalendars();
        const calendar = calendars.find((c) => c.url === storedArgs.calendarUrl);
        const serverObj = calendar ? await client.fetchSingleObject(calendar, storedArgs.eventUrl) : null;
        const serverParsed = serverObj?.data ? parseICS(serverObj.data) : null;
        throw new ConflictError('Event was modified on the server since you last read it.', {
          localData: storedArgs as unknown as Record<string, unknown>,
          serverData: serverParsed,
          serverEtag: serverObj?.etag ?? null,
        });
      }
      throw new NetworkError(`Delete event failed: HTTP ${response.status}`);
    }
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Return client entries filtered to accountId (or all if undefined). */
  private _resolveClients(accountId?: string): Array<[string, CalDAVClient]> {
    if (accountId !== undefined) {
      const client = this.clients.get(accountId);
      if (!client) {
        throw new ValidationError(`Account not found: ${accountId}`);
      }
      return [[accountId, client]];
    }
    return Array.from(this.clients.entries());
  }

  /** Find the client that owns the given calendarUrl, or use accountId if provided. */
  private async _resolveClientForCalendar(
    calendarUrl: string,
    accountId?: string,
  ): Promise<{ client: CalDAVClient; accId: string }> {
    if (accountId !== undefined) {
      const client = this.clients.get(accountId);
      if (!client) {
        throw new ValidationError(`Account not found: ${accountId}`);
      }
      return { client, accId: accountId };
    }

    // Search all accounts for the calendar URL
    for (const [accId, client] of this.clients.entries()) {
      const cals = await client.fetchCalendars();
      if (cals.some((c) => c.url === calendarUrl)) {
        return { client, accId };
      }
    }
    throw new ValidationError(`Calendar not found in any account: ${calendarUrl}`);
  }
}
