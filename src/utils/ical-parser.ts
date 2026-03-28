import ICAL from 'ical.js';
import type { ParsedEvent, Attendee, EventTime } from '../types.js';
import { ParseError } from '../errors.js';

// ---------------------------------------------------------------------------
// Helper: extract timezone-preserving EventTime from an ICAL.Time value
// ---------------------------------------------------------------------------

function extractEventTime(vevent: ICAL.Component, propName: string): EventTime | null {
  const prop = vevent.getFirstProperty(propName);
  if (!prop) return null;

  const time = prop.getFirstValue() as ICAL.Time | null;
  if (!time) return null;

  // Preserve timezone: NEVER call .toJSDate() as that collapses timezone info
  //
  // ical.js Time object structure:
  //   time.timezone — string TZID set when TZID param present (e.g. "America/New_York")
  //   time.zone.tzid — fallback string: "UTC" for Z-suffix times, "floating" for no-TZ
  //
  // We read the string properties directly via type cast since ical.js types are incomplete.
  const t = time as unknown as { timezone?: string; zone?: { tzid?: string } };
  const tzid: string = t.timezone ?? t.zone?.tzid ?? 'floating';

  // toString() returns the local time string (e.g. "2024-03-15T09:00:00")
  // Strip trailing Z if present to get consistent localTime format
  const rawTime = time.toString();
  const localTime = rawTime.endsWith('Z') ? rawTime.slice(0, -1) : rawTime;

  return { localTime, tzid };
}

// ---------------------------------------------------------------------------
// Helper: extract attendee data from an ICAL.Property
// ---------------------------------------------------------------------------

function extractAttendee(prop: ICAL.Property): Attendee {
  const value = prop.getFirstValue() as string;
  const email = typeof value === 'string' ? value.replace(/^mailto:/i, '') : String(value);
  // getParameter returns string | string[] — take first string only
  const cnRaw = prop.getParameter('cn');
  const roleRaw = prop.getParameter('role');
  const partstatRaw = prop.getParameter('partstat');
  const cn = Array.isArray(cnRaw) ? (cnRaw[0] ?? null) : (cnRaw ?? null);
  const role = Array.isArray(roleRaw) ? (roleRaw[0] ?? null) : (roleRaw ?? null);
  const partstat = Array.isArray(partstatRaw) ? (partstatRaw[0] ?? null) : (partstatRaw ?? null);
  return { email, cn, role, partstat };
}

// ---------------------------------------------------------------------------
// Public: parseICS
// ---------------------------------------------------------------------------

export function parseICS(raw: string): ParsedEvent {
  if (!raw || typeof raw !== 'string') {
    throw new ParseError('Invalid ICS input: empty or not a string');
  }

  let jcal: unknown;
  try {
    jcal = ICAL.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ParseError(`Failed to parse ICS data: ${msg}`, { cause: err });
  }

  const comp = new ICAL.Component(jcal as string | unknown[]);
  const vevent = comp.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new ParseError('No VEVENT component found in ICS data');
  }

  const event = new ICAL.Event(vevent);

  // UID and summary
  const uid = event.uid ?? '';
  const summary = event.summary ?? '';

  // Description and location
  const description = vevent.getFirstPropertyValue('description') as string | null ?? null;
  const location = vevent.getFirstPropertyValue('location') as string | null ?? null;

  // Start and end times — timezone-preserving
  const start = extractEventTime(vevent, 'dtstart');
  if (!start) {
    throw new ParseError('VEVENT missing required DTSTART property');
  }
  const end = extractEventTime(vevent, 'dtend');

  // RRULE extraction
  const rruleProp = vevent.getFirstProperty('rrule');
  let rrule: string | null = null;
  if (rruleProp) {
    const rruleValue = rruleProp.getFirstValue();
    rrule = rruleValue ? rruleValue.toString() : null;
  }

  // Attendees
  const attendeeProps = vevent.getAllProperties('attendee');
  const attendees: Attendee[] = attendeeProps.map(extractAttendee);

  // Organizer
  const organizerProp = vevent.getFirstProperty('organizer');
  const organizer: Attendee | null = organizerProp ? extractAttendee(organizerProp) : null;

  return {
    uid,
    summary,
    description,
    location,
    start,
    end,
    rrule,
    attendees,
    organizer,
    raw,
  };
}
