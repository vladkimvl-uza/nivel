import { describe, expect, it } from "vitest";
import { type BgState, computeBgState, layoutZones } from "../bg-model.ts";
import { makeLabel } from "../labels.ts";
import { applyBg, type BgApplyEls, type BgTexts, createBgMemo } from "./bg.ts";
import type { ElLike } from "./dom.ts";

type FakeEl = ElLike & {
  classes: Set<string>;
  attrs: Record<string, string>;
  style: ElLike["style"] & Record<string, string>;
};

function el(): FakeEl {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  const style: Record<string, unknown> = { opacity: "", transform: "" };
  style.setProperty = (k: string, v: string) => {
    style[k] = v;
  };
  return {
    classes,
    attrs,
    classList: {
      add: (...n: string[]) => {
        for (const x of n) classes.add(x);
      },
      remove: (...n: string[]) => {
        for (const x of n) classes.delete(x);
      },
      toggle: (n: string, force?: boolean) => {
        const on = force ?? !classes.has(n);
        if (on) classes.add(n);
        else classes.delete(n);
        return on;
      },
      contains: (n: string) => classes.has(n),
    },
    style: style as FakeEl["style"],
    textContent: "",
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  };
}

function els() {
  return {
    ob: el(),
    scene: el(),
    shadeWin: el(),
    ord: el(),
    ordT: [0, 1, 2, 3, 4, 5, 6].map(el),
    ordS: el(),
    ordSt: el(),
    lv: el(),
    il: el(),
    receipts: Array.from({ length: 9 }, el),
    rcsSum: { root: el(), s: el(), ret: el() },
    asm: Array.from({ length: 8 }, el),
    labels: { x: el(), y: el(), t: el() },
    tclk: { root: el(), h: el() },
    tlog: { root: el(), c: el() },
    rstamp: el(),
    navs: [
      { href: "#kak-rabotaem", el: el() },
      { href: "#ceny", el: el() },
    ],
  } satisfies BgApplyEls;
}

const dict = {
  "rc.sum": "Чеки {n}/9 · {sum}",
  "rc.refund": "Возврат: {sum}",
  "band.x.label": "03 Закупка · чеки {n}/9",
  "band.y.label": "04 Сборка · {k}/8",
  "band.t.label": "04 Тест",
};
const texts: BgTexts = {
  label: makeLabel(dict),
  receiptSums: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  refund: "140 000",
};

const VH = 800;
const MAX = 13_300;
const RAW = [
  { id: "kak", t: 1000, h: 3000 },
  { id: "xarid", t: 4300, h: 1200 },
  { id: "yig", t: 5600, h: 1200 },
  { id: "sin", t: 6900, h: 1200 },
  { id: "pas", t: 8200, h: 1500 },
  { id: "ceny", t: 9800, h: 2000 },
  { id: "zayavka", t: 11900, h: 900 },
  { id: "fin", t: 12900, h: 900 },
] as const;
function state(
  y: number,
  o: { life?: { x: number; y: number; h: number; d: number }; reduced?: boolean } = {},
): BgState {
  return computeBgState({
    y,
    geo: {
      vh: VH,
      heroEnd: 1000,
      max: MAX,
      kak: 1000,
      docs: 3000,
      rt: 1800,
      rh: 600,
      gdoc: 10_800,
      finS: 12_900 - 0.6 * VH,
      wins: [],
      zones: layoutZones(RAW, VH, MAX),
    },
    life: o.life ?? { x: 0, y: 0, h: 0, d: 0 },
    reduced: o.reduced ?? false,
    small: false,
    label: makeLabel(dict),
  });
}

const run = (e: ReturnType<typeof els>, s: BgState, memo = createBgMemo(), reduced = false) =>
  applyBg(e, s, memo, { ...texts, reduced });

describe("applyBg", () => {
  it("shows the stage and the lamp when the page has come to them, and the shading of the zone", () => {
    const e = els();
    run(e, state(1000 - 0.6 * VH + 1));
    expect(e.ob.classes.has("is-on")).toBe(true);
    expect(e.ob.classes.has("is-lit")).toBe(true);
    expect(e.ob.attrs["data-sh"]).toBe("l");
    expect(e.ord.classes.has("is-on")).toBe(true);
  });

  it("shows nothing over the first screen", () => {
    const e = els();
    run(e, state(0));
    expect(e.ob.classes.has("is-on")).toBe(false);
    expect(e.ord.classes.has("is-on")).toBe(false);
  });

  it("marks the steps of the ruler: done before the current, current, and the preview of the route", () => {
    const e = els();
    run(e, state(5600 - 0.3 * VH + 0.5 * (1200 - 0.7 * VH))); // assembly: step 04
    expect(e.ordT.map((t) => [...t.classes].join(""))).toEqual([
      "is-done",
      "is-done",
      "is-done",
      "is-done",
      "is-cur",
      "",
      "",
    ]);
    const r = els();
    run(r, state(1800 - 400 + 250)); // the route shows documents 1 to 3: no current step
    expect(r.ordT.map((t) => [...t.classes].join(""))).toEqual(["", "is-pv", "is-pv", "is-pv", "", "", ""]);
  });

  it("writes the text of the ruler and the stamp, and repeats the stamp animation for a new stamp only", () => {
    const e = els();
    const memo = createBgMemo();
    run(e, state(5600 - 0.3 * VH + 0.5 * (1200 - 0.7 * VH)), memo);
    expect(e.ordS.textContent).toMatch(/^bg\.y\.s|\d\/8/);
    const zone = layoutZones(RAW, VH, MAX)[1];
    const done = state(zone ? zone.t - 0.3 * VH + (zone.h - 0.7 * VH) : 0);
    run(e, done, memo);
    expect(e.ordSt.textContent).toBe("route.st3.stamp");
    expect(e.ordSt.classes.has("is-in")).toBe(true);
    expect(e.ordSt.classes.has("is-seat")).toBe(true);
    run(e, done, memo);
    expect(e.ordSt.classes.has("is-seat")).toBe(true);
  });

  it("does not play the stamp animation under reduced motion", () => {
    const e = els();
    const zone = layoutZones(RAW, VH, MAX)[1];
    run(e, state(zone ? zone.t - 0.3 * VH + (zone.h - 0.7 * VH) : 0), createBgMemo(), true);
    expect(e.ordSt.classes.has("is-in")).toBe(true);
    expect(e.ordSt.classes.has("is-seat")).toBe(false);
  });

  it("draws the level line as the progress of the order and keeps it dim until the lamp is on", () => {
    const e = els();
    run(e, state(1000 - 0.6 * VH + 1));
    expect(e.lv.style.transform).toBe("scaleX(0)");
    const f = els();
    run(f, state(MAX));
    expect(f.lv.style.transform).toBe("scaleX(1)");
    expect(f.lv.style.opacity).toBe("0.8");
  });

  it("puts the receipts on the table: the first n are in, the last one is new while they come", () => {
    const e = els();
    const memo = createBgMemo();
    const zone = layoutZones(RAW, VH, MAX)[1];
    const at = (share: number) => (zone ? zone.t - 0.3 * VH + share * (zone.h - 0.7 * VH) : 0);
    run(e, state(at(0.005)), memo);
    expect(e.receipts.filter((r) => r.classes.has("is-in"))).toHaveLength(0);
    run(e, state(at(0.2)), memo);
    const n = e.receipts.filter((r) => r.classes.has("is-in")).length;
    expect(n).toBe(3);
    expect(e.receipts[n - 1]?.classes.has("is-new")).toBe(true);
    expect(e.rcsSum.s.textContent).toBe("Чеки 3/9 · 3");
    expect(e.labels.x.textContent).toBe("03 Закупка · чеки 3/9");
    run(e, state(at(1)), memo);
    expect(e.receipts.every((r) => r.classes.has("is-in"))).toBe(true);
    expect(e.rcsSum.root.classes.has("is-all")).toBe(true);
    expect(e.rcsSum.ret.textContent).toBe("Возврат: 140 000");
  });

  it("does not mark a receipt as new when the scroll went back", () => {
    const e = els();
    const memo = createBgMemo();
    const zone = layoutZones(RAW, VH, MAX)[1];
    const at = (share: number) => (zone ? zone.t - 0.3 * VH + share * (zone.h - 0.7 * VH) : 0);
    run(e, state(at(0.5)), memo);
    run(e, state(at(0.2)), memo);
    expect(e.receipts.some((r) => r.classes.has("is-new"))).toBe(false);
  });

  it("marks the parts of the assembly: done, current, waiting", () => {
    const e = els();
    const zone = layoutZones(RAW, VH, MAX)[2];
    const s = state(zone ? zone.t - 0.3 * VH + 0.5 * (zone.h - 0.7 * VH) : 0);
    run(e, s);
    expect(e.asm.slice(0, s.assembly).every((li) => li.classes.has("is-done"))).toBe(true);
    expect(e.asm[s.assembly]?.classes.has("is-cur")).toBe(true);
    expect(e.asm.slice(s.assembly + 1).every((li) => li.classes.size === 0)).toBe(true);
    expect(e.labels.y.textContent).toBe(`04 Сборка · ${s.assembly + 1}/8`);
  });

  it("runs the clock of the test and marks the end of it, and draws the log and the round stamp", () => {
    const e = els();
    const memo = createBgMemo();
    const zone = layoutZones(RAW, VH, MAX)[3];
    const at = (share: number) => (zone ? zone.t - 0.3 * VH + share * (zone.h - 0.7 * VH) : 0);
    run(e, state(at(0.5)), memo);
    expect(e.tclk.h.textContent).toMatch(/^0\d:\d0$/);
    expect(e.tclk.root.classes.has("is-done")).toBe(false);
    expect(e.rstamp.classes.has("is-in")).toBe(false);
    run(e, state(at(1)), memo);
    expect(e.tclk.h.textContent).toBe("08:00");
    expect(e.tclk.root.classes.has("is-done")).toBe(true);
    expect(e.tlog.c.textContent).toBe("08:00");
    expect(e.tlog.root.style["--d"]).toBe("0.000");
    expect(e.rstamp.classes.has("is-in")).toBe(true);
  });

  it("shows the caption «Illustration» only over a clip", () => {
    const e = els();
    const zone = layoutZones(RAW, VH, MAX)[1];
    run(e, state(zone ? zone.t : 0));
    expect(e.il.classes.has("is-in")).toBe(true);
    run(e, state(9000));
    expect(e.il.classes.has("is-in")).toBe(false);
  });

  it("makes the header link of the zone the current one", () => {
    const e = els();
    run(e, state(1200));
    expect(e.navs.map((n) => n.el.classes.has("is-cur"))).toEqual([true, false]);
    run(e, state(10_000));
    expect(e.navs.map((n) => n.el.classes.has("is-cur"))).toEqual([false, true]);
    run(e, state(5000));
    expect(e.navs.map((n) => n.el.classes.has("is-cur"))).toEqual([false, false]);
  });

  it("puts the stage image to the scale of the zone", () => {
    const e = els();
    run(e, state(1200));
    expect(e.scene.style.transform).toMatch(/^scale\(1\./);
    run(e, state(9000));
    expect(e.scene.style.transform).toBe("none");
  });

  it("writes only what changed", () => {
    const e = els();
    const memo = createBgMemo();
    run(e, state(1200), memo);
    e.ordS.textContent = "marker";
    run(e, state(1200), memo);
    expect(e.ordS.textContent).toBe("marker");
  });
});
