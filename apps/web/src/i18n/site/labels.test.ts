import ruSite from "@nivel/i18n/messages/ru/site.json" with { type: "json" };
import uzSite from "@nivel/i18n/messages/uz/site.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { computeBgState, type Geometry, layoutZones } from "./bg-model.ts";
import { BG_LABEL_KEYS, buildLabels, fillLabel, makeLabel } from "./labels.ts";

function leaves(tree: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof tree !== "object" || tree === null) return out;
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out.set(`${prefix}${k}`, v);
    else for (const [kk, vv] of leaves(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}

const VH = 800;
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
const MAX = 13_300;
const geo: Geometry = {
  vh: VH,
  heroEnd: 1000,
  max: MAX,
  kak: 1000,
  docs: 3000,
  rt: 1800,
  rh: 600,
  gdoc: 10_800,
  finS: 12_900 - 0.6 * VH,
  wins: [[1500, 400]],
  zones: layoutZones(RAW, VH, MAX),
};

describe("fillLabel", () => {
  it("puts the arguments in place and leaves the unknown ones as they are", () => {
    expect(fillLabel("{date} · чеки {n}/9", { n: 4 })).toBe("{date} · чеки 4/9");
    expect(fillLabel("{a}{a}{b}", { a: "x", b: 2 })).toBe("xx2");
    expect(fillLabel("без аргументов")).toBe("без аргументов");
  });

  it("does not take a dollar or a pattern of a regular expression in the value for an instruction", () => {
    expect(fillLabel("x {a} y", { a: "$& $1 $$" })).toBe("x $& $1 $$ y");
  });
});

describe("makeLabel", () => {
  it("reads a text of the dictionary and fills the arguments", () => {
    const label = makeLabel({ "a.b": "{n} / 9" });
    expect(label("a.b", { n: 3 })).toBe("3 / 9");
  });

  it("shows the key of a missing text, so that a gap is visible and nothing breaks", () => {
    expect(makeLabel({})("no.such.key")).toBe("no.such.key");
  });
});

describe("buildLabels", () => {
  it("takes the raw text of every key and fills the arguments that are the same for the whole page", () => {
    const raw = (k: string) => (k === "bg.act.s" ? "12.10 · акт сдачи, расчёт {final}" : `${k} {n}`);
    const dict = buildLabels(["bg.act.s", "bg.x.s"], raw, { final: "70 %" });
    expect(dict).toEqual({ "bg.act.s": "12.10 · акт сдачи, расчёт 70 %", "bg.x.s": "bg.x.s {n}" });
  });
});

describe("the texts of the background", () => {
  it("are all asked for by the model, and the model asks for nothing else", () => {
    const asked = new Set<string>();
    const spy = (key: string) => {
      asked.add(key);
      return key;
    };
    for (const reduced of [false, true]) {
      for (const small of [false, true]) {
        for (let y = 0; y <= MAX; y += 9) {
          for (const life of [
            { x: 0, y: 0, h: 0, d: 0 },
            { x: 5, y: 6, h: 3, d: 0 },
          ]) {
            computeBgState({ y, geo, life, reduced, small, label: spy });
          }
        }
      }
    }
    const known = new Set(BG_LABEL_KEYS);
    // the texts the model asks for (and the stage names of the ruler, which the controller asks for itself)
    for (const k of asked) expect(known.has(k), `the model asks for ${k}`).toBe(true);
    for (const k of BG_LABEL_KEYS) {
      if (k.startsWith("bg.stage.") || k.startsWith("band.") || k.startsWith("rc.")) continue;
      expect(asked.has(k), `nothing asks for ${k}`).toBe(true);
    }
  });

  it("exist in both languages", () => {
    const uz = leaves(uzSite);
    const ru = leaves(ruSite);
    for (const k of BG_LABEL_KEYS) {
      expect(uz.has(k), `uz ${k}`).toBe(true);
      expect(ru.has(k), `ru ${k}`).toBe(true);
    }
  });

  it("are listed once", () => {
    expect(new Set(BG_LABEL_KEYS).size).toBe(BG_LABEL_KEYS.length);
  });
});
