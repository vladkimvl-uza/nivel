import { afterEach, describe, expect, it } from "vitest";
import { startChrome } from "./chrome.ts";
import type { Win } from "./dom.ts";
import { el, FakeObserver, FakeWindow, type FakeWindowOptions } from "./test-support/fake-dom.ts";

function setup(o: FakeWindowOptions & { reducedClass?: boolean; noIo?: boolean } = {}) {
  FakeObserver.all = [];
  const win = new FakeWindow(o);
  if (o.reducedClass) win.document.documentElement.classList.add("is-reduced");
  if (o.noIo) delete (win as unknown as Record<string, unknown>).IntersectionObserver;
  const d = win.document;
  const hdr = el(d, "header", { "data-hdr": "" });
  const menu = el(d, "details", { "data-menu": "" });
  const link = el(d, "a", {}, menu);
  const label = el(d, "span", {}, menu);
  const rv = [el(d, "div", { class: "rv" }), el(d, "div", { class: "rv" })];
  const steps = [el(d, "li", { class: "step" }), el(d, "li", { class: "step" })];
  const toggle = el(d, "button", { "data-motion-toggle": "" });
  const groups = [el(d, "details", { class: "ftr-d" }), el(d, "details", { class: "ftr-d" })];
  for (const g of groups) g.open = true;
  const stop = startChrome(win as unknown as Win);
  return { win, d, hdr, menu, link, label, rv, steps, toggle, groups, stop };
}

afterEach(() => {
  FakeObserver.all = [];
});

describe("startChrome: the line under the header", () => {
  it("marks the header as scrolled when the marker at the top leaves the window", () => {
    const s = setup();
    const io = FakeObserver.all[0] as FakeObserver;
    expect(io.observed).toHaveLength(1);
    io.fire(false);
    expect(s.hdr.classList.contains("is-scrolled")).toBe(true);
    io.fire(true);
    expect(s.hdr.classList.contains("is-scrolled")).toBe(false);
  });

  it("removes the marker on stop", () => {
    const s = setup();
    const marker = s.d.body.firstChild;
    expect(marker?.getAttribute("aria-hidden")).toBe("true");
    s.stop();
    expect(s.d.body.children.includes(marker as never)).toBe(false);
  });
});

describe("startChrome: the menu of a phone", () => {
  it("closes after a click on a link and stays open after a click on the text", () => {
    const s = setup();
    s.menu.open = true;
    s.label.dispatch("click");
    expect(s.menu.open).toBe(true);
    s.link.dispatch("click");
    expect(s.menu.open).toBe(false);
  });

  it("stops listening after stop", () => {
    const s = setup();
    s.stop();
    expect(s.menu.listenerCount("click")).toBe(0);
  });
});

describe("startChrome: blocks that appear", () => {
  it("marks a block when it comes into view and then stops watching it", () => {
    const s = setup();
    const io = FakeObserver.all[1] as FakeObserver;
    expect(io.observed).toHaveLength(4);
    io.fire(false, [s.rv[0] as never]);
    expect(s.rv[0]?.classList.contains("is-in")).toBe(false);
    io.fire(true, [s.rv[0] as never]);
    expect(s.rv[0]?.classList.contains("is-in")).toBe(true);
    expect(io.observed).not.toContain(s.rv[0]);
  });

  it("staggers the steps", () => {
    const s = setup();
    expect(s.steps[0]?.style.transitionDelay).toMatch(/ms$/);
    expect(s.rv[0]?.style.transitionDelay).toBeUndefined();
  });

  it("shows everything at once on a page served static", () => {
    const s = setup({ reducedClass: true });
    for (const e of [...s.rv, ...s.steps]) expect(e.classList.contains("is-in")).toBe(true);
    expect(FakeObserver.all).toHaveLength(1);
  });

  it("shows everything at once in a browser without IntersectionObserver", () => {
    const s = setup({ noIo: true });
    for (const e of [...s.rv, ...s.steps]) expect(e.classList.contains("is-in")).toBe(true);
    expect(s.hdr.classList.contains("is-scrolled")).toBe(false);
  });
});

describe("startChrome: the switch Without animation", () => {
  it("is ready after the script has started", () => {
    const s = setup();
    expect(s.toggle.dataset.ready).toBe("1");
  });

  it("sets the cookie to off and reloads when the page is animated", () => {
    const s = setup();
    s.toggle.dispatch("click");
    expect(s.d.cookie).toMatch(/^nv-motion=off/);
    expect(s.win.location.reloads).toBe(1);
  });

  it("deletes the cookie and reloads when the page was switched off", () => {
    const s = setup();
    s.toggle.dataset.off = "1";
    s.toggle.dispatch("click");
    expect(s.d.cookie).toMatch(/nv-motion=;.*(Max-Age=0|expires)/i);
    expect(s.win.location.reloads).toBe(1);
  });
});

describe("startChrome: the footer", () => {
  it("folds the groups on a narrow window", () => {
    const s = setup({ width: 500 });
    expect(s.groups.every((g) => g.open === false)).toBe(true);
  });

  it("folds the groups on a touch screen of any width", () => {
    const s = setup({ width: 1200, coarse: true });
    expect(s.groups.every((g) => g.open === false)).toBe(true);
  });

  it("leaves the groups open on a wide window", () => {
    const s = setup({ width: 1440 });
    expect(s.groups.every((g) => g.open)).toBe(true);
  });
});
