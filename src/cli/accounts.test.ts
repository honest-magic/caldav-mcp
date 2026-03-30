import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAccountsCommand } from './accounts.js';

vi.mock('../config.js', () => ({
  getAccounts: vi.fn(),
  saveAccount: vi.fn(),
  removeAccount: vi.fn(),
  ACCOUNTS_PATH: '/mock/.config/caldav-mcp/accounts.json',
}));

vi.mock('../security/keychain.js', () => ({
  saveCredentials: vi.fn(),
  removeCredentials: vi.fn(),
}));

import { getAccounts, removeAccount } from '../config.js';
import { removeCredentials } from '../security/keychain.js';

const mockGetAccounts = vi.mocked(getAccounts);
const mockRemoveAccount = vi.mocked(removeAccount);
const mockRemoveCredentials = vi.mocked(removeCredentials);

describe('handleAccountsCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns false for non-accounts args', async () => {
    expect(await handleAccountsCommand(['--version'])).toBe(false);
    expect(await handleAccountsCommand(['help'])).toBe(false);
    expect(await handleAccountsCommand([])).toBe(false);
  });

  it('returns true for accounts list', async () => {
    mockGetAccounts.mockResolvedValue([]);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await handleAccountsCommand(['accounts', 'list']);
    expect(result).toBe(true);
    consoleSpy.mockRestore();
  });

  it('lists accounts with formatted output', async () => {
    mockGetAccounts.mockResolvedValue([
      { id: 'test', name: 'Test', serverUrl: 'https://cal.example.com', authType: 'basic' as const, username: 'user@test.com' },
    ]);
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => logs.push(msg));

    await handleAccountsCommand(['accounts', 'list']);

    expect(logs.some((l) => l.includes('test'))).toBe(true);
    expect(logs.some((l) => l.includes('https://cal.example.com'))).toBe(true);
    consoleSpy.mockRestore();
  });

  it('lists empty accounts with config path', async () => {
    mockGetAccounts.mockResolvedValue([]);
    const logs: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => logs.push(msg));

    await handleAccountsCommand(['accounts', 'list']);

    expect(logs.some((l) => l.includes('No accounts configured'))).toBe(true);
    consoleSpy.mockRestore();
  });

  it('removes account and keychain entry', async () => {
    mockRemoveAccount.mockResolvedValue(true);
    mockRemoveCredentials.mockResolvedValue();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleAccountsCommand(['accounts', 'remove', 'test-id']);

    expect(mockRemoveAccount).toHaveBeenCalledWith('test-id');
    expect(mockRemoveCredentials).toHaveBeenCalledWith('test-id');
    consoleSpy.mockRestore();
  });

  it('warns but succeeds if keychain removal fails', async () => {
    mockRemoveAccount.mockResolvedValue(true);
    mockRemoveCredentials.mockRejectedValue(new Error('keychain error'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleAccountsCommand(['accounts', 'remove', 'test-id']);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not remove keychain'));
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('exits with error for unknown subcommand', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleAccountsCommand(['accounts', 'unknown'])).rejects.toThrow('exit');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits with error when removing without id', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleAccountsCommand(['accounts', 'remove'])).rejects.toThrow('exit');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits with error when removing nonexistent account', async () => {
    mockRemoveAccount.mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleAccountsCommand(['accounts', 'remove', 'nope'])).rejects.toThrow('exit');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
