// How often one person may write to the bot (ARCHITECTURE 10.1: «бот — 1 обновление в секунду от пользователя»). A bucket
// of tokens per Telegram id: it holds a burst (a person taps through a menu quickly) and is refilled at a steady pace.
// What does not fit is dropped before the database is touched. One process, so the buckets live in memory.

export interface ThrottleOptions {
  /** The most updates in a burst. */
  burst: number;
  /** The refill, updates per second. */
  perSecond: number;
  /** How rarely a person who is over the limit is told so, ms. */
  noticeEveryMs?: number;
  now?: () => number;
}

export type Verdict = "ok" | "drop" | "notice";

export interface Throttle {
  /** `ok`: handle it; `drop`: silently skip; `notice`: skip and say «not so often» (once in a while). */
  take(key: string): Verdict;
  readonly size: number;
}

const MAX_KEYS = 10_000;

export function createThrottle(o: ThrottleOptions): Throttle {
  const now = o.now ?? (() => Date.now());
  const noticeEvery = o.noticeEveryMs ?? 30_000;
  const buckets = new Map<string, { tokens: number; at: number; noticedAt: number }>();

  const refilled = (b: { tokens: number; at: number }, at: number) =>
    Math.min(o.burst, b.tokens + ((at - b.at) / 1000) * o.perSecond);

  return {
    get size() {
      return buckets.size;
    },
    take(key) {
      const at = now();
      if (buckets.size >= MAX_KEYS) {
        // Whoever has a full bucket is as good as new: forget them.
        for (const [k, b] of buckets) if (refilled(b, at) >= o.burst) buckets.delete(k);
      }
      const known = buckets.get(key);
      const tokens = known === undefined ? o.burst : refilled(known, at);
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at, noticedAt: known?.noticedAt ?? Number.NEGATIVE_INFINITY });
        return "ok";
      }
      const noticedAt = known?.noticedAt ?? Number.NEGATIVE_INFINITY;
      const notice = at - noticedAt >= noticeEvery;
      buckets.set(key, { tokens, at, noticedAt: notice ? at : noticedAt });
      return notice ? "notice" : "drop";
    },
  };
}
