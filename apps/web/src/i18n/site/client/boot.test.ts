import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "./boot.ts";
import type { Win } from "./dom.ts";
import { el, FakeWindow, type FakeWindowOptions } from "./test-support/fake-dom.ts";
import { testConfig } from "./test-support/pages.ts";

const calls = vi.hoisted(() => ({ chrome: 0, hero: 0, bg: 0, stops: [] as string[] }));

vi.mock("./chrome.ts", () => ({
  startChrome: () => {
    calls.chrome += 1;
    return () => calls.stops.push("chrome");
  },
}));
vi.mock("./hero.ts", () => ({
  startHero: () => {
    calls.hero += 1;
    return () => calls.stops.push("hero");
  },
}));
vi.mock("./bg.ts", () => ({
  startBg: () => {
    calls.bg += 1;
    return () => calls.stops.push("bg");
  },
}));

// dynamic import() settles in a later macrotask than a promise chain: wait on the real timer
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

function setup(o: FakeWindowOptions & { reducedClass?: boolean; trackBottom?: number | null } = {}) {
  const win = new FakeWindow(o);
  if (o.reducedClass) win.document.documentElement.classList.add("is-reduced");
  if (o.trackBottom !== null) {
    const track = el(win.document, "div", { "data-hero-track": "" });
    track.rect = { ...track.rect, bottom: o.trackBottom ?? 6000 };
  }
  const stop = boot(testConfig(), win as unknown as Win);
  return { win, stop };
}

beforeEach(() => {
  calls.chrome = calls.hero = calls.bg = 0;
  calls.stops = [];
});
afterEach(() => vi.clearAllMocks());

describe("boot", () => {
  it("starts the small things and the first screen at once and the background only when the reader comes near", async () => {
    const { win } = setup();
    await flush();
    expect(calls.chrome).toBe(1);
    expect(calls.hero).toBe(1);
    expect(calls.bg).toBe(0);
    win.dispatch("scroll");
    await flush();
    expect(calls.bg).toBe(0);
  });

  it("starts the background when the end of the first screen is within two windows", async () => {
    const { win } = setup();
    const track = win.document.querySelector("[data-hero-track]");
    if (track) track.rect = { ...track.rect, bottom: 1200 };
    win.dispatch("scroll");
    await flush();
    expect(calls.bg).toBe(1);
    expect(win.listenerCount("scroll")).toBe(0);
  });

  it("starts the background at once when the first screen is already far above", async () => {
    setup({ trackBottom: 100 });
    await flush();
    expect(calls.bg).toBe(1);
  });

  it("starts the background at once when the page has no first-screen track", async () => {
    setup({ trackBottom: null });
    await flush();
    expect(calls.bg).toBe(1);
  });

  it("starts the background at once when the address points to a section", async () => {
    setup({ hash: "#ceny" });
    await flush();
    expect(calls.bg).toBe(1);
  });

  it("starts the background after five seconds even if the reader has not scrolled", async () => {
    const { win } = setup();
    await flush();
    expect(calls.bg).toBe(0);
    win.advance(5001);
    await flush();
    expect(calls.bg).toBe(1);
  });

  it("starts the background only once", async () => {
    const { win } = setup({ hash: "#ceny" });
    win.advance(6000);
    win.dispatch("scroll");
    await flush();
    expect(calls.bg).toBe(1);
  });

  it("does not start the first screen on a page served static, and starts the background at once", async () => {
    setup({ reducedClass: true });
    await flush();
    expect(calls.hero).toBe(0);
    expect(calls.chrome).toBe(1);
    expect(calls.bg).toBe(1);
  });

  it("stops everything it started", async () => {
    const { win, stop } = setup({ hash: "#ceny" });
    await flush();
    stop();
    expect(calls.stops.sort()).toEqual(["bg", "chrome", "hero"]);
    expect(win.pendingTimers()).toBe(0);
  });

  it("stops at once what finishes loading after the stop", async () => {
    const { stop } = setup({ hash: "#ceny" });
    stop();
    await flush();
    expect(calls.stops.sort()).toEqual(["bg", "chrome", "hero"]);
  });
});
