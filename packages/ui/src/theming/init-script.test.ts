/// <reference types="node" />
import vm from "node:vm";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "../test-support/render.ts";
import { themeTokens } from "../themes/tokens.ts";
import { ThemeInitScript } from "./InitScript.ts";
import { themeInitScript } from "./init-script.ts";
import { resolveTheme } from "./select.ts";

interface Page {
  theme: string | null;
  themeColor: string | null;
}

/** Runs the inline script in a sandbox with a fake document, storage, URL and clock. */
function run(opts: {
  hour: number;
  stored?: string | null;
  search?: string;
  storage?: "ok" | "throws";
  meta?: boolean;
}): Page {
  const attrs = new Map<string, string>();
  const meta = { content: null as string | null, setAttribute: (_: string, v: string) => (meta.content = v) };
  const created: (typeof meta)[] = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor() {
      super(2026, 9, 6, opts.hour, 30, 0);
    }
  }
  const sandbox = {
    document: {
      documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) },
      head: { appendChild: (m: typeof meta) => created.push(m) },
      querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' && opts.meta !== false ? meta : null),
      createElement: () => ({
        ...meta,
        setAttribute(_k: string, v: string) {
          this.content = v;
        },
      }),
    },
    localStorage: {
      getItem: () => {
        if (opts.storage === "throws") throw new Error("denied");
        return opts.stored ?? null;
      },
    },
    location: { search: opts.search ?? "" },
    URLSearchParams,
    Date: FakeDate,
  };
  vm.runInNewContext(themeInitScript(), sandbox);
  const color = opts.meta === false ? (created[0]?.content ?? null) : meta.content;
  return { theme: attrs.get("data-theme") ?? null, themeColor: color };
}

describe("themeInitScript (runs in <head> before the first paint, no flash)", () => {
  it("agrees with resolveTheme for every hour, saved choice and ?theme= value", () => {
    for (let hour = 0; hour < 24; hour++) {
      for (const stored of [null, "day", "night", "b", "garbage"]) {
        for (const search of ["", "?theme=day", "?theme=night", "?theme=b", "?x=1&theme=night"]) {
          const query = /[?&]theme=([^&]*)/.exec(search)?.[1] ?? null;
          const expected = resolveTheme({ query, stored, now: new Date(2026, 9, 6, hour, 30) });
          const page = run({ hour, stored, search });
          expect(page.theme, `hour ${hour} stored ${stored} search ${search}`).toBe(expected);
        }
      }
    }
  });

  it("sets the browser theme-color to the page color of the chosen theme", () => {
    expect(run({ hour: 12 }).themeColor).toBe(themeTokens.day.themeColor);
    expect(run({ hour: 23 }).themeColor).toBe(themeTokens.night.themeColor);
  });

  it("adds the theme-color meta when the page has none", () => {
    expect(run({ hour: 23, meta: false }).themeColor).toBe(themeTokens.night.themeColor);
  });

  it("falls back to the clock when localStorage throws", () => {
    expect(run({ hour: 8, storage: "throws" }).theme).toBe("day");
    expect(run({ hour: 21, storage: "throws" }).theme).toBe("night");
  });

  it("does not throw when there is no storage at all", () => {
    const attrs = new Map<string, string>();
    const sandbox = {
      document: {
        documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) },
        querySelector: () => null,
        createElement: () => ({ setAttribute() {} }),
        head: { appendChild() {} },
      },
      location: { search: "" },
      URLSearchParams,
      Date,
    };
    expect(() => vm.runInNewContext(themeInitScript(), sandbox)).not.toThrow();
    expect(["day", "night"]).toContain(attrs.get("data-theme"));
  });

  it("is self-contained: no imports, no network, no raw colors beyond the two theme-color values", () => {
    const script = themeInitScript();
    expect(script).not.toMatch(/\b(import|fetch|XMLHttpRequest|eval)\b/);
    expect([...script.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toUpperCase()).sort()).toEqual(
      [themeTokens.day.themeColor, themeTokens.night.themeColor].sort(),
    );
  });
});

describe("<ThemeInitScript>", () => {
  it("renders the script inline, with the CSP nonce when given", () => {
    const html = render(createElement(ThemeInitScript, { nonce: "abc123" }));
    expect(html.startsWith("<script")).toBe(true);
    expect(html).toContain('nonce="abc123"');
    expect(html).toContain("data-theme");
  });

  it("renders without a nonce", () => {
    expect(render(createElement(ThemeInitScript, {}))).not.toContain("nonce");
  });
});
