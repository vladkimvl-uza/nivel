import { describe, expect, it, vi } from "vitest";
import { createThemeController, type ThemeControllerDeps } from "./controller.ts";
import type { StorageLike } from "./select.ts";

class FakeRoot {
  attrs = new Map<string, string>();
  classes = new Set<string>();
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
  };
}

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const at = (h: number) => new Date(2026, 9, 6, h, 0, 0);

/** A controller over fakes; timers are manual so that the 1 s "theme-shift" window can be stepped. */
function setup(over: Partial<ThemeControllerDeps> = {}) {
  const root = new FakeRoot();
  const storage = memoryStorage();
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  const colors: string[] = [];
  const emitted: { theme: string; animate: boolean }[] = [];
  const deps: ThemeControllerDeps = {
    root,
    storage,
    now: () => at(12),
    search: "",
    setThemeColor: (c) => colors.push(c),
    emit: (theme, animate) => emitted.push({ theme, animate }),
    reducedMotion: () => false,
    schedule: (fn, ms) => {
      timers.push({ fn, ms, id: timers.length, live: true });
      return timers.length - 1;
    },
    cancel: (id) => {
      const t = timers[id as number];
      if (t) t.live = false;
    },
    ...over,
  };
  const controller = createThemeController(deps);
  const fire = () => {
    for (const t of timers) {
      if (t.live) {
        t.live = false;
        t.fn();
      }
    }
  };
  return { root, storage, timers, colors, emitted, controller, fire };
}

describe("init: the first state of the page", () => {
  it("takes the local time when there is no saved choice: 08:00 is day, 22:00 is night", () => {
    const morning = setup({ now: () => at(8) });
    expect(morning.controller.init()).toBe("day");
    expect(morning.root.getAttribute("data-theme")).toBe("day");

    const evening = setup({ now: () => at(22) });
    expect(evening.controller.init()).toBe("night");
    expect(evening.root.getAttribute("data-theme")).toBe("night");
  });

  it("does not save a choice the visitor did not make", () => {
    const s = setup({ now: () => at(22) });
    s.controller.init();
    expect(s.storage.data).toEqual({});
  });

  it("restores the saved choice in a new session (the choice is remembered)", () => {
    const first = setup({ now: () => at(12) });
    first.controller.init();
    first.controller.set("night");
    const second = setup({ now: () => at(12), storage: first.storage });
    expect(second.controller.init()).toBe("night");
  });

  it("lets ?theme= win without saving it", () => {
    const s = setup({ search: "?theme=night", now: () => at(12) });
    s.storage.setItem("nv-theme", "day");
    expect(s.controller.init()).toBe("night");
    expect(s.storage.data["nv-theme"]).toBe("day");
  });

  it("updates the browser theme-color without animating", () => {
    const s = setup({ now: () => at(22) });
    s.controller.init();
    expect(s.colors).toEqual(["#121110"]);
    expect(s.root.classes.has("theme-shift")).toBe(false);
  });

  it("is idempotent: a second init does not override a choice made in between", () => {
    const s = setup({ now: () => at(12) });
    s.controller.init();
    s.controller.set("night");
    expect(s.controller.init()).toBe("night");
  });

  it("works without storage and without a clock", () => {
    const s = setup({ storage: null });
    expect(["day", "night"]).toContain(s.controller.init());
    const bare = createThemeController({ root: new FakeRoot() });
    expect(["day", "night"]).toContain(bare.init());
  });
});

describe("set: switching by the attribute only", () => {
  it("sets data-theme, saves the choice, tells listeners and the page", () => {
    const s = setup();
    const seen: string[] = [];
    s.controller.subscribe(() => seen.push(s.controller.get()));
    s.controller.set("night");
    expect(s.root.getAttribute("data-theme")).toBe("night");
    expect(s.storage.data["nv-theme"]).toBe("night");
    expect(s.colors).toEqual(["#121110"]);
    expect(s.emitted).toEqual([{ theme: "night", animate: true }]);
    expect(seen).toEqual(["night"]);
    expect(s.controller.get()).toBe("night");
  });

  it("does not notify when the theme does not change, but still saves the explicit choice", () => {
    const s = setup();
    s.controller.init();
    s.emitted.length = 0;
    const listener = vi.fn();
    s.controller.subscribe(listener);
    s.controller.set("day");
    expect(listener).not.toHaveBeenCalled();
    expect(s.emitted).toEqual([]);
    expect(s.storage.data["nv-theme"]).toBe("day");
  });

  it("can switch without saving", () => {
    const s = setup();
    s.controller.set("night", { persist: false });
    expect(s.storage.data).toEqual({});
    expect(s.root.getAttribute("data-theme")).toBe("night");
  });

  it("stops notifying after unsubscribe", () => {
    const s = setup();
    const listener = vi.fn();
    const off = s.controller.subscribe(listener);
    off();
    s.controller.set("night");
    expect(listener).not.toHaveBeenCalled();
  });

  it("survives blocked storage: the theme still changes", () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const s = setup({ storage: blocked });
    expect(() => s.controller.set("night")).not.toThrow();
    expect(s.root.getAttribute("data-theme")).toBe("night");
  });

  it("rejects anything that is not a theme", () => {
    const s = setup();
    expect(() => s.controller.set("b" as never)).toThrow(TypeError);
    expect(() => s.controller.set(undefined as never)).toThrow(TypeError);
    expect(s.root.getAttribute("data-theme")).toBeNull();
  });
});

describe("animation of the switch: only colors, only for a second", () => {
  it("adds theme-shift for 1000 ms and removes it", () => {
    const s = setup();
    s.controller.set("night");
    expect(s.root.classes.has("theme-shift")).toBe(true);
    expect(s.timers[0]?.ms).toBe(1000);
    s.fire();
    expect(s.root.classes.has("theme-shift")).toBe(false);
  });

  it("restarts the window on a quick second switch", () => {
    const s = setup();
    s.controller.set("night");
    s.controller.set("day");
    expect(s.timers).toHaveLength(2);
    expect(s.timers[0]?.live).toBe(false);
    expect(s.timers[1]?.live).toBe(true);
    s.fire();
    expect(s.root.classes.has("theme-shift")).toBe(false);
  });

  it("is instant under prefers-reduced-motion", () => {
    const s = setup({ reducedMotion: () => true });
    s.controller.set("night");
    expect(s.root.classes.has("theme-shift")).toBe(false);
    expect(s.timers).toHaveLength(0);
  });

  it("is instant when the caller says so", () => {
    const s = setup();
    s.controller.set("night", { animate: false });
    expect(s.timers).toHaveLength(0);
  });
});

describe("toggle, get, getServer", () => {
  it("toggles between the two themes and returns the new one", () => {
    const s = setup();
    s.controller.set("day");
    expect(s.controller.toggle()).toBe("night");
    expect(s.controller.toggle()).toBe("day");
  });

  it("reads the attribute as the truth, with day for an unknown value", () => {
    const s = setup();
    expect(s.controller.get()).toBe("day");
    s.root.setAttribute("data-theme", "b");
    expect(s.controller.get()).toBe("day");
    s.root.setAttribute("data-theme", "night");
    expect(s.controller.get()).toBe("night");
  });

  it("always reports day on the server, whatever the clock says", () => {
    const s = setup({ now: () => at(23) });
    expect(s.controller.getServer()).toBe("day");
  });
});
