import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all external dependencies
// ---------------------------------------------------------------------------

vi.mock('../protocol/caldav.js', () => {
  const CalDAVClient = vi.fn().mockImplementation(function (this: any) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.fetchCalendars = vi.fn().mockResolvedValue([]);
    this.fetchCalendarObjects = vi.fn().mockResolvedValue([]);
    this.fetchSingleObject = vi.fn().mockResolvedValue(null);
    this.createEvent = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    this.updateEvent = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    this.deleteEvent = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  });
  return { CalDAVClient };
});

vi.mock('../config.js', () => ({
  getAccounts: vi.fn().mockResolvedValue([]),
  saveAccount: vi.fn().mockResolvedValue(undefined),
  config: { serviceName: 'test-service', logLevel: 'info' },
}));

vi.mock('../security/keychain.js', () => ({
  saveCredentials: vi.fn().mockResolvedValue(undefined),
  loadCredentials: vi.fn().mockResolvedValue(null),
}));

vi.mock('../security/oauth2.js', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../utils/ical-parser.js', () => ({
  parseICS: vi.fn(),
}));

vi.mock('../utils/ical-generator.js', () => ({
  generateICS: vi.fn().mockReturnValue('BEGIN:VCALENDAR\nEND:VCALENDAR'),
}));

vi.mock('../utils/recurrence-expander.js', () => ({
  expandToBusyPeriods: vi.fn().mockReturnValue([]),
  expandToOccurrences: vi.fn().mockReturnValue([]),
}));

vi.mock('../utils/conflict-detector.js', () => ({
  mergePeriods: vi.fn().mockReturnValue([]),
  detectConflicts: vi.fn().mockReturnValue([]),
  findAvailableSlots: vi.fn().mockReturnValue([]),
  eventTimeToMs: vi.fn((et: { localTime: string }) => new Date(et.localTime).getTime()),
  msToEventTime: vi.fn((ms: number, tzid: string) => ({
    localTime: new Date(ms).toISOString(),
    tzid,
  })),
}));

import { CalendarService } from './calendar.js';
import { CalDAVClient } from '../protocol/caldav.js';
import { getAccounts } from '../config.js';
import { parseICS } from '../utils/ical-parser.js';
import { generateICS } from '../utils/ical-generator.js';
import { expandToBusyPeriods, expandToOccurrences } from '../utils/recurrence-expander.js';
import { mergePeriods, detectConflicts, findAvailableSlots, eventTimeToMs } from '../utils/conflict-detector.js';
import { ValidationError, NetworkError } from '../errors.js';
import type { ParsedEvent, EventTime } from '../types.js';

const MockCalDAVClient = vi.mocked(CalDAVClient);
const mockGetAccounts = vi.mocked(getAccounts);
const mockParseICS = vi.mocked(parseICS);
const mockExpandToBusyPeriods = vi.mocked(expandToBusyPeriods);
const mockExpandToOccurrences = vi.mocked(expandToOccurrences);
const mockDetectConflicts = vi.mocked(detectConflicts);
const mockFindAvailableSlots = vi.mocked(findAvailableSlots);
const mockMergePeriods = vi.mocked(mergePeriods);

// Helpers
function makeParsedEvent(overrides?: Partial<ParsedEvent>): ParsedEvent {
  return {
    uid: 'uid-1',
    summary: 'Test Event',
    description: null,
    location: null,
    start: { localTime: '2025-03-15T09:00:00', tzid: 'America/New_York' },
    end: { localTime: '2025-03-15T10:00:00', tzid: 'America/New_York' },
    rrule: null,
    attendees: [],
    organizer: null,
    raw: 'BEGIN:VCALENDAR...',
    ...overrides,
  };
}

function makeEventTime(localTime: string, tzid = 'UTC'): EventTime {
  return { localTime, tzid };
}

/** Helper: make MockCalDAVClient constructable by assigning all properties of obj to `this` */
function mockClientConstructor(obj: Record<string, any>) {
  return function (this: any) {
    Object.assign(this, obj);
  };
}

/** Helper: make MockCalDAVClient constructable from an array of client objects */
function mockClientSequence(clients: Record<string, any>[]) {
  let idx = 0;
  return function (this: any) {
    Object.assign(this, clients[idx++]);
  };
}

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CalendarService();
  });

  // -------------------------------------------------------------------------
  // initialize()
  // -------------------------------------------------------------------------

  describe('initialize()', () => {
    it('connects all configured accounts', async () => {
      const accounts = [
        { id: 'acc-1', name: 'Work', serverUrl: 'https://caldav1.example.com', authType: 'basic' as const, username: 'u1' },
        { id: 'acc-2', name: 'Personal', serverUrl: 'https://caldav2.example.com', authType: 'basic' as const, username: 'u2' },
      ];
      mockGetAccounts.mockResolvedValue(accounts);

      await service.initialize();

      expect(MockCalDAVClient).toHaveBeenCalledTimes(2);
      expect(service.getConnectedAccountIds()).toEqual(['acc-1', 'acc-2']);
    });

    it('skips accounts that fail to connect without throwing', async () => {
      const accounts = [
        { id: 'good', name: 'Good', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
        { id: 'bad', name: 'Bad', serverUrl: 'https://caldav.fail.com', authType: 'basic' as const, username: 'u' },
      ];
      mockGetAccounts.mockResolvedValue(accounts);

      // Make second client's connect() fail
      let callCount = 0;
      MockCalDAVClient.mockImplementation(function (this: any) {
        callCount++;
        const shouldFail = callCount === 2;
        this.connect = shouldFail
          ? vi.fn().mockRejectedValue(new Error('connection refused'))
          : vi.fn().mockResolvedValue(undefined);
        this.fetchCalendars = vi.fn().mockResolvedValue([]);
        this.fetchCalendarObjects = vi.fn().mockResolvedValue([]);
        this.fetchSingleObject = vi.fn().mockResolvedValue(null);
        this.createEvent = vi.fn();
        this.updateEvent = vi.fn();
        this.deleteEvent = vi.fn();
      });

      await service.initialize(); // should not throw

      expect(service.getConnectedAccountIds()).toEqual(['good']);
    });

    it('handles zero accounts gracefully', async () => {
      mockGetAccounts.mockResolvedValue([]);
      await service.initialize();
      expect(service.getConnectedAccountIds()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // listCalendars()
  // -------------------------------------------------------------------------

  describe('listCalendars()', () => {
    async function initWithClients(clientMap: Record<string, any>) {
      const accounts = Object.keys(clientMap).map((id) => ({
        id,
        name: id,
        serverUrl: `https://${id}.example.com`,
        authType: 'basic' as const,
        username: 'u',
      }));
      mockGetAccounts.mockResolvedValue(accounts);

      const ids = Object.keys(clientMap);
      const clientObjs = ids.map((id) => clientMap[id]);
      MockCalDAVClient.mockImplementation(mockClientSequence(clientObjs) as any);

      await service.initialize();
    }

    it('returns calendars from all accounts', async () => {
      await initWithClients({
        'acc-1': {
          connect: vi.fn(),
          fetchCalendars: vi.fn().mockResolvedValue([
            { url: '/cal/a', displayName: 'Work', syncToken: 'st1' },
          ]),
        },
        'acc-2': {
          connect: vi.fn(),
          fetchCalendars: vi.fn().mockResolvedValue([
            { url: '/cal/b', displayName: 'Personal', syncToken: 'st2' },
          ]),
        },
      });

      const result = await service.listCalendars();
      expect(result).toHaveLength(2);
      expect(result[0]!.accountId).toBe('acc-1');
      expect(result[0]!.displayName).toBe('Work');
      expect(result[1]!.accountId).toBe('acc-2');
    });

    it('filters by accountId', async () => {
      await initWithClients({
        'acc-1': {
          connect: vi.fn(),
          fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/a', displayName: 'Work' }]),
        },
        'acc-2': {
          connect: vi.fn(),
          fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/b', displayName: 'Personal' }]),
        },
      });

      const result = await service.listCalendars('acc-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.accountId).toBe('acc-1');
    });

    it('throws ValidationError for unknown accountId', async () => {
      await initWithClients({
        'acc-1': {
          connect: vi.fn(),
          fetchCalendars: vi.fn().mockResolvedValue([]),
        },
      });

      await expect(service.listCalendars('unknown')).rejects.toThrow(ValidationError);
    });

    it('defaults displayName to "Untitled" when missing', async () => {
      await initWithClients({
        'acc-1': {
          connect: vi.fn(),
          fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/a' }]),
        },
      });

      const result = await service.listCalendars();
      expect(result[0]!.displayName).toBe('Untitled');
    });
  });

  // -------------------------------------------------------------------------
  // listEvents()
  // -------------------------------------------------------------------------

  describe('listEvents()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([
          { url: '/cal/work', displayName: 'Work' },
        ]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();

      return mockClient;
    }

    it('validates start date format', async () => {
      await initSingleAccount();
      await expect(
        service.listEvents('/cal/work', 'not-a-date', '2025-03-31', 'acc-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('validates end date format', async () => {
      await initSingleAccount();
      await expect(
        service.listEvents('/cal/work', '2025-03-01', 'bad-date', 'acc-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when calendar not found', async () => {
      await initSingleAccount();
      await expect(
        service.listEvents('/cal/missing', '2025-03-01', '2025-03-31', 'acc-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('returns expanded occurrences within date range', async () => {
      const mockClient = await initSingleAccount();
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: '/cal/work/ev-1.ics', data: 'BEGIN:VCALENDAR...', etag: '"e1"' },
      ]);
      mockExpandToOccurrences.mockReturnValue([{
        uid: 'ev-1',
        summary: 'Meeting',
        start: { localTime: '2025-03-15T09:00:00', tzid: 'UTC' },
        end: { localTime: '2025-03-15T10:00:00', tzid: 'UTC' },
        isRecurring: false,
      }]);

      const result = await service.listEvents('/cal/work', '2025-03-01', '2025-03-31', 'acc-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.uid).toBe('ev-1');
      expect(result[0]!.summary).toBe('Meeting');
      expect(result[0]!.etag).toBe('"e1"');
      expect(result[0]!.accountId).toBe('acc-1');
      expect(result[0]!.calendarUrl).toBe('/cal/work');
    });

    it('returns empty when expandToOccurrences returns no occurrences', async () => {
      const mockClient = await initSingleAccount();
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: '/cal/work/old.ics', data: 'BEGIN:VCALENDAR...', etag: '"e"' },
      ]);
      mockExpandToOccurrences.mockReturnValue([]);

      const result = await service.listEvents('/cal/work', '2025-03-01', '2025-03-31', 'acc-1');
      expect(result).toHaveLength(0);
    });

    it('expands recurring events into per-occurrence results', async () => {
      const mockClient = await initSingleAccount();
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: '/cal/work/recurring.ics', data: 'BEGIN:VCALENDAR\nRRULE:FREQ=WEEKLY\nEND:VCALENDAR', etag: '"e"' },
      ]);
      mockExpandToOccurrences.mockReturnValue([
        { uid: 'r-1', summary: 'Weekly', start: { localTime: '2025-03-03T09:00:00', tzid: 'UTC' }, end: { localTime: '2025-03-03T10:00:00', tzid: 'UTC' }, isRecurring: true },
        { uid: 'r-1', summary: 'Weekly', start: { localTime: '2025-03-10T09:00:00', tzid: 'UTC' }, end: { localTime: '2025-03-10T10:00:00', tzid: 'UTC' }, isRecurring: true },
      ]);

      const result = await service.listEvents('/cal/work', '2025-03-01', '2025-03-31', 'acc-1');
      expect(result).toHaveLength(2);
      expect(result[0]!.start.localTime).toBe('2025-03-03T09:00:00');
      expect(result[1]!.start.localTime).toBe('2025-03-10T09:00:00');
    });

    it('passes window timestamps to expandToOccurrences', async () => {
      const mockClient = await initSingleAccount();
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: '/cal/work/ev.ics', data: 'ICS-DATA', etag: '"e"' },
      ]);
      mockExpandToOccurrences.mockReturnValue([]);

      await service.listEvents('/cal/work', '2025-03-01T00:00:00', '2025-03-31T00:00:00', 'acc-1');

      expect(mockExpandToOccurrences).toHaveBeenCalledWith(
        'ICS-DATA',
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('skips objects with no data', async () => {
      const mockClient = await initSingleAccount();
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { url: '/cal/work/empty.ics', data: null, etag: '"e"' },
      ]);

      const result = await service.listEvents('/cal/work', '2025-03-01', '2025-03-31', 'acc-1');
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // readEvent()
  // -------------------------------------------------------------------------

  describe('readEvent()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([
          { url: '/cal/work', displayName: 'Work' },
        ]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();
      return mockClient;
    }

    it('returns parsed event and etag', async () => {
      const mockClient = await initSingleAccount();
      const parsed = makeParsedEvent({ uid: 'ev-1', summary: 'Team Sync' });

      mockClient.fetchSingleObject.mockResolvedValue({
        url: '/cal/work/ev-1.ics',
        data: 'BEGIN:VCALENDAR...',
        etag: '"etag-abc"',
      });
      mockParseICS.mockReturnValue(parsed);

      const result = await service.readEvent('/cal/work/ev-1.ics', '/cal/work', 'acc-1');
      expect(result.event.summary).toBe('Team Sync');
      expect(result.etag).toBe('"etag-abc"');
    });

    it('throws ValidationError when event not found', async () => {
      const mockClient = await initSingleAccount();
      mockClient.fetchSingleObject.mockResolvedValue(null);

      await expect(
        service.readEvent('/cal/work/missing.ics', '/cal/work', 'acc-1'),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when calendar not found', async () => {
      await initSingleAccount();
      await expect(
        service.readEvent('/cal/missing/ev.ics', '/cal/missing', 'acc-1'),
      ).rejects.toThrow(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // createEvent() — confirmation flow
  // -------------------------------------------------------------------------

  describe('createEvent()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/work' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();
      return mockClient;
    }

    it('returns preview with confirmationId on first call (no confirmationId)', async () => {
      await initSingleAccount();

      const result = await service.createEvent({
        calendarUrl: '/cal/work',
        summary: 'New Meeting',
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
        accountId: 'acc-1',
      });

      expect('confirmationId' in result).toBe(true);
      const preview = result as any;
      expect(preview.operation).toBe('create');
      expect(preview.preview.summary).toBe('New Meeting');
      expect(preview.expiresIn).toBe('5 minutes');
    });

    it('executes creation when confirmationId is provided', async () => {
      const mockClient = await initSingleAccount();

      // Step 1: get preview
      const preview = await service.createEvent({
        calendarUrl: '/cal/work',
        summary: 'New Meeting',
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
        accountId: 'acc-1',
      });
      const confirmationId = (preview as any).confirmationId;

      // Step 2: confirm
      const result = await service.createEvent({
        calendarUrl: '/cal/work',
        summary: 'New Meeting',
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
        accountId: 'acc-1',
        confirmationId,
      });

      expect((result as any).success).toBe(true);
      expect((result as any).uid).toBeDefined();
      expect(mockClient.createEvent).toHaveBeenCalled();
    });

    it('throws ValidationError for expired/invalid confirmationId', async () => {
      await initSingleAccount();

      await expect(
        service.createEvent({
          calendarUrl: '/cal/work',
          summary: 'Test',
          start: makeEventTime('2025-04-01T10:00:00'),
          end: makeEventTime('2025-04-01T11:00:00'),
          confirmationId: 'invalid-id',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws NetworkError when server rejects creation', async () => {
      const mockClient = await initSingleAccount();
      mockClient.createEvent.mockResolvedValue({ ok: false, status: 500 });

      const preview = await service.createEvent({
        calendarUrl: '/cal/work',
        summary: 'Fail',
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
        accountId: 'acc-1',
      });

      await expect(
        service.createEvent({
          calendarUrl: '/cal/work',
          summary: 'Fail',
          start: makeEventTime('2025-04-01T10:00:00'),
          end: makeEventTime('2025-04-01T11:00:00'),
          accountId: 'acc-1',
          confirmationId: (preview as any).confirmationId,
        }),
      ).rejects.toThrow(NetworkError);
    });
  });

  // -------------------------------------------------------------------------
  // updateEvent() — confirmation flow
  // -------------------------------------------------------------------------

  describe('updateEvent()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/work' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn().mockResolvedValue({
          url: '/cal/work/ev-1.ics',
          data: 'BEGIN:VCALENDAR...',
          etag: '"etag-1"',
        }),
        createEvent: vi.fn(),
        updateEvent: vi.fn().mockResolvedValue({ ok: true, status: 204 }),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();

      mockParseICS.mockReturnValue(makeParsedEvent());
      return mockClient;
    }

    it('returns preview on first call', async () => {
      await initSingleAccount();

      const result = await service.updateEvent({
        eventUrl: '/cal/work/ev-1.ics',
        calendarUrl: '/cal/work',
        etag: '"etag-1"',
        summary: 'Updated Meeting',
        accountId: 'acc-1',
      });

      expect((result as any).confirmationId).toBeDefined();
      expect((result as any).operation).toBe('update');
    });

    it('executes update when confirmationId is provided', async () => {
      const mockClient = await initSingleAccount();

      const preview = await service.updateEvent({
        eventUrl: '/cal/work/ev-1.ics',
        calendarUrl: '/cal/work',
        etag: '"etag-1"',
        summary: 'Updated',
        accountId: 'acc-1',
      });

      const result = await service.updateEvent({
        eventUrl: '/cal/work/ev-1.ics',
        calendarUrl: '/cal/work',
        etag: '"etag-1"',
        summary: 'Updated',
        accountId: 'acc-1',
        confirmationId: (preview as any).confirmationId,
      });

      expect((result as any).success).toBe(true);
      expect(mockClient.updateEvent).toHaveBeenCalled();
    });

    it('throws ValidationError for invalid confirmationId', async () => {
      await initSingleAccount();

      await expect(
        service.updateEvent({
          eventUrl: '/cal/work/ev-1.ics',
          calendarUrl: '/cal/work',
          etag: '"etag-1"',
          confirmationId: 'bad-id',
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // deleteEvent() — confirmation flow
  // -------------------------------------------------------------------------

  describe('deleteEvent()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/work' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn().mockResolvedValue({
          url: '/cal/work/ev-1.ics',
          data: 'BEGIN:VCALENDAR...',
          etag: '"etag-1"',
        }),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn().mockResolvedValue({ ok: true, status: 204 }),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();

      mockParseICS.mockReturnValue(makeParsedEvent({ uid: 'ev-1', summary: 'Delete Me' }));
      return mockClient;
    }

    it('returns preview with event details on first call', async () => {
      await initSingleAccount();

      const result = await service.deleteEvent({
        eventUrl: '/cal/work/ev-1.ics',
        calendarUrl: '/cal/work',
        etag: '"etag-1"',
        accountId: 'acc-1',
      });

      expect((result as any).confirmationId).toBeDefined();
      expect((result as any).operation).toBe('delete');
      expect((result as any).preview.summary).toBe('Delete Me');
    });

    it('executes deletion when confirmationId is provided', async () => {
      const mockClient = await initSingleAccount();

      const preview = await service.deleteEvent({
        eventUrl: '/cal/work/ev-1.ics',
        calendarUrl: '/cal/work',
        etag: '"etag-1"',
        accountId: 'acc-1',
      });

      const result = await service.deleteEvent({
        eventUrl: '/cal/work/ev-1.ics',
        calendarUrl: '/cal/work',
        etag: '"etag-1"',
        accountId: 'acc-1',
        confirmationId: (preview as any).confirmationId,
      });

      expect((result as any).success).toBe(true);
      expect(mockClient.deleteEvent).toHaveBeenCalled();
    });

    it('throws ValidationError for invalid confirmationId', async () => {
      await initSingleAccount();

      await expect(
        service.deleteEvent({
          eventUrl: '/cal/work/ev-1.ics',
          calendarUrl: '/cal/work',
          etag: '"etag-1"',
          confirmationId: 'bad-id',
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // checkConflicts()
  // -------------------------------------------------------------------------

  describe('checkConflicts()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/work' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();
      return mockClient;
    }

    it('returns no conflicts when none exist', async () => {
      await initSingleAccount();
      mockDetectConflicts.mockReturnValue([]);
      mockMergePeriods.mockReturnValue([]);

      const result = await service.checkConflicts({
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
      });

      expect(result.hasConflict).toBe(false);
      expect(result.conflicts).toEqual([]);
    });

    it('returns conflicts when detected', async () => {
      await initSingleAccount();
      const busy = [{ startMs: 1000, endMs: 2000 }];
      mockMergePeriods.mockReturnValue(busy);
      mockDetectConflicts.mockReturnValue(busy);

      const result = await service.checkConflicts({
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
      });

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toEqual(busy);
    });

    it('calls expandToBusyPeriods with excludeAllDay true by default', async () => {
      await initSingleAccount();

      await service.checkConflicts({
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
      });

      expect(mockExpandToBusyPeriods).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Number),
        expect.any(Number),
        { excludeAllDay: true },
      );
    });

    it('passes includeAllDay=true to expandToBusyPeriods when requested', async () => {
      await initSingleAccount();

      await service.checkConflicts({
        start: makeEventTime('2025-04-01T10:00:00'),
        end: makeEventTime('2025-04-01T11:00:00'),
        includeAllDay: true,
      });

      expect(mockExpandToBusyPeriods).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Number),
        expect.any(Number),
        { excludeAllDay: false },
      );
    });
  });

  // -------------------------------------------------------------------------
  // suggestSlots()
  // -------------------------------------------------------------------------

  describe('suggestSlots()', () => {
    async function initSingleAccount() {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/work' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Test', serverUrl: 'https://caldav.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();
      return mockClient;
    }

    it('calls findAvailableSlots with correct parameters', async () => {
      await initSingleAccount();

      const searchStart = makeEventTime('2025-04-01T09:00:00', 'America/New_York');
      await service.suggestSlots({
        durationMinutes: 60,
        searchStart,
        searchDays: 3,
        maxSlots: 3,
        workingHoursStart: 9,
        workingHoursEnd: 17,
      });

      expect(mockFindAvailableSlots).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 60 * 60 * 1000,
          maxSlots: 3,
          workingHoursStart: 9,
          workingHoursEnd: 17,
          slotTzid: 'America/New_York',
        }),
      );
    });

    it('uses default values for optional params', async () => {
      await initSingleAccount();

      await service.suggestSlots({
        durationMinutes: 30,
        searchStart: makeEventTime('2025-04-01T09:00:00'),
      });

      expect(mockFindAvailableSlots).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 30 * 60 * 1000,
          maxSlots: 5, // default
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // _resolveClientForCalendar (tested indirectly)
  // -------------------------------------------------------------------------

  describe('_resolveClientForCalendar (via listEvents)', () => {
    it('finds correct client by searching calendar URLs', async () => {
      const client1 = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/a' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };
      const client2 = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/b' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      const accounts = [
        { id: 'acc-1', name: 'A', serverUrl: 'https://a.example.com', authType: 'basic' as const, username: 'u' },
        { id: 'acc-2', name: 'B', serverUrl: 'https://b.example.com', authType: 'basic' as const, username: 'u' },
      ];
      mockGetAccounts.mockResolvedValue(accounts);

      MockCalDAVClient.mockImplementation(mockClientSequence([client1, client2]) as any);
      await service.initialize();

      // Access calendar from second account without specifying accountId
      await service.listEvents('/cal/b', '2025-03-01', '2025-03-31');

      // client2 should have been used for fetchCalendarObjects
      expect(client2.fetchCalendarObjects).toHaveBeenCalled();
    });

    it('throws ValidationError when calendar not found in any account', async () => {
      const mockClient = {
        connect: vi.fn(),
        fetchCalendars: vi.fn().mockResolvedValue([{ url: '/cal/a' }]),
        fetchCalendarObjects: vi.fn().mockResolvedValue([]),
        fetchSingleObject: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      };

      mockGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'A', serverUrl: 'https://a.example.com', authType: 'basic' as const, username: 'u' },
      ]);
      MockCalDAVClient.mockImplementation(mockClientConstructor(mockClient) as any);
      await service.initialize();

      await expect(
        service.listEvents('/cal/nonexistent', '2025-03-01', '2025-03-31'),
      ).rejects.toThrow(ValidationError);
    });
  });
});
