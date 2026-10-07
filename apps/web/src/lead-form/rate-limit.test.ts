import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

const DAY = 24 * 60 * 60 * 1000;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("lets a key through limit times in a window and refuses the next one", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 3, windowMs: DAY, now: c.now });
    expect(rl.reserve(["phone:a"])).not.toBeNull();
    expect(rl.reserve(["phone:a"])).not.toBeNull();
    expect(rl.reserve(["phone:a"])).not.toBeNull();
    expect(rl.reserve(["phone:a"])).toBeNull();
    expect(rl.reserve(["phone:b"])).not.toBeNull();
  });

  it("forgets a hit when the window has passed", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(rl.reserve(["k"])).not.toBeNull();
    c.advance(999);
    expect(rl.reserve(["k"])).toBeNull();
    c.advance(1);
    expect(rl.reserve(["k"])).not.toBeNull();
  });

  it("is all or nothing across keys: a refused request uses up nothing", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: DAY, now: c.now });
    expect(rl.reserve(["ip:1"])).not.toBeNull();
    expect(rl.reserve(["phone:x", "ip:1"])).toBeNull();
    // the phone was not charged by the refused request
    expect(rl.reserve(["phone:x"])).not.toBeNull();
  });

  it("gives the place back when the reservation is released", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: DAY, now: c.now });
    const first = rl.reserve(["k"]);
    expect(first).not.toBeNull();
    expect(rl.reserve(["k"])).toBeNull();
    first?.release();
    expect(rl.reserve(["k"])).not.toBeNull();
  });

  it("releases only once", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 2, windowMs: DAY, now: c.now });
    const a = rl.reserve(["k"]);
    rl.reserve(["k"]);
    a?.release();
    a?.release();
    expect(rl.reserve(["k"])).not.toBeNull();
    expect(rl.reserve(["k"])).toBeNull();
  });

  it("counts a repeated key of one request once and ignores empty keys", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 2, windowMs: DAY, now: c.now });
    expect(rl.reserve(["k", "k", ""])).not.toBeNull();
    expect(rl.reserve(["k"])).not.toBeNull();
    expect(rl.reserve(["k"])).toBeNull();
    expect(rl.reserve([])).not.toBeNull();
  });

  it("keeps the memory bounded: the oldest keys go when there are too many", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: DAY, now: c.now, maxKeys: 5 });
    for (let i = 0; i < 20; i++) {
      c.advance(1);
      rl.reserve([`k${i}`]);
    }
    expect(rl.size()).toBeLessThanOrEqual(5);
    // the newest key is still remembered, the oldest was forgotten
    expect(rl.reserve(["k19"])).toBeNull();
    expect(rl.reserve(["k0"])).not.toBeNull();
  });

  it("drops expired keys before it evicts live ones", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now, maxKeys: 3 });
    rl.reserve(["old1"]);
    rl.reserve(["old2"]);
    c.advance(2000);
    rl.reserve(["live1"]);
    rl.reserve(["live2"]);
    rl.reserve(["live3"]);
    expect(rl.reserve(["live1"])).toBeNull();
    expect(rl.reserve(["live2"])).toBeNull();
    expect(rl.reserve(["live3"])).toBeNull();
  });

  it("refuses silly settings", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1.5, windowMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 0 })).toThrow(RangeError);
  });

  it("works with the real clock by default", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: DAY });
    expect(rl.reserve(["real"])).not.toBeNull();
    expect(rl.reserve(["real"])).toBeNull();
  });
});
