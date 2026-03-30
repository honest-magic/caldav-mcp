import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  listCalendarsArgs,
  listEventsArgs,
  readEventArgs,
  parseIcsArgs,
  registerOAuth2Args,
  createEventArgs,
  updateEventArgs,
  deleteEventArgs,
  checkConflictsArgs,
  suggestSlotsArgs,
} from './index.js';

describe('Zod tool argument schemas', () => {
  describe('listCalendarsArgs', () => {
    it('accepts empty args', () => {
      expect(listCalendarsArgs.parse({})).toEqual({});
    });

    it('accepts optional account', () => {
      expect(listCalendarsArgs.parse({ account: 'test' })).toEqual({ account: 'test' });
    });

    it('rejects non-string account', () => {
      expect(() => listCalendarsArgs.parse({ account: 123 })).toThrow(z.ZodError);
    });
  });

  describe('listEventsArgs', () => {
    const valid = { calendarUrl: 'https://cal.example.com/cal/', startDate: '2026-03-30', endDate: '2026-04-05' };

    it('accepts valid args', () => {
      const result = listEventsArgs.parse(valid);
      expect(result.calendarUrl).toBe(valid.calendarUrl);
    });

    it('rejects missing calendarUrl', () => {
      expect(() => listEventsArgs.parse({ startDate: '2026-03-30', endDate: '2026-04-05' })).toThrow(z.ZodError);
    });

    it('rejects missing startDate', () => {
      expect(() => listEventsArgs.parse({ calendarUrl: 'url', endDate: '2026-04-05' })).toThrow(z.ZodError);
    });

    it('rejects non-string startDate', () => {
      expect(() => listEventsArgs.parse({ ...valid, startDate: 12345 })).toThrow(z.ZodError);
    });
  });

  describe('readEventArgs', () => {
    it('accepts valid args', () => {
      const result = readEventArgs.parse({ eventUrl: 'https://x/e.ics', calendarUrl: 'https://x/cal/' });
      expect(result.eventUrl).toBe('https://x/e.ics');
    });

    it('rejects missing eventUrl', () => {
      expect(() => readEventArgs.parse({ calendarUrl: 'url' })).toThrow(z.ZodError);
    });
  });

  describe('parseIcsArgs', () => {
    it('accepts string icsData', () => {
      expect(parseIcsArgs.parse({ icsData: 'BEGIN:VCALENDAR' })).toEqual({ icsData: 'BEGIN:VCALENDAR' });
    });

    it('rejects missing icsData', () => {
      expect(() => parseIcsArgs.parse({})).toThrow(z.ZodError);
    });

    it('rejects non-string icsData', () => {
      expect(() => parseIcsArgs.parse({ icsData: 42 })).toThrow(z.ZodError);
    });
  });

  describe('registerOAuth2Args', () => {
    const valid = {
      accountId: 'google',
      serverUrl: 'https://apidata.googleapis.com/caldav/v2',
      username: 'user@gmail.com',
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rt',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    };

    it('accepts valid args', () => {
      expect(registerOAuth2Args.parse(valid).accountId).toBe('google');
    });

    it('accepts optional name', () => {
      expect(registerOAuth2Args.parse({ ...valid, name: 'My Google' }).name).toBe('My Google');
    });

    it('rejects missing required field', () => {
      const { clientId, ...missing } = valid;
      expect(() => registerOAuth2Args.parse(missing)).toThrow(z.ZodError);
    });
  });

  describe('createEventArgs', () => {
    const valid = {
      calendarUrl: 'https://cal/cal/',
      summary: 'Meeting',
      startDate: '2026-04-01T10:00:00',
      startTzid: 'Europe/Zurich',
      endDate: '2026-04-01T11:00:00',
      endTzid: 'Europe/Zurich',
    };

    it('accepts valid args', () => {
      expect(createEventArgs.parse(valid).summary).toBe('Meeting');
    });

    it('accepts optional fields', () => {
      const result = createEventArgs.parse({ ...valid, description: 'desc', location: 'Room 1' });
      expect(result.description).toBe('desc');
      expect(result.location).toBe('Room 1');
    });

    it('rejects missing summary', () => {
      const { summary, ...missing } = valid;
      expect(() => createEventArgs.parse(missing)).toThrow(z.ZodError);
    });

    it('rejects non-string startTzid', () => {
      expect(() => createEventArgs.parse({ ...valid, startTzid: 123 })).toThrow(z.ZodError);
    });
  });

  describe('updateEventArgs', () => {
    const valid = { eventUrl: 'https://x/e.ics', calendarUrl: 'https://x/cal/', etag: '"abc"' };

    it('accepts minimal args (just required fields)', () => {
      const result = updateEventArgs.parse(valid);
      expect(result.etag).toBe('"abc"');
    });

    it('accepts all optional fields', () => {
      const result = updateEventArgs.parse({
        ...valid,
        summary: 'New title',
        startDate: '2026-04-01T10:00:00',
        startTzid: 'UTC',
        description: null,
        location: 'Room 2',
      });
      expect(result.summary).toBe('New title');
      expect(result.description).toBeNull();
    });

    it('rejects missing etag', () => {
      const { etag, ...missing } = valid;
      expect(() => updateEventArgs.parse(missing)).toThrow(z.ZodError);
    });
  });

  describe('deleteEventArgs', () => {
    it('accepts valid args', () => {
      const result = deleteEventArgs.parse({ eventUrl: 'u', calendarUrl: 'c', etag: '"e"' });
      expect(result.eventUrl).toBe('u');
    });

    it('rejects missing etag', () => {
      expect(() => deleteEventArgs.parse({ eventUrl: 'u', calendarUrl: 'c' })).toThrow(z.ZodError);
    });
  });

  describe('checkConflictsArgs', () => {
    const valid = {
      startDate: '2026-04-01T10:00:00',
      startTzid: 'Europe/Zurich',
      endDate: '2026-04-01T11:00:00',
      endTzid: 'Europe/Zurich',
    };

    it('accepts valid args', () => {
      expect(checkConflictsArgs.parse(valid).startTzid).toBe('Europe/Zurich');
    });

    it('accepts optional calendarUrls array', () => {
      const result = checkConflictsArgs.parse({ ...valid, calendarUrls: ['url1', 'url2'] });
      expect(result.calendarUrls).toEqual(['url1', 'url2']);
    });

    it('accepts optional includeAllDay boolean', () => {
      expect(checkConflictsArgs.parse({ ...valid, includeAllDay: true }).includeAllDay).toBe(true);
    });

    it('rejects non-boolean includeAllDay', () => {
      expect(() => checkConflictsArgs.parse({ ...valid, includeAllDay: 'yes' })).toThrow(z.ZodError);
    });

    it('rejects missing startTzid', () => {
      const { startTzid, ...missing } = valid;
      expect(() => checkConflictsArgs.parse(missing)).toThrow(z.ZodError);
    });
  });

  describe('suggestSlotsArgs', () => {
    const valid = {
      durationMinutes: 60,
      searchStartDate: '2026-04-01T00:00:00',
      searchStartTzid: 'Europe/Zurich',
    };

    it('accepts valid args', () => {
      expect(suggestSlotsArgs.parse(valid).durationMinutes).toBe(60);
    });

    it('accepts all optional fields', () => {
      const result = suggestSlotsArgs.parse({
        ...valid,
        searchDays: 3,
        workingHoursStart: 9,
        workingHoursEnd: 17,
        maxSlots: 10,
        includeAllDay: false,
      });
      expect(result.searchDays).toBe(3);
      expect(result.maxSlots).toBe(10);
    });

    it('rejects non-number durationMinutes', () => {
      expect(() => suggestSlotsArgs.parse({ ...valid, durationMinutes: '60' })).toThrow(z.ZodError);
    });

    it('rejects missing searchStartDate', () => {
      const { searchStartDate, ...missing } = valid;
      expect(() => suggestSlotsArgs.parse(missing)).toThrow(z.ZodError);
    });
  });
});
