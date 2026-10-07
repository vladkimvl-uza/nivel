import { describe, expect, it } from "vitest";
import { AttemptLimiter, JournalGate } from "./attempts.ts";

const T0 = new Date("2026-10-06T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const rule = { lockAfter: 3, windowMs: 60_000 };

function take(limiter: AttemptLimiter, key: string, now = T0) {
  const claim = limiter.claim(key, now);
  if (!claim.claimed) throw new Error("expected a claim");
  return claim;
}

describe("AttemptLimiter", () => {
  it("locks at the count and refuses until the window has passed, then starts from one", () => {
    const l = new AttemptLimiter(rule);
    take(l, "k");
    take(l, "k");
    expect(take(l, "k").lockedUntil).toEqual(at(60_000));
    expect(l.claim("k", at(59_999))).toMatchObject({ claimed: false, lockedUntil: at(60_000) });
    expect(take(l, "k", at(60_000))).toMatchObject({ count: 1, lockedUntil: null });
  });

  it("keys do not touch each other", () => {
    const l = new AttemptLimiter(rule);
    for (let i = 0; i < 3; i += 1) take(l, "a");
    expect(take(l, "b").count).toBe(1);
  });

  it("a series ends by time even without a lock", () => {
    const l = new AttemptLimiter(rule);
    take(l, "k");
    take(l, "k");
    expect(take(l, "k", at(60_000)).count).toBe(1);
  });

  it("reset and release work only while nothing was counted after the claim", () => {
    const l = new AttemptLimiter(rule);
    const first = take(l, "k");
    take(l, "k");
    l.reset(first);
    l.release(first);
    expect(take(l, "k").count).toBe(3);

    const m = new AttemptLimiter(rule);
    const one = take(m, "k");
    m.release(one);
    expect(take(m, "k").count).toBe(1);
    const two = take(m, "k");
    m.reset(two);
    expect(take(m, "k").count).toBe(1);
  });

  it("release never lifts a lock", () => {
    const l = new AttemptLimiter(rule);
    take(l, "k");
    take(l, "k");
    const last = take(l, "k");
    l.release(last);
    expect(l.isLocked("k", at(1))).toBe(true);
  });

  it("an old claim cannot reset a newer series of the same key", () => {
    const l = new AttemptLimiter(rule);
    const old = take(l, "k");
    take(l, "k", at(60_000)); // the old series ended by time, a new one has count 1 as well
    l.reset(old);
    expect(take(l, "k", at(60_001)).count).toBe(2);
  });

  it("asks for a journal entry for refusals at most once a minute per key", () => {
    const l = new AttemptLimiter(rule, 10);
    for (let i = 0; i < 3; i += 1) take(l, "k");
    const flags = [0, 1_000, 30_000, 59_000].map((ms) => {
      const c = l.claim("k", at(ms));
      return c.claimed ? null : c.journal;
    });
    expect(flags).toEqual([true, false, false, false]);
  });

  it("forgets the oldest key when the memory bound is reached", () => {
    const l = new AttemptLimiter(rule, 3);
    for (const key of ["a", "b", "c", "d"]) take(l, key);
    // "a" was forgotten: its count starts again, "d" kept its own.
    expect(take(l, "a").count).toBe(1);
    expect(take(l, "d").count).toBe(2);
  });

  it("evicts a series that has ended before one that is alive", () => {
    const l = new AttemptLimiter(rule, 3);
    take(l, "old"); // ends by time
    take(l, "a", at(50_000));
    take(l, "a", at(50_000));
    take(l, "b", at(61_000));
    take(l, "c", at(61_000)); // full: "old" is over, so it goes, "a" keeps its two
    expect(take(l, "a", at(61_000)).count).toBe(3);
  });

  it("never frees a lock to make room while a series that is not locked can go", () => {
    const l = new AttemptLimiter(rule, 3);
    for (let i = 0; i < 3; i += 1) take(l, "locked");
    take(l, "b");
    take(l, "c");
    for (let i = 0; i < 50; i += 1) take(l, `flood-${i}`);
    expect(l.isLocked("locked", at(1))).toBe(true);
    expect(l.claim("locked", at(1)).claimed).toBe(false);
  });

  it("keeps the series that has the most failures when the keys are many", () => {
    const l = new AttemptLimiter(rule, 4);
    take(l, "guessed");
    take(l, "guessed");
    for (let i = 0; i < 500; i += 1) take(l, `flood-${i}`);
    expect(take(l, "guessed").lockedUntil).not.toBeNull(); // the third failure: its count of two was not forgotten
  });

  it("among series with the same count forgets the one used longest ago", () => {
    const l = new AttemptLimiter(rule, 3);
    for (const key of ["a", "b", "c"]) take(l, key);
    take(l, "d"); // forgets "a" (one failure, the longest unused)
    take(l, "b"); // b: two failures now, and the most recent use
    take(l, "e"); // forgets "c", not "b"
    expect(take(l, "b").lockedUntil).not.toBeNull();
    expect(take(l, "c").count).toBe(1);
  });

  it("when every series is locked forgets the one whose lock ends first", () => {
    const l = new AttemptLimiter(rule, 2);
    for (let i = 0; i < 3; i += 1) take(l, "early", at(0));
    for (let i = 0; i < 3; i += 1) take(l, "late", at(10_000));
    take(l, "new", at(20_000));
    expect(l.isLocked("late", at(20_000))).toBe(true);
    expect(l.isLocked("early", at(20_000))).toBe(false);
  });
});

describe("JournalGate", () => {
  it("lets one entry through per key per gap", () => {
    const g = new JournalGate(60_000);
    expect([0, 1_000, 59_999, 60_000, 60_001].map((ms) => g.allow("k", at(ms)))).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(g.allow("other", at(1_000))).toBe(true);
  });

  it("is bounded in memory", () => {
    const g = new JournalGate(60_000, 3);
    for (let i = 0; i < 100; i += 1) g.allow(`k-${i}`, at(0));
    expect(g.size).toBeLessThanOrEqual(3);
  });
});
