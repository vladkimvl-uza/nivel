/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Badge, Tag } from "../primitives/Badge.tsx";
import { Button } from "../primitives/Button.tsx";
import { EstimateRow, EstimateTable } from "../primitives/Estimate.tsx";
import { Select, TextField } from "../primitives/Field.tsx";
import { badgeKinds } from "../primitives/kinds.ts";
import { Paper } from "../primitives/Paper.tsx";
import { RoundStamp, Stamp, StampInkDefs } from "../primitives/Stamp.tsx";
import { SumsTable } from "../primitives/SumsTable.tsx";
import { parseCss } from "../test-support/css.ts";
import { render } from "../test-support/render.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const themesCss = read("../themes/themes.css");
const baseCss = read("./base.css");
const primitivesCss = read("./primitives.css");
const indexCss = read("./index.css");
const own = [baseCss, primitivesCss].join("\n");
const rules = [...parseCss(baseCss), ...parseCss(primitivesCss)];

const COLOR_PROPS =
  /^(color|background|background-color|background-image|border(-[a-z]+)*|outline(-color)?|fill|stroke|box-shadow|text-decoration-color|caret-color|accent-color)$/;
const NAMED =
  /\b(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|navy|teal|cyan|magenta|silver|maroon|olive|lime|aqua|fuchsia|brown|gold)\b/i;

describe("stylesheets use roles, not colors", () => {
  it("have no raw color in any color-bearing declaration (only var(), transparent, currentColor, none)", () => {
    for (const r of rules) {
      for (const [prop, value] of r.decls) {
        if (!COLOR_PROPS.test(prop)) continue;
        expect(value, `${r.selector} { ${prop} }`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(value, `${r.selector} { ${prop} }`).not.toMatch(
          /\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix)\(/i,
        );
        expect(value, `${r.selector} { ${prop} }`).not.toMatch(NAMED);
      }
    }
  });

  it("use only variables that themes.css defines (or that the same sheet defines)", () => {
    const defined = new Set([...themesCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
    for (const m of own.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1] as string);
    const used = [...own.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it("have no glass, blur, glow or gradient (anti-list)", () => {
    expect(own).not.toMatch(/backdrop-filter|blur\(|drop-shadow\(|text-shadow/i);
    expect(own).not.toMatch(/gradient\(/i);
    for (const r of rules) {
      for (const [prop, value] of r.decls) {
        if (prop === "box-shadow") expect(value, r.selector).toMatch(/^(none|var\(--[a-z-]+\))$/);
      }
    }
  });

  it("never switch by theme name: the rules serve the page through roles, so a second theme needs no rule", () => {
    expect(own).not.toMatch(/data-theme/);
    expect(own).not.toMatch(/prefers-color-scheme/);
  });
});

describe("classes used by the components exist in the stylesheets", () => {
  it("covers every nv- class that any primitive can render", () => {
    const sums = [
      { id: "a", label: "a", amount: 1 },
      { id: "b", label: "b", amount: 1, kind: "subtotal" as const },
      { id: "c", label: "c", amount: -1, kind: "refund" as const },
      { id: "d", label: "d", amount: 1, kind: "total" as const },
    ];
    const html = [
      h(Button, { mark: true, variant: "ghost", size: "sm" }, "x"),
      h(Button, { href: "/" }, "x"),
      h(TextField, { id: "a", label: "a", error: "e", hint: "h" }),
      h(Select, { id: "s", label: "s", options: [{ value: "1", label: "1" }], error: "e", hint: "h" }),
      h(
        EstimateTable,
        { caption: "c", labels: { index: "i", name: "n", amount: "a" } },
        h(EstimateRow, { name: "n", amount: 1, note: "x" }),
        h(EstimateRow, { name: "r", amount: -1, kind: "refund" }),
      ),
      h(SumsTable, { caption: "c", unit: "u", lines: sums }),
      h(Stamp, { word: "w", meta: "m", tilt: "left" }),
      h(Stamp, { word: "w", variant: "small", tilt: "right" }),
      h(RoundStamp, { id: "r", ring: "r", date: "d", label: "l" }),
      h(StampInkDefs, {}),
      h(Tag, {}, "t"),
      ...badgeKinds.map((kind) => h(Badge, { kind, label: "l" })),
      h(Paper, { tilt: "left", badge: h(Badge, { kind: "sample", label: "s" }) }, "x"),
      h(Paper, { tilt: "right" }, "x"),
    ]
      .map((el) => render(el))
      .join("\n");
    const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => (m[1] as string).split(/\s+/)));
    const missing = [...classes].filter((c) => c.startsWith("nv-") && !new RegExp(`\\.${c}(?![\\w-])`).test(own));
    expect(missing).toEqual([]);
    expect(classes.size).toBeGreaterThan(30);
  });
});

describe("buttons (DESIGN_SYSTEM 3.1)", () => {
  const buttonRules = rules.filter((r) => /\.nv-btn/.test(r.selector));

  it("change only background and frame on hover: no lift, shadow or gradient", () => {
    const hover = buttonRules.filter((r) => /:hover/.test(r.selector));
    expect(hover.length).toBeGreaterThanOrEqual(2);
    for (const r of hover) {
      for (const [prop] of r.decls) expect(["background", "border-color", "color"], r.selector).toContain(prop);
    }
  });

  it("are 52 px tall (small 40 px) with a 2 px radius and a 150-300 ms color transition", () => {
    const base = buttonRules.find((r) => r.selector === ".nv-btn");
    const get = (r: typeof base, p: string) => r?.decls.find(([k]) => k === p)?.[1];
    expect(get(base, "min-height")).toBe("52px");
    expect(get(base, "border-radius")).toBe("var(--r1)");
    expect(get(base, "transition")).toMatch(/var\(--dur-2\)/);
    expect(
      get(
        buttonRules.find((r) => r.selector === ".nv-btn--sm"),
        "min-height",
      ),
    ).toBe("40px");
  });
});

describe("form fields", () => {
  const control = rules.find((r) => r.selector === ".nv-field__control");
  const get = (p: string) => control?.decls.find(([k]) => k === p)?.[1];

  it("are at least 44 px tall and 16 px in type, so that phones neither miss the tap nor zoom in", () => {
    expect(Number.parseInt(get("min-height") ?? "0", 10)).toBeGreaterThanOrEqual(44);
    expect(Number.parseInt(get("font-size") ?? "0", 10)).toBeGreaterThanOrEqual(16);
  });

  it("draw the frame with the secondary text color, which is >= 3:1 on every surface (WCAG 1.4.11)", () => {
    expect(get("border")).toContain("var(--ink-2)");
  });

  it("show the invalid state without relying on color alone: the message text is rendered next to the field", () => {
    const html = render(h(TextField, { id: "a", label: "A", error: "Не хватает цифр" }));
    expect(html).toContain("Не хватает цифр");
    expect(rules.some((r) => /nv-field--invalid/.test(r.selector))).toBe(true);
  });

  it("keep the placeholder at the secondary text color (>= 4.5:1), not the disabled one", () => {
    const ph = rules.find((r) => /::placeholder/.test(r.selector));
    expect(ph?.decls.find(([k]) => k === "color")?.[1]).toBe("var(--ink-2)");
  });
});

describe("motion", () => {
  it("has no mode-switch fade: no theme-shift class, no --dur-theme, no !important transition", () => {
    expect(own).not.toMatch(/theme-shift|--dur-theme|--nv-shift/);
    expect(own).not.toMatch(/!important/);
  });

  it("is instant under prefers-reduced-motion", () => {
    const reduced = rules.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.at));
    expect(reduced.some((r) => /nv-stamp--press/.test(r.selector))).toBe(true);
  });

  it("prints a stamp by scaling from 1.6 with the stamp easing over 450 ms", () => {
    expect(own).toMatch(/@keyframes nv-stamp-press/);
    expect(own).toMatch(/scale:\s*1\.6/);
    const press = rules.find((r) => r.selector === ".nv-stamp--press");
    expect(press?.decls.find(([k]) => k === "animation")?.[1]).toMatch(/450ms var\(--ease-stamp\)/);
  });
});

describe("documents", () => {
  it("are square paper on the night page: no radius, doc colors, the paper shadow", () => {
    const paper = rules.find((r) => r.selector === ".nv-paper");
    const d = Object.fromEntries(paper?.decls ?? []);
    expect(d.background).toBe("var(--doc)");
    expect(d.color).toBe("var(--doc-ink)");
    expect(d["box-shadow"]).toBe("var(--doc-shadow)");
    expect(d["border-radius"]).toBe("0");
  });

  it("tilt the paper only on wide screens", () => {
    const tilt = rules.filter((r) => /nv-paper--tilt/.test(r.selector));
    expect(tilt.length).toBeGreaterThanOrEqual(2);
    for (const r of tilt) expect(r.at).toMatch(/min-width:\s*961px/);
  });

  it("put the sample plaque over the top edge of the paper", () => {
    const r = rules.find((x) => /\.nv-paper > \.nv-badge--sample/.test(x.selector));
    const d = Object.fromEntries(r?.decls ?? []);
    expect(d.position).toBe("absolute");
    expect(d.top).toBe("-12px");
  });

  it("recolor a demo tag inside paper to the stamp ink (the accent is unreadable on night paper)", () => {
    const r = rules.find((x) => /\.nv-paper \.nv-badge--demo/.test(x.selector));
    expect(Object.fromEntries(r?.decls ?? []).color).toBe("var(--stamp)");
  });

  it("paint the small stamp with --accent-ink on the page and with --stamp only on paper (steps sit on --surface)", () => {
    const base = rules.find((x) => x.selector.trim() === ".nv-sstamp");
    expect(Object.fromEntries(base?.decls ?? []).color).toBe("var(--accent-ink)");
    const onPaper = rules.find((x) => /\.nv-paper \.nv-sstamp/.test(x.selector));
    expect(Object.fromEntries(onPaper?.decls ?? []).color).toBe("var(--stamp)");
  });

  it("show the lamp spot always (night only): the spot role, no opacity role, no fade", () => {
    const r = rules.find((x) => /\.nv-lamp::before/.test(x.selector));
    const d = Object.fromEntries(r?.decls ?? []);
    expect(d.background).toBe("var(--lamp-spot)");
    expect(d.opacity).toBeUndefined();
    expect(d.transition).toBeUndefined();
    expect(own).not.toMatch(/--lamp-opacity/);
  });

  it("have no day/night segment (the mode toggle is gone)", () => {
    expect(own).not.toMatch(/nv-seg2|nv-tod/);
  });
});

describe("index.css", () => {
  it("imports themes, fonts, base and primitives, in that order", () => {
    const imports = [...indexCss.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["../themes/themes.css", "./fonts.css", "./base.css", "./primitives.css"]);
  });
});

describe("anti-list over the whole package (tools/check-antilist.mjs)", () => {
  it("reports no violation in packages/ui", () => {
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const r = spawnSync(process.execPath, ["tools/check-antilist.mjs"], { cwd: root, encoding: "utf8" });
    const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.includes("packages/ui/"));
    expect(lines).toEqual([]);
  });
});
