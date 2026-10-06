// Test helper (not part of the public API): typed product builders with complete, mutually compatible default specs.
import { type CatalogLookup, createCatalogLookup, type DetailedCategory, type SpecMap } from "../catalog/index.ts";
import type { BuildLine, Nullable, Product, ProductBase, ProductId } from "../catalog/types.ts";
import { bp } from "../money/index.ts";
import { DEFAULT_COMPAT_SETTINGS } from "./settings.ts";
import type { CompatSettings, SetupPlan, Task } from "./types.ts";

export const pid = (s: string): ProductId => s as ProductId;

/** Defaults describe a mid-range AM5 gaming build that passes every rule with a margin. */
const DEFAULT_SPECS: { [C in DetailedCategory]: SpecMap[C] } = {
  cpu: {
    socket: "AM5",
    cores: 6,
    threads: 12,
    boostGhz: 5,
    tdpW: 65,
    maxPowerW: 88,
    hasIgpu: false,
    memTypes: ["DDR5"],
    memMaxMts: { DDR5: 5200 },
    boxCooler: false,
    chipsets: ["B650", "X670", "B850", "X870"],
    minBiosByChipset: { B650: "1.20" },
  },
  mb: {
    socket: "AM5",
    chipset: "B650",
    formFactor: "mATX",
    ramType: "DDR5",
    ramSlots: 4,
    ramMaxGb: 192,
    ramMaxMts: 6400,
    m2: [
      { id: "M2_1", pcieGen: 5, maxLenMm: 80, disablesSata: [] },
      { id: "M2_2", pcieGen: 4, maxLenMm: 110, disablesSata: [3, 4] },
    ],
    sataPorts: 4,
    pcieX16Slots: 1,
    fanHeaders: 6,
    argb5vHeaders: 2,
    rgb12vHeaders: 1,
    wifi: true,
    bluetooth: true,
    biosFlashback: true,
    shippedBios: "1.30",
  },
  ram: { type: "DDR5", kitGb: 16, modules: 2, mts: 5200, cl: 40, profile: "EXPO", heightMm: 34, lighting: false },
  ssd: { iface: "nvme", formFactor: "M.2-2280", capacityGb: 1000, pcieGen: 4, tbw: 600 },
  gpu: {
    chip: "RTX 5060",
    vramGb: 8,
    lengthMm: 240,
    heightMm: 120,
    slots: 2,
    power: [{ conn: "8pin", count: 1 }],
    adapterInBox: false,
    tgpW: 145,
    vendorRecommendedPsuW: 550,
    hwEncoders: ["NVENC"],
  },
  psu: {
    watts: 650,
    rating: "bronze",
    formFactor: "ATX",
    lengthMm: 140,
    modular: "semi",
    pcie8pin: 2,
    native12v2x6: 0,
    atx3: false,
  },
  case: {
    boards: ["ATX", "mATX", "Mini-ITX"],
    gpuMaxLenMm: 330,
    gpuMaxLenWithFrontRadMm: 300,
    coolerMaxHeightMm: 165,
    radiators: [
      { side: "top", sizesMm: [120, 140, 240, 280], maxThicknessMm: 55 },
      { side: "front", sizesMm: [120, 140, 240, 280, 360], maxThicknessMm: 55 },
      { side: "rear", sizesMm: [120] },
    ],
    psuFF: ["ATX"],
    psuMaxLenMm: 180,
    expansionSlots: 7,
    fanMounts: 8,
    fansIncluded: 2,
    dimsMm: { w: 215, d: 430, h: 450 },
  },
  cooler_air: { sockets: ["AM5", "AM4", "LGA1700"], heightMm: 155, ramClearanceMm: 40, tdpRatedW: 180 },
  aio: {
    sockets: ["AM5", "AM4", "LGA1700", "LGA1851"],
    radMm: 360,
    radThicknessWithFansMm: 52,
    tubeLenMm: 400,
    pumpW: 15,
  },
  fan: { sizeMm: 120, count: 3, conn: "4pin", argb: false },
  monitor: {
    diagIn: 27,
    aspect: "16:9",
    resolution: "2560x1440",
    hz: 180,
    panelWmm: 614,
    panelHmm: 360,
    depthWithStandMm: 210,
    standFootprintMm: { w: 250, d: 200 },
    weightNoStandKg: 4.5,
    vesa: "100x100",
    curved: false,
  },
  arm: {
    reachMinMm: 100,
    reachMaxMm: 450,
    poleHeightMm: 400,
    mount: "clamp",
    topThicknessMinMm: 10,
    topThicknessMaxMm: 85,
    vesa: ["75x75", "100x100"],
    loadMinKg: 2,
    loadMaxKg: 9,
    diagMinIn: 13,
    diagMaxIn: 32,
    screens: 1,
  },
  desk: {
    topWmm: 1400,
    topDmm: 700,
    heightMinMm: 720,
    heightMaxMm: 720,
    topThicknessMm: 25,
    legZonesMm: [
      { fromMm: 0, toMm: 100 },
      { fromMm: 1300, toMm: 1400 },
    ],
    cableCutout: true,
    loadKg: 80,
    motors: 0,
  },
  chair: {
    baseDiamMm: 680,
    seatHeightMinMm: 430,
    seatHeightMaxMm: 520,
    rollbackZoneMm: 750,
    userHeightCm: [160, 190],
    userMaxKg: 120,
  },
};

export function defaultSpec<C extends DetailedCategory>(category: C): SpecMap[C] {
  return JSON.parse(JSON.stringify(DEFAULT_SPECS[category])) as SpecMap[C];
}

export function makeProduct<C extends DetailedCategory>(
  category: C,
  id: string,
  over: Partial<Nullable<SpecMap[C]>> = {},
  base: Partial<ProductBase> = {},
): Product {
  return {
    id: pid(id),
    category,
    brand: "Test",
    model: id,
    color: "black",
    lighting: "none",
    feeGroup: "pc",
    returnable: true,
    manualOnly: false,
    status: "verified",
    isDemo: true,
    ...base,
    spec: { ...defaultSpec(category), ...over },
  } as Product;
}

/** Product of a category without typed specs (keyboard, light …). */
export function makePlain(category: Exclude<Product["category"], DetailedCategory>, id: string): Product {
  return {
    id: pid(id),
    category,
    brand: "Test",
    model: id,
    color: "black",
    lighting: "none",
    feeGroup: "pc",
    returnable: true,
    manualOnly: false,
    status: "verified",
    isDemo: true,
    spec: {},
  } as Product;
}

export interface TestBuild {
  products: Product[];
  lines: BuildLine[];
  catalog: CatalogLookup;
}

/** Builds lines (qty 1 unless a tuple `[product, qty]`) and a lookup over the given products. */
export function build(...parts: (Product | [Product, number])[]): TestBuild {
  const products: Product[] = [];
  const lines: BuildLine[] = [];
  for (const part of parts) {
    const [p, qty] = Array.isArray(part) ? part : [part, 1];
    products.push(p);
    lines.push({ productId: p.id, qty });
  }
  return { products, lines, catalog: createCatalogLookup(products) };
}

export const settings = (over: Partial<CompatSettings> = {}): CompatSettings => ({
  ...DEFAULT_COMPAT_SETTINGS,
  ...over,
});
export const ctx = (tasks: Task[] = [], over: Partial<CompatSettings> = {}) => ({ tasks, settings: settings(over) });

export { bp };

export type Part = Product | [Product, number];

interface PcOverrides {
  cpu?: Partial<Nullable<SpecMap["cpu"]>>;
  mb?: Partial<Nullable<SpecMap["mb"]>>;
  ram?: Partial<Nullable<SpecMap["ram"]>>;
  ssd?: Partial<Nullable<SpecMap["ssd"]>>;
  gpu?: Partial<Nullable<SpecMap["gpu"]>>;
  psu?: Partial<Nullable<SpecMap["psu"]>>;
  case?: Partial<Nullable<SpecMap["case"]>>;
  cooler?: Partial<Nullable<SpecMap["cooler_air"]>>;
  /** Extra parts appended to the build. */
  add?: Part[];
  /** Ids of default parts to leave out. */
  drop?: string[];
  /** Quantity per default part id. */
  qty?: Record<string, number>;
}

/**
 * A complete AM5 gaming PC that passes every rule (ids: cpu, mb, ram, ssd, gpu, psu, case, cooler),
 * with per-part spec overrides, parts to drop and extra parts to add.
 */
export function pcBuild(o: PcOverrides = {}): Part[] {
  const parts: [string, Product][] = [
    ["cpu", makeProduct("cpu", "cpu", o.cpu)],
    ["mb", makeProduct("mb", "mb", o.mb)],
    ["ram", makeProduct("ram", "ram", o.ram)],
    ["ssd", makeProduct("ssd", "ssd", o.ssd)],
    ["gpu", makeProduct("gpu", "gpu", o.gpu)],
    ["psu", makeProduct("psu", "psu", o.psu)],
    ["case", makeProduct("case", "case", o.case)],
    ["cooler", makeProduct("cooler_air", "cooler", o.cooler)],
  ];
  const out: Part[] = [];
  for (const [id, p] of parts) {
    if (o.drop?.includes(id)) continue;
    const qty = o.qty?.[id];
    out.push(qty === undefined ? p : [p, qty]);
  }
  out.push(...(o.add ?? []));
  return out;
}

/** A complete build that passes all PC rules. */
export const goodPc = (): Part[] => pcBuild();

/** Removes spec keys from a product (an optional field that is absent, as opposed to `null` = unknown). */
export function omitSpec(product: Product, ...keys: string[]): Product {
  const spec = { ...(product.spec as Record<string, unknown>) };
  for (const k of keys) delete spec[k];
  return { ...product, spec } as Product;
}

interface DeskOverrides {
  desk?: Partial<Nullable<SpecMap["desk"]>>;
  monitor?: Partial<Nullable<SpecMap["monitor"]>>;
  chair?: Partial<Nullable<SpecMap["chair"]>>;
  arm?: Partial<Nullable<SpecMap["arm"]>>;
  /** Add an arm (id "arm") that carries the monitor. */
  withArm?: boolean;
  add?: Part[];
  drop?: string[];
  qty?: Record<string, number>;
}

/** A desk setup that passes every setup rule (ids: desk, monitor, chair and, with `withArm`, arm). */
export function setupParts(o: DeskOverrides = {}): Part[] {
  const parts: [string, Product][] = [
    ["desk", makeProduct("desk", "desk", o.desk)],
    ["monitor", makeProduct("monitor", "monitor", o.monitor)],
    ["chair", makeProduct("chair", "chair", o.chair)],
  ];
  if (o.withArm || o.arm) parts.push(["arm", makeProduct("arm", "arm", o.arm)]);
  const out: Part[] = [];
  for (const [id, p] of parts) {
    if (o.drop?.includes(id)) continue;
    const qty = o.qty?.[id];
    out.push(qty === undefined ? p : [p, qty]);
  }
  out.push(...(o.add ?? []));
  return out;
}

export const DEFAULT_ROOM: SetupPlan["room"] = { widthMm: 3000, depthMm: 2500, userHeightCm: 175 };

/** mulberry32: small deterministic PRNG for the mutation helpers of the property tests (fast-check supplies the seed). */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Gen {
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  bool(): boolean;
}

export function createGen(seed: number): Gen {
  const rng = createRng(seed);
  return {
    int: (min, max) => min + Math.floor(rng() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(rng() * xs.length)] as (typeof xs)[number],
    bool: () => rng() < 0.5,
  };
}
