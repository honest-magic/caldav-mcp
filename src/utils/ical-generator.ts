import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import type { EventTime } from '../types.js';

export interface GenerateICSParams {
  uid?: string;          // auto-generated via randomUUID() if omitted
  summary: string;
  start: EventTime;
  end: EventTime;
  description?: string | null;
  location?: string | null;
}

// NOTE: VTIMEZONE components are intentionally omitted per Phase 2 RESEARCH.md open question #1.
// Most target providers (iCloud, Google Calendar, Fastmail) accept events without VTIMEZONE blocks.
// A future iteration can add VTIMEZONE support if provider compatibility issues are found.

/**
 * Generate a VCALENDAR iCal string from the provided event parameters.
 * Handles three timezone modes:
 *   - IANA (e.g. "America/New_York"): adds TZID parameter to DTSTART/DTEND
 *   - "UTC": adds Z suffix to time value (no TZID parameter)
 *   - "floating": no TZID parameter, no Z suffix
 */
export function generateICS(params: GenerateICSParams): string {
  const vcalendar = new ICAL.Component('vcalendar');
  vcalendar.addPropertyWithValue('version', '2.0');
  vcalendar.addPropertyWithValue('prodid', '-//honest-magic//caldav-mcp//EN');

  const vevent = new ICAL.Component('vevent');

  // UID
  vevent.addPropertyWithValue('uid', params.uid ?? randomUUID());

  // DTSTAMP — current UTC time (Z suffix required by RFC 5545)
  const dtstamp = ICAL.Time.now();
  dtstamp.zone = ICAL.Timezone.utcTimezone;
  vevent.addPropertyWithValue('dtstamp', dtstamp);

  // SUMMARY
  vevent.addPropertyWithValue('summary', params.summary);

  // DTSTART
  const dtstart = buildICALTime(params.start);
  const dtstartProp = new ICAL.Property('dtstart');
  applyTimeToProperty(dtstartProp, dtstart, params.start.tzid);
  vevent.addProperty(dtstartProp);

  // DTEND
  const dtend = buildICALTime(params.end);
  const dtendProp = new ICAL.Property('dtend');
  applyTimeToProperty(dtendProp, dtend, params.end.tzid);
  vevent.addProperty(dtendProp);

  // Optional: DESCRIPTION
  if (params.description != null) {
    vevent.addPropertyWithValue('description', params.description);
  }

  // Optional: LOCATION
  if (params.location != null) {
    vevent.addPropertyWithValue('location', params.location);
  }

  vcalendar.addSubcomponent(vevent);
  return vcalendar.toString();
}

/**
 * Build an ICAL.Time from an EventTime, handling UTC and floating modes.
 */
function buildICALTime(eventTime: EventTime): ICAL.Time {
  const time = ICAL.Time.fromDateTimeString(eventTime.localTime);
  if (eventTime.tzid === 'UTC') {
    // Assign the UTC timezone object so ical.js emits the Z suffix
    time.zone = ICAL.Timezone.utcTimezone;
  }
  // For 'floating' and IANA zones: leave time as-is (TZID set via property parameter below)
  return time;
}

/**
 * Set the time value on a property, adding TZID parameter for IANA zones.
 */
function applyTimeToProperty(prop: ICAL.Property, time: ICAL.Time, tzid: string): void {
  if (tzid !== 'UTC' && tzid !== 'floating') {
    // IANA timezone: set TZID parameter on the property
    prop.setParameter('tzid', tzid);
  }
  prop.setValue(time);
}
