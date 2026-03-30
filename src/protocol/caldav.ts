import { createDAVClient, DAVCalendar, DAVObject } from 'tsdav';
import type { CalDAVAccount } from '../config.js';
import type { BasicCredentials, OAuth2Credentials } from '../types.js';
import { AuthError, NetworkError, ValidationError } from '../errors.js';
import { loadCredentials } from '../security/keychain.js';
import { getValidAccessToken } from '../security/oauth2.js';

const REQUEST_TIMEOUT_MS = 30_000;

// createDAVClient returns a plain object, not an instance of DAVClient class
type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>;

export class CalDAVClient {
  private account: CalDAVAccount;
  private client: DAVClientInstance | undefined;

  constructor(account: CalDAVAccount) {
    this.account = account;
  }

  async connect(): Promise<void> {
    const raw = await loadCredentials(this.account.id);
    if (raw === null) {
      throw new AuthError(`No credentials found for account ${this.account.id}`);
    }

    let parsedCreds: BasicCredentials | OAuth2Credentials;
    try {
      parsedCreds = JSON.parse(raw) as BasicCredentials | OAuth2Credentials;
    } catch {
      // Treat as plain password if JSON parse fails
      parsedCreds = { password: raw } as BasicCredentials;
    }

    try {
      if (this.account.authType === 'basic') {
        const creds = parsedCreds as BasicCredentials;
        this.client = await createDAVClient({
          serverUrl: this.account.serverUrl,
          credentials: {
            username: this.account.username,
            password: creds.password,
          },
          authMethod: 'Basic',
          defaultAccountType: 'caldav',
        });
      } else {
        // oauth2
        const creds = parsedCreds as OAuth2Credentials;
        // Get a fresh access token — getValidAccessToken handles refresh if expired
        await getValidAccessToken(this.account.id);
        this.client = await createDAVClient({
          serverUrl: this.account.serverUrl,
          credentials: {
            tokenUrl: creds.tokenUrl,
            username: this.account.username,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            refreshToken: creds.refreshToken,
          },
          authMethod: 'Oauth',
          defaultAccountType: 'caldav',
        });
      }
    } catch (err) {
      if (err instanceof AuthError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = /401|403|unauthorized|forbidden|authentication/i.test(msg);
      if (isAuth) {
        throw new AuthError(`Authentication failed for account ${this.account.id}: ${msg}`, { cause: err });
      }
      throw new NetworkError(`Failed to connect to CalDAV server for account ${this.account.id}: ${msg}`, { cause: err });
    }
  }

  private assertConnected(): void {
    if (!this.client) {
      throw new NetworkError(`CalDAV client not connected for account ${this.account.id}. Call connect() first.`);
    }
  }

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new NetworkError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${label}`)), REQUEST_TIMEOUT_MS),
      ),
    ]);
  }

  async fetchCalendars(): Promise<DAVCalendar[]> {
    this.assertConnected();
    try {
      return await this.withTimeout(this.client!.fetchCalendars(), 'fetchCalendars');
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new NetworkError(`Failed to fetch calendars for account ${this.account.id}: ${msg}`, { cause: err });
    }
  }

  async fetchCalendarObjects(
    calendar: DAVCalendar,
    timeRange?: { start: string; end: string },
  ): Promise<DAVObject[]> {
    this.assertConnected();
    try {
      return await this.withTimeout(
        this.client!.fetchCalendarObjects({ calendar, ...(timeRange ? { timeRange } : {}) }),
        'fetchCalendarObjects',
      );
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new NetworkError(`Failed to fetch calendar objects: ${msg}`, { cause: err });
    }
  }

  async fetchSingleObject(calendar: DAVCalendar, objectUrl: string): Promise<DAVObject | null> {
    this.assertConnected();
    try {
      const results = await this.withTimeout(
        this.client!.fetchCalendarObjects({ calendar, objectUrls: [objectUrl] }),
        `fetchSingleObject(${objectUrl})`,
      );
      return results[0] ?? null;
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new NetworkError(`Failed to fetch calendar object ${objectUrl}: ${msg}`, { cause: err });
    }
  }

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

  private async _findCalendar(calendarUrl: string): Promise<DAVCalendar> {
    this.assertConnected();
    const calendars = await this.client!.fetchCalendars();
    const calendar = calendars.find((c) => c.url === calendarUrl);
    if (!calendar) {
      throw new ValidationError(`Calendar not found: ${calendarUrl}`);
    }
    return calendar;
  }
}

export default CalDAVClient;
