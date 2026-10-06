/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { parseCss } from "../test-support/css.ts";
import { render } from "../test-support/render.ts";
import { clampLoaderSize, LOADER_SIZE, LogoLoader, LogoLockup, LogoMark } from "./Logo.tsx";
import { markShapes } from "./shapes.ts";
import { logoSvg } from "./svg.ts";

const css = readFileSync(fileURLToPath(new URL("../styles/logo.css", import.meta.url)), "utf8");
const rules = parseCss(css);
const declOf = (selector: string, at = "") =>
  Object.fromEntries(rules.filter((r) => r.selector === selector && r.at === at).flatMap((r) => r.decls));

/** Every `class="..."` token in a piece of markup. */
const classesOf = (html: string) => [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => (m[1] as string).split(" "));

describe("LogoMark and LogoLockup (SSR)", () => {
  it("render an svg with role=img and the aria-label Nivel by default", () => {
    for (const el of [h(LogoMark), h(LogoLockup)]) {
      const html = render(el);
      expect(html).toMatch(/^<svg /);
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Nivel"');
    }
  });

  it("draw the same paths as the string core, with roles as classes instead of colors", () => {
    const html = render(h(LogoLockup));
    const fromString = [...logoSvg().matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    const fromReact = [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(fromReact).toEqual(fromString);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).not.toContain("fill=");
    expect(html.match(/nv-logo__accent/g)).toHaveLength(2);
  });

  it("take a custom label and a pixel width, and keep the aspect ratio of the box", () => {
    const mark = render(h(LogoMark, { label: "Nivel — главная", width: 40 }));
    expect(mark).toContain('viewBox="0 0 64 64" width="40" height="40"');
    expect(mark).toContain('aria-label="Nivel — главная"');
    expect(render(h(LogoLockup, { width: 348.6 }))).toContain('width="348.6" height="83"');
  });

  it("can be decorative: aria-hidden, no role and no label", () => {
    const html = render(h(LogoMark, { decorative: true, label: "ignored" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-label");
  });

  it("accept undefined optional props (exactOptionalPropertyTypes)", () => {
    const none: string | undefined = undefined as string | undefined;
    const w: number | undefined = undefined as number | undefined;
    const html = render(h(LogoMark, { label: none, className: none, width: w, decorative: undefined }));
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("width=");
  });

  it("add the caller class after its own", () => {
    expect(render(h(LogoLockup, { className: "hdr" }))).toContain('class="nv-logo nv-logo--lockup hdr"');
  });
});

describe("LogoLoader (SSR)", () => {
  it("is a status with aria-busy=true, the label from the caller and a decorative svg", () => {
    const html = render(h(LogoLoader, { label: "Yuklanmoqda" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('<span class="nv-logo-loader__cap">Yuklanmoqda</span>');
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/);
  });

  it("works for the Russian label too and escapes it", () => {
    expect(render(h(LogoLoader, { label: "загрузка" }))).toContain(">загрузка<");
    expect(render(h(LogoLoader, { label: "<b>" }))).toContain("&lt;b&gt;");
  });

  it("refuses an empty or blank label: the text is required", () => {
    expect(() => LogoLoader({ label: "" })).toThrow(/label is required/);
    expect(() => LogoLoader({ label: "  " })).toThrow(/label is required/);
    expect(() => LogoLoader({ label: undefined as unknown as string })).toThrow(/label is required/);
  });

  it("rocks the shelf and the two halves of the triangle, and leaves the level line outside the group", () => {
    const html = render(h(LogoLoader, { label: "x" }));
    const group = /<g class="nv-logo-loader__tilt">(.*?)<\/g>(.*?)<\/svg>/.exec(html);
    expect(group).not.toBeNull();
    const inside = [...(group?.[1] ?? "").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    const outside = [...(group?.[2] ?? "").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(inside).toEqual(markShapes.slice(0, 3).map((s) => s.d));
    expect(outside).toEqual([markShapes[3]?.d]);
  });

  it("holds the size to 48-96 px", () => {
    const sizes = [10, 48, 70.4, 96, 500].map(clampLoaderSize);
    expect(sizes).toEqual([48, 48, 70, 96, 96]);
    const odd = [undefined, Number.NaN, Number.POSITIVE_INFINITY].map(clampLoaderSize);
    expect(odd).toEqual([LOADER_SIZE.default, LOADER_SIZE.default, LOADER_SIZE.default]);
    expect(render(h(LogoLoader, { label: "x", size: 20 }))).toContain('width="48" height="48"');
    expect(render(h(LogoLoader, { label: "x", size: 200 }))).toContain('width="96" height="96"');
    expect(render(h(LogoLoader, { label: "x" }))).toContain('width="64"');
  });

  it("uses only classes that logo.css defines", () => {
    const html = [render(h(LogoLoader, { label: "x" })), render(h(LogoMark)), render(h(LogoLockup))].join("");
    const defined = new Set([...css.matchAll(/\.(nv-[a-z0-9_-]+)/g)].map((m) => m[1]));
    expect(classesOf(html).filter((c) => !defined.has(c))).toEqual([]);
  });
});

describe("logo.css", () => {
  it("colors the mark by roles of the page (--ink, --accent), never by a raw color", () => {
    expect(declOf(".nv-logo__ink").fill).toBe("var(--ink)");
    expect(declOf(".nv-logo__accent").fill).toBe("var(--accent)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
  });

  it("rocks around the apex of the mark, in a loop of 1.4 s", () => {
    const tilt = declOf(".nv-logo-loader__tilt");
    expect(tilt["transform-origin"]).toBe("24px 40px");
    expect(tilt["transform-box"]).toBe("view-box");
    expect(tilt.animation).toBe("nv-logo-rock 1.4s linear infinite");
  });

  it("has the rock keyframes of the concept: start and rest at 0 deg, the first swing to -5 deg at 22 %", () => {
    const frames = rules
      .filter((r) => r.at === "@keyframes nv-logo-rock")
      .map((r) => ({
        at: Number.parseFloat(r.selector),
        deg: Number.parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(r.decls[0]?.[1] ?? "")?.[1] ?? "NaN"),
      }));
    expect(frames[0]).toEqual({ at: 0, deg: 0 });
    expect(frames.at(-1)).toEqual({ at: 100, deg: 0 });
    expect(frames.map((f) => f.at)).toEqual([...frames.map((f) => f.at)].sort((a, b) => a - b));
    const peak = frames.reduce((m, f) => (Math.abs(f.deg) > Math.abs(m.deg) ? f : m));
    expect(peak).toEqual({ at: 22, deg: -5 });
    // damped: the swing back is positive and under a quarter of the first one; the last 14 % (0.2 s) is rest
    const second = Math.max(...frames.map((f) => f.deg));
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(1.25);
    expect(frames.filter((f) => f.at >= 86).every((f) => f.deg === 0)).toBe(true);
    expect(frames.every((f) => Number.isFinite(f.deg))).toBe(true);
  });

  it("stops the rocking and shows the label under prefers-reduced-motion", () => {
    const at = "@media (prefers-reduced-motion: reduce)";
    expect(declOf(".nv-logo-loader__tilt", at).animation).toBe("none");
    const cap = declOf(".nv-logo-loader__cap", at);
    expect(cap.position).toBe("static");
    expect(cap.overflow).toBe("visible");
    expect(cap.color).toBe("var(--ink-2)");
    const hidden = declOf(".nv-logo-loader__cap");
    expect(hidden.position).toBe("absolute");
    expect(hidden["clip-path"]).toBe("inset(50%)");
  });

  it("is imported by the package stylesheet", () => {
    const index = readFileSync(fileURLToPath(new URL("../styles/index.css", import.meta.url)), "utf8");
    expect(index).toContain('@import "./logo.css"');
  });

  it("has no glass, glow or gradient", () => {
    expect(css).not.toMatch(/backdrop-filter|blur\(|drop-shadow\(|text-shadow|gradient\(/i);
  });
});
