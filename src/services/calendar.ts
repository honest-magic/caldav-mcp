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
import { expandToBusyPeriods, expandToOccurrences } from '../utils/recurrence-expander.js';
import type { BusyPeriod } from '../utils/recurrence-expander.js';
import { mergePeriods, detectConflicts, findAvailableSlots, eventTimeToMs, msToEventTime } from '../utils/conflict-detector.js';
import type { SlotSuggestion, ConflictResult } from '../utils/conflict-detector.js';

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
    const startMs = DateTime.fromISO(startDate).toUTC().toMillis();
    const endMs = DateTime.fromISO(endDate).toUTC().toMillis();

    for (const obj of objects) {
      if (!obj.data) continue;

      // Expand recurring events into per-occurrence results
      const occurrences = expandToOccurrences(obj.data, startMs, endMs);
      for (const occ of occurrences) {
        results.push({
          uid: occ.uid,
          url: obj.url,
          etag: obj.etag ?? null,
          summary: occ.summary,
          start: occ.start,
          end: occ.end,
          accountId: accId,
          calendarUrl,
        });
      }
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

  /**
   * Check whether a proposed time range conflicts with any existing events.
   * By default checks across all calendars and all accounts.
   * Returns a ConflictResult with hasConflict and the conflicting busy periods.
   */
  async checkConflicts(params: {
    start: EventTime;
    end: EventTime;
    calendarUrls?: string[];
    accountId?: string;
    includeAllDay?: boolean;
  }): Promise<ConflictResult> {
    const proposedStartMs = eventTimeToMs(params.start);
    const proposedEndMs = eventTimeToMs(params.end);

    // Wider fetch window: 90 days before proposed start to catch recurring masters
    // whose DTSTART precedes the proposed time range.
    const wideWindowStartMs = proposedStartMs - 90 * 24 * 60 * 60 * 1000;
    const wideWindowEndMs = proposedEndMs;

    const allICS = await this._fetchAllICS({
      windowStartMs: wideWindowStartMs,
      windowEndMs: wideWindowEndMs,
      calendarUrls: params.calendarUrls,
      accountId: params.accountId,
    });

    // Expand with wide window so recurring masters whose DTSTART is in the past
    // still produce instances that fall within the proposed range.
    const busy = expandToBusyPeriods(allICS, wideWindowStartMs, wideWindowEndMs, {
      excludeAllDay: !(params.includeAllDay ?? false),
    });
    const merged = mergePeriods(busy);
    const conflicts = detectConflicts(proposedStartMs, proposedEndMs, merged);

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * Find available time slots of the requested duration within a search window.
   * By default searches across all calendars and all accounts.
   * Returns up to maxSlots (default 5) SlotSuggestion objects.
   */
  async suggestSlots(params: {
    durationMinutes: number;
    searchStart: EventTime;
    searchDays?: number;
    calendarUrls?: string[];
    accountId?: string;
    workingHoursStart?: number;
    workingHoursEnd?: number;
    maxSlots?: number;
    includeAllDay?: boolean;
  }): Promise<SlotSuggestion[]> {
    const searchDays = params.searchDays ?? 7;
    const maxSlots = params.maxSlots ?? 5;
    const searchStartMs = eventTimeToMs(params.searchStart);
    const searchEndMs = searchStartMs + searchDays * 24 * 60 * 60 * 1000;

    // Wider fetch window: 90 days before search start to catch recurring masters
    const wideWindowStartMs = searchStartMs - 90 * 24 * 60 * 60 * 1000;

    const allICS = await this._fetchAllICS({
      windowStartMs: wideWindowStartMs,
      windowEndMs: searchEndMs,
      calendarUrls: params.calendarUrls,
      accountId: params.accountId,
    });

    const busy = expandToBusyPeriods(allICS, wideWindowStartMs, searchEndMs, {
      excludeAllDay: !(params.includeAllDay ?? false),
    });
    const merged = mergePeriods(busy);

    return findAvailableSlots({
      searchWindowStartMs: searchStartMs,
      searchWindowEndMs: searchEndMs,
      durationMs: params.durationMinutes * 60 * 1000,
      busyPeriods: merged,
      workingHoursStart: params.workingHoursStart,
      workingHoursEnd: params.workingHoursEnd,
      maxSlots,
      slotTzid: params.searchStart.tzid,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch raw ICS data strings from all relevant calendars within a time window.
   * Handles calendarUrls filter, accountId filter, or defaults to all accounts.
   */
  private async _fetchAllICS(params: {
    windowStartMs: number;
    windowEndMs: number;
    calendarUrls?: string[];
    accountId?: string;
  }): Promise<string[]> {
    const windowStart = DateTime.fromMillis(params.windowStartMs).toUTC().toISO()!;
    const windowEnd = DateTime.fromMillis(params.windowEndMs).toUTC().toISO()!;
    const timeRange = { start: windowStart, end: windowEnd };

    const allICS: string[] = [];

    if (params.calendarUrls && params.calendarUrls.length > 0) {
      // Fetch from specific calendars — resolve each calendar's owning client
      for (const calUrl of params.calendarUrls) {
        try {
          const { client } = await this._resolveClientForCalendar(calUrl, params.accountId);
          const cals = await client.fetchCalendars();
          const calendar = cals.find((c) => c.url === calUrl);
          if (!calendar) continue;
          const objects = await client.fetchCalendarObjects(calendar, timeRange);
          for (const obj of objects) {
            if (obj.data) allICS.push(obj.data as string);
          }
        } catch (err) {
          console.error(`[CalendarService] _fetchAllICS: failed for calendar ${calUrl}:`, err);
        }
      }
    } else {
      // Fetch from all calendars across resolved accounts
      const entries = this._resolveClients(params.accountId);
      for (const [, client] of entries) {
        try {
          const cals = await client.fetchCalendars();
          for (const calendar of cals) {
            try {
              const objects = await client.fetchCalendarObjects(calendar, timeRange);
              for (const obj of objects) {
                if (obj.data) allICS.push(obj.data as string);
              }
            } catch (err) {
              console.error(`[CalendarService] _fetchAllICS: failed for calendar ${calendar.url}:`, err);
            }
          }
        } catch (err) {
          console.error(`[CalendarService] _fetchAllICS: failed to fetch calendars:`, err);
        }
      }
    }

    return allICS;
  }

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
