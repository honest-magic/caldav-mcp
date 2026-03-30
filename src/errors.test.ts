import { describe, it, expect } from 'vitest';
import {
  CalDAVErrorCode,
  CalDAVMCPError,
  AuthError,
  NetworkError,
  ValidationError,
  ParseError,
  ConflictError,
} from './errors.js';
import type { ETagConflict } from './types.js';

describe('CalDAVErrorCode enum', () => {
  it('has correct values', () => {
    expect(CalDAVErrorCode.AuthError).toBe('AuthError');
    expect(CalDAVErrorCode.NetworkError).toBe('NetworkError');
    expect(CalDAVErrorCode.ValidationError).toBe('ValidationError');
    expect(CalDAVErrorCode.ParseError).toBe('ParseError');
    expect(CalDAVErrorCode.ConflictError).toBe('ConflictError');
  });
});

describe('CalDAVMCPError', () => {
  it('constructs with code and message', () => {
    const err = new CalDAVMCPError(CalDAVErrorCode.AuthError, 'test message');
    expect(err.message).toBe('test message');
    expect(err.code).toBe(CalDAVErrorCode.AuthError);
    expect(err.name).toBe('AuthError');
    expect(err).toBeInstanceOf(Error);
  });

  it('supports error cause chain', () => {
    const cause = new Error('root cause');
    const err = new CalDAVMCPError(CalDAVErrorCode.NetworkError, 'wrapper', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('AuthError', () => {
  it('has correct code and is instanceof CalDAVMCPError', () => {
    const err = new AuthError('invalid credentials');
    expect(err.code).toBe(CalDAVErrorCode.AuthError);
    expect(err.message).toBe('invalid credentials');
    expect(err).toBeInstanceOf(CalDAVMCPError);
    expect(err).toBeInstanceOf(Error);
  });

  it('supports cause option', () => {
    const cause = new Error('underlying');
    const err = new AuthError('auth failed', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('NetworkError', () => {
  it('has correct code and is instanceof CalDAVMCPError', () => {
    const err = new NetworkError('connection refused');
    expect(err.code).toBe(CalDAVErrorCode.NetworkError);
    expect(err).toBeInstanceOf(CalDAVMCPError);
  });
});

describe('ValidationError', () => {
  it('has correct code and is instanceof CalDAVMCPError', () => {
    const err = new ValidationError('invalid input');
    expect(err.code).toBe(CalDAVErrorCode.ValidationError);
    expect(err).toBeInstanceOf(CalDAVMCPError);
  });
});

describe('ParseError', () => {
  it('has correct code and is instanceof CalDAVMCPError', () => {
    const err = new ParseError('bad ical data');
    expect(err.code).toBe(CalDAVErrorCode.ParseError);
    expect(err).toBeInstanceOf(CalDAVMCPError);
  });
});

describe('ConflictError', () => {
  const conflict: ETagConflict = {
    localData: { summary: 'Meeting' },
    serverData: null,
    serverEtag: '"etag-123"',
  };

  it('has correct code and stores conflict data', () => {
    const err = new ConflictError('etag mismatch', conflict);
    expect(err.code).toBe(CalDAVErrorCode.ConflictError);
    expect(err.message).toBe('etag mismatch');
    expect(err.conflict).toBe(conflict);
    expect(err.conflict.serverEtag).toBe('"etag-123"');
  });

  it('is instanceof CalDAVMCPError and Error', () => {
    const err = new ConflictError('conflict', conflict);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toBeInstanceOf(CalDAVMCPError);
    expect(err).toBeInstanceOf(Error);
  });

  it('supports cause option', () => {
    const cause = new Error('fetch failed');
    const err = new ConflictError('conflict', conflict, { cause });
    expect(err.cause).toBe(cause);
  });
});
