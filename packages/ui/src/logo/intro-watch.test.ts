import { describe, expect, it, vi } from "vitest";
import { constrainedNetwork, watchReducedMotion, watchVisible } from "./intro-watch.ts";

describe("constrainedNetwork (the 3D core is not requested over a saver or a slow link)", () => {
  it("is false for a plain connection and for a browser that does not tell", () => {
    expect(constrainedNetwork({})).toBe(false);
    expect(constrainedNetwork(undefined)).toBe(false);
    expect(constrainedNetwork({ connection: { effectiveType: "4g", saveData: false }, deviceMemory: 8 })).toBe(false);
  });

  it("is true for the data saver, for 2g and 3g classes and for a device with 2 GB or less", () => {
    expect(constrainedNetwork({ connection: { saveData: true } })).toBe(true);
    for (const effectiveType of ["slow-2g", "2g", "3g"]) {
      expect(constrainedNetwork({ connection: { effectiveType } }), effectiveType).toBe(true);
    }
    expect(constrainedNetwork({ deviceMemory: 2 })).toBe(true);
    expect(constrainedNetwork({ deviceMemory: 0.5 })).toBe(true);
    expect(constrainedNetwork({ deviceMemory: 4 })).toBe(false);
  });

  it("reads the real navigator by default and does not throw where there is none", () => {
    expect(() => constrainedNetwork()).not.toThrow();
  });

  it("a getter that throws counts as not constrained: the check never breaks the page", () => {
    const nav = {
      get connection(): never {
        throw new Error("blocked");
      },
    };
    expect(constrainedNetwork(nav)).toBe(false);
  });
});

type Entries = { isIntersecting: boolean }[];

function visibilityEnv(state = "visible") {
  let io: ((entries: Entries) => void) | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const listeners = new Map<string, () => void>();
  const doc = {
    visibilityState: state,
    addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
  };
  class FakeObserver {
    observe = observe;
    disconnect = disconnect;
    constructor(cb: (entries: Entries) => void) {
      io = cb;
    }
  }
  return {
    doc,
    listeners,
    observe,
    disconnect,
    IntersectionObserver: FakeObserver,
    fire: (v: boolean) => io?.([{ isIntersecting: v }]),
    tab: (s: string) => {
      doc.visibilityState = s;
      listeners.get("visibilitychange")?.();
    },
  };
}

describe("watchVisible (the loop runs only while the box is on screen and the tab is shown)", () => {
  it("tells false when the box leaves the viewport and true when it returns", () => {
    const e = visibilityEnv();
    const seen: boolean[] = [];
    const target = {} as Element;
    watchVisible(target, (v) => seen.push(v), e);
    expect(e.observe).toHaveBeenCalledWith(target);
    e.fire(false);
    e.fire(true);
    expect(seen).toEqual([false, true]);
  });

  it("tells false while the tab is hidden, even when the box is in the viewport", () => {
    const e = visibilityEnv();
    const seen: boolean[] = [];
    watchVisible({} as Element, (v) => seen.push(v), e);
    e.fire(true);
    e.tab("hidden");
    e.tab("visible");
    expect(seen).toEqual([true, false, true]);
  });

  it("does not tell the same value twice in a row", () => {
    const e = visibilityEnv();
    const seen: boolean[] = [];
    watchVisible({} as Element, (v) => seen.push(v), e);
    e.fire(true);
    e.fire(true);
    e.fire(false);
    e.fire(false);
    expect(seen).toEqual([true, false]);
  });

  it("the returned function disconnects the observer and removes the listener", () => {
    const e = visibilityEnv();
    const stop = watchVisible({} as Element, () => {}, e);
    stop();
    expect(e.disconnect).toHaveBeenCalledTimes(1);
    expect(e.listeners.size).toBe(0);
  });

  it("without IntersectionObserver the tab alone decides; with neither there is nothing to watch and nothing throws", () => {
    const seen: boolean[] = [];
    const e = visibilityEnv();
    const stop = watchVisible({} as Element, (v) => seen.push(v), { doc: e.doc });
    e.tab("hidden");
    expect(seen).toEqual([false]);
    stop();
    expect(e.listeners.size).toBe(0);
    expect(watchVisible({} as Element, () => {}, {})).toBeTypeOf("function");
  });
});

describe("watchReducedMotion (the preference can be switched on while the page is open)", () => {
  type Listener = (e: { matches: boolean }) => void;
  function query() {
    const listeners = new Set<Listener>();
    return {
      matches: false,
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
      emit: (matches: boolean) => {
        for (const fn of listeners) fn({ matches });
      },
      listeners,
    };
  }

  it("tells the new value on every change, and stops after the returned function", () => {
    const q = query();
    const asked: string[] = [];
    const seen: boolean[] = [];
    const stop = watchReducedMotion(
      (v) => seen.push(v),
      (text) => {
        asked.push(text);
        return q;
      },
    );
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
    q.emit(true);
    q.emit(false);
    expect(seen).toEqual([true, false]);
    stop();
    expect(q.listeners.size).toBe(0);
    q.emit(true);
    expect(seen).toEqual([true, false]);
  });

  it("takes an old browser (addListener only), a missing matchMedia and a throwing one without an exception", () => {
    const legacy = { matches: false, addListener: vi.fn(), removeListener: vi.fn() };
    const stop = watchReducedMotion(
      () => {},
      () => legacy,
    );
    expect(legacy.addListener).toHaveBeenCalledTimes(1);
    stop();
    expect(legacy.removeListener).toHaveBeenCalledTimes(1);
    expect(watchReducedMotion(() => {}, undefined)).toBeTypeOf("function");
    const broken = watchReducedMotion(
      () => {},
      () => {
        throw new Error("no");
      },
    );
    expect(broken).toBeTypeOf("function");
    expect(() => broken()).not.toThrow();
  });
});
