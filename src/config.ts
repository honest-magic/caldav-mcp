import { z } from 'zod';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export const ACCOUNTS_PATH = path.join(os.homedir(), '.config', 'caldav-mcp', 'accounts.json');

const configSchema = z.object({
  serviceName: z.string().default('ch.honest-magic.config.caldav-server'),
  logLevel: z.string().default('info'),
});

export const config = configSchema.parse({
  serviceName: process.env.SERVICE_NAME,
  logLevel: process.env.LOG_LEVEL,
});

// ---------------------------------------------------------------------------
// Account schema and type
// ---------------------------------------------------------------------------

export const calDAVAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  serverUrl: z.string().url(),
  authType: z.enum(['basic', 'oauth2']),
  username: z.string().min(1),
});

export type CalDAVAccount = z.infer<typeof calDAVAccountSchema>;

// ---------------------------------------------------------------------------
// In-memory cache with fs.watch invalidation
// ---------------------------------------------------------------------------

let cachedAccounts: CalDAVAccount[] | null = null;
let watcherStarted = false;

function startWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  try {
    fs.watch(ACCOUNTS_PATH, () => {
      cachedAccounts = null;
    });
  } catch {
    // File may not exist yet — cache stays null until next read
  }
}

/** @internal — exposed for testing only */
export function resetConfigCache(): void {
  cachedAccounts = null;
  watcherStarted = false;
}

// ---------------------------------------------------------------------------
// Internal disk loader with per-item safeParse
// ---------------------------------------------------------------------------

async function loadAccountsFromDisk(): Promise<CalDAVAccount[]> {
  const raw = await fsPromises.readFile(ACCOUNTS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    console.error('accounts.json must be an array');
    return [];
  }

  const valid: CalDAVAccount[] = [];
  for (const item of parsed) {
    const result = calDAVAccountSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      const id = typeof item?.id === 'string' ? item.id : '(unknown)';
      const fields = result.error.issues.map((i) => i.path.map(String).join('.') || 'root').join(', ');
      console.error(`accounts.json: account "${id}" skipped — invalid fields: ${fields}`);
    }
  }
  return valid;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads account definitions from ~/.config/caldav-mcp/accounts.json.
 * Results are cached in memory; the cache is invalidated when the file changes.
 * Returns an empty array if the file does not exist or cannot be parsed.
 */
export async function getAccounts(): Promise<CalDAVAccount[]> {
  if (cachedAccounts !== null) return cachedAccounts;
  startWatcher();
  try {
    const loaded = await loadAccountsFromDisk();
    cachedAccounts = loaded;
    return loaded;
  } catch {
    return [];
  }
}
