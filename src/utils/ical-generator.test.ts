import { describe, it, expect } from 'vitest';
import { generateICS } from './ical-generator.js';
import { parseICS } from './ical-parser.js';

const BASE_START = { localTime: '2024-03-15T09:00:00', tzid: 'America/New_York' };
const BASE_END = { localTime: '2024-03-15T10:00:00', tzid: 'America/New_York' };

describe('generateICS', () => {
  describe('basic structure', () => {
    it('produces a string starting with BEGIN:VCALENDAR', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    });

    it('produces a string ending with END:VCALENDAR', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    });

    it('contains VERSION:2.0', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toContain('VERSION:2.0');
    });

    it('contains PRODID', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toContain('PRODID');
    });

    it('contains BEGIN:VEVENT and END:VEVENT', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('END:VEVENT');
    });

    it('contains DTSTAMP', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toContain('DTSTAMP');
    });

    it('contains the provided SUMMARY', () => {
      const ics = generateICS({ summary: 'Team Meeting', start: BASE_START, end: BASE_END });
      expect(ics).toContain('SUMMARY:Team Meeting');
    });
  });

  describe('UID handling', () => {
    it('uses provided UID when given', () => {
      const ics = generateICS({ uid: 'my-uid-123', summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toContain('UID:my-uid-123');
    });

    it('auto-generates a UUID when uid is omitted', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toMatch(/UID:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    });
  });

  describe('timezone handling', () => {
    it('IANA timezone: DTSTART contains TZID parameter', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).toMatch(/DTSTART;TZID=America\/New_York/);
    });

    it('UTC timezone: DTSTART value ends with Z', () => {
      const start = { localTime: '2024-03-15T14:00:00', tzid: 'UTC' };
      const end = { localTime: '2024-03-15T15:00:00', tzid: 'UTC' };
      const ics = generateICS({ summary: 'Test', start, end });
      expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
      expect(ics).not.toContain('DTSTART;TZID=UTC');
    });

    it('floating timezone: DTSTART has no TZID parameter and no Z suffix', () => {
      const start = { localTime: '2024-03-15T09:00:00', tzid: 'floating' };
      const end = { localTime: '2024-03-15T10:00:00', tzid: 'floating' };
      const ics = generateICS({ summary: 'Test', start, end });
      expect(ics).not.toContain('DTSTART;TZID=floating');
      expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
      expect(ics).toMatch(/DTSTART:\d{8}T\d{6}[^Z]/);
    });
  });

  describe('optional fields', () => {
    it('includes DESCRIPTION when provided', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END, description: 'A description' });
      expect(ics).toContain('DESCRIPTION:A description');
    });

    it('omits DESCRIPTION when null', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END, description: null });
      expect(ics).not.toContain('DESCRIPTION');
    });

    it('omits DESCRIPTION when undefined', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END });
      expect(ics).not.toContain('DESCRIPTION');
    });

    it('includes LOCATION when provided', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END, location: 'Conference Room' });
      expect(ics).toContain('LOCATION:Conference Room');
    });

    it('omits LOCATION when null', () => {
      const ics = generateICS({ summary: 'Test', start: BASE_START, end: BASE_END, location: null });
      expect(ics).not.toContain('LOCATION');
    });
  });

  describe('round-trip with parseICS', () => {
    it('parse(generate(params)) preserves UID, summary, and start', () => {
      const params = {
        uid: 'round-trip-uid',
        summary: 'Round Trip Event',
        start: BASE_START,
        end: BASE_END,
      };
      const ics = generateICS(params);
      const parsed = parseICS(ics);
      expect(parsed.uid).toBe('round-trip-uid');
      expect(parsed.summary).toBe('Round Trip Event');
      expect(parsed.start.localTime).toBe('2024-03-15T09:00:00');
      expect(parsed.start.tzid).toBe('America/New_York');
    });

    it('round-trip preserves UTC timezone', () => {
      const start = { localTime: '2024-03-15T14:00:00', tzid: 'UTC' };
      const end = { localTime: '2024-03-15T15:00:00', tzid: 'UTC' };
      const ics = generateICS({ uid: 'utc-uid', summary: 'UTC Event', start, end });
      const parsed = parseICS(ics);
      expect(parsed.uid).toBe('utc-uid');
      expect(parsed.start.tzid).toBe('UTC');
    });
  });
});
