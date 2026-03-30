import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock keychain before importing module under test
vi.mock('./keychain.js', () => ({
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
}));

import { getValidAccessToken } from './oauth2.js';
import { loadCredentials, saveCredentials } from './keychain.js';
import { AuthError } from '../errors.js';

const mockLoadCredentials = vi.mocked(loadCredentials);
const mockSaveCredentials = vi.mocked(saveCredentials);

describe('getValidAccessToken', () => {
  const accountId = 'test-account';
  const baseTokens = {
    clientId: 'client-123',
    clientSecret: 'secret-456',
    refreshToken: 'refresh-789',
    tokenUrl: 'https://oauth.example.com/token',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws AuthError when no credentials found', async () => {
    mockLoadCredentials.mockResolvedValue(null);
    await expect(getValidAccessToken(accountId)).rejects.toThrow(AuthError);
  });

  it('returns plaintext password when JSON parse fails', async () => {
    mockLoadCredentials.mockResolvedValue('plain-password-string');
    const result = await getValidAccessToken(accountId);
    expect(result).toBe('plain-password-string');
  });

  it('returns plaintext data when OAuth2 fields are missing', async () => {
    const data = JSON.stringify({ someField: 'value' });
    mockLoadCredentials.mockResolvedValue(data);
    const result = await getValidAccessToken(accountId);
    expect(result).toBe(data);
  });

  it('returns cached access token when not expired', async () => {
    const tokens = {
      ...baseTokens,
      accessToken: 'cached-access-token',
      expiryDate: Date.now() + 120_000, // 2 minutes from now
    };
    mockLoadCredentials.mockResolvedValue(JSON.stringify(tokens));

    const result = await getValidAccessToken(accountId);
    expect(result).toBe('cached-access-token');
    // Should not call fetch since token is valid
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('refreshes token when within 60-second expiry buffer', async () => {
    const tokens = {
      ...baseTokens,
      accessToken: 'old-token',
      expiryDate: Date.now() + 30_000, // 30 seconds from now (within 60s buffer)
    };
    mockLoadCredentials.mockResolvedValue(JSON.stringify(tokens));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
      }),
    });

    const result = await getValidAccessToken(accountId);
    expect(result).toBe('new-access-token');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      baseTokens.tokenUrl,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refreshes token when no accessToken exists', async () => {
    mockLoadCredentials.mockResolvedValue(JSON.stringify(baseTokens));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access-token',
        expires_in: 7200,
      }),
    });

    const result = await getValidAccessToken(accountId);
    expect(result).toBe('fresh-access-token');
    expect(mockSaveCredentials).toHaveBeenCalledWith(
      accountId,
      expect.stringContaining('fresh-access-token'),
    );
  });

  it('saves updated tokens including new expiryDate after refresh', async () => {
    mockLoadCredentials.mockResolvedValue(JSON.stringify(baseTokens));

    const beforeRefresh = Date.now();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        expires_in: 3600,
      }),
    });

    await getValidAccessToken(accountId);

    const savedJson = JSON.parse(
      mockSaveCredentials.mock.calls[0]![1] as string,
    );
    expect(savedJson.accessToken).toBe('new-token');
    expect(savedJson.expiryDate).toBeGreaterThanOrEqual(
      beforeRefresh + 3600 * 1000 - 1000,
    );
  });

  it('updates refreshToken when server provides a rotated one', async () => {
    mockLoadCredentials.mockResolvedValue(JSON.stringify(baseTokens));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        expires_in: 3600,
        refresh_token: 'rotated-refresh-token',
      }),
    });

    await getValidAccessToken(accountId);

    const savedJson = JSON.parse(
      mockSaveCredentials.mock.calls[0]![1] as string,
    );
    expect(savedJson.refreshToken).toBe('rotated-refresh-token');
  });

  it('throws AuthError when token refresh HTTP request fails', async () => {
    mockLoadCredentials.mockResolvedValue(JSON.stringify(baseTokens));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(getValidAccessToken(accountId)).rejects.toThrow(AuthError);
    await expect(getValidAccessToken(accountId)).rejects.toThrow(
      /Failed to refresh token.*400.*invalid_grant/,
    );
  });

  it('handles missing expires_in in response (no expiryDate set)', async () => {
    mockLoadCredentials.mockResolvedValue(JSON.stringify(baseTokens));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'token-no-expiry',
        // no expires_in
      }),
    });

    const result = await getValidAccessToken(accountId);
    expect(result).toBe('token-no-expiry');

    const savedJson = JSON.parse(
      mockSaveCredentials.mock.calls[0]![1] as string,
    );
    // expiryDate should remain undefined since expires_in was missing
    expect(savedJson.expiryDate).toBeUndefined();
  });

  it('sends correct form-encoded body to token endpoint', async () => {
    mockLoadCredentials.mockResolvedValue(JSON.stringify(baseTokens));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok' }),
    });
    globalThis.fetch = mockFetch;

    await getValidAccessToken(accountId);

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe(baseTokens.tokenUrl);
    expect(opts.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = opts.body as URLSearchParams;
    expect(body.get('client_id')).toBe(baseTokens.clientId);
    expect(body.get('client_secret')).toBe(baseTokens.clientSecret);
    expect(body.get('refresh_token')).toBe(baseTokens.refreshToken);
    expect(body.get('grant_type')).toBe('refresh_token');
  });
});
