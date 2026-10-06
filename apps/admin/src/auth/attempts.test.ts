import { describe, expect, it } from "vitest";
import { AttemptLimiter } from "./attempts.ts";

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
});
