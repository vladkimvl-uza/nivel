// The background below the first screen in the browser (docs/design/hero-video/bg.js, round 10): the scroll is the time of the
// order NV-0001. `applyBg` writes the state of `bg-model.ts` into the elements (tested with plain objects); `startBg` is the
// wiring: the geometry of the page, the scroll loop, the stage images, the clips, the life that goes on without the scroll.

import type { Label } from "../bg-model.ts";
import {
  type BgState,
  clipStop,
  computeBgState,
  formatClock,
  type Geometry,
  type Life,
  layoutZones,
  type Stage,
  ZONES,
  type ZoneId,
} from "../bg-model.ts";
import { makeLabel } from "../labels.ts";
import { bgVideoAllowed, decideGate } from "../motion-gate.ts";
import { createClips } from "./clips.ts";
import type { SiteConfig } from "./config.ts";
import type { ElLike, Win } from "./dom.ts";

export interface BgApplyEls {
  ob: ElLike;
  scene: ElLike;
  shadeWin: ElLike;
  ord: ElLike;
  ordT: ElLike[];
  ordS: ElLike;
  ordSt: ElLike;
  lv: ElLike;
  il: ElLike | null;
  receipts: ElLike[];
  rcsSum: { root: ElLike; s: ElLike; ret: ElLike };
  asm: ElLike[];
  labels: { x: ElLike | null; y: ElLike | null; t: ElLike | null };
  tclk: { root: ElLike; h: ElLike } | null;
  tlog: { root: ElLike; c: ElLike } | null;
  rstamp: ElLike | null;
  navs: { href: string; el: ElLike }[];
}

export interface BgTexts {
  label: Label;
  /** The sum under the receipts for 0..9 of them. */
  receiptSums: string[];
  /** The refund of the sample order, written under the receipts when all nine have come. */
  refund: string;
}

export interface BgCtx extends BgTexts {
  reduced: boolean;
  /** Forces the browser to lay the element out, so that a CSS animation starts again. */
  reflow?: (el: ElLike) => void;
}

export interface BgMemo {
  last: Map<string, unknown>;
  receipts: number;
}

export const createBgMemo = (): BgMemo => ({ last: new Map(), receipts: -1 });

/** Runs `write` when the value of `key` is not the one written last time. */
function once<T>(memo: BgMemo, key: string, value: T, write: (value: T) => void): void {
  if (memo.last.has(key) && memo.last.get(key) === value) return;
  memo.last.set(key, value);
  write(value);
}

export function applyBg(els: BgApplyEls, s: BgState, memo: BgMemo, ctx: BgCtx): void {
  const { label } = ctx;
  once(memo, "on", s.on, (v) => els.ob.classList.toggle("is-on", v));
  once(memo, "lit", s.lit, (v) => els.ob.classList.toggle("is-lit", v));
  once(memo, "ruler", s.rulerVisible, (v) => els.ord.classList.toggle("is-on", v));
  if (!s.on) return;
  once(memo, "sh", s.sh, (v) => els.ob.setAttribute("data-sh", v));
  once(memo, "scale", s.scale, (v) => {
    els.scene.style.transform = v;
  });
  once(memo, "caret", s.caret, (v) => els.ord.classList.toggle("is-cw", v));
  once(memo, "il", s.illustration, (v) => els.il?.classList.toggle("is-in", v));
  once(memo, "win", `${s.win}|${s.winShift}`, () => {
    els.ob.style.setProperty("--win", String(s.win));
    if (s.win > 0) els.shadeWin.style.transform = `translateY(${s.winShift}px)`;
  });
  for (const n of els.navs) once(memo, `nav${n.href}`, s.nav === n.href, (v) => n.el.classList.toggle("is-cur", v));

  // the ruler
  once(memo, "ticks", `${s.cur}|${s.pv}`, () => {
    els.ordT.forEach((li, i) => {
      li.classList.toggle("is-cur", i === s.cur);
      li.classList.toggle("is-done", i !== s.cur && i < s.cur);
      li.classList.toggle("is-pv", i !== s.cur && !(i < s.cur) && s.pv > 0 && i > 0 && i <= s.pv);
    });
  });
  once(memo, "text", s.text, (v) => {
    els.ordS.textContent = v;
  });
  once(memo, "st", s.st, (v) => {
    els.ordSt.textContent = v;
    els.ordSt.classList.toggle("is-in", v !== "");
    els.ordSt.classList.remove("is-seat");
    if (v !== "" && !ctx.reduced) {
      ctx.reflow?.(els.ordSt);
      els.ordSt.classList.add("is-seat");
    }
  });
  once(memo, "lv", `${Number(s.progress.toFixed(4))}|${s.rulerVisible}|${s.lit}`, () => {
    els.lv.style.transform = `scaleX(${Number(s.progress.toFixed(4))})`;
    els.lv.style.opacity = s.rulerVisible && s.lit ? "0.8" : "0";
  });

  // the receipts on the table
  once(memo, "receipts", s.receipts, (n) => {
    const up = n > memo.receipts && memo.receipts >= 0;
    memo.receipts = n;
    els.receipts.forEach((r, i) => {
      r.classList.toggle("is-in", i < n);
      r.classList.toggle("is-new", up && !ctx.reduced && i === n - 1);
    });
    els.rcsSum.s.textContent = label("rc.sum", { n, sum: ctx.receiptSums[n] ?? "" });
    els.rcsSum.ret.textContent = label("rc.refund", { sum: ctx.refund });
    els.rcsSum.root.classList.toggle("is-all", n === 9);
    if (els.labels.x) els.labels.x.textContent = label("band.x.label", { n });
  });

  // the parts in the case
  once(memo, "asm", s.assembly, (k) => {
    els.asm.forEach((li, i) => {
      li.classList.toggle("is-done", i < k);
      li.classList.toggle("is-cur", i === k);
    });
    if (els.labels.y) els.labels.y.textContent = label("band.y.label", { k: Math.max(0, k + 1) });
  });

  // the clock of the test, in steps of ten minutes
  once(memo, "clock", formatClock(s.hours), (clock) => {
    if (els.tclk) els.tclk.h.textContent = clock;
    els.tclk?.root.classList.toggle("is-done", s.hours >= 8);
    els.tlog?.root.style.setProperty("--d", (1 - s.hours / 8).toFixed(3));
    if (els.tlog) els.tlog.c.textContent = clock;
    els.rstamp?.classList.toggle("is-in", s.hours >= 8);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// the wiring

/** The stage image of each zone: the light of the lamp, the three clips of the stages, the dark table. */
const ZONE_STAGE: Record<ZoneId, Stage> = {
  kak: "k",
  xarid: "x",
  yig: "y",
  sin: "t",
  pas: "k",
  ceny: "c",
  zayavka: "c",
  fin: "c",
};
const HAS_CLIP: Partial<Record<Stage, true>> = { x: true, y: true, t: true };
const ELEMENT_OF: Record<ZoneId, string> = {
  kak: "kak-rabotaem",
  xarid: "xarid",
  yig: "yigish",
  sin: "sinov",
  pas: "pasport",
  ceny: "ceny",
  zayavka: "zayavka",
  fin: "yakun",
};

interface NavigatorExtras {
  connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
  deviceMemory?: number;
}

const find = <T extends Element>(root: ParentNode, selector: string): T | null => root.querySelector<T>(selector);
const findAll = <T extends Element>(root: ParentNode, selector: string): T[] => [...root.querySelectorAll<T>(selector)];

/** Starts the background; returns a function that stops it. */
export function startBg(config: SiteConfig, win: Win = window): () => void {
  const doc = win.document;
  const ob = find<HTMLElement>(doc, "[data-ob]");
  const scene = find<HTMLElement>(doc, "[data-ob-scene]");
  const shadeWin = find<HTMLElement>(doc, "[data-ob-win]");
  const ord = find<HTMLElement>(doc, "[data-ord]");
  const ordS = find<HTMLElement>(doc, "[data-ord-s]");
  const ordSt = find<HTMLElement>(doc, "[data-ord-st]");
  const lv = find<HTMLElement>(doc, "[data-ord-lv]");
  const rcsSumRoot = find<HTMLElement>(doc, "[data-rcs-sum]");
  if (!ob || !scene || !shadeWin || !ord || !ordS || !ordSt || !lv || !rcsSumRoot) return () => {};
  const rcsS = rcsSumRoot.querySelector<HTMLElement>(".s");
  const rcsRet = rcsSumRoot.querySelector<HTMLElement>(".ret");
  if (!rcsS || !rcsRet) return () => {};

  const reduced = doc.documentElement.classList.contains("is-reduced");
  const nav = win.navigator as Navigator & NavigatorExtras;
  const conn = nav.connection ?? {};
  const small = () => win.innerWidth < 860 || win.matchMedia("(pointer: coarse)").matches;
  let isSmall = small();
  const gate = decideGate({
    motionOff: false,
    prefersReduced: reduced,
    saveData: conn.saveData === true,
    effectiveType: conn.effectiveType,
    downlink: conn.downlink,
    deviceMemory: nav.deviceMemory,
  });
  const video = bgVideoAllowed({ reduced, gateOk: gate.ok, small: isSmall, deviceMemory: nav.deviceMemory });
  const label = makeLabel(config.bg.labels);
  const side = () => (isSmall ? "m" : "d");

  const els: BgApplyEls = {
    ob,
    scene,
    shadeWin,
    ord,
    ordT: findAll<HTMLElement>(doc, "[data-ord-t] li"),
    ordS,
    ordSt,
    lv,
    il: find<HTMLElement>(doc, "[data-ob-il]"),
    receipts: findAll<HTMLElement>(doc, "[data-rcs] .rc"),
    rcsSum: {
      root: rcsSumRoot,
      s: rcsS,
      ret: rcsRet,
    },
    asm: findAll<HTMLElement>(doc, "[data-asm] li"),
    labels: {
      x: find<HTMLElement>(doc, '[data-band="xarid"] [data-band-label]'),
      y: find<HTMLElement>(doc, '[data-band="yig"] [data-band-label]'),
      t: find<HTMLElement>(doc, '[data-band="sin"] [data-band-label]'),
    },
    tclk: (() => {
      const root = find<HTMLElement>(doc, "[data-tclk]");
      const h = find<HTMLElement>(doc, "[data-tclk-h]");
      return root && h ? { root, h } : null;
    })(),
    tlog: (() => {
      const root = find<HTMLElement>(doc, ".tlog");
      const c = find<HTMLElement>(doc, "[data-tlog-c]");
      return root && c ? { root, c } : null;
    })(),
    rstamp: find<HTMLElement>(doc, ".rstamp"),
    navs: findAll<HTMLAnchorElement>(doc, "[data-nav]").map((a) => ({ href: a.dataset.nav ?? "", el: a })),
  };
  const ctx: BgCtx = {
    label,
    receiptSums: config.bg.receiptSums,
    refund: config.bg.refund,
    reduced,
    reflow: (el) => void (el as unknown as HTMLElement).offsetWidth,
  };

  // ---- the stage images: two layers that take turns ----
  const imgs = findAll<HTMLImageElement>(scene, "img");
  let slot = 0;
  let shown = "";
  let wanted = "";
  const seen = new Set<string>();
  const still = (key: Stage) => config.bg.stills[key][side()];
  const preload = (key: Stage) => {
    if (seen.has(key)) return;
    seen.add(key);
    const i = new win.Image();
    i.decoding = "async";
    i.src = still(key);
  };
  const showScene = (key: Stage) => {
    wanted = key;
    if (key === shown) return;
    const next = imgs[slot ^ 1];
    if (!next) return;
    const url = still(key);
    const go = () => {
      if (wanted !== key) return;
      for (const e of imgs) e.classList.toggle("is-on", e === next);
      slot ^= 1;
      shown = key;
    };
    if (next.getAttribute("src") === url) return go();
    next.src = url;
    seen.add(key);
    (next.decode ? next.decode() : Promise.resolve()).then(go, go);
  };

  // ---- the clips ----
  const clips = createClips({
    create(key) {
      const v = doc.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.tabIndex = -1;
      for (const a of ["playsinline", "disablepictureinpicture", "disableremoteplayback"]) v.setAttribute(a, "");
      v.src = config.bg.clips[key as "x" | "y" | "t"][side()];
      scene.appendChild(v);
      return v;
    },
    release(v) {
      const el = v as unknown as HTMLVideoElement;
      el.removeAttribute("src");
      el.load();
      el.remove();
    },
    timeout: (cb, ms) => win.setTimeout(cb, ms),
    hidden: () => doc.hidden,
    reduced,
  });

  // ---- the geometry of the page ----
  let geo: Geometry | null = null;
  const top = (el: Element) => el.getBoundingClientRect().top + win.scrollY;
  const measure = () => {
    const vh = win.innerHeight;
    const hero = find<HTMLElement>(doc, "[data-hero-track]");
    const present = ZONES.map((z) => ({ id: z.id, el: doc.getElementById(ELEMENT_OF[z.id]) })).filter(
      (z): z is { id: ZoneId; el: HTMLElement } => z.el !== null,
    );
    const max = doc.documentElement.scrollHeight - vh;
    const route = find<HTMLElement>(doc, "#kak-rabotaem .route");
    const docs = find<HTMLElement>(doc, "#kak-rabotaem .docs");
    const gdoc = find<HTMLElement>(doc, "#garantiya");
    const kak = doc.getElementById("kak-rabotaem");
    const fin = doc.getElementById("yakun");
    if (!hero || !route || !docs || !gdoc || !kak || !fin) return;
    geo = {
      vh,
      heroEnd: top(hero) + hero.offsetHeight,
      max,
      kak: top(kak),
      docs: top(docs),
      rt: top(route),
      rh: route.offsetHeight,
      gdoc: top(gdoc),
      finS: top(fin) - 0.6 * vh,
      wins: findAll<HTMLElement>(doc, ".win")
        .filter((w) => w.offsetHeight > 0)
        .map((w) => [top(w), w.offsetHeight] as const),
      zones: layoutZones(
        present.map((z) => ({ id: z.id, t: top(z.el), h: z.el.offsetHeight })),
        vh,
        max,
      ),
    };
  };

  // ---- the frame ----
  const memo = createBgMemo();
  const life: Life = { x: 0, y: 0, h: 0, d: 0 };
  let zoneIndex = -1;
  let lastLit: boolean | null = null;
  let went = false;
  let raf = 0;
  let lifeTimer = 0;
  let lifeStamp = 0;
  let need = false;

  const stop = { x: 0, y: 0 };
  const frame = () => {
    raf = 0;
    if (!geo) return;
    const y = win.scrollY;
    const s = computeBgState({ y, geo, life, reduced, small: isSmall, label });
    if (s.zoneIndex !== zoneIndex) {
      zoneIndex = s.zoneIndex;
      life.x = life.y = life.h = life.d = 0;
      prefetch(s.zoneIndex);
    }
    if (s.on && !went) {
      went = true;
      ob.classList.add("is-go");
      preload("k");
      preload("c");
    }
    // the lamp clicks on: two flashes, then full light (DESIGN_SYSTEM 4)
    if (s.lit !== lastLit) {
      const first = lastLit === false;
      lastLit = s.lit;
      const second = geo.zones[1];
      if (s.lit && first && !reduced && second && y + geo.vh * 0.5 < second.a) {
        ob.classList.add("is-flick");
        win.setTimeout(() => ob.classList.remove("is-flick"), 800);
      }
    }
    applyBg(els, s, memo, ctx);
    if (s.on) {
      if (video && HAS_CLIP[s.stage]) {
        if (!shown) showScene("k");
        clips.set(s.stage, s.clip);
        const dur = clips.get(s.stage).duration;
        if (s.stage === "x") {
          stop.x = reduced ? 0 : clipStop("x", s.receipts, dur || 1.84);
          clips.stop("x", stop.x);
        } else if (s.stage === "y") {
          stop.y = reduced ? 0 : clipStop("y", s.assembly < 0 ? 0 : s.assembly, dur || 4.16);
          clips.stop("y", stop.y);
        }
      } else {
        clips.hide();
        showScene(s.stage);
      }
    } else {
      clips.hide();
    }
    need = s.need;
    lifeGo();
  };
  const kick = () => {
    if (!raf) raf = win.requestAnimationFrame(frame);
  };

  /** A neighbour stage is prepared in advance; a phone lets go of the clips that are far away. */
  const prefetch = (i: number) => {
    const zones = geo?.zones ?? [];
    const nextZone = zones[Math.min(zones.length - 1, i + 1)];
    const cur = zones[i];
    if (!nextZone || !cur) return;
    const nk = ZONE_STAGE[nextZone.id];
    if (video && HAS_CLIP[nk]) clips.get(nk);
    else if (nk !== ZONE_STAGE[cur.id]) preload(nk);
    if (isSmall) {
      for (const key of ["x", "y", "t"] as const) {
        const near = [i - 1, i, i + 1].some((j) => zones[j] && ZONE_STAGE[(zones[j] as { id: ZoneId }).id] === key);
        if (!near && clips.has(key)) clips.drop(key);
      }
    }
  };

  // ---- the life that goes on without the scroll: receipts come, parts are set, the clock runs ----
  const lifeTick = () => {
    lifeTimer = 0;
    if (reduced || doc.hidden || !need) return;
    const now = win.performance.now();
    const dt = Math.min(0.6, (now - lifeStamp) / 1000);
    lifeStamp = now;
    const zone = geo?.zones[zoneIndex]?.id;
    if (zone === "xarid") life.x += dt / 2.6;
    else if (zone === "yig") life.y += dt / 2.2;
    else if (zone === "sin") life.h += dt / 4;
    kick();
    lifeTimer = win.setTimeout(lifeTick, 200);
  };
  const lifeGo = () => {
    if (need && !lifeTimer && !reduced && !doc.hidden) {
      lifeStamp = win.performance.now();
      lifeTimer = win.setTimeout(lifeTick, 200);
    }
  };

  const onScroll = () => {
    kick();
    clips.bump();
  };
  const onResize = () => {
    const nowSmall = small();
    if (nowSmall !== isSmall) {
      isSmall = nowSmall;
      shown = "";
      seen.clear();
      clips.dropAll();
      zoneIndex = -1;
    }
    measure();
    memo.last.clear();
    kick();
  };
  const onVisibility = () => {
    if (doc.hidden) {
      clips.pauseAll();
      win.clearTimeout(lifeTimer);
      lifeTimer = 0;
    } else {
      kick();
      clips.resume();
    }
  };
  win.addEventListener("scroll", onScroll, { passive: true });
  win.addEventListener("resize", onResize);
  win.addEventListener("load", onResize);
  doc.addEventListener("visibilitychange", onVisibility);
  let observer: ResizeObserver | undefined;
  if ("ResizeObserver" in win) {
    let rq = 0;
    observer = new win.ResizeObserver(() => {
      win.cancelAnimationFrame(rq);
      rq = win.requestAnimationFrame(() => {
        measure();
        kick();
      });
    });
    observer.observe(doc.body);
  }
  // the receipts, the parts and the clock are drawn by the server in their finished form; the first frame sets them to the scroll
  for (const r of els.receipts) r.classList.remove("is-in");
  measure();
  kick();

  return () => {
    win.removeEventListener("scroll", onScroll);
    win.removeEventListener("resize", onResize);
    win.removeEventListener("load", onResize);
    doc.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
    win.clearTimeout(lifeTimer);
    win.cancelAnimationFrame(raf);
    clips.dropAll();
  };
}
