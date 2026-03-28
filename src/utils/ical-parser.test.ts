import { describe, it, expect } from 'vitest';
import { parseICS } from './ical-parser.js';
import { ParseError } from '../errors.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_TIMEZONE_EVENT = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test-123@example.com
SUMMARY:Team Meeting
DESCRIPTION:Weekly sync
LOCATION:Conference Room A
DTSTART;TZID=America/New_York:20240315T090000
DTEND;TZID=America/New_York:20240315T100000
ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:alice@example.com
ATTENDEE;CN=Bob;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:bob@example.com
ORGANIZER;CN=Alice:mailto:alice@example.com
RRULE:FREQ=WEEKLY;BYDAY=FR
END:VEVENT
END:VCALENDAR`;

const FIXTURE_UTC_EVENT = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:utc-456@example.com
SUMMARY:UTC Event
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
END:VEVENT
END:VCALENDAR`;

const FIXTURE_ALL_DAY_EVENT = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:allday-789@example.com
SUMMARY:All Day Event
DTSTART;VALUE=DATE:20240315
DTEND;VALUE=DATE:20240316
END:VEVENT
END:VCALENDAR`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseICS', () => {
  describe('Test 1: Timezone preservation', () => {
    it('parses DTSTART;TZID=America/New_York and preserves timezone', () => {
      const result = parseICS(FIXTURE_TIMEZONE_EVENT);
      expect(result.start.tzid).toBe('America/New_York');
      expect(result.start.localTime).toContain('2024-03-15T09:00:00');
    });
  });

  describe('Test 2: All-day event', () => {
    it('returns date-only string for VALUE=DATE events', () => {
      const result = parseICS(FIXTURE_ALL_DAY_EVENT);
      expect(result.start.localTime).toContain('2024-03-15');
      // All-day events should not have a time component
      expect(result.start.localTime).not.toContain('T');
    });
  });

  describe('Test 3: Attendees', () => {
    it('extracts attendees with cn, role, and partstat', () => {
      const result = parseICS(FIXTURE_TIMEZONE_EVENT);
      expect(result.attendees).toHaveLength(2);

      const alice = result.attendees.find((a) => a.email === 'alice@example.com');
      expect(alice).toBeDefined();
      expect(alice!.cn).toBe('Alice');
      expect(alice!.role).toBe('REQ-PARTICIPANT');
      expect(alice!.partstat).toBe('ACCEPTED');

      const bob = result.attendees.find((a) => a.email === 'bob@example.com');
      expect(bob).toBeDefined();
      expect(bob!.cn).toBe('Bob');
      expect(bob!.role).toBe('OPT-PARTICIPANT');
      expect(bob!.partstat).toBe('NEEDS-ACTION');
    });
  });

  describe('Test 4: Organizer', () => {
    it('extracts organizer with email and cn', () => {
      const result = parseICS(FIXTURE_TIMEZONE_EVENT);
      expect(result.organizer).not.toBeNull();
      expect(result.organizer!.email).toBe('alice@example.com');
      expect(result.organizer!.cn).toBe('Alice');
    });

    it('returns null organizer when absent', () => {
      const result = parseICS(FIXTURE_UTC_EVENT);
      expect(result.organizer).toBeNull();
    });
  });

  describe('Test 5: RRULE extraction', () => {
    it('extracts RRULE string when present', () => {
      const result = parseICS(FIXTURE_TIMEZONE_EVENT);
      expect(result.rrule).not.toBeNull();
      expect(result.rrule).toContain('FREQ=WEEKLY');
    });

    it('returns null rrule when absent', () => {
      const result = parseICS(FIXTURE_UTC_EVENT);
      expect(result.rrule).toBeNull();
    });
  });

  describe('Test 6: Description and location', () => {
    it('extracts description and location when present', () => {
      const result = parseICS(FIXTURE_TIMEZONE_EVENT);
      expect(result.description).toBe('Weekly sync');
      expect(result.location).toBe('Conference Room A');
    });

    it('returns null for description and location when absent', () => {
      const result = parseICS(FIXTURE_UTC_EVENT);
      expect(result.description).toBeNull();
      expect(result.location).toBeNull();
    });
  });

  describe('Test 7: Error handling', () => {
    it('throws ParseError on empty input', () => {
      expect(() => parseICS('')).toThrow(ParseError);
    });

    it('throws ParseError on invalid ICS data', () => {
      expect(() => parseICS('this is not valid ics data')).toThrow(ParseError);
    });
  });

  describe('Test 8: Raw ICS preservation', () => {
    it('preserves the raw ICS string in output', () => {
      const result = parseICS(FIXTURE_TIMEZONE_EVENT);
      expect(result.raw).toBe(FIXTURE_TIMEZONE_EVENT);
    });
  });

  describe('Test 9: UTC times', () => {
    it('handles UTC times (Z suffix) and assigns tzid UTC', () => {
      const result = parseICS(FIXTURE_UTC_EVENT);
      expect(result.start.tzid).toBe('UTC');
      expect(result.start.localTime).toContain('2024-03-15T14:00:00');
    });
  });
});
