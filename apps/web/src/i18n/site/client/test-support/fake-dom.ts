// A very small DOM for the tests of the controllers of the page (vitest runs in Node, and a DOM library is not a dependency of the
// project). It knows what the controllers use: classes, attributes, data-*, children, a handful of selectors, listeners, timers
// that a test advances by hand, observers that a test fires by hand. It is not a browser: the browser is checked by e2e.
/* eslint-disable */

type Listener = (event: Record<string, unknown>) => void;

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: { name: string; value: string | null }[];
}

function parseCompound(text: string): Compound {
  const c: Compound = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/y;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) throw new Error(`fake-dom: cannot read the selector "${text}"`);
    if (m[1]) c.tag = m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4], value: m[5] ?? null });
    at = re.lastIndex;
  }
  return c;
}

export class FakeClassList {
  private set = new Set<string>();
  add(...names: string[]) {
    for (const n of names) this.set.add(n);
  }
  remove(...names: string[]) {
    for (const n of names) this.set.delete(n);
  }
  toggle(name: string, force?: boolean) {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name: string) {
    return this.set.has(name);
  }
  get value() {
    return [...this.set].join(" ");
  }
}

export class FakeStyle {
  [key: string]: unknown;
  opacity = "";
  transform = "";
  cssText = "";
  setProperty(name: string, value: string) {
    this[name] = value;
  }
}

export class FakeEl {
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  textContent: string | null = "";
  id = "";
  open = false;
  hidden = false;
  tabIndex = 0;
  src = "";
  alt = "";
  decoding = "";
  muted = false;
  playsInline = false;
  preload = "";
  /** Layout numbers a test sets by hand. */
  rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  offsetHeight = 0;
  offsetWidth = 0;
  scrollHeight = 0;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();

  readonly tagName: string;
  readonly doc: FakeDocument | null;

  constructor(tagName: string, doc: FakeDocument | null = null) {
    this.tagName = tagName;
    this.doc = doc;
  }

  get tag() {
    return this.tagName.toLowerCase();
  }
  get className() {
    return this.classList.value;
  }
  set className(v: string) {
    for (const c of v.split(/\s+/).filter(Boolean)) this.classList.add(c);
  }
  getAttribute(name: string): string | null {
    if (name === "id") return this.id || null;
    if (name === "src" && this.src) return this.src;
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    if (name === "id") this.id = value;
    else if (name === "src") this.src = value;
    else if (name.startsWith("data-"))
      this.dataset[name.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = value;
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
    if (name === "src") this.src = "";
  }
  hasAttribute(name: string) {
    return this.getAttribute(name) !== null;
  }
  appendChild(child: FakeEl) {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child: FakeEl, before: FakeEl | null) {
    child.remove();
    child.parent = this;
    const i = before ? this.children.indexOf(before) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }
  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  listenerCount(type: string) {
    return (this.listeners.get(type) ?? []).length;
  }
  /** Calls the listeners; the event bubbles to the parents like a click does. */
  dispatch(type: string, extra: Record<string, unknown> = {}) {
    const event = { type, target: extra.target ?? this, ...extra };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    if (type === "click" && this.parent) this.parent.dispatch(type, { ...extra, target: event.target });
  }
  /** Lays the element out on the page (not in the window): its rect then follows the scroll of the window, like a browser's. */
  place(top: number, height: number) {
    this.pageTop = top;
    this.offsetHeight = height;
    this.rect = { ...this.rect, top, bottom: top + height, height };
    return this;
  }
  pageTop: number | null = null;
  getBoundingClientRect() {
    if (this.pageTop === null) return this.rect;
    const scrollY = this.doc?.win?.scrollY ?? 0;
    const top = this.pageTop - scrollY;
    return { ...this.rect, top, bottom: top + this.offsetHeight, height: this.offsetHeight };
  }
  private matchesCompound(c: Compound): boolean {
    if (c.tag && this.tag !== c.tag) return false;
    if (c.id && this.id !== c.id) return false;
    for (const k of c.classes) if (!this.classList.contains(k)) return false;
    for (const a of c.attrs) {
      const v = this.getAttribute(a.name);
      if (v === null || (a.value !== null && v !== a.value)) return false;
    }
    return true;
  }
  private matchesChain(chain: Compound[]): boolean {
    const last = chain[chain.length - 1] as Compound;
    if (!this.matchesCompound(last)) return false;
    let need = chain.length - 2;
    for (let p = this.parent; p && need >= 0; p = p.parent) {
      if (p.matchesCompound(chain[need] as Compound)) need -= 1;
    }
    return need < 0;
  }
  matches(selector: string): boolean {
    return selector
      .split(",")
      .map((s) => s.trim())
      .some((s) => this.matchesChain(s.split(/\s+/).map(parseCompound)));
  }
  closest(selector: string): FakeEl | null {
    for (let e: FakeEl | null = this; e; e = e.parent) if (e.matches(selector)) return e;
    return null;
  }
  querySelectorAll(selector: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (e: FakeEl) => {
      for (const c of e.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  get offsetTop() {
    return this.rect.top;
  }
}

export class FakeVideo extends FakeEl {
  duration = Number.NaN;
  private time = 0;
  seeks: number[] = [];
  seeking = false;
  loop = false;
  paused = true;
  loads = 0;
  constructor(doc: FakeDocument) {
    super("VIDEO", doc);
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(t: number) {
    this.seeks.push(t);
    this.time = t;
  }
  load() {
    this.loads += 1;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  frameCallbacks: (() => void)[] = [];
  requestVideoFrameCallback(cb: () => void) {
    this.frameCallbacks.push(cb);
    return this.frameCallbacks.length;
  }
  /** A test says: the frame of the last seek was drawn. */
  drawFrame() {
    const run = this.frameCallbacks.splice(0);
    for (const f of run) f();
  }
}

export class FakeImage extends FakeEl {
  decode() {
    return Promise.resolve();
  }
  constructor(doc: FakeDocument) {
    super("IMG", doc);
  }
}

export class FakeDocument {
  readonly documentElement = new FakeEl("HTML", this);
  readonly body = new FakeEl("BODY", this);
  cookie = "";
  win: FakeWindow | null = null;
  hidden = false;
  readyState = "complete";
  private listeners = new Map<string, Listener[]>();
  constructor() {
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): FakeEl {
    const t = tag.toLowerCase();
    if (t === "video") return new FakeVideo(this);
    if (t === "img") return new FakeImage(this);
    return new FakeEl(tag.toUpperCase(), this);
  }
  getElementById(id: string) {
    return this.documentElement.querySelector(`#${id}`);
  }
  querySelector(s: string) {
    return this.documentElement.querySelector(s);
  }
  querySelectorAll(s: string) {
    return this.documentElement.querySelectorAll(s);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  dispatch(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type });
  }
}

export class FakeObserver {
  static all: FakeObserver[] = [];
  observed: FakeEl[] = [];
  disconnected = false;
  readonly callback: (entries: { isIntersecting: boolean; target: FakeEl }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean; target: FakeEl }[]) => void) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }
  observe(el: FakeEl) {
    this.observed.push(el);
  }
  unobserve(el: FakeEl) {
    this.observed = this.observed.filter((e) => e !== el);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** A test says: these elements are (not) in view now. */
  fire(isIntersecting: boolean, only?: FakeEl[]) {
    this.callback((only ?? this.observed).map((target) => ({ isIntersecting, target })));
  }
}

export interface FakeWindowOptions {
  width?: number;
  height?: number;
  coarse?: boolean;
  reduce?: boolean;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  hash?: string;
  dpr?: number;
}

/** A window with a hand-driven clock: `tick()` runs the animation frames, `advance(ms)` the timers. */
export class FakeWindow {
  readonly document = new FakeDocument();
  innerWidth: number;
  innerHeight: number;
  scrollY = 0;
  devicePixelRatio: number;
  readonly navigator: { connection: Record<string, unknown>; deviceMemory?: number };
  readonly location = {
    hash: "",
    reloads: 0,
    reload: () => {
      this.location.reloads += 1;
    },
  };
  readonly media: Record<string, boolean>;
  private listeners = new Map<string, Listener[]>();
  private frames: (() => void)[] = [];
  private timers: { at: number; cb: () => void; id: number }[] = [];
  private nextId = 1;
  now = 0;
  fetches: string[] = [];
  revoked: string[] = [];
  Image = class {
    src = "";
    decoding = "";
  };
  ResizeObserver = FakeObserver;
  IntersectionObserver = FakeObserver;
  URL = {
    createObjectURL: (_b: unknown) => `blob:fake/${this.nextId++}`,
    revokeObjectURL: (u: string) => void this.revoked.push(u),
  };
  performance = { now: () => this.now };
  fetch = async (url: string) => {
    this.fetches.push(url);
    return { ok: true, blob: async () => ({ size: 1 }) };
  };

  constructor(o: FakeWindowOptions = {}) {
    this.innerWidth = o.width ?? 1440;
    this.innerHeight = o.height ?? 900;
    this.devicePixelRatio = o.dpr ?? 1;
    this.navigator = {
      connection: { saveData: o.saveData ?? false, ...(o.effectiveType ? { effectiveType: o.effectiveType } : {}) },
      ...(o.deviceMemory === undefined ? {} : { deviceMemory: o.deviceMemory }),
    };
    this.location.hash = o.hash ?? "";
    this.document.win = this;
    this.media = { "(pointer: coarse)": o.coarse ?? false, "(prefers-reduced-motion: reduce)": o.reduce ?? false };
  }
  matchMedia = (q: string) => ({ matches: this.media[q] ?? false });
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  listenerCount(type: string) {
    return (this.listeners.get(type) ?? []).length;
  }
  dispatch(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type });
  }
  requestAnimationFrame = (cb: () => void) => this.frames.push(cb);
  cancelAnimationFrame = (_id: number) => {};
  setTimeout = (cb: () => void, ms = 0) => {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, cb, id });
    return id;
  };
  clearTimeout = (id: number) => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };
  requestIdleCallback = (cb: () => void) => this.setTimeout(cb, 0);
  cancelIdleCallback = (id: number) => this.clearTimeout(id);
  scrollTo = (_x: number, y: number) => {
    this.scrollY = y;
    this.dispatch("scroll");
  };
  /** Scrolls like a visitor: sets the position and fires the scroll event. */
  scroll(y: number) {
    this.scrollY = y;
    this.dispatch("scroll");
  }
  /** Runs the queued animation frames (those queued while running wait for the next call). */
  tick(times = 1) {
    for (let i = 0; i < times; i++) {
      const run = this.frames.splice(0);
      for (const f of run) f();
    }
  }
  /** Moves the clock and runs the timers that are due. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = Math.max(this.now, due.at);
      due.cb();
    }
    this.now = end;
  }
  pendingTimers() {
    return this.timers.length;
  }
}

/** Builds elements from a list `[selector-like description, ...]`: a tiny helper for the page skeletons of the tests. */
export function el(doc: FakeDocument, tag: string, attrs: Record<string, string> = {}, parent?: FakeEl): FakeEl {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  (parent ?? doc.body).appendChild(e);
  return e;
}
