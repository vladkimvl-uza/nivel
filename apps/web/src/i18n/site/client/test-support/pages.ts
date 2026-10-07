// Page skeletons for the tests of the controllers: the same data-attributes the components of the page write, without the rest.
/* eslint-disable */
import { BG_LABEL_KEYS } from "../../labels.ts";
import { buildSiteConfig, type SiteConfig } from "../config.ts";
import { el, type FakeEl, type FakeWindow } from "./fake-dom.ts";

export function testConfig(over: Partial<{ reduced: boolean }> = {}): SiteConfig {
  return buildSiteConfig({
    mediaBase: "/media",
    locale: "uz",
    reduced: over.reduced ?? false,
    labels: Object.fromEntries(BG_LABEL_KEYS.map((k) => [k, `{${k}}`])),
    stepNames: ["01 Tanlov", "02 Smeta", "03 Xarid", "04 Setup"],
    stepNow: "{n} / 04 · {name}",
    receiptSums: Array.from({ length: 10 }, (_, i) => `${i} mln`),
    refund: "140 000 soʻm",
    motion: { on: "On", off: "Off" },
  });
}

export interface HeroPage {
  root: FakeEl;
  track: FakeEl;
  media: FakeEl;
  off: FakeEl;
  hfoot: FakeEl;
  stepsNow: FakeEl;
  caps: FakeEl[];
  steps: FakeEl[];
  hdoc: FakeEl;
  posters: FakeEl[];
}

export function heroPage(win: FakeWindow, o: { posterZeroSrc?: string } = {}): HeroPage {
  const d = win.document;
  const root = el(d, "section", { "data-hero": "" });
  const track = el(d, "div", { "data-hero-track": "" }, root);
  const media = el(d, "div", { "data-hero-media": "" }, track);
  const posters = [0, 1, 2, 3].map((i) => {
    const img = el(d, "img", { "data-poster": String(i) }, media);
    if (i === 0 && o.posterZeroSrc) img.src = o.posterZeroSrc;
    return img;
  });
  const off = el(d, "div", { "data-hero-off": "" }, track);
  const hfoot = el(d, "div", { "data-hfoot": "" }, track);
  const stepsNow = el(d, "p", { "data-steps-now": "" }, track);
  const caps = [0, 1, 2, 3, 4].map((i) => el(d, "p", { "data-cap": String(i), class: "cap" }, track));
  const list = el(d, "ul", { "data-steps": "" }, track);
  const steps = [0, 1, 2, 3].map((i) => {
    const li = el(d, "li", { "data-step-i": String(i) }, list);
    el(d, "b", {}, li);
    return li;
  });
  const hdoc = el(d, "div", { "data-hdoc": "" }, track);
  track.rect = { top: 0, bottom: 5200, left: 0, right: 0, width: 1440, height: 5200, x: 0, y: 0 };
  return { root, track, media, off, hfoot, stepsNow, caps, steps, hdoc, posters };
}

/** Puts the first screen at a share of its track (0..1) like a scroll does. */
export function scrollHeroTo(win: FakeWindow, page: HeroPage, share: number) {
  const total = page.track.rect.height - win.innerHeight;
  const top = -share * total;
  page.track.rect = { ...page.track.rect, top, bottom: top + page.track.rect.height };
  win.dispatch("scroll");
  win.tick();
}

export interface BgPage {
  ob: FakeEl;
  scene: FakeEl;
  imgs: FakeEl[];
  shadeWin: FakeEl;
  ord: FakeEl;
  ordT: FakeEl[];
  ordS: FakeEl;
  ordSt: FakeEl;
  lv: FakeEl;
  il: FakeEl;
  receipts: FakeEl[];
  rcsSum: FakeEl;
  asm: FakeEl[];
  bandLabels: Record<"xarid" | "yig" | "sin", FakeEl>;
  tclk: FakeEl;
  tlog: FakeEl;
  rstamp: FakeEl;
  navs: FakeEl[];
  sections: Record<string, FakeEl>;
  hero: FakeEl;
  route: FakeEl;
}

/** A tall page: the zones one under another, each a screen and a half high. */
export function bgPage(win: FakeWindow): BgPage {
  const d = win.document;
  const vh = win.innerHeight;
  const hero = el(d, "div", { "data-hero-track": "" });
  hero.place(0, 5000);
  const ob = el(d, "div", { "data-ob": "" });
  const scene = el(d, "div", { "data-ob-scene": "" }, ob);
  const imgs = [el(d, "img", {}, scene), el(d, "img", {}, scene)];
  const shadeWin = el(d, "div", { "data-ob-win": "" }, ob);
  const il = el(d, "p", { "data-ob-il": "" }, ob);
  const ord = el(d, "div", { "data-ord": "" });
  const tickList = el(d, "ol", { "data-ord-t": "" }, ord);
  const ordT = Array.from({ length: 7 }, () => el(d, "li", {}, tickList));
  const ordS = el(d, "span", { "data-ord-s": "" }, ord);
  const ordSt = el(d, "span", { "data-ord-st": "" }, ord);
  const lv = el(d, "i", { "data-ord-lv": "" }, ord);

  const sections: Record<string, FakeEl> = {};
  let y = 5000;
  const section = (id: string, height = vh * 1.5) => {
    const s = el(d, "section", { id });
    s.place(y, height);
    y += height;
    sections[id] = s;
    return s;
  };
  const kak = section("kak-rabotaem");
  const route = el(d, "div", { class: "route" }, kak);
  route.place((kak.pageTop as number) + 100, 600);
  const docsBox = el(d, "div", { class: "docs" }, kak);
  docsBox.place((kak.pageTop as number) + 800, 300);
  const gdoc = section("garantiya", vh * 0.5);
  void gdoc;
  const xarid = section("xarid");
  const receiptsBox = el(d, "div", { "data-rcs": "" }, xarid);
  const receipts = Array.from({ length: 9 }, () => {
    const r = el(d, "div", { class: "rc is-in" }, receiptsBox);
    return r;
  });
  const rcsSum = el(d, "div", { "data-rcs-sum": "" }, xarid);
  el(d, "span", { class: "s" }, rcsSum);
  el(d, "span", { class: "ret" }, rcsSum);
  const yig = section("yigish");
  const asmList = el(d, "ul", { "data-asm": "" }, yig);
  const asm = Array.from({ length: 8 }, () => el(d, "li", {}, asmList));
  const sin = section("sinov");
  const tclk = el(d, "div", { "data-tclk": "" }, sin);
  el(d, "span", { "data-tclk-h": "" }, tclk);
  const tlog = el(d, "div", { class: "tlog" }, sin);
  el(d, "span", { "data-tlog-c": "" }, tlog);
  const rstamp = el(d, "div", { class: "rstamp" }, sin);
  section("pasport");
  section("ceny");
  section("zayavka");
  section("yakun", vh);
  const bandLabels = {
    xarid: el(d, "span", { "data-band-label": "" }, el(d, "div", { "data-band": "xarid" })),
    yig: el(d, "span", { "data-band-label": "" }, el(d, "div", { "data-band": "yig" })),
    sin: el(d, "span", { "data-band-label": "" }, el(d, "div", { "data-band": "sin" })),
  };
  const navs = ["#kak-rabotaem", "#ceny", "#zayavka"].map((h) => el(d, "a", { "data-nav": h }));
  d.documentElement.scrollHeight = y;
  return {
    ob,
    scene,
    imgs,
    shadeWin,
    ord,
    ordT,
    ordS,
    ordSt,
    lv,
    il,
    receipts,
    rcsSum,
    asm,
    bandLabels,
    tclk,
    tlog,
    rstamp,
    navs,
    sections,
    hero,
    route,
  };
}
