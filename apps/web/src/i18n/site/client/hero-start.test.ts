import { afterEach, describe, expect, it } from "vitest";
import type { Win } from "./dom.ts";
import { startHero } from "./hero.ts";
import { FakeObserver, type FakeVideo, FakeWindow, type FakeWindowOptions } from "./test-support/fake-dom.ts";
import { type HeroPage, heroPage, scrollHeroTo, testConfig } from "./test-support/pages.ts";

// The wiring of the first screen against a hand-driven window: the scroll writes the captions and the posters, the clip is
// fetched on the first sign of life, a poster-only page never makes a video. Pixels and frames are checked by e2e.
interface Setup {
  win: FakeWindow;
  page: HeroPage;
  stop: () => void;
}

function setup(
  o: FakeWindowOptions & { reducedClass?: boolean; noPage?: boolean; posterZeroSrc?: string } = {},
): Setup {
  FakeObserver.all = [];
  const win = new FakeWindow(o);
  const page = heroPage(win, o.posterZeroSrc === undefined ? {} : { posterZeroSrc: o.posterZeroSrc });
  if (o.noPage) page.root.remove();
  if (o.reducedClass) win.document.documentElement.classList.add("is-reduced");
  const stop = startHero(testConfig(), win as unknown as Win);
  return { win, page, stop };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const video = (page: HeroPage) => page.media.querySelector("video") as FakeVideo | null;

afterEach(() => {
  FakeObserver.all = [];
});

describe("startHero: pages that stay static", () => {
  it("does nothing when the page has no first screen", () => {
    const { win, stop } = setup({ noPage: true });
    expect(win.listenerCount("scroll")).toBe(0);
    expect(() => stop()).not.toThrow();
  });

  it("does nothing on a page served static (is-reduced)", () => {
    const { win, page } = setup({ reducedClass: true });
    expect(win.listenerCount("scroll")).toBe(0);
    expect(page.caps.some((c) => c.classList.contains("is-on"))).toBe(false);
  });

  it("does nothing when the visitor asks for reduced motion", () => {
    const { win } = setup({ reduce: true });
    expect(win.listenerCount("scroll")).toBe(0);
  });
});

describe("startHero: the scroll", () => {
  it("shows the first caption and the first poster at the top", () => {
    const { page } = setup();
    expect(page.caps[0]?.classList.contains("is-on")).toBe(true);
    expect(page.posters[0]?.classList.contains("is-on")).toBe(true);
    expect(page.posters[0]?.src).toContain("/media/posters/");
    expect(page.stepsNow.textContent).toBe("01 / 04 · Tanlov");
  });

  it("moves the captions, the step and the poster with the scroll", () => {
    const { win, page } = setup();
    scrollHeroTo(win, page, 0.42);
    expect(page.caps[2]?.classList.contains("is-on")).toBe(true);
    expect(page.hdoc.classList.contains("is-on")).toBe(true);
    expect(page.steps.map((s) => s.classList.contains("is-on"))).toEqual([true, true, false, false]);
    expect(page.posters[1]?.classList.contains("is-on")).toBe(true);
    expect(page.stepsNow.textContent).toBe("02 / 04 · Smeta");
    scrollHeroTo(win, page, 0.9);
    expect(page.caps[4]?.classList.contains("is-on")).toBe(true);
    expect(page.steps.every((s) => s.classList.contains("is-on"))).toBe(true);
  });

  it("answers many scroll events with one frame", () => {
    const { win, page } = setup();
    page.track.rect = { ...page.track.rect, top: -1000, bottom: 4200 };
    win.dispatch("scroll");
    win.dispatch("scroll");
    win.dispatch("scroll");
    win.tick();
    expect(page.stepsNow.textContent).toMatch(/^0\d \/ 04/);
  });

  it("keeps the poster of the first step that the server already wrote", () => {
    const { page } = setup({ posterZeroSrc: "/media/server-poster.webp" });
    expect(page.posters[0]?.src).toBe("/media/server-poster.webp");
  });

  it("darkens the stage at the end of the track", () => {
    const { win, page } = setup();
    scrollHeroTo(win, page, 1);
    expect(page.off.style.opacity).toBe("1");
  });

  it("takes the other poster size when the window grows past the breakpoint and forgets the old addresses", () => {
    const { win, page } = setup({ width: 400, dpr: 1, coarse: true });
    const small = page.posters[0]?.src;
    scrollHeroTo(win, page, 0.42);
    expect(page.posters[1]?.src).toBeTruthy();
    win.innerWidth = 1920;
    win.devicePixelRatio = 1;
    win.media["(pointer: coarse)"] = false;
    win.dispatch("resize");
    win.tick();
    expect(page.posters[1]?.src).not.toBe("");
    expect(page.posters[1]?.src).toContain("/media/posters/");
    expect(small).toBeTruthy();
  });

  it("only redraws when the window changed but the size class did not", () => {
    const { win, page } = setup();
    const before = page.posters[1]?.src ?? "";
    win.innerWidth = 1500;
    win.dispatch("resize");
    win.tick();
    expect(page.posters[1]?.src ?? "").toBe(before);
  });
});

describe("startHero: the clip", () => {
  it("makes no video before the first sign of life or the idle moment", () => {
    const { page } = setup();
    expect(video(page)).toBeNull();
  });

  it("fetches the clip into memory on the first scroll and sets it on the video", async () => {
    const { win, page } = setup();
    win.dispatch("scroll");
    await flush();
    const v = video(page);
    expect(v).not.toBeNull();
    expect(win.fetches[0]).toContain("nivel-night-brand-");
    expect(v?.src).toMatch(/^blob:/);
    expect(v?.muted).toBe(true);
    expect(v?.getAttribute("playsinline")).toBe("");
    expect(v?.loads).toBeGreaterThan(0);
  });

  it("makes the video once, also when the idle callback comes after a sign of life", async () => {
    const { win, page } = setup();
    win.dispatch("wheel");
    win.dispatch("scroll");
    win.advance(3000);
    await flush();
    expect(page.media.querySelectorAll("video")).toHaveLength(1);
  });

  it("makes the video when the browser is idle", async () => {
    const { win, page } = setup();
    win.advance(10);
    await flush();
    expect(video(page)).not.toBeNull();
  });

  it("scrubs: after the metadata the target time is sought and the clip is shown over the poster", async () => {
    const { win, page } = setup();
    win.dispatch("scroll");
    await flush();
    const v = video(page) as FakeVideo;
    v.duration = 8;
    scrollHeroTo(win, page, 0.5);
    v.dispatch("loadedmetadata");
    win.tick(3);
    expect(v.seeks.length).toBeGreaterThan(0);
    v.drawFrame();
    win.tick(2);
    expect(v.classList.contains("is-ready")).toBe(true);
  });

  it("settles on the nearest stop of the magnet when the scroll rests", async () => {
    const { win, page } = setup();
    win.dispatch("scroll");
    await flush();
    const v = video(page) as FakeVideo;
    v.duration = 8;
    v.dispatch("loadedmetadata");
    scrollHeroTo(win, page, 0.3);
    win.tick(3);
    const seeks = v.seeks.length;
    win.advance(200);
    win.tick(30);
    expect(v.seeks.length).toBeGreaterThanOrEqual(seeks);
  });

  it("asks for the next seek after the seeked event when the frame callback does not come", async () => {
    const { win, page } = setup();
    win.dispatch("scroll");
    await flush();
    const v = video(page) as FakeVideo;
    v.duration = 8;
    v.dispatch("loadedmetadata");
    scrollHeroTo(win, page, 0.6);
    win.tick(3);
    v.dispatch("seeked");
    win.advance(50);
    win.tick(3);
    expect(v.classList.contains("is-ready")).toBe(true);
  });

  it("wakes the decoder of a phone with play() and pauses it again", async () => {
    const { win, page } = setup({ coarse: true, width: 400 });
    win.dispatch("scroll");
    await flush();
    const v = video(page) as FakeVideo;
    v.dispatch("loadedmetadata");
    await flush();
    expect(v.paused).toBe(true);
  });

  it("falls back to the posters when the video fails", async () => {
    const { win, page } = setup();
    win.dispatch("scroll");
    await flush();
    const v = video(page) as FakeVideo;
    v.classList.add("is-ready");
    v.dispatch("error");
    expect(v.classList.contains("is-ready")).toBe(false);
    expect(page.posters[0]?.classList.contains("is-on")).toBe(true);
  });

  it("sets the address of the file itself when the fetch fails", async () => {
    const { win, page } = setup();
    win.fetch = async () => {
      throw new Error("offline");
    };
    win.dispatch("scroll");
    await flush();
    expect(video(page)?.src).toBe("/media/nivel-night-brand-1280.mp4");
  });

  it("sets the address of the file itself when the answer is not ok", async () => {
    const { win, page } = setup();
    win.fetch = async () => ({ ok: false, blob: async () => ({ size: 0 }) });
    win.dispatch("scroll");
    await flush();
    expect(video(page)?.src).toBe("/media/nivel-night-brand-1280.mp4");
  });

  it("does not start a video on a slow connection and keeps to the posters", async () => {
    const { win, page } = setup({ effectiveType: "3g" });
    win.dispatch("scroll");
    await flush();
    expect(video(page)).toBeNull();
    scrollHeroTo(win, page, 0.4);
    expect(page.posters[1]?.src).toContain("/media/posters/");
    // a page of posters loads the next poster in advance
    expect(page.posters[2]?.src).toContain("/media/posters/");
  });

  it("lets a phone drop the clip when the first screen is far above, and takes it back on the way up", async () => {
    const { win, page } = setup({ coarse: true, width: 400 });
    win.dispatch("scroll");
    await flush();
    const v = video(page) as FakeVideo;
    expect(v.getAttribute("src")).toBeTruthy();
    page.track.rect = { ...page.track.rect, top: -9000, bottom: -3800 };
    win.dispatch("scroll");
    win.tick();
    expect(v.getAttribute("src")).toBeNull();
    page.track.rect = { ...page.track.rect, top: -500, bottom: 4700 };
    win.dispatch("scroll");
    win.tick();
    await flush();
    expect(v.getAttribute("src")).toBeTruthy();
  });

  it("changes the clip for the new size after a resize", async () => {
    const { win, page } = setup({ width: 1000, dpr: 1 });
    win.dispatch("scroll");
    await flush();
    const first = win.fetches[0];
    win.innerWidth = 1920;
    win.devicePixelRatio = 2;
    win.dispatch("resize");
    win.tick();
    await flush();
    expect(win.fetches.length).toBe(2);
    expect(win.fetches[1]).not.toBe(first);
    expect(win.revoked.length).toBeGreaterThan(0);
    expect(video(page)).not.toBeNull();
  });

  it("uses the address of the file when the window has no fetch", async () => {
    const { win, page } = setup();
    (win as unknown as { fetch: unknown }).fetch = undefined;
    win.dispatch("scroll");
    await flush();
    expect(video(page)?.src).toBe("/media/nivel-night-brand-1280.mp4");
  });
});

describe("startHero: stopping", () => {
  it("takes off the listeners, the timers and the video", async () => {
    const { win, page, stop } = setup();
    win.dispatch("scroll");
    await flush();
    stop();
    expect(win.listenerCount("scroll")).toBe(0);
    expect(win.listenerCount("resize")).toBe(0);
    expect(video(page)).toBeNull();
    expect(win.pendingTimers()).toBe(0);
  });

  it("stops before the idle moment without leaving the timer", () => {
    const { win, stop } = setup();
    stop();
    expect(win.pendingTimers()).toBe(0);
  });

  it("works on a browser without requestIdleCallback", async () => {
    FakeObserver.all = [];
    const win = new FakeWindow();
    (win as unknown as { requestIdleCallback: unknown }).requestIdleCallback = undefined;
    const page = heroPage(win);
    const stop = startHero(testConfig(), win as unknown as Win);
    win.advance(1300);
    await flush();
    expect(video(page)).not.toBeNull();
    stop();
    expect(win.pendingTimers()).toBe(0);
  });
});
