// Counts of failed attempts kept in the memory of the process: one admin process serves the site, so a count here is
// seen by every request, and it is decided in one synchronous step (a claim is taken before anything is checked, so
// requests that arrive together cannot check more than the rule allows).
//
// Used for what must not share the counter of the account in the database: a sign-in from one source (an address, for
// one e-mail), all the sign-ins of one address over all e-mails, and the sensitive changes inside a live session. The counts are lost when the process restarts; that is
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
  /** Bounds the memory: when it is full one series is forgotten (see `evict`). */
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
      if (this.entries.size >= this.maxKeys) this.evict(t);
      entry = { series: this.nextSeries, count: 0, startedAt: t, lockedUntil: 0, lastRefusalJournaled: 0 };
      this.nextSeries += 1;
      this.entries.set(key, entry);
    } else {
      // The map is kept in the order of use: the key just used goes to the end.
      this.entries.delete(key);
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

  /**
   * Makes room for one key. A series that has ended goes first (it would start again from zero anyway). Then the
   * series that is not locked and has the fewest failures, the one used longest ago among equals: whoever fills the map
   * with keys of one failure each cannot push out a series that has four. A lock goes last (the one that ends first):
   * forgetting it would let the source in before its time.
   */
  private evict(t: number): void {
    let fewest: { key: string; count: number } | undefined;
    let soonest: { key: string; until: number } | undefined;
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil > t) {
        if (!soonest || entry.lockedUntil < soonest.until) soonest = { key, until: entry.lockedUntil };
      } else if (entry.lockedUntil > 0 || t - entry.startedAt >= this.rule.windowMs) {
        this.entries.delete(key);
        return;
      } else if (!fewest || entry.count < fewest.count) {
        fewest = { key, count: entry.count };
      }
    }
    const victim = fewest?.key ?? soonest?.key;
    if (victim !== undefined) this.entries.delete(victim);
  }

  isLocked(key: string, now: Date): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.lockedUntil > now.getTime();
  }
}

/**
 * Lets a journal entry through at most once per `gapMs` per key. For the failures that nobody owns (an e-mail without
 * an account, a refusal of a locked account): the journal only grows, so a flood must not write a row per request.
 */
export class JournalGate {
  private readonly last = new Map<string, number>();
  private readonly gapMs: number;
  private readonly maxKeys: number;

  constructor(gapMs = REFUSAL_JOURNAL_GAP_MS, maxKeys = 10_000) {
    this.gapMs = gapMs;
    this.maxKeys = maxKeys;
  }

  get size(): number {
    return this.last.size;
  }

  allow(key: string, now: Date): boolean {
    const t = now.getTime();
    const before = this.last.get(key);
    if (before !== undefined && t - before < this.gapMs) return false;
    this.last.delete(key);
    if (this.last.size >= this.maxKeys) {
      const oldest = this.last.keys().next();
      if (!oldest.done) this.last.delete(oldest.value);
    }
    this.last.set(key, t);
    return true;
  }
}
