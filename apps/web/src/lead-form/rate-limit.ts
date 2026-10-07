// A fixed-size memory limiter for the request form: at most `limit` requests per key in a sliding window. It lives in the
// memory of the site process (one process in production, ARCHITECTURE 12.1); a restart forgets it, which only helps a
// person. The persistent limiter of ARCHITECTURE 10.1 needs a table that the site role may write: a request to the
// integrator (see the report of WP-16).

export interface RateLimiterOptions {
  /** How many requests one key may make in the window. */
  limit: number;
  windowMs: number;
  /** The clock in milliseconds; tests inject their own. */
  now?: () => number;
  /** Upper bound of remembered keys: the oldest are forgotten first, so a flood of keys cannot grow the memory. */
  maxKeys?: number;
}

/** A place taken in the window of every key of one request. */
export interface Reservation {
  /** Gives the place back (the request did not happen after all); calling it twice does nothing more. */
  release(): void;
}

export interface RateLimiter {
  /** Takes a place for every key at once, or none and returns null when any key has used its limit. */
  reserve(keys: readonly string[]): Reservation | null;
  /** Number of remembered keys. */
  size(): number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(o: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = o;
  const maxKeys = o.maxKeys ?? DEFAULT_MAX_KEYS;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a whole number of at least 1");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("windowMs must be positive");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError("maxKeys must be a whole number of at least 1");
  const now = o.now ?? Date.now;
  const hits = new Map<string, number[]>();

  /** Hits of a key that are still inside the window (the stored list is trimmed on the way). */
  function live(key: string, at: number): number[] {
    const list = hits.get(key);
    if (!list) return [];
    const from = at - windowMs;
    while (list.length > 0 && (list[0] as number) <= from) list.shift();
    if (list.length === 0) hits.delete(key);
    return list;
  }

  function trim(at: number): void {
    if (hits.size <= maxKeys) return;
    for (const key of [...hits.keys()]) live(key, at);
    if (hits.size <= maxKeys) return;
    const byLastHit = [...hits.entries()].sort(
      (a, b) => (a[1][a[1].length - 1] as number) - (b[1][b[1].length - 1] as number),
    );
    for (const [key] of byLastHit.slice(0, hits.size - maxKeys)) hits.delete(key);
  }

  return {
    reserve(keys) {
      const at = now();
      const unique = [...new Set(keys.filter((k) => k !== ""))];
      if (unique.some((k) => live(k, at).length >= limit)) return null;
      for (const k of unique) {
        const list = hits.get(k);
        if (list) list.push(at);
        else hits.set(k, [at]);
      }
      trim(at);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          for (const k of unique) {
            const list = hits.get(k);
            if (!list) continue;
            const i = list.lastIndexOf(at);
            if (i >= 0) list.splice(i, 1);
            if (list.length === 0) hits.delete(k);
          }
        },
      };
    },
    size: () => hits.size,
  };
}
