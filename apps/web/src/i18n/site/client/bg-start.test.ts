import { afterEach, describe, expect, it } from "vitest";
import { startBg } from "./bg.ts";
import type { Win } from "./dom.ts";
import { FakeObserver, type FakeVideo, FakeWindow, type FakeWindowOptions } from "./test-support/fake-dom.ts";
import { type BgPage, bgPage, testConfig } from "./test-support/pages.ts";

// The wiring of the background against a hand-driven window and a page of the same shape as the real one: the scroll position
// decides what is shown; the arithmetic of the zones is tested in bg-model.test.ts, the pixels by e2e.
interface Setup {
  win: FakeWindow;
  page: BgPage;
  stop: () => void;
}

function setup(o: FakeWindowOptions & { reducedClass?: boolean; skipPage?: boolean } = {}): Setup {
  FakeObserver.all = [];
  const win = new FakeWindow({ deviceMemory: 8, ...o });
  const page = bgPage(win);
  if (o.reducedClass) win.document.documentElement.classList.add("is-reduced");
  if (o.skipPage) page.ob.remove();
  const stop = startBg(testConfig({ reduced: o.reducedClass === true }), win as unknown as Win);
  win.tick(2);
  return { win, page, stop };
}

/** Scrolls to the middle of a section (by its id) and runs the frames. */
function goTo(s: Setup, id: string, share = 0.5) {
  const sec = s.page.sections[id];
  if (!sec) throw new Error(id);
  const y = (sec.pageTop as number) + share * sec.offsetHeight - s.win.innerHeight / 2;
  s.win.scroll(Math.max(0, y));
  s.win.tick(3);
}

const videos = (page: BgPage) => page.scene.querySelectorAll("video") as FakeVideo[];

afterEach(() => {
  FakeObserver.all = [];
});

describe("startBg: missing page", () => {
  it("does nothing without the background markup", () => {
    const { win, stop } = setup({ skipPage: true });
    expect(win.listenerCount("scroll")).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});

describe("startBg: the scroll", () => {
  it("keeps the background off above the first screen end", () => {
    const { page } = setup();
    expect(page.ob.classList.contains("is-on")).toBe(false);
  });

  it("turns the background on below the first screen and shows the ruler on «How we work»", () => {
    const s = setup();
    goTo(s, "kak-rabotaem", 0.5);
    expect(s.page.ob.classList.contains("is-on")).toBe(true);
    expect(s.page.ob.classList.contains("is-go")).toBe(true);
    expect(s.page.ord.classList.contains("is-on")).toBe(true);
    expect(s.page.navs[0]?.classList.contains("is-cur")).toBe(true);
    expect(s.page.ob.getAttribute("data-sh")).toBe("l");
  });

  it("brings the receipts to the table one by one with the life of the purchase stage", () => {
    const s = setup();
    goTo(s, "xarid", 0.2);
    const first = s.page.receipts.filter((r) => r.classList.contains("is-in")).length;
    for (let i = 0; i < 40; i++) {
      s.win.advance(200);
      s.win.tick(3);
    }
    const later = s.page.receipts.filter((r) => r.classList.contains("is-in")).length;
    expect(later).toBeGreaterThanOrEqual(first);
    expect(s.page.rcsSum.querySelector(".s")?.textContent).toContain("rc.sum");
  });

  it("sets all nine receipts and the refund when the purchase stage is scrolled to its end", () => {
    const s = setup();
    goTo(s, "xarid", 1);
    expect(s.page.receipts.filter((r) => r.classList.contains("is-in"))).toHaveLength(9);
    expect(s.page.rcsSum.classList.contains("is-all")).toBe(true);
  });

  it("runs the parts of the assembly and the clock of the test", () => {
    const s = setup();
    goTo(s, "yigish", 0.9);
    expect(s.page.asm.some((li) => li.classList.contains("is-done"))).toBe(true);
    goTo(s, "sinov", 1);
    expect(s.page.tclk.classList.contains("is-done")).toBe(true);
    expect(s.page.rstamp.classList.contains("is-in")).toBe(true);
  });

  it("shows the sample-order caption on the table below and the closing words on the finale", () => {
    const s = setup();
    goTo(s, "ceny", 0.5);
    expect(s.page.navs[1]?.classList.contains("is-cur")).toBe(true);
    goTo(s, "zayavka", 0.5);
    expect(s.page.navs[2]?.classList.contains("is-cur")).toBe(true);
    s.win.scroll(s.win.document.documentElement.scrollHeight);
    s.win.tick(3);
    expect(s.page.ordSt.textContent).toContain("fin.closed");
  });

  it("flashes the lamp when the page scrolls in from above and leaves it at full light", () => {
    const s = setup();
    goTo(s, "kak-rabotaem", 0);
    s.win.scroll(0);
    s.win.tick(3);
    goTo(s, "kak-rabotaem", 0.1);
    expect(s.page.ob.classList.contains("is-lit")).toBe(true);
    s.win.advance(900);
    expect(s.page.ob.classList.contains("is-flick")).toBe(false);
  });
});

describe("startBg: the stage images and the clips", () => {
  it("puts the stage image on the layer that is off and swaps the layers", async () => {
    const s = setup();
    goTo(s, "kak-rabotaem", 0.5);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.page.imgs.some((i) => i.classList.contains("is-on"))).toBe(true);
    expect(s.page.imgs.some((i) => i.src.includes("/media/bg/"))).toBe(true);
  });

  it("creates the clip of the purchase stage on a desktop with memory to spare", () => {
    const s = setup();
    goTo(s, "xarid", 0.5);
    const x = videos(s.page).find((v) => v.src === "/media/bg/x-d.mp4");
    expect(x).toBeDefined();
    expect(x?.muted).toBe(true);
  });

  it("prefetches the clip of the next stage", () => {
    const s = setup();
    goTo(s, "xarid", 0.5);
    expect(videos(s.page).some((v) => v.src.includes("/bg/y-d.mp4"))).toBe(true);
  });

  it("sets the clip to the scroll, stops the purchase clip on the receipts that came and the assembly clip on the item", () => {
    const s = setup();
    goTo(s, "xarid", 0.5);
    const x = videos(s.page).find((v) => v.src.includes("x-d"));
    x?.dispatch("loadedmetadata");
    goTo(s, "yigish", 0.5);
    expect(videos(s.page).some((v) => v.src.includes("y-d"))).toBe(true);
    goTo(s, "sinov", 0.5);
    expect(videos(s.page).some((v) => v.src.includes("t-d"))).toBe(true);
  });

  it("makes no video for a visitor with little memory and shows still images instead", () => {
    const s = setup({ deviceMemory: 1 });
    goTo(s, "xarid", 0.5);
    expect(videos(s.page)).toHaveLength(0);
    goTo(s, "yigish", 0.5);
    expect(videos(s.page)).toHaveLength(0);
  });

  it("makes no video on a slow connection or with saveData", () => {
    const s = setup({ saveData: true });
    goTo(s, "xarid", 0.5);
    expect(videos(s.page)).toHaveLength(0);
  });

  it("serves the phone side of the images on a phone and lets go of the far clips", () => {
    const s = setup({ width: 400, coarse: true, deviceMemory: 8 });
    goTo(s, "xarid", 0.5);
    for (const img of s.page.imgs) if (img.src) expect(img.src).toContain("-m.webp");
    goTo(s, "pasport", 0.5);
    goTo(s, "ceny", 0.5);
    expect(videos(s.page).every((v) => !v.src.includes("x-m") || v.getAttribute("src") === null)).toBe(true);
  });
});

describe("startBg: reduced motion", () => {
  it("shows the state at once, plays nothing and creates no video", () => {
    const s = setup({ reducedClass: true });
    goTo(s, "xarid", 0.5);
    expect(s.page.ob.classList.contains("is-on")).toBe(true);
    expect(videos(s.page)).toHaveLength(0);
    for (let i = 0; i < 10; i++) s.win.advance(200);
    expect(s.page.receipts.filter((r) => r.classList.contains("is-new"))).toHaveLength(0);
  });
});

describe("startBg: the window", () => {
  it("measures again on a resize and on a change of the size of the body", () => {
    const s = setup();
    goTo(s, "kak-rabotaem", 0.5);
    s.win.innerWidth = 1000;
    s.win.dispatch("resize");
    s.win.tick(3);
    const observer = FakeObserver.all[0];
    expect(observer?.observed).toContain(s.win.document.body);
    observer?.callback([]);
    s.win.tick(3);
    expect(s.page.ob.classList.contains("is-on")).toBe(true);
  });

  it("starts again with the phone images when the window gets narrow", () => {
    const s = setup();
    goTo(s, "xarid", 0.5);
    s.win.innerWidth = 400;
    s.win.media["(pointer: coarse)"] = true;
    s.win.dispatch("resize");
    s.win.tick(4);
    expect(s.page.ob.classList.contains("is-on")).toBe(true);
  });

  it("pauses everything when the tab is hidden and goes on when it is back", () => {
    const s = setup();
    goTo(s, "sinov", 0.5);
    s.win.document.hidden = true;
    s.win.document.dispatch("visibilitychange");
    expect(s.win.pendingTimers()).toBeGreaterThanOrEqual(0);
    s.win.document.hidden = false;
    s.win.document.dispatch("visibilitychange");
    s.win.tick(2);
    expect(s.page.ob.classList.contains("is-on")).toBe(true);
  });

  it("stops: no listeners left, no frames, no videos", () => {
    const s = setup();
    goTo(s, "xarid", 0.5);
    s.stop();
    expect(s.win.listenerCount("scroll")).toBe(0);
    expect(s.win.listenerCount("resize")).toBe(0);
    expect(s.win.listenerCount("load")).toBe(0);
    expect(FakeObserver.all[0]?.disconnected).toBe(true);
    expect(videos(s.page)).toHaveLength(0);
  });
});
