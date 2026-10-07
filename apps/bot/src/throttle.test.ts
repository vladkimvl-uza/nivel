import { describe, expect, it } from "vitest";
import { createThrottle } from "./throttle.ts";

describe("the limit of updates from one person", () => {
  it("lets a burst through, then one in a second", () => {
    let t = 0;
    const th = createThrottle({ burst: 3, perSecond: 1, now: () => t });
    expect([1, 2, 3].map(() => th.take("a"))).toEqual(["ok", "ok", "ok"]);
    expect(th.take("a")).toBe("notice");
    expect(th.take("a")).toBe("drop");
    t = 500;
    expect(th.take("a")).toBe("drop");
    t = 1000;
    expect(th.take("a")).toBe("ok");
    expect(th.take("a")).toBe("drop");
  });

  it("people do not take each other's turn", () => {
    const th = createThrottle({ burst: 1, perSecond: 1, now: () => 0 });
    expect(th.take("a")).toBe("ok");
    expect(th.take("a")).not.toBe("ok");
    expect(th.take("b")).toBe("ok");
  });

  it("tells a person that he is too quick once in the notice period, not at every update", () => {
    let t = 0;
    const th = createThrottle({ burst: 1, perSecond: 0.001, noticeEveryMs: 30_000, now: () => t });
    th.take("a");
    expect(th.take("a")).toBe("notice");
    t = 29_000;
    expect(th.take("a")).toBe("drop");
    t = 30_001;
    expect(th.take("a")).toBe("notice");
  });

  it("the bucket never holds more than the burst, however long the person was silent", () => {
    let t = 0;
    const th = createThrottle({ burst: 2, perSecond: 1, now: () => t });
    th.take("a");
    t = 3_600_000;
    expect([th.take("a"), th.take("a"), th.take("a")]).toEqual(["ok", "ok", "notice"]);
  });

  it("forgets the people whose bucket is full again when there are very many", () => {
    let t = 0;
    const th = createThrottle({ burst: 1, perSecond: 1, now: () => t });
    for (let i = 0; i < 10_000; i += 1) th.take(`u${i}`);
    expect(th.size).toBe(10_000);
    t = 5_000;
    th.take("new");
    expect(th.size).toBe(1);
  });
});
