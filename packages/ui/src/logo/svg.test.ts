/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brand, themeTokens } from "../themes/tokens.ts";
import { lockupSize, lockupViewBox, markRockingCount, markShapes, markViewBox, wordShapes } from "./shapes.ts";
import { escapeXml, logoSvg } from "./svg.ts";

const brandFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../docs/brand/logos-v2/${name}`, import.meta.url)), "utf8");

/** `[fill, d]` of every path of an SVG document, in order. */
const pathsOf = (svg: string) => [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => [m[1], m[2]]);

describe("logo shapes are the brand files verbatim (docs/brand/logos-v2, nivel-1)", () => {
  it("the mark: four paths and the viewBox of nivel-1-inverse.svg", () => {
    const file = brandFile("nivel-1-inverse.svg");
    expect(file).toContain(`viewBox="${markViewBox}"`);
    expect(markShapes.map((s) => s.d)).toEqual(pathsOf(file).map(([, d]) => d));
  });

  it("the mark keeps the roles of the colored file: the left half of the triangle is the accent", () => {
    const light = pathsOf(brandFile("nivel-1.svg"));
    const accentFill = light.find(([fill]) => fill === brand.signal)?.[1];
    expect(markShapes.filter((s) => s.role === "accent").map((s) => s.d)).toEqual([accentFill]);
  });

  it("the lockup: mark paths and word paths in the order of nivel-1-lockup-inverse.svg", () => {
    const file = brandFile("nivel-1-lockup-inverse.svg");
    const fromFile = pathsOf(file).map(([, d]) => d);
    expect([...markShapes, ...wordShapes].map((s) => s.d)).toEqual(fromFile);
    expect(file).toContain(`viewBox="${lockupViewBox}"`);
    expect(lockupViewBox.split(" ").slice(2).map(Number)).toEqual([lockupSize.width, lockupSize.height]);
  });

  it("the roles match the inverse lockup colors path by path (ink = paper, accent = night orange)", () => {
    const file = pathsOf(brandFile("nivel-1-lockup-inverse.svg"));
    const roles = [...markShapes, ...wordShapes].map((s) => s.role);
    expect(file.map(([fill]) => fill)).toEqual(roles.map((r) => (r === "ink" ? brand.paper : brand.signalDark)));
  });

  it("the loader rocks the shelf and the triangle (first three shapes), not the level line", () => {
    expect(markRockingCount).toBe(3);
    expect(markShapes[markRockingCount]?.d).toBe("M4 40h56v8h-56Z");
  });
});

describe("logoSvg (plain string for worker, PDF and bot)", () => {
  it("draws the night lockup by default, byte-equal in paths and colors to nivel-1-lockup-inverse.svg", () => {
    const svg = logoSvg();
    expect(pathsOf(svg)).toEqual(pathsOf(brandFile("nivel-1-lockup-inverse.svg")));
    expect(svg).toContain(`fill="${themeTokens.night.ink}"`);
    expect(svg).toContain(`fill="${themeTokens.night.accent}"`);
    expect(svg).toContain('role="img" aria-label="Nivel"');
  });

  it("draws the mark of nivel-1-inverse.svg", () => {
    expect(pathsOf(logoSvg({ kind: "mark" }))).toEqual(pathsOf(brandFile("nivel-1-inverse.svg")));
    expect(logoSvg({ kind: "mark" })).toContain(`viewBox="${markViewBox}"`);
  });

  it("takes colors, label and width from the caller", () => {
    const svg = logoSvg({ kind: "mark", ink: "currentColor", accent: "var(--accent)", label: "Nivel logo", width: 96 });
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('fill="var(--accent)"');
    expect(svg).toContain('aria-label="Nivel logo"');
    expect(svg).toContain(' width="96" ');
  });

  it("is decorative (aria-hidden, no role) when the label is empty", () => {
    const svg = logoSvg({ label: "" });
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain("role=");
    expect(svg).not.toContain("aria-label");
  });

  it("escapes markup in the label and in colors", () => {
    const svg = logoSvg({ label: `A "B" <i> & 'c'`, ink: '"><script>' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("A &quot;B&quot; &lt;i&gt; &amp; &#39;c&#39;");
    expect(escapeXml("plain")).toBe("plain");
  });

  it("is well-formed: balanced tags and one root", () => {
    for (const kind of ["mark", "lockup"] as const) {
      const svg = logoSvg({ kind });
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect((svg.match(/<g /g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
    }
  });
});
