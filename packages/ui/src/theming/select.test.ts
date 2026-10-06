import { describe, expect, it } from "vitest";
import {
  readStoredTheme,
  resolveTheme,
  type StorageLike,
  storeTheme,
  THEME_STORAGE_KEY,
  themeByLocalTime,
  themeFromSearch,
} from "./select.ts";

/** Local time (the machine zone), as the visitor's browser sees it. */
const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m, 0);

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

const broken: StorageLike = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError");
  },
};

describe("themeByLocalTime: day is 07:00-19:00 local time (R-18)", () => {
  it("covers every hour", () => {
    const expected = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 19 ? "day" : "night"));
    expect(Array.from({ length: 24 }, (_, h) => themeByLocalTime(at(h)))).toEqual(expected);
  });

  it("switches exactly at 07:00 and 19:00", () => {
    expect(themeByLocalTime(at(6, 59))).toBe("night");
    expect(themeByLocalTime(at(7, 0))).toBe("day");
    expect(themeByLocalTime(at(18, 59))).toBe("day");
    expect(themeByLocalTime(at(19, 0))).toBe("night");
  });

  it("falls back to the default theme on an invalid date", () => {
    expect(themeByLocalTime(new Date(Number.NaN))).toBe("day");
  });
});

describe("themeFromSearch (?theme=day|night, for checking)", () => {
  it("accepts only the two theme ids", () => {
    expect(themeFromSearch("?theme=night")).toBe("night");
    expect(themeFromSearch("theme=day&x=1")).toBe("day");
    expect(themeFromSearch("?theme=b")).toBeNull();
    expect(themeFromSearch("?theme=NIGHT")).toBeNull();
    expect(themeFromSearch("?other=night")).toBeNull();
    expect(themeFromSearch("")).toBeNull();
    expect(themeFromSearch(undefined)).toBeNull();
  });
});

describe("readStoredTheme / storeTheme", () => {
  it("round-trips a choice under the key nv-theme", () => {
    const s = memoryStorage();
    expect(storeTheme(s, "night")).toBe(true);
    expect(s.data).toEqual({ [THEME_STORAGE_KEY]: "night" });
    expect(THEME_STORAGE_KEY).toBe("nv-theme");
    expect(readStoredTheme(s)).toBe("night");
  });

  it("ignores values that are not a theme (old ids, garbage, empty)", () => {
    for (const bad of ["b", "a", "v", "dark", "", "Day", " night"]) {
      expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: bad })), JSON.stringify(bad)).toBeNull();
    }
    expect(readStoredTheme(memoryStorage())).toBeNull();
  });

  it("never throws when storage is blocked, full or absent", () => {
    expect(readStoredTheme(broken)).toBeNull();
    expect(storeTheme(broken, "day")).toBe(false);
    expect(readStoredTheme(null)).toBeNull();
    expect(readStoredTheme(undefined)).toBeNull();
    expect(storeTheme(null, "day")).toBe(false);
  });
});

describe("resolveTheme: ?theme= over the saved choice over the local time", () => {
  it("uses the local time when nothing else is known", () => {
    expect(resolveTheme({ now: at(8) })).toBe("day");
    expect(resolveTheme({ now: at(23) })).toBe("night");
  });

  it("prefers the saved choice to the time", () => {
    expect(resolveTheme({ stored: "night", now: at(12) })).toBe("night");
    expect(resolveTheme({ stored: "day", now: at(23) })).toBe("day");
  });

  it("prefers the query to the saved choice", () => {
    expect(resolveTheme({ query: "day", stored: "night", now: at(23) })).toBe("day");
  });

  it("skips values that are not themes and goes on to the next source", () => {
    expect(resolveTheme({ query: "b", stored: "night", now: at(12) })).toBe("night");
    expect(resolveTheme({ query: null, stored: "v", now: at(22) })).toBe("night");
    expect(resolveTheme({ query: "", stored: undefined, now: at(10) })).toBe("day");
  });
});
