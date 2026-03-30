import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installClaude } from './install-claude.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

describe('installClaude', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('creates new config when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await installClaude('/tmp/config.json', '/usr/bin/caldav-mcp');

    expect(result).toBe('/tmp/config.json');
    expect(mockMkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
    const written = JSON.parse((mockWriteFile.mock.calls[0][1] as string).trim());
    expect(written).toEqual({
      mcpServers: { caldav: { command: '/usr/bin/caldav-mcp' } },
    });
  });

  it('merges into existing config preserving other servers', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ mcpServers: { mail: { command: '/usr/bin/mail-mcp' } } }),
    );

    await installClaude('/tmp/config.json', '/usr/bin/caldav-mcp');

    const written = JSON.parse((mockWriteFile.mock.calls[0][1] as string).trim());
    expect(written.mcpServers.mail).toEqual({ command: '/usr/bin/mail-mcp' });
    expect(written.mcpServers.caldav).toEqual({ command: '/usr/bin/caldav-mcp' });
  });

  it('creates mcpServers key if missing in existing config', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ someOther: true }));

    await installClaude('/tmp/config.json', '/usr/bin/caldav-mcp');

    const written = JSON.parse((mockWriteFile.mock.calls[0][1] as string).trim());
    expect(written.someOther).toBe(true);
    expect(written.mcpServers.caldav).toEqual({ command: '/usr/bin/caldav-mcp' });
  });

  it('overwrites existing caldav entry', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ mcpServers: { caldav: { command: '/old/path' } } }),
    );

    await installClaude('/tmp/config.json', '/new/path');

    const written = JSON.parse((mockWriteFile.mock.calls[0][1] as string).trim());
    expect(written.mcpServers.caldav.command).toBe('/new/path');
  });

  it('throws on malformed JSON in existing config', async () => {
    mockReadFile.mockResolvedValue('not valid json {{{');

    await expect(installClaude('/tmp/config.json', '/usr/bin/caldav-mcp')).rejects.toThrow(
      /Malformed JSON/,
    );
  });

  it('returns the config path', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await installClaude('/some/path/config.json', '/usr/bin/caldav-mcp');
    expect(result).toBe('/some/path/config.json');
  });
});
