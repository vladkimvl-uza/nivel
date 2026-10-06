// Counts of failed attempts kept in the memory of the process: one admin process serves the site, so a count here is
// seen by every request, and it is decided in one synchronous step (a claim is taken before anything is checked, so
// requests that arrive together cannot check more than the rule allows).
//
// Used for what must not share the counter of the account in the database: a sign-in from one source (an address, for
// one e-mail) and the sensitive changes inside a live session. The counts are lost when the process restarts; that is
// accepted: a restart is not in the hands of whoever guesses, and a count that is gone only gives a fresh series.
//
// A series ends by time: after `windowMs` from its first failure it starts again from zero, so a typo of last week does
// not stand next to four typos of today.

export interface LimiterRule {
  lockAfter: number;
  /** Length of a series and of the lock that ends it. */
  windowMs: number;
}

export type LimiterClaim =
  | { claimed: true; key: string; series: number; count: number; lockedUntil: Date | null }
  | {
      claimed: false;
      lockedUntil: Date;
      /** True at most once a minute per key: the refused attempts of a lock go to the journal, but not without end. */
      journal: boolean;
    };

type Taken = Extract<LimiterClaim, { claimed: true }>;

interface Entry {
  series: number;
  count: number;
  startedAt: number;
  lockedUntil: number;
  lastRefusalJournaled: number;
}

const REFUSAL_JOURNAL_GAP_MS = 60_000;

export class AttemptLimiter {
  private readonly entries = new Map<string, Entry>();
  private nextSeries = 1;

  private readonly rule: LimiterRule;
  /** Bounds the memory: when it is full the oldest series is forgotten. */
  private readonly maxKeys: number;

  constructor(rule: LimiterRule, maxKeys = 10_000) {
    this.rule = rule;
    this.maxKeys = maxKeys;
  }

  /** Takes one attempt. Refused while the lock of the key lasts. */
  claim(key: string, now: Date): LimiterClaim {
    const t = now.getTime();
    let entry = this.entries.get(key);
    if (entry && entry.lockedUntil > t) {
      const journal = t - entry.lastRefusalJournaled >= REFUSAL_JOURNAL_GAP_MS;
      if (journal) entry.lastRefusalJournaled = t;
      return { claimed: false, lockedUntil: new Date(entry.lockedUntil), journal };
    }
    if (!entry || entry.lockedUntil > 0 || t - entry.startedAt >= this.rule.windowMs) {
      this.entries.delete(key);
      if (this.entries.size >= this.maxKeys) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
      entry = { series: this.nextSeries, count: 0, startedAt: t, lockedUntil: 0, lastRefusalJournaled: 0 };
      this.nextSeries += 1;
      this.entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count >= this.rule.lockAfter) entry.lockedUntil = t + this.rule.windowMs;
    return {
      claimed: true,
      key,
      series: entry.series,
      count: entry.count,
      lockedUntil: entry.lockedUntil > 0 ? new Date(entry.lockedUntil) : null,
    };
  }

  /** Forgets the series, but only when nothing was counted in it since the claim. */
  reset(claim: Taken): void {
    const entry = this.entries.get(claim.key);
    if (entry && entry.series === claim.series && entry.count === claim.count) this.entries.delete(claim.key);
  }

  /**
   * Gives back the attempt of a claim whose check cannot tell a guess from the owner (the password alone). Only while
   * nothing was counted after it and the key is not locked: a lock is never lifted by it.
   */
  release(claim: Taken): void {
    const entry = this.entries.get(claim.key);
    if (!entry || entry.series !== claim.series || entry.count !== claim.count || entry.lockedUntil > 0) return;
    entry.count -= 1;
    if (entry.count === 0) this.entries.delete(claim.key);
  }

  isLocked(key: string, now: Date): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.lockedUntil > now.getTime();
  }
}
