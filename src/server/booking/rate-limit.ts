export interface RateLimiter {
  /** Counts one request from `key`. False when `key` has already made `limit` requests within the window (this one is not counted). */
  take(key: string): boolean;
  /** Forgets everyone. For the test server's reset. */
  reset(): void;
}

/**
 * At most `limit` requests per key within any window of `windowMs` (a sliding window).
 * The keys are client addresses, which a caller can keep changing, so only `maxKeys` are remembered:
 * past that, the key that has gone longest without a request is forgotten first.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }): RateLimiter {
  /** Each key's allowed requests that are still inside the window. The Map's first key is always the least recently used. */
  const hits = new Map<string, number[]>();
  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(t);
      hits.delete(key);
      if (recent.length > 0) hits.set(key, recent);
      for (const oldest of hits.keys()) {
        if (hits.size <= maxKeys) break;
        hits.delete(oldest);
      }
      return allowed;
    },
    reset() { hits.clear(); },
  };
}
