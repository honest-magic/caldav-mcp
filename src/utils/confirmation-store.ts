import { randomUUID } from 'node:crypto';

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface PendingConfirmation {
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
  ttlMs: number;
}

export class ConfirmationStore {
  private readonly store = new Map<string, PendingConfirmation>();
  private readonly ttlMs: number;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? CONFIRMATION_TTL_MS;
  }

  create(toolName: string, args: Record<string, unknown>): string {
    const id = randomUUID();
    this.store.set(id, {
      toolName,
      args: structuredClone(args),
      createdAt: Date.now(),
      ttlMs: this.ttlMs,
    });
    return id;
  }

  consume(id: string): PendingConfirmation | undefined {
    const entry = this.store.get(id);

    // Unknown ID
    if (!entry) {
      // Lazy eviction: sweep expired entries while we're here
      this._evictExpired();
      return undefined;
    }

    // Expired?
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.store.delete(id);
      this._evictExpired();
      return undefined;
    }

    // Valid — consume (remove) and return
    this.store.delete(id);
    return entry;
  }

  get size(): number {
    return this.store.size;
  }

  private _evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}
