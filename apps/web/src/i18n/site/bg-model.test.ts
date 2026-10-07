import { describe, expect, it } from "vitest";
import {
  addDays,
  type BgInput,
  clipStop,
  computeBgState,
  formatClock,
  type Geometry,
  layoutZones,
  locateZone,
  pin,
  YC,
  ymap,
  ZONES,
} from "./bg-model.ts";

const VH = 800;

// A page of the one-page site: the first screen ends at 1000, then the sections in the order of the real page.
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
const MAX = 13800 - VH + 300; // the document is 13 800 + 300 px high

function geo(): Geometry {
  return {
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
  };
}

/** A label that shows what was asked for, so a test can see the key and the arguments. */
const label = (key: string, params?: Record<string, string | number>) =>
  params
    ? `${key}|${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}`
    : key;

function at(y: number, o: Partial<BgInput> = {}) {
  return computeBgState({ y, geo: geo(), life: { x: 0, y: 0, h: 0, d: 0 }, reduced: false, small: false, label, ...o });
}

describe("ZONES", () => {
  it("names the zones of the page in order", () => {
    expect(ZONES.map((z) => z.id)).toEqual(["kak", "xarid", "yig", "sin", "pas", "ceny", "zayavka", "fin"]);
  });
});

describe("layoutZones", () => {
  const zones = layoutZones(RAW, VH, MAX);

  it("lets a pinned band begin a third of a screen early and end a third of a screen late", () => {
    const x = zones[1];
    expect(x?.a).toBe(4300 - 0.35 * VH);
    expect(zones[0]?.b).toBe(x?.a);
  });

  it("starts a plain section where the one before ended, with no gap and no overlap", () => {
    for (let i = 1; i < zones.length; i++) expect(zones[i - 1]?.b).toBe(zones[i]?.a);
  });

  it("ends the last zone below the bottom of the page", () => {
    expect(zones.at(-1)?.b).toBe(MAX + VH);
  });

  it("carries the shading of each zone", () => {
    expect(zones.map((z) => z.sh)).toEqual(["l", "b", "b", "b", "l", "c", "c", "f"]);
  });
});

describe("locateZone", () => {
  const zones = layoutZones(RAW, VH, MAX);

  it("finds the zone of the middle of the screen", () => {
    expect(locateZone(zones, 1500)).toBe(0);
    expect(locateZone(zones, 4900)).toBe(1);
    expect(locateZone(zones, 6000)).toBe(2);
    expect(locateZone(zones, 13_500)).toBe(7);
  });

  it("takes the first zone above the first", () => {
    expect(locateZone(zones, -5)).toBe(0);
  });
});

describe("pin: the share of a pinned scene", () => {
  const z = layoutZones(RAW, VH, MAX)[1];

  it("is zero when the table enters and one when the pinning ends", () => {
    if (!z) throw new Error("no zone");
    expect(pin(z, 4300 - 0.3 * VH, VH)).toBe(0);
    expect(pin(z, 4300 - 0.3 * VH + (1200 - 0.7 * VH), VH)).toBe(1);
    expect(pin(z, 0, VH)).toBe(0);
    expect(pin(z, 99_999, VH)).toBe(1);
  });
});

describe("ymap: the chapters of the assembly clip", () => {
  it("goes from 0 to 1 and passes the borders of the chapters", () => {
    expect(ymap(0)).toBe(0);
    expect(ymap(1)).toBeCloseTo(1, 9);
    expect(ymap(1 / 8)).toBeCloseTo(YC[1] as number, 9);
    expect(ymap(0.5)).toBeCloseTo(YC[4] as number, 9);
    expect(ymap(-3)).toBe(0);
    expect(ymap(3)).toBeCloseTo(1, 9);
  });

  it("is steepest inside the chapter of the processor", () => {
    const slope = (a: number, b: number) => (ymap(b) - ymap(a)) / (b - a);
    expect(slope(1 / 8, 2 / 8)).toBeGreaterThan(slope(2 / 8, 3 / 8) * 4);
  });
});

describe("clipStop: how far a clip plays by itself", () => {
  it("plays the clip of the purchase only up to the share of the receipts that have come", () => {
    expect(clipStop("x", 0, 2)).toBeCloseTo(0.08 * 2, 9);
    expect(clipStop("x", 9, 2)).toBeCloseTo(2, 9);
    expect(clipStop("x", 3, 1.8)).toBeCloseTo(0.6, 9);
  });

  it("plays the clip of the assembly to the end of the chapter of the current item", () => {
    expect(clipStop("y", 0, 4)).toBeCloseTo((YC[1] as number) * 4, 9);
    expect(clipStop("y", 7, 4)).toBeCloseTo(4, 9);
  });
});

describe("formatClock and addDays", () => {
  it("writes the clock of the test in steps of ten minutes", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(0.16)).toBe("00:00");
    expect(formatClock(1 / 6)).toBe("00:10");
    expect(formatClock(3.5)).toBe("03:30");
    expect(formatClock(8)).toBe("08:00");
  });

  it("counts the days of the warranty from the day of the handover, 12.10.2026", () => {
    expect(addDays(0)).toBe("12.10.2026");
    expect(addDays(1)).toBe("13.10.2026");
    expect(addDays(20)).toBe("01.11.2026");
    expect(addDays(365)).toBe("12.10.2027");
  });
});

describe("computeBgState: where the page is on the way of the order NV-0001", () => {
  it("shows nothing while the first screen covers the window", () => {
    const s = at(0);
    expect(s.on).toBe(false);
    expect(s.rulerVisible).toBe(false);
    expect(s.zone).toBeNull();
    expect(s.illustration).toBe(false);
  });

  it("shows the background but not the lamp or the ruler until How we work comes to the lower part of the window", () => {
    const s = at(1000 - VH + 10); // the top of the page is 760 px below the top of the window, more than 60 %
    expect(s.on).toBe(true);
    expect(s.lit).toBe(false);
    expect(s.rulerVisible).toBe(false);
  });

  it("turns the lamp and the ruler on when How we work reaches the upper 60 % of the window", () => {
    const s = at(1000 - 0.6 * VH + 1);
    expect(s.lit).toBe(true);
    expect(s.rulerVisible).toBe(true);
  });

  describe("How we work", () => {
    it("is the route preview: no current step, the cursor blinks, the light stage", () => {
      const s = at(1200);
      expect(s.zone).toBe("kak");
      expect(s.sh).toBe("l");
      expect(s.stage).toBe("k");
      expect(s.cur).toBe(-1);
      expect(s.caret).toBe(true);
      expect(s.nav).toBe("#kak-rabotaem");
      expect(s.s).toBe("bg.idle.s");
      expect(s.ss).toBe("bg.idle.ss");
      expect(s.pv).toBe(0);
      expect(s.illustration).toBe(false);
    });

    it("previews the six documents one after another while the route goes by", () => {
      // the window centre is y + 400; the route starts at 1800 and is 600 high: six steps of 100
      expect(at(1800 - 400 - 1).pv).toBe(0);
      expect(at(1800 - 400 + 50).pv).toBe(1);
      expect(at(1800 - 400 + 250).pv).toBe(3);
      expect(at(1800 - 400 + 599).pv).toBe(6);
      expect(at(1800 - 400 + 650).pv).toBe(6);
      const s = at(1800 - 400 + 250);
      expect(s.s).toBe("bg.route.s|n=3,title=route.st3.title,doc=route.st3.doc");
      expect(s.ss).toBe("bg.route.ss|n=3,title=route.st3.title");
      expect(s.st).toBe("route.st3.stamp");
    });

    it("shows no stamp on a phone", () => {
      expect(at(1800 - 400 + 250, { small: true }).st).toBe("");
    });

    it("zooms the stage slowly while the reader goes down", () => {
      const a = at(1000 - 300);
      const b = at(2800);
      expect(a.scale).not.toBe("none");
      expect(b.scale).not.toBe("none");
      expect(Number(/scale\((.*)\)/.exec(b.scale)?.[1])).toBeGreaterThan(Number(/scale\((.*)\)/.exec(a.scale)?.[1]));
    });

    it("gives a phone the short line, and a computer the long one", () => {
      expect(at(1800 - 400 + 250, { small: true }).text).toBe("bg.route.ss|n=3,title=route.st3.title");
      expect(at(1200, { small: true }).text).toBe("bg.idle.ss");
      expect(at(1800 - 400 + 250).text).toBe("bg.route.s|n=3,title=route.st3.title,doc=route.st3.doc");
    });
  });

  describe("03 Purchase", () => {
    const zone = layoutZones(RAW, VH, MAX)[1];
    const yAt = (share: number) => (zone ? zone.t - 0.3 * VH + share * (zone.h - 0.7 * VH) : 0);

    it("is a pinned scene with the clip of the processor and the first receipts", () => {
      const s = at(yAt(0.2));
      expect(s.zone).toBe("xarid");
      expect(s.sh).toBe("b");
      expect(s.stage).toBe("x");
      expect(s.cur).toBe(3);
      expect(s.illustration).toBe(true);
      expect(s.caret).toBe(false);
      expect(s.scale).toBe("none");
      expect(s.receipts).toBeGreaterThan(0);
      expect(s.receipts).toBeLessThan(9);
    });

    it("puts the receipts on the table as the scroll goes: none at the start, all nine at the end", () => {
      expect(at(yAt(0.005)).receipts).toBe(0);
      expect(at(yAt(0.5)).receipts).toBeGreaterThan(3);
      expect(at(yAt(1)).receipts).toBe(9);
    });

    it("lets the receipts come by themselves, one for each 2.6 s that life has run", () => {
      const quiet = at(yAt(0.005), { life: { x: 0, y: 0, h: 0, d: 0 } });
      const lived = at(yAt(0.005), { life: { x: 2.4, y: 0, h: 0, d: 0 } });
      expect(lived.receipts).toBe(quiet.receipts + 2);
      expect(lived.need).toBe(true);
    });

    it("needs no more life once all nine have come", () => {
      expect(at(yAt(1)).need).toBe(false);
    });

    it("dates the receipts: the first five on 06.10, the rest on 07.10, and stamps the last", () => {
      expect(at(yAt(0.2)).s).toMatch(/^bg\.x\.s\|date=06\.10,n=\d$/);
      const done = at(yAt(1));
      expect(done.s).toBe("bg.x.s|date=07.10,n=9");
      expect(done.st).toBe("route.st3.stamp");
      expect(done.clip).toBeGreaterThan(0.99);
    });

    it("shows everything at once under reduced motion", () => {
      const s = at(yAt(0.005), { reduced: true });
      expect(s.receipts).toBe(9);
      expect(s.need).toBe(false);
    });

    it("moves the ruler along: the share of the purchase is a third of the way through the order", () => {
      expect(at(yAt(1)).progress).toBeCloseTo(4 / 7, 6);
    });
  });

  describe("04 Assembly", () => {
    const zone = layoutZones(RAW, VH, MAX)[2];
    const yAt = (share: number) => (zone ? zone.t - 0.3 * VH + share * (zone.h - 0.7 * VH) : 0);

    it("sets the parts in the case one by one, item 0 to 7", () => {
      expect(at(yAt(0)).assembly).toBe(0);
      expect(at(yAt(1)).assembly).toBe(7);
      const mid = at(yAt(0.5)).assembly;
      expect(mid).toBeGreaterThan(2);
      expect(mid).toBeLessThan(6);
    });

    it("is the stage of the clip of the assembly with the caption and the item in the ruler", () => {
      const s = at(yAt(0.5));
      expect(s.zone).toBe("yig");
      expect(s.stage).toBe("y");
      expect(s.cur).toBe(4);
      expect(s.illustration).toBe(true);
      expect(s.s).toMatch(/^bg\.y\.s\|k=\d,name=bg\.asm\.\d$/);
      expect(s.ss).toMatch(/^bg\.y\.ss\|k=\d$/);
    });

    it("keeps the clip inside the chapter of the current item when the item came by itself", () => {
      const driven = at(yAt(0.005));
      const lived = at(yAt(0.005), { life: { x: 0, y: 3.2, h: 0, d: 0 } });
      expect(lived.assembly).toBe(driven.assembly + 3);
      expect(lived.clip).toBeCloseTo(YC[lived.assembly] as number, 9);
    });

    it("shows all parts under reduced motion", () => {
      expect(at(yAt(0), { reduced: true }).assembly).toBe(7);
    });
  });

  describe("04 Test", () => {
    const zone = layoutZones(RAW, VH, MAX)[3];
    const yAt = (share: number) => (zone ? zone.t - 0.3 * VH + share * (zone.h - 0.7 * VH) : 0);

    it("starts the clock of the eight-hour test at zero and ends it at 08:00 with no errors", () => {
      const a = at(yAt(0.001));
      expect(a.zone).toBe("sin");
      expect(a.stage).toBe("t");
      expect(a.hours).toBeLessThan(0.1);
      expect(a.s).toBe("bg.t.s|clock=00:00");
      const b = at(yAt(1));
      expect(b.hours).toBe(8);
      expect(b.s).toBe("bg.t.done.s");
      expect(b.ss).toBe("bg.t.done.ss");
      expect(b.st).toBe("route.st4.stamp");
      expect(b.need).toBe(false);
    });

    it("runs the clock by itself, one hour for each 4 s of life", () => {
      const a = at(yAt(0.001), { life: { x: 0, y: 0, h: 2, d: 0 } });
      expect(a.hours).toBeGreaterThan(2);
      expect(a.need).toBe(true);
    });
  });

  describe("Passport, prices, the request and the finale", () => {
    it("shows the passport on the light stage with the test already done", () => {
      const s = at(9000);
      expect(s.zone).toBe("pas");
      expect(s.sh).toBe("l");
      expect(s.stage).toBe("k");
      expect(s.hours).toBe(8);
      expect(s.s).toBe("bg.pas.s");
      expect(s.st).toBe("route.st4.stamp");
      expect(s.cur).toBe(4);
      expect(s.illustration).toBe(false);
    });

    it("shows the act and the settlement before the warranty document and the warranty after it", () => {
      const before = at(9900 - 100);
      expect(before.zone).toBe("ceny");
      expect(before.sh).toBe("c");
      expect(before.stage).toBe("c");
      expect(before.cur).toBe(5);
      expect(before.s).toMatch(/^bg\.act\.s/);
      const after = at(10_700);
      expect(after.cur).toBe(6);
      expect(after.s).toBe("bg.done.s");
      expect(after.st).toBe("route.st5.stamp");
    });

    it("keeps the warranty state in the zone of the request", () => {
      const s = at(11_500);
      expect(s.zone).toBe("zayavka");
      expect(s.cur).toBe(6);
      expect(s.stage).toBe("c");
      expect(s.nav).toBe("#zayavka");
    });

    it("runs the days of the warranty year while the finale scrolls, and closes the order at the bottom", () => {
      const mid = at(12_900 - 0.6 * VH + 0.5 * (MAX - (12_900 - 0.6 * VH)));
      expect(mid.zone).toBe("fin");
      expect(mid.sh).toBe("f");
      expect(mid.cur).toBe(6);
      expect(mid.s).toMatch(/^bg\.fin\.run\.s(Care)?\|date=\d\d\.\d\d\.\d{4},d=\d+$/);
      const end = at(MAX);
      expect(end.s).toBe("bg.fin.closed.s");
      expect(end.ss).toBe("bg.fin.closed.ss");
      expect(end.st).toBe("bg.fin.closed.st");
      expect(end.progress).toBe(1);
    });

    it("marks the care visit in the middle of the warranty year", () => {
      // 170-215 days of 365: q between 0.4 and 0.49 (q is the share of 0.9 of the way)
      const finS = 12_900 - 0.6 * VH;
      const y = finS + 0.9 * 0.5 * (MAX - finS);
      const s = at(y);
      expect(s.s).toMatch(/bg\.fin\.run\.sCare/);
      expect(s.st).toBe("bg.fin.care");
    });

    it("has the whole year run by 90 % of the way", () => {
      const finS = 12_900 - 0.6 * VH;
      const s = at(finS + 0.93 * (MAX - finS));
      expect(s.s).toBe("bg.fin.year.s");
    });
  });

  it("shows the caption «Illustration» only while the lamp is on and the stage is a clip", () => {
    const zone = layoutZones(RAW, VH, MAX)[1];
    expect(at(zone ? zone.t : 0).illustration).toBe(true);
    expect(at(1200).illustration).toBe(false);
    expect(at(9000).illustration).toBe(false);
  });

  it("holds a window of the open scene between the blocks on a phone", () => {
    const g = geo();
    g.wins = [[1500, 400]];
    const s = computeBgState({
      y: 1500 + 200 - 400,
      geo: g,
      life: { x: 0, y: 0, h: 0, d: 0 },
      reduced: false,
      small: true,
      label,
    });
    expect(s.win).toBe(1);
    expect(s.winShift).toBe(0);
    const far = computeBgState({
      y: 700,
      geo: g,
      life: { x: 0, y: 0, h: 0, d: 0 },
      reduced: false,
      small: true,
      label,
    });
    expect(far.win).toBe(0);
  });
});
