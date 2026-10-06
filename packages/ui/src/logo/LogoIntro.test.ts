/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { parseCss } from "../test-support/css.ts";
import { render } from "../test-support/render.ts";
import { logoScene } from "../themes/logo-motion.ts";
import { LogoIntro } from "./LogoIntro.tsx";

const css = readFileSync(fileURLToPath(new URL("../styles/logo.css", import.meta.url)), "utf8");
const rules = parseCss(css);
const declOf = (selector: string, at = "") =>
  Object.fromEntries(rules.filter((r) => r.selector === selector && r.at === at).flatMap((r) => r.decls));

describe("LogoIntro (server render): the still lockup is the first and the fallback picture", () => {
  const html = render(h(LogoIntro));

  it("contains the lockup with the name Nivel, readable without JavaScript", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Nivel"');
    expect(html).toContain("nv-logo-intro__still");
    expect(html.match(/<path /g)?.length).toBe(6);
  });

  it("starts in the still state: the 3D has not started, the canvas is empty and the caption is hidden from assistive technology", () => {
    expect(html).toContain('data-state="still"');
    expect(html).toMatch(/<canvas class="nv-logo-intro__canvas"><\/canvas>/);
    expect(html).toMatch(/<span [^>]*aria-hidden="true"[^>]*>±0\.000<\/span>/);
  });

  it("takes the lamp pool for the background from the theme file, so the still lockup sits where the 3D frame does", () => {
    expect(html).toContain("radial-gradient");
    expect(logoScene.stage).toMatch(/^radial-gradient\(ellipse farthest-corner/);
    expect(html).toContain("background-image");
  });

  it("takes a label, a class and a mode without a trace of undefined", () => {
    const none: string | undefined = undefined as string | undefined;
    const custom = render(
      h(LogoIntro, { label: "Nivel — bosh sahifa", className: "hero", mode: "hero", introWindowMs: 500 }),
    );
    expect(custom).toContain('aria-label="Nivel — bosh sahifa"');
    expect(custom).toContain('class="nv-logo-intro hero"');
    const forwarded = render(h(LogoIntro, { label: none, className: none, mode: undefined, deps: undefined }));
    expect(forwarded).not.toContain("undefined");
  });

  it("has no sound: no audio, no video, no autoplay element", () => {
    expect(html).not.toMatch(/<audio|<video|autoplay/i);
  });
});

describe("logo.css of the intro stage", () => {
  it("keeps the canvas invisible until the 3D plays, and hides the still lockup only while it plays", () => {
    expect(declOf(".nv-logo-intro__canvas").opacity).toBe("0");
    expect(declOf('.nv-logo-intro[data-state="playing"] .nv-logo-intro__canvas').opacity).toBe("1");
    // opacity, not visibility: visibility:hidden would take the name of the logo out of the accessibility tree
    const still = declOf('.nv-logo-intro[data-state="playing"] .nv-logo-intro__still');
    expect(still.opacity).toBe("0");
    expect(still.visibility).toBeUndefined();
    expect(css).not.toMatch(/nv-logo-intro__still[^{]*{[^}]*(visibility|display)s*:s*(hidden|none)/);
    expect(css).not.toMatch(/data-state="done"|data-state="still"/);
  });

  it("frames the lockup as the camera does: 62 % of the width, 80 % below 700 px", () => {
    expect(declOf(".nv-logo-intro__still").width).toBe("62%");
    const phone = rules.filter(
      (r) => r.selector === ".nv-logo-intro__still" && r.at === "@container (max-width: 699px)",
    );
    expect(phone.map((r) => r.decls[0]?.[1])).toEqual(["80%", "min(80cqw, calc(100cqh * 0.5 * 348.6 / 83))"]);
    expect(css).toMatch(/min\(62cqw, calc\(100cqh \* 0\.5 \* 348\.6 \/ 83\)\)/);
  });

  it("makes the stage a size container with a role color, and the caption a mono label that the script moves", () => {
    const stage = declOf(".nv-logo-intro");
    expect(stage["container-type"]).toBe("size");
    expect(stage["background-color"]).toBe("var(--bg)");
    const caption = declOf(".nv-logo-intro__caption");
    expect(caption.position).toBe("absolute");
    expect(caption.opacity).toBe("0");
    expect(caption.color).toBe("var(--ink-2)");
    expect(caption.font).toContain("var(--mono)");
  });

  it("matches the camera's share of the frame in the timeline (one rule in two places)", async () => {
    const { frameFraction } = await import("../logo-motion/timeline.ts");
    expect(frameFraction(1080)).toBe(0.62);
    expect(frameFraction(699)).toBe(0.8);
  });
});
