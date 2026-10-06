import { describe, expect, it } from "vitest";
import {
  createIntroSession,
  INTRO_SESSION_KEY,
  prefersReducedMotion,
  type StorageLike,
  sessionStorageSource,
} from "./intro-session.ts";

/** A Storage that keeps values in a map. */
function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const boom = () => {
  throw new Error("SecurityError: storage is blocked");
};

describe("intro session: plays once per session", () => {
  it("has not played in a new session, and remembers it after markPlayed (sessionStorage)", () => {
    const storage = memoryStorage();
    const session = createIntroSession(() => storage);
    expect(session.hasPlayed()).toBe(false);
    session.markPlayed();
    expect(session.hasPlayed()).toBe(true);
    expect(storage.map.get(INTRO_SESSION_KEY)).toBe("1");
  });

  it("is seen by another page of the same session (a new object over the same storage)", () => {
    const storage = memoryStorage();
    createIntroSession(() => storage).markPlayed();
    expect(createIntroSession(() => storage).hasPlayed()).toBe(true);
  });

  it("does not tell a stranger value from the flag", () => {
    const storage = memoryStorage();
    storage.setItem(INTRO_SESSION_KEY, "0");
    expect(createIntroSession(() => storage).hasPlayed()).toBe(false);
  });

  it("keeps working when reading the storage throws: not played, no exception", () => {
    const session = createIntroSession(() => ({ getItem: boom, setItem: boom }));
    expect(() => session.hasPlayed()).not.toThrow();
    expect(session.hasPlayed()).toBe(false);
  });

  it("keeps working when the storage getter itself throws (sandboxed iframe, blocked cookies)", () => {
    const session = createIntroSession(boom);
    expect(session.hasPlayed()).toBe(false);
    expect(() => session.markPlayed()).not.toThrow();
  });

  it("remembers in memory when writing fails: the intro still plays once per page life, not on every navigation", () => {
    const session = createIntroSession(() => ({ getItem: () => null, setItem: boom }));
    expect(session.hasPlayed()).toBe(false);
    session.markPlayed();
    expect(session.hasPlayed()).toBe(true);
  });

  it("copes with a missing storage (null or undefined: server, a worker)", () => {
    for (const source of [() => null, () => undefined]) {
      const session = createIntroSession(source);
      expect(session.hasPlayed()).toBe(false);
      session.markPlayed();
      expect(session.hasPlayed()).toBe(true);
    }
  });

  it("memory of one session object does not leak to another (tests are independent)", () => {
    const a = createIntroSession(() => null);
    const b = createIntroSession(() => null);
    a.markPlayed();
    expect(b.hasPlayed()).toBe(false);
  });

  it("the default source reads globalThis.sessionStorage and is safe where it does not exist", () => {
    expect(sessionStorageSource()).toBeNull(); // plain Node: no sessionStorage
    const holder = globalThis as { sessionStorage?: unknown };
    Object.defineProperty(holder, "sessionStorage", { configurable: true, get: boom });
    try {
      expect(sessionStorageSource()).toBeNull();
    } finally {
      Reflect.deleteProperty(holder, "sessionStorage");
    }
    const fake = memoryStorage();
    Object.defineProperty(holder, "sessionStorage", { configurable: true, value: fake });
    try {
      expect(sessionStorageSource()).toBe(fake);
    } finally {
      Reflect.deleteProperty(holder, "sessionStorage");
    }
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it("asks for reduce", () => {
    let asked = "";
    prefersReducedMotion((q) => {
      asked = q;
      return { matches: false };
    });
    expect(asked).toBe("(prefers-reduced-motion: reduce)");
  });

  it("takes a missing matchMedia as no preference and a throwing one as reduced (plays safe)", () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion(boom)).toBe(true);
  });
});
