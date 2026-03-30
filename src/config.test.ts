import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock node:fs and node:fs/promises before importing config
vi.mock('node:fs', () => ({
  watch: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Import after mocks are set up
import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import {
  calDAVAccountSchema,
  ACCOUNTS_PATH,
  getAccounts,
  resetConfigCache,
  saveAccount,
  removeAccount,
  type CalDAVAccount,
} from './config.js';

const validAccount: CalDAVAccount = {
  id: 'test-1',
  name: 'Test Account',
  serverUrl: 'https://caldav.example.com',
  authType: 'basic',
  username: 'user@example.com',
};

const validAccount2: CalDAVAccount = {
  id: 'test-2',
  name: 'Second Account',
  serverUrl: 'https://caldav2.example.com',
  authType: 'oauth2',
  username: 'user2@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetConfigCache();
});

// ---------------------------------------------------------------------------
// ACCOUNTS_PATH
// ---------------------------------------------------------------------------

describe('ACCOUNTS_PATH', () => {
  it('points to ~/.config/caldav-mcp/accounts.json', () => {
    const expected = path.join(os.homedir(), '.config', 'caldav-mcp', 'accounts.json');
    expect(ACCOUNTS_PATH).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// calDAVAccountSchema
// ---------------------------------------------------------------------------

describe('calDAVAccountSchema', () => {
  it('parses a valid account', () => {
    const result = calDAVAccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = calDAVAccountSchema.safeParse({ id: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = calDAVAccountSchema.safeParse({ ...validAccount, id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL for serverUrl', () => {
    const result = calDAVAccountSchema.safeParse({ ...validAccount, serverUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid authType', () => {
    const result = calDAVAccountSchema.safeParse({ ...validAccount, authType: 'digest' });
    expect(result.success).toBe(false);
  });

  it('accepts oauth2 authType', () => {
    const result = calDAVAccountSchema.safeParse({ ...validAccount, authType: 'oauth2' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAccounts (exercises loadAccountsFromDisk internally)
// ---------------------------------------------------------------------------

describe('getAccounts', () => {
  it('returns parsed accounts from a valid JSON array', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount]));
    const accounts = await getAccounts();
    expect(accounts).toEqual([validAccount]);
  });

  it('returns empty array when file contains empty array', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue('[]');
    const accounts = await getAccounts();
    expect(accounts).toEqual([]);
  });

  it('returns empty array when JSON is not an array', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fsPromises.readFile).mockResolvedValue('{"not": "array"}');
    const accounts = await getAccounts();
    expect(accounts).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('returns empty array when file does not exist', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    vi.mocked(fsPromises.readFile).mockRejectedValue(err);
    const accounts = await getAccounts();
    expect(accounts).toEqual([]);
  });

  it('skips invalid entries and keeps valid ones', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = [validAccount, { id: 'bad', name: '' }]; // second entry invalid (empty name)
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(data));
    const accounts = await getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('test-1');
    consoleSpy.mockRestore();
  });

  it('returns cached value on second call without re-reading', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount]));
    await getAccounts();
    await getAccounts();
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it('re-reads after resetConfigCache', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount]));
    await getAccounts();
    resetConfigCache();
    await getAccounts();
    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// saveAccount
// ---------------------------------------------------------------------------

describe('saveAccount', () => {
  it('creates file when it does not exist', async () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    vi.mocked(fsPromises.readFile).mockRejectedValue(enoent);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    await saveAccount(validAccount);

    expect(fsPromises.mkdir).toHaveBeenCalledWith(
      path.dirname(ACCOUNTS_PATH),
      { recursive: true },
    );
    expect(fsPromises.writeFile).toHaveBeenCalledOnce();
    const written = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
    expect(written).toEqual([validAccount]);
  });

  it('upserts an existing account by id', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount]));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const updated = { ...validAccount, name: 'Updated Name' };
    await saveAccount(updated);

    const written = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('Updated Name');
  });

  it('appends a new account when id does not exist', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount]));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    await saveAccount(validAccount2);

    const written = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
    expect(written).toHaveLength(2);
  });

  it('throws on invalid account data', async () => {
    const bad = { ...validAccount, serverUrl: 'not-a-url' };
    await expect(saveAccount(bad as CalDAVAccount)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// removeAccount
// ---------------------------------------------------------------------------

describe('removeAccount', () => {
  it('removes an existing account and returns true', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount, validAccount2]));
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const result = await removeAccount('test-1');
    expect(result).toBe(true);

    const written = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe('test-2');
  });

  it('returns false for nonexistent account', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify([validAccount]));
    const result = await removeAccount('nonexistent');
    expect(result).toBe(false);
  });

  it('returns false when file does not exist', async () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    vi.mocked(fsPromises.readFile).mockRejectedValue(enoent);
    const result = await removeAccount('test-1');
    expect(result).toBe(false);
  });
});
