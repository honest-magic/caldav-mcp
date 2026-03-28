import { describe, it, expect, beforeEach } from 'vitest';
import { ConfirmationStore, CONFIRMATION_TTL_MS } from './confirmation-store.js';

describe('ConfirmationStore', () => {
  let store: ConfirmationStore;

  beforeEach(() => {
    store = new ConfirmationStore();
  });

  it('exports CONFIRMATION_TTL_MS as 5 minutes in ms', () => {
    expect(CONFIRMATION_TTL_MS).toBe(5 * 60 * 1000);
  });

  describe('create()', () => {
    it('returns a UUID string', () => {
      const id = store.create('testTool', { foo: 'bar' });
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('increments size after create', () => {
      expect(store.size).toBe(0);
      store.create('tool1', {});
      expect(store.size).toBe(1);
      store.create('tool2', {});
      expect(store.size).toBe(2);
    });

    it('stores a deep copy of args (mutation after create does not affect stored copy)', () => {
      const args = { key: 'original' };
      const id = store.create('tool', args);
      args.key = 'mutated';
      const confirmation = store.consume(id);
      expect(confirmation?.args.key).toBe('original');
    });
  });

  describe('consume()', () => {
    it('returns the PendingConfirmation and removes it from store', () => {
      const id = store.create('myTool', { param: 1 });
      expect(store.size).toBe(1);
      const result = store.consume(id);
      expect(result).toBeDefined();
      expect(result?.toolName).toBe('myTool');
      expect(result?.args).toEqual({ param: 1 });
      expect(store.size).toBe(0);
    });

    it('returns undefined for unknown IDs', () => {
      const result = store.consume('unknown-id');
      expect(result).toBeUndefined();
    });

    it('returns undefined on second consume (token already used)', () => {
      const id = store.create('tool', {});
      const first = store.consume(id);
      expect(first).toBeDefined();
      const second = store.consume(id);
      expect(second).toBeUndefined();
    });

    it('returns undefined for expired tokens', async () => {
      const shortTTL = 50; // 50ms TTL for test
      const shortStore = new ConfirmationStore(shortTTL);
      const id = shortStore.create('tool', {});
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = shortStore.consume(id);
      expect(result).toBeUndefined();
    });

    it('removes expired token from store (size decrements on eviction)', async () => {
      const shortTTL = 50;
      const shortStore = new ConfirmationStore(shortTTL);
      shortStore.create('tool', {});
      expect(shortStore.size).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 100));
      // Consume triggers lazy eviction
      shortStore.consume('any-id');
      expect(shortStore.size).toBe(0);
    });
  });

  describe('PendingConfirmation shape', () => {
    it('stores toolName, args, createdAt, ttlMs', () => {
      const before = Date.now();
      const id = store.create('myTool', { x: 42 });
      const after = Date.now();
      const result = store.consume(id);
      expect(result?.toolName).toBe('myTool');
      expect(result?.args).toEqual({ x: 42 });
      expect(result?.createdAt).toBeGreaterThanOrEqual(before);
      expect(result?.createdAt).toBeLessThanOrEqual(after);
      expect(result?.ttlMs).toBe(CONFIRMATION_TTL_MS);
    });

    it('stores custom ttlMs when constructed with custom TTL', () => {
      const customStore = new ConfirmationStore(1000);
      const id = customStore.create('tool', {});
      const result = customStore.consume(id);
      expect(result?.ttlMs).toBe(1000);
    });
  });
});
