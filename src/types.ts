// Timezone-preserving event time — NEVER use Date objects for output
export interface EventTime {
  localTime: string;   // e.g. "2024-03-15T09:00:00"
  tzid: string;        // IANA zone e.g. "America/New_York"
}

export interface ParsedEvent {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: EventTime;
  end: EventTime | null;
  rrule: string | null;
  attendees: Attendee[];
  organizer: Attendee | null;
  raw: string;
}

export interface Attendee {
  email: string;
  cn: string | null;
  role: string | null;
  partstat: string | null;
}

export interface CalendarSummary {
  url: string;
  displayName: string;
  ctag: string | null;
  syncToken: string | null;
  accountId: string;
}

export interface EventSummary {
  uid: string;
  url: string;
  etag: string | null;
  summary: string;
  start: EventTime;
  end: EventTime | null;
  accountId: string;
  calendarUrl: string;
}

// Credential types stored in keychain (JSON-encoded)
export interface BasicCredentials {
  password: string;
}

export interface OAuth2Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  tokenUrl: string;
}

export interface WritePreview {
  confirmationId: string;
  expiresIn: string;
  operation: 'create' | 'update' | 'delete';
  preview: {
    summary: string;
    calendarUrl: string;
    start?: string;
    end?: string;
    attendees?: string[];
  };
  warning?: string;
}

export interface ETagConflict {
  localData: Record<string, unknown>;
  serverData: ParsedEvent | null;
  serverEtag: string | null;
}
