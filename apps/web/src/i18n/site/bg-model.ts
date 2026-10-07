// The background below the first screen, «One order under the lamp» (docs/design/hero-video/bg.js, round 10): the scroll is the
// time of the order NV-0001. This module is the whole state machine as a pure function: from the scroll position and the page
// geometry to what the page shows (the ruler "Course of the order", the receipts on the table, the parts in the case, the clock
// of the test, the stage of the background). The DOM and the clips are the business of bg-controller.ts.
//
// Compared with the prototype the configurator and "Ideas" zones are gone (they belong to R1, BUILD_PLAN WP-19 and WP-20),
// and a zone of the request form is added. The captions come through `label(key, params)`, the texts live in
// packages/i18n/messages/*/site.json.

export type ZoneId = "kak" | "xarid" | "yig" | "sin" | "pas" | "ceny" | "zayavka" | "fin";
export type Shade = "l" | "u" | "b" | "c" | "f";
export type Stage = "k" | "x" | "y" | "t" | "c";

interface ZoneMeta {
  id: ZoneId;
  /** Shading of the background behind the text of the zone. */
  sh: Shade;
  /** The link of the header that is current in the zone. */
  nav: string | null;
  /** A pinned scene of its own (150 screen heights tall): its frame starts a third of a screen early. */
  band: boolean;
}

export const ZONES: readonly ZoneMeta[] = [
  { id: "kak", sh: "l", nav: "#kak-rabotaem", band: false },
  { id: "xarid", sh: "b", nav: null, band: true },
  { id: "yig", sh: "b", nav: null, band: true },
  { id: "sin", sh: "b", nav: null, band: true },
  { id: "pas", sh: "l", nav: null, band: false },
  { id: "ceny", sh: "c", nav: "#ceny", band: false },
  { id: "zayavka", sh: "c", nav: "#zayavka", band: false },
  { id: "fin", sh: "f", nav: null, band: true },
];

export interface Zone extends ZoneMeta {
  /** Top of the section on the page, px. */
  t: number;
  h: number;
  /** The span of the scroll (middle of the window) in which the zone is the current one. */
  a: number;
  b: number;
}

export interface Geometry {
  vh: number;
  /** Bottom of the track of the first screen. */
  heroEnd: number;
  /** The largest scroll position. */
  max: number;
  /** Top of «How we work». */
  kak: number;
  /** Top of the documents block of «How we work». */
  docs: number;
  /** Top and height of the route of six steps. */
  rt: number;
  rh: number;
  /** Top of the warranty document. */
  gdoc: number;
  /** Where the finale begins to count the days of the warranty. */
  finS: number;
  /** Pauses on a phone: top and height of each. */
  wins: readonly (readonly [number, number])[];
  zones: readonly Zone[];
}

export function layoutZones(raw: readonly { id: ZoneId; t: number; h: number }[], vh: number, max: number): Zone[] {
  const zones: Zone[] = raw.map((r) => {
    const meta = ZONES.find((z) => z.id === r.id);
    if (!meta) throw new Error(`unknown zone ${r.id}`);
    return {
      ...meta,
      t: r.t,
      h: r.h,
      a: meta.band ? r.t - 0.35 * vh : r.t,
      b: meta.band ? r.t + r.h + 0.35 * vh : r.t + r.h,
    };
  });
  for (let i = 1; i < zones.length; i++) {
    const z = zones[i] as Zone;
    const before = zones[i - 1] as Zone;
    if (z.band) before.b = z.a;
    else z.a = before.b;
  }
  const last = zones[zones.length - 1];
  if (last) last.b = max + vh;
  return zones;
}

/** The zone the middle of the window is in. */
export function locateZone(zones: readonly Zone[], center: number): number {
  let i = 0;
  for (let k = 1; k < zones.length; k++) if (center >= (zones[k] as Zone).a) i = k;
  return i;
}

const cl = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (v: number): number => {
  const c = cl(v);
  return c * c * (3 - 2 * c);
};

/** The share of a pinned scene: from the table entering the window to the end of the pinning. */
export function pin(z: Zone, y: number, vh: number): number {
  return cl((y - (z.t - 0.3 * vh)) / (z.h - 0.7 * vh));
}

/** Share of the clip of the assembly at which the chapter of each item of the list starts (pipeline/bg/cy.py). */
export const YC: readonly number[] = [0, 0.0962, 0.3846, 0.4423, 0.5769, 0.7692, 0.8462, 0.9231, 1];

/** The position in the clip for the share of the scene: the chapters have their own lengths. */
export function ymap(u: number): number {
  const v = cl(u) * 8;
  const k = Math.min(7, Math.floor(v));
  const from = YC[k] as number;
  return from + ((YC[k + 1] as number) - from) * (v - k);
}

/** Where a clip stops when it plays by itself: seconds from its start; `n` is the receipts that came or the item set. */
export function clipStop(kind: "x" | "y", n: number, duration: number): number {
  return kind === "x" ? Math.max(0.08, n / 9) * duration : (YC[Math.min(7, n) + 1] as number) * duration;
}

/** "03:30": the clock of the test in steps of ten minutes. */
export function formatClock(hours: number): string {
  const minutes = Math.floor(hours * 6) * 10;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The date `d` days after the handover of the sample order, 12.10.2026: "01.11.2026". */
export function addDays(d: number): string {
  const t = new Date(Date.UTC(2026, 9, 12 + d));
  return `${String(t.getUTCDate()).padStart(2, "0")}.${String(t.getUTCMonth() + 1).padStart(2, "0")}.${t.getUTCFullYear()}`;
}

export type Label = (key: string, params?: Record<string, string | number>) => string;

/** Seconds of life already run in each zone (the process goes on by itself while the reader stays). */
export interface Life {
  x: number;
  y: number;
  h: number;
  d: number;
}

export interface BgInput {
  y: number;
  geo: Geometry;
  life: Life;
  reduced: boolean;
  small: boolean;
  label: Label;
}

export interface BgState {
  /** The background is on the screen (the first screen has gone). */
  on: boolean;
  /** The lamp is on. */
  lit: boolean;
  rulerVisible: boolean;
  zone: ZoneId | null;
  zoneIndex: number;
  sh: Shade;
  nav: string | null;
  caret: boolean;
  /** `transform` of the stage image. */
  scale: string;
  stage: Stage;
  /** Position of the clip of the stage, 0..1. */
  clip: number;
  receipts: number;
  /** Item of the assembly list that is being set, -1..7. */
  assembly: number;
  /** The item came by itself (the process went on without the scroll): its clip starts from the chapter of the item. */
  advanced: boolean;
  /** Clock of the test, hours, 0..8. */
  hours: number;
  /** Current step of the order on the ruler, 0..6, or -1. */
  cur: number;
  /** Steps of the route previewed so far, 0..6. */
  pv: number;
  s: string;
  ss: string;
  /** Text of the ruler for this window: long on a computer, short on a phone. */
  text: string;
  st: string;
  /** Progress of the order, 0..1, for the level line under the ruler. */
  progress: number;
  /** The caption «Illustration» is shown (the clip on the stage is not our work). */
  illustration: boolean;
  /** The process goes on by itself: the controller ticks the life. */
  need: boolean;
  /** Pause of the open scene on a phone, 0..1, and the shift of its band. */
  win: number;
  winShift: number;
}

const OFF: BgState = {
  on: false,
  lit: false,
  rulerVisible: false,
  zone: null,
  zoneIndex: -1,
  sh: "l",
  nav: null,
  caret: false,
  scale: "none",
  stage: "k",
  clip: 0,
  receipts: 0,
  assembly: -1,
  advanced: false,
  hours: 0,
  cur: -1,
  pv: 0,
  s: "",
  ss: "",
  text: "",
  st: "",
  progress: 0,
  illustration: false,
  need: false,
  win: 0,
  winShift: 0,
};

export function computeBgState(i: BgInput): BgState {
  const { y, geo, life, reduced, small, label: L } = i;
  const { vh } = geo;
  const c = y + vh * 0.5;
  const on = y + vh > geo.heroEnd - 2;
  const lit = geo.kak - y < 0.6 * vh;
  if (!on) return { ...OFF, lit };

  const zi = locateZone(geo.zones, c);
  const z = geo.zones[zi] as Zone;

  let cur = 3;
  let pv = 0;
  let s = "";
  let ss = "";
  let st = "";
  let scale = "none";
  let stage: Stage = "k";
  let clip = 0;
  let receipts = 0;
  let assembly = -1;
  let advanced = false;
  let hours = 0;
  let progress = 0;
  let need = false;
  let pf = true;
  let win = 0;
  let winShift = 0;

  const stamp = (n: number) => L(`route.st${n}.stamp`);

  switch (z.id) {
    case "kak": {
      cur = -1;
      const g = cl((c - geo.docs) / (z.b - geo.docs));
      scale = `scale(${(1 + 0.04 * cl((c - geo.kak) / (geo.docs - geo.kak)) + 0.2 * g).toFixed(4)})`;
      pv = c < geo.rt ? 0 : Math.min(6, 1 + Math.floor(((c - geo.rt) / geo.rh) * 6));
      if (c > geo.rt + geo.rh) pv = 6;
      if (pv > 0) {
        st = small ? "" : stamp(pv);
        s = L("bg.route.s", { n: pv, title: L(`route.st${pv}.title`), doc: L(`route.st${pv}.doc`) });
        ss = L("bg.route.ss", { n: pv, title: L(`route.st${pv}.title`) });
      } else {
        s = L("bg.idle.s");
        ss = L("bg.idle.ss");
      }
      pf = false;
      // the pauses of the open scene between the blocks (phones only)
      let wd = 0;
      for (const [top, height] of geo.wins) {
        const d = top + height / 2 - c;
        const v = 1 - sm((Math.abs(d) - 0.3 * vh) / (0.3 * vh));
        if (v > win) {
          win = v;
          wd = d;
        }
      }
      win = Math.round(win * 20) / 20;
      winShift = win > 0 ? Math.round(wd) : 0;
      break;
    }
    case "xarid": {
      const pp = pin(z, y, vh);
      stage = "x";
      clip = cl(pp / 0.9);
      receipts = reduced ? 9 : Math.min(9, (pp <= 0.01 ? 0 : Math.floor((pp / 0.88) * 9) + 1) + Math.floor(life.x));
      need = receipts < 9;
      const date = receipts < 6 ? "06.10" : "07.10";
      s = L("bg.x.s", { date, n: receipts });
      ss = L("bg.x.ss", { date, n: receipts });
      st = receipts === 9 ? stamp(3) : "";
      progress = (3 + receipts / 9) / 7;
      break;
    }
    case "yig": {
      const pa = pin(z, y, vh);
      stage = "y";
      assembly = reduced ? 7 : Math.min(7, Math.floor(cl(pa / 0.92) * 7.99) + Math.floor(life.y));
      need = assembly < 7;
      // the frame follows the item: the scroll drives it inside a chapter, an item that came by itself starts its chapter
      const u = cl(pa / 0.92) * 8;
      const driven = Math.min(7, Math.floor(u));
      advanced = assembly > driven;
      clip = advanced ? (YC[assembly] as number) : ymap(pa / 0.92);
      s = L("bg.y.s", { k: assembly + 1, name: L(`bg.asm.${assembly}`) });
      ss = L("bg.y.ss", { k: assembly + 1 });
      cur = 4;
      progress = (4 + (assembly / 8) * 0.4) / 7;
      break;
    }
    case "sin": {
      const pt = pin(z, y, vh);
      stage = "t";
      hours = reduced ? 8 : Math.min(8, cl(pt / 0.9) * 8 + life.h);
      need = hours < 8;
      if (hours < 8) {
        s = L("bg.t.s", { clock: formatClock(hours) });
        ss = L("bg.t.ss", { clock: formatClock(hours) });
      } else {
        s = L("bg.t.done.s");
        ss = L("bg.t.done.ss");
        st = stamp(4);
      }
      cur = 4;
      progress = (4.4 + (hours / 8) * 0.6) / 7;
      break;
    }
    case "pas": {
      hours = 8;
      s = L("bg.pas.s");
      ss = L("bg.pas.ss");
      st = stamp(4);
      cur = 4;
      progress = 5 / 7;
      break;
    }
    case "ceny":
    case "zayavka": {
      stage = "c";
      const done = geo.gdoc - y < vh * 0.67 || z.id === "zayavka";
      cur = done ? 6 : 5;
      s = done ? L("bg.done.s") : L("bg.act.s");
      ss = done ? L("bg.done.ss") : L("bg.act.ss");
      st = done ? stamp(5) : "";
      progress = (done ? 6 : 5.6) / 7;
      break;
    }
    case "fin": {
      stage = "c";
      cur = 6;
      const q = cl((y - geo.finS) / (geo.max - geo.finS));
      const dd = Math.round(cl(q / 0.9) * 365);
      if (q >= 0.96) {
        s = L("bg.fin.closed.s");
        ss = L("bg.fin.closed.ss");
        st = L("bg.fin.closed.st");
      } else if (dd >= 365) {
        s = L("bg.fin.year.s");
        ss = L("bg.fin.year.ss");
      } else {
        const care = dd >= 170 && dd <= 215;
        const params = { date: addDays(dd), d: dd };
        s = L(care ? "bg.fin.run.sCare" : "bg.fin.run.s", params);
        ss = L(care ? "bg.fin.run.ssCare" : "bg.fin.run.ss", { d: dd });
        st = care ? L("bg.fin.care") : "";
      }
      pf = false;
      progress = 1;
      break;
    }
  }

  // the other zones show the finished state of what lies behind them
  if (zi > 1) receipts = 9;
  if (zi > 2) assembly = 7;
  if (zi > 3) hours = 8;

  const illustration = (stage === "x" || stage === "y" || stage === "t") && lit;
  const text = small ? (pf && cur >= 0 ? `${L(`bg.stage.${cur}`)} · ${ss}` : ss) : s;
  return {
    on,
    lit,
    rulerVisible: on && lit,
    zone: z.id,
    zoneIndex: zi,
    sh: z.sh,
    nav: z.nav,
    caret: z.id === "kak" && !reduced,
    scale,
    stage,
    clip,
    receipts,
    assembly,
    advanced,
    hours,
    cur,
    pv,
    s,
    ss,
    text,
    st,
    progress: cl(progress),
    illustration,
    need,
    win,
    winShift,
  };
}
