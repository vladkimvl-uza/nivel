import { describe, expect, it, vi } from "vitest";
import { createBrowserThemeController, createInertThemeController, THEME_EVENT } from "./browser.ts";

interface FakeMeta {
  attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
}

function fakeWindow(
  over: { storage?: "ok" | "throws"; matchMedia?: boolean | "missing"; search?: string; hour?: number } = {},
) {
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  const metas: FakeMeta[] = [];
  const events: { type: string; detail: unknown }[] = [];
  const store: Record<string, string> = {};
  const timers: (() => void)[] = [];
  const meta = (): FakeMeta => {
    const m: FakeMeta = {
      attrs: {},
      setAttribute(k, v) {
        m.attrs[k] = v;
      },
    };
    return m;
  };
  const win = {
    document: {
      documentElement: {
        getAttribute: (k: string) => attrs[k] ?? null,
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
        classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
      },
      head: { appendChild: (m: FakeMeta) => metas.push(m) },
      querySelector: () => metas[0] ?? null,
      createElement: () => meta(),
    },
    get localStorage() {
      if (over.storage === "throws") throw new DOMException("blocked", "SecurityError");
      return { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) };
    },
    location: { search: over.search ?? "" },
    matchMedia: over.matchMedia === "missing" ? undefined : () => ({ matches: over.matchMedia === true }),
    dispatchEvent: (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail }),
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: vi.fn(),
  };
  return { win: win as unknown as Window, attrs, classes, metas, events, store, timers };
}

describe("createBrowserThemeController", () => {
  it("applies the theme to the page, adds the theme-color meta once, saves the choice and fires nv-theme", () => {
    const f = fakeWindow();
    const c = createBrowserThemeController(f.win);
    c.set("night");
    expect(f.attrs["data-theme"]).toBe("night");
    expect(f.metas).toHaveLength(1);
    expect(f.metas[0]?.attrs).toEqual({ name: "theme-color", content: "#121110" });
    c.set("day");
    expect(f.metas).toHaveLength(1);
    expect(f.metas[0]?.attrs.content).toBe("#F1EFEA");
    expect(f.store["nv-theme"]).toBe("day");
    expect(f.events).toEqual([
      { type: THEME_EVENT, detail: "night" },
      { type: THEME_EVENT, detail: "day" },
    ]);
    expect(THEME_EVENT).toBe("nv-theme");
  });

  it("fades the colors for a second and stops after the timer", () => {
    const f = fakeWindow();
    createBrowserThemeController(f.win).set("night");
    expect(f.classes.has("theme-shift")).toBe(true);
    f.timers[0]?.();
    expect(f.classes.has("theme-shift")).toBe(false);
  });

  it("cancels the previous window with clearTimeout on a quick second switch", () => {
    const f = fakeWindow();
    const c = createBrowserThemeController(f.win);
    c.set("night");
    c.set("day");
    expect((f.win.clearTimeout as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("does not animate under prefers-reduced-motion, or when matchMedia is missing it animates", () => {
    const reduced = fakeWindow({ matchMedia: true });
    createBrowserThemeController(reduced.win).set("night");
    expect(reduced.classes.has("theme-shift")).toBe(false);
    const old = fakeWindow({ matchMedia: "missing" });
    createBrowserThemeController(old.win).set("night");
    expect(old.classes.has("theme-shift")).toBe(true);
  });

  it("reads ?theme= from the address on init, and the saved choice otherwise", () => {
    const q = fakeWindow({ search: "?theme=night" });
    expect(createBrowserThemeController(q.win).init()).toBe("night");
    const saved = fakeWindow();
    saved.store["nv-theme"] = "night";
    expect(createBrowserThemeController(saved.win).init()).toBe("night");
  });

  it("works when localStorage is blocked", () => {
    const f = fakeWindow({ storage: "throws" });
    const c = createBrowserThemeController(f.win);
    expect(() => c.set("night")).not.toThrow();
    expect(["day", "night"]).toContain(c.init());
  });

  it("is inert without a window (server render): no throw, always the default theme", () => {
    const c = createBrowserThemeController(undefined);
    expect(c.init()).toBe("day");
    expect(c.get()).toBe("day");
    expect(c.getServer()).toBe("day");
    expect(c.toggle()).toBe("day");
    expect(() => c.set("night")).not.toThrow();
    expect(c.subscribe(() => {})).toBeTypeOf("function");
    expect(createInertThemeController().get()).toBe("day");
  });
});
