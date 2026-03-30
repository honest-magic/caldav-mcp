import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing module under test
vi.mock('tsdav', () => ({
  createDAVClient: vi.fn(),
}));
vi.mock('../security/keychain.js', () => ({
  loadCredentials: vi.fn(),
}));
vi.mock('../security/oauth2.js', () => ({
  getValidAccessToken: vi.fn(),
}));

import { createDAVClient } from 'tsdav';
import { CalDAVClient } from './caldav.js';
import { loadCredentials } from '../security/keychain.js';
import { getValidAccessToken } from '../security/oauth2.js';
import { AuthError, NetworkError, ValidationError } from '../errors.js';
import type { CalDAVAccount } from '../config.js';

const mockCreateDAVClient = vi.mocked(createDAVClient);
const mockLoadCredentials = vi.mocked(loadCredentials);
const mockGetValidAccessToken = vi.mocked(getValidAccessToken);

function makeAccount(overrides?: Partial<CalDAVAccount>): CalDAVAccount {
  return {
    id: 'test-acc',
    name: 'Test Account',
    serverUrl: 'https://caldav.example.com',
    authType: 'basic',
    username: 'user@example.com',
    ...overrides,
  };
}

function makeMockDAVClient() {
  return {
    fetchCalendars: vi.fn().mockResolvedValue([]),
    fetchCalendarObjects: vi.fn().mockResolvedValue([]),
    createCalendarObject: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
    updateCalendarObject: vi.fn().mockResolvedValue({ ok: true, status: 204 }),
    deleteCalendarObject: vi.fn().mockResolvedValue({ ok: true, status: 204 }),
  };
}

describe('CalDAVClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connect()', () => {
    it('throws AuthError when no credentials found', async () => {
      const client = new CalDAVClient(makeAccount());
      mockLoadCredentials.mockResolvedValue(null);

      await expect(client.connect()).rejects.toThrow(AuthError);
      await expect(client.connect()).rejects.toThrow(/No credentials found/);
    });

    it('connects with basic auth using JSON credentials', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'secret' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);

      await client.connect();

      expect(mockCreateDAVClient).toHaveBeenCalledWith({
        serverUrl: account.serverUrl,
        credentials: {
          username: account.username,
          password: 'secret',
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      });
    });

    it('connects with basic auth using plaintext password (non-JSON)', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();

      mockLoadCredentials.mockResolvedValue('plaintext-password');
      mockCreateDAVClient.mockResolvedValue(mockDav as any);

      await client.connect();

      expect(mockCreateDAVClient).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            username: account.username,
            password: 'plaintext-password',
          },
          authMethod: 'Basic',
        }),
      );
    });

    it('connects with OAuth2 auth', async () => {
      const account = makeAccount({ authType: 'oauth2' });
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      const oauth2Creds = {
        clientId: 'cid',
        clientSecret: 'csecret',
        refreshToken: 'rtoken',
        tokenUrl: 'https://oauth.example.com/token',
      };

      mockLoadCredentials.mockResolvedValue(JSON.stringify(oauth2Creds));
      mockGetValidAccessToken.mockResolvedValue('access-token');
      mockCreateDAVClient.mockResolvedValue(mockDav as any);

      await client.connect();

      expect(mockGetValidAccessToken).toHaveBeenCalledWith(account.id);
      expect(mockCreateDAVClient).toHaveBeenCalledWith(
        expect.objectContaining({
          authMethod: 'Oauth',
          credentials: expect.objectContaining({
            clientId: 'cid',
            clientSecret: 'csecret',
            refreshToken: 'rtoken',
            tokenUrl: 'https://oauth.example.com/token',
          }),
        }),
      );
    });

    it('throws AuthError on 401/403 errors', async () => {
      const client = new CalDAVClient(makeAccount());
      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockRejectedValue(new Error('401 Unauthorized'));

      await expect(client.connect()).rejects.toThrow(AuthError);
    });

    it('throws NetworkError on non-auth connection failures', async () => {
      const client = new CalDAVClient(makeAccount());
      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(client.connect()).rejects.toThrow(NetworkError);
    });
  });

  describe('fetchCalendars()', () => {
    it('throws NetworkError when not connected', async () => {
      const client = new CalDAVClient(makeAccount());
      await expect(client.fetchCalendars()).rejects.toThrow(NetworkError);
      await expect(client.fetchCalendars()).rejects.toThrow(/not connected/);
    });

    it('returns calendars from underlying DAV client', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      const calendars = [
        { url: '/cal/1', displayName: 'Work' },
        { url: '/cal/2', displayName: 'Personal' },
      ];
      mockDav.fetchCalendars.mockResolvedValue(calendars);

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      const result = await client.fetchCalendars();
      expect(result).toEqual(calendars);
    });

    it('wraps underlying errors as NetworkError', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      mockDav.fetchCalendars.mockRejectedValue(new Error('connection lost'));

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      await expect(client.fetchCalendars()).rejects.toThrow(NetworkError);
    });
  });

  describe('fetchCalendarObjects()', () => {
    async function connectedClient() {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();
      return { client, mockDav };
    }

    it('passes time range to underlying client', async () => {
      const { client, mockDav } = await connectedClient();
      const calendar = { url: '/cal/1' } as any;
      const timeRange = { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' };

      await client.fetchCalendarObjects(calendar, timeRange);

      expect(mockDav.fetchCalendarObjects).toHaveBeenCalledWith({
        calendar,
        timeRange,
      });
    });

    it('omits timeRange when not provided', async () => {
      const { client, mockDav } = await connectedClient();
      const calendar = { url: '/cal/1' } as any;

      await client.fetchCalendarObjects(calendar);

      expect(mockDav.fetchCalendarObjects).toHaveBeenCalledWith({
        calendar,
      });
    });

    it('throws NetworkError when not connected', async () => {
      const client = new CalDAVClient(makeAccount());
      await expect(
        client.fetchCalendarObjects({ url: '/cal/1' } as any),
      ).rejects.toThrow(NetworkError);
    });
  });

  describe('fetchSingleObject()', () => {
    it('returns first result or null', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      const calendar = { url: '/cal/1' } as any;
      const obj = { url: '/cal/1/event.ics', data: 'BEGIN:VCALENDAR...', etag: '"abc"' };
      mockDav.fetchCalendarObjects.mockResolvedValue([obj]);

      const result = await client.fetchSingleObject(calendar, '/cal/1/event.ics');
      expect(result).toEqual(obj);
      expect(mockDav.fetchCalendarObjects).toHaveBeenCalledWith({
        calendar,
        objectUrls: ['/cal/1/event.ics'],
      });
    });

    it('returns null when no results', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      mockDav.fetchCalendarObjects.mockResolvedValue([]);
      const result = await client.fetchSingleObject({ url: '/cal/1' } as any, '/missing.ics');
      expect(result).toBeNull();
    });
  });

  describe('createEvent()', () => {
    it('finds calendar and calls createCalendarObject', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      const calendar = { url: '/cal/work' };
      mockDav.fetchCalendars.mockResolvedValue([calendar]);

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      await client.createEvent('/cal/work', 'BEGIN:VCALENDAR...', 'uid-123');

      expect(mockDav.createCalendarObject).toHaveBeenCalledWith({
        calendar,
        iCalString: 'BEGIN:VCALENDAR...',
        filename: 'uid-123.ics',
      });
    });

    it('throws ValidationError when calendar not found', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();
      mockDav.fetchCalendars.mockResolvedValue([]);

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      await expect(
        client.createEvent('/cal/missing', 'ics', 'uid'),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('updateEvent()', () => {
    it('calls updateCalendarObject with url, data, and etag', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      await client.updateEvent('/cal/work/event.ics', 'BEGIN:VCALENDAR...', '"etag-1"');

      expect(mockDav.updateCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: '/cal/work/event.ics',
          data: 'BEGIN:VCALENDAR...',
          etag: '"etag-1"',
        },
      });
    });
  });

  describe('deleteEvent()', () => {
    it('calls deleteCalendarObject with url and etag', async () => {
      const account = makeAccount();
      const client = new CalDAVClient(account);
      const mockDav = makeMockDAVClient();

      mockLoadCredentials.mockResolvedValue(JSON.stringify({ password: 'pw' }));
      mockCreateDAVClient.mockResolvedValue(mockDav as any);
      await client.connect();

      await client.deleteEvent('/cal/work/event.ics', '"etag-1"');

      expect(mockDav.deleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: '/cal/work/event.ics',
          etag: '"etag-1"',
        },
      });
    });
  });
});
