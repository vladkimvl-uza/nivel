import { DEFAULT_FEE_SETTINGS } from "@nivel/domain/fee";
import { describe, expect, it } from "vitest";

// Pure checks of the seed data (no database): the shape of the 32 base builds of block 28 and the plausibility of the
// demo catalog against the compatibility rules the real engine will apply (ARCHITECTURE 4.4).
// The seed lives outside src/ (packages/db/seed, owned by WP-06), so it is loaded by a path the compiler does not follow.
const SEED_PATH = "../../seed/index.ts";
type Row = readonly [classKey: string, qty?: number];
interface Build {
  task: string;
  tier: string;
  style: "A" | "B";
  variant: "base" | "plus";
  status: "offered" | "not_offered";
  redirectTask: string | null;
  explain: { uz: string; ru: string } | null;
  rows: readonly Row[];
}
interface Product {
  slug: string;
  classKey: string;
  category: string;
  price: number;
  color: string;
  // biome-ignore lint/suspicious/noExplicitAny: the test reads loosely typed characteristics
  specs: Record<string, any>;
  vendors?: number;
  manualOnly?: boolean;
}
interface SeedModule {
  CATEGORIES: {
    code: string;
    group: string;
    feeGroup: string;
    freshnessDays: number;
    name: { uz: string; ru: string };
  }[];
  PRICE_CLASSES: {
    key: string;
    category: string;
    ladder?: string;
    step?: number;
    primary?: boolean;
    manualOnly?: boolean;
    name: { uz: string; ru: string };
  }[];
  buildSeeds(): Build[];
  DEMO_PRODUCTS: readonly Product[];
  SELECTION_SETTINGS: { ladders: Record<string, string[]>; tierBounds: { t1: number; t2: number; t3: number } };
  FEE_SETTINGS: Record<string, unknown>;
  assertDemoAllowed(env: Record<string, string | undefined>): void;
  observationPrices(price: number, vendors?: 1 | 2 | 3): number[];
  demoMarketPrice(prices: number[]): {
    median: number | null;
    from: number | null;
    vendors: number;
    confidence: string;
  };
  assertResetAllowed(url: string, env: Record<string, string | undefined>): void;
}
const seed = (await import(/* @vite-ignore */ SEED_PATH)) as SeedModule;

const ARCH_CATEGORIES = [
  "cpu",
  "mb",
  "ram",
  "ssd",
  "gpu",
  "psu",
  "case",
  "cooler_air",
  "aio",
  "fan",
  "monitor",
  "arm",
  "desk",
  "desk_frame",
  "desk_top",
  "chair",
  "keyboard",
  "mouse",
  "mousepad",
  "headset",
  "microphone",
  "webcam",
  "light",
  "speakers",
  "acoustic_panel",
  "cable_mgmt",
  "ups",
  "decor",
  "os_license",
];

describe("categories", () => {
  it("are the 29 codes of the architecture, each once", () => {
    expect(seed.CATEGORIES.map((c) => c.code).sort()).toEqual([...ARCH_CATEGORIES].sort());
  });
  it("use freshness 7, 3 for GPU and 30 for furniture", () => {
    const by = Object.fromEntries(seed.CATEGORIES.map((c) => [c.code, c.freshnessDays]));
    expect(by.gpu).toBe(3);
    expect(by.cpu).toBe(7);
    for (const k of ["desk", "desk_frame", "desk_top", "chair"]) expect(by[k], k).toBe(30);
  });
  it("keep licences outside the fee scale and PC parts in the pc group", () => {
    const by = Object.fromEntries(seed.CATEGORIES.map((c) => [c.code, c]));
    expect(by.os_license?.feeGroup).toBe("outside_scale");
    for (const k of ["cpu", "mb", "ram", "ssd", "gpu", "psu", "case"]) expect(by[k]?.feeGroup, k).toBe("pc");
  });
  it("have both languages without a forbidden apostrophe inside a word", () => {
    const bad = /(?<=\p{L})['’‘`](?=\p{L})/u;
    for (const c of seed.CATEGORIES) {
      expect(c.name.uz.length, c.code).toBeGreaterThan(0);
      expect(c.name.ru.length, c.code).toBeGreaterThan(0);
      expect(bad.test(c.name.uz), c.code).toBe(false);
    }
  });
});

describe("price classes and ladders", () => {
  it("have unique keys that start with their category", () => {
    const keys = seed.PRICE_CLASSES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of seed.PRICE_CLASSES) expect(c.key.startsWith(`${c.category}.`), c.key).toBe(true);
  });
  it("give each ladder one primary class per step, ascending without gaps", () => {
    for (const code of ["gpu", "cpu_am5", "cpu_lga1700", "ram", "ssd"]) {
      const steps = seed.PRICE_CLASSES.filter((c) => c.ladder === code && c.primary).map((c) => c.step);
      expect(steps, code).toEqual(steps.map((_, i) => i + 1));
    }
  });
  it("mark RTX 5090 and 128 GB memory as manual only", () => {
    const manual = seed.PRICE_CLASSES.filter((c) => c.manualOnly).map((c) => c.key);
    expect(manual.sort()).toEqual(["gpu.rtx5090", "ram.ddr5_128"]);
    expect(seed.SELECTION_SETTINGS.ladders.gpu?.at(-1)).toBe("gpu.rtx5090");
  });
  it("name every class in Uzbek and Russian", () => {
    for (const c of seed.PRICE_CLASSES) {
      expect(c.name.uz.trim(), c.key).not.toBe("");
      expect(c.name.ru.trim(), c.key).not.toBe("");
    }
  });
});

describe("base builds of block 28", () => {
  const builds = seed.buildSeeds();
  const offered = builds.filter((b) => b.status === "offered" && b.variant === "base");

  it("are 32 templates: 16 per style, 5 tasks, and 8 cells that are not offered", () => {
    expect(offered).toHaveLength(32);
    for (const style of ["A", "B"]) {
      expect(offered.filter((b) => b.style === style)).toHaveLength(16);
      expect(builds.filter((b) => b.style === style && b.status === "not_offered")).toHaveLength(4);
    }
    expect(builds.filter((b) => b.status === "not_offered")).toHaveLength(8);
    expect(new Set(offered.map((b) => b.task))).toEqual(
      new Set(["gaming", "streaming", "design3d", "programming", "office"]),
    );
  });

  it("leave exactly Stream T1 and Office T2-T4 not offered, each with a task to switch to", () => {
    const cells = builds
      .filter((b) => b.status === "not_offered" && b.style === "A")
      .map((b) => `${b.task} ${b.tier}`)
      .sort();
    expect(cells).toEqual(["office T2", "office T3", "office T4", "streaming T1"]);
    for (const b of builds.filter((x) => x.status === "not_offered")) {
      expect(b.redirectTask, `${b.task} ${b.tier}`).not.toBeNull();
      expect(b.redirectTask).not.toBe(b.task === "streaming" ? "streaming" : "office");
      expect(b.rows).toHaveLength(0);
      expect(b.explain?.uz).toBeTruthy();
      expect(b.explain?.ru).toBeTruthy();
    }
  });

  it("make Office T1+ the same template as Programming T1", () => {
    for (const style of ["A", "B"]) {
      const plus = builds.find((b) => b.task === "office" && b.variant === "plus" && b.style === style);
      const programming = builds.find(
        (b) => b.task === "programming" && b.tier === "T1" && b.style === style && b.variant === "base",
      );
      expect(plus?.rows).toEqual(programming?.rows);
      expect(plus?.tier).toBe("T1");
    }
  });

  it("refer only to known price classes and give every build the parts of a PC", () => {
    const known = new Set(seed.PRICE_CLASSES.map((c) => c.key));
    for (const b of offered) {
      const keys = b.rows.map((r) => r[0]);
      for (const k of keys) expect(known.has(k), `${b.task} ${b.tier} ${b.style}: ${k}`).toBe(true);
      const cats = new Set(keys.map((k) => k.split(".")[0]));
      for (const need of ["cpu", "mb", "ram", "ssd", "psu", "case"])
        expect(cats.has(need), `${b.task} ${b.tier} ${b.style}: ${need}`).toBe(true);
      expect(cats.has("cooler_air") || cats.has("aio"), `${b.task} ${b.tier} ${b.style}: cooling`).toBe(true);
    }
  });

  it("put a graphics card in every build whose processor has no graphics, and in all gaming and stream builds", () => {
    const products = new Map(seed.DEMO_PRODUCTS.map((p) => [p.classKey, p]));
    for (const b of offered) {
      const keys = b.rows.map((r) => r[0]);
      const hasGpu = keys.some((k) => k.startsWith("gpu."));
      const cpuKey = keys.find((k) => k.startsWith("cpu."));
      const igpu = cpuKey ? products.get(cpuKey)?.specs.hasIgpu === true : false;
      expect(hasGpu || igpu, `${b.task} ${b.tier} ${b.style}`).toBe(true);
      if (b.task === "gaming" || b.task === "streaming") expect(hasGpu, `${b.task} ${b.tier}`).toBe(true);
    }
  });

  it("follow the style rule: style B swaps in white parts and adds three white fans from T2", () => {
    for (const a of offered.filter((b) => b.style === "A")) {
      const b = offered.find((x) => x.style === "B" && x.task === a.task && x.tier === a.tier);
      const hasFan = b?.rows.some((r) => r[0] === "fan.white_x3");
      expect(hasFan, `${a.task} ${a.tier}`).toBe(a.tier !== "T1");
      expect(a.rows.some((r) => r[0] === "fan.white_x3")).toBe(false);
    }
  });

  it("keep the parts cost of every template inside its tier (T1 < 12, T2 12-20, T3 20-35, T4 >= 35 million)", () => {
    const price = new Map<string, number>();
    for (const p of seed.DEMO_PRODUCTS) price.set(p.classKey, p.price);
    const tierOf = (sum: number) =>
      sum < 12_000_000 ? "T1" : sum < 20_000_000 ? "T2" : sum < 35_000_000 ? "T3" : "T4";
    for (const b of offered) {
      const sum = b.rows.reduce((s, [key, qty]) => s + (price.get(key) ?? Number.NaN) * (qty ?? 1), 0);
      expect(Number.isFinite(sum), `${b.task} ${b.tier} ${b.style} has a class without a demo price`).toBe(true);
      expect(tierOf(sum), `${b.task} ${b.tier} ${b.style}: ${sum}`).toBe(b.tier);
    }
  });
});

describe("demo catalog against the compatibility rules", () => {
  const byClass = new Map<string, Product[]>();
  for (const p of seed.DEMO_PRODUCTS) byClass.set(p.classKey, [...(byClass.get(p.classKey) ?? []), p]);
  const offered = seed.buildSeeds().filter((b) => b.status === "offered");

  /** One product per class; for classes with a black and a white product the style decides. */
  const pick = (classKey: string, style: "A" | "B") => {
    const list = byClass.get(classKey) ?? [];
    return list.find((p) => p.color === (style === "B" ? "white" : "black")) ?? list[0];
  };

  it("has a position for every class used by a template, and positions only for existing classes", () => {
    const classes = new Set(seed.PRICE_CLASSES.map((c) => c.key));
    for (const p of seed.DEMO_PRODUCTS) expect(classes.has(p.classKey), p.slug).toBe(true);
    for (const b of offered) for (const [k] of b.rows) expect(byClass.has(k), k).toBe(true);
    expect(new Set(seed.DEMO_PRODUCTS.map((p) => p.slug)).size).toBe(seed.DEMO_PRODUCTS.length);
  });

  it.each(offered.map((b) => [`${b.task} ${b.tier}${b.variant === "plus" ? "+" : ""} ${b.style}`, b] as const))(
    "%s has no blocking incompatibility",
    (_name, b) => {
      const items = b.rows.map(([k, qty]) => ({ p: pick(k, b.style), qty: qty ?? 1 }));
      const of = (cat: string) => items.filter((i) => i.p?.category === cat).map((i) => i.p as Product);
      const cpu = of("cpu")[0];
      const mb = of("mb")[0];
      const ram = of("ram")[0];
      const kase = of("case")[0];
      const gpu = of("gpu")[0];
      const psu = of("psu")[0];
      const air = of("cooler_air")[0];
      const aio = of("aio")[0];
      if (!(cpu && mb && ram && kase && psu)) throw new Error("incomplete build");
      expect(cpu.specs.socket).toBe(mb.specs.socket);
      expect(cpu.specs.chipsets).toContain(mb.specs.chipset);
      expect(cpu.specs.memTypes).toContain(ram.specs.type);
      expect(ram.specs.type).toBe(mb.specs.ramType);
      expect(ram.specs.modules).toBeLessThanOrEqual(mb.specs.ramSlots);
      expect(ram.specs.kitGb).toBeLessThanOrEqual(mb.specs.ramMaxGb);
      expect(kase.specs.boards).toContain(mb.specs.formFactor);
      if (gpu) {
        expect(gpu.specs.lengthMm).toBeLessThanOrEqual(kase.specs.gpuMaxLenMm);
        expect(psu.specs.pcie8pin >= 1 || psu.specs.native12v2x6 >= 1).toBe(true);
        expect(psu.specs.watts).toBeGreaterThanOrEqual(gpu.specs.vendorRecommendedPsuW);
        const needs12v = gpu.specs.power[0].conn === "12V-2x6";
        if (needs12v) expect(psu.specs.native12v2x6 >= 1 || gpu.specs.adapterInBox).toBe(true);
        else expect(psu.specs.pcie8pin).toBeGreaterThanOrEqual(1);
      } else {
        expect(cpu.specs.hasIgpu).toBe(true);
      }
      if (air) {
        expect(air.specs.sockets).toContain(cpu.specs.socket);
        expect(air.specs.heightMm).toBeLessThanOrEqual(kase.specs.coolerMaxHeightMm);
        expect(air.specs.tdpRatedW).toBeGreaterThanOrEqual(cpu.specs.maxPowerW);
      }
      if (aio) {
        expect(aio.specs.sockets).toContain(cpu.specs.socket);
        const fits = kase.specs.radiators.some((r: { sizesMm: number[] }) => r.sizesMm.includes(aio.specs.radMm));
        expect(fits).toBe(true);
      }
      // Power: the supply is not below the peak the rules estimate (CPU + GPU + 50 + 5 W per fan + 15 W pump).
      const fans =
        3 + items.filter((i) => i.p?.category === "fan").reduce((s, i) => s + (i.p?.specs.count ?? 0) * i.qty, 0);
      const peak = cpu.specs.maxPowerW + (gpu?.specs.tgpW ?? 0) + 50 + 5 * fans + (aio ? 15 : 0);
      expect(psu.specs.watts, `peak ${peak} W`).toBeGreaterThanOrEqual(Math.ceil(peak * 1.3));
      // Storage fits the board: NVMe drives need slots.
      const drives = items.filter((i) => i.p?.category === "ssd").reduce((s, i) => s + i.qty, 0);
      expect(drives).toBeLessThanOrEqual(mb.specs.m2.length);
    },
  );

  it("fills every key a verified position needs (the database CHECK would refuse it otherwise)", () => {
    const required: Record<string, string[]> = {
      cpu: ["socket", "chipsets", "memTypes", "maxPowerW", "hasIgpu"],
      mb: ["socket", "chipset", "formFactor", "ramType", "ramSlots", "ramMaxGb", "m2", "sataPorts"],
      ram: ["type", "kitGb", "modules", "mts"],
      ssd: ["iface", "formFactor", "capacityGb"],
      gpu: ["lengthMm", "power", "tgpW"],
      psu: ["watts", "formFactor", "pcie8pin", "native12v2x6"],
      case: ["boards", "gpuMaxLenMm", "coolerMaxHeightMm", "psuFF", "radiators"],
      cooler_air: ["sockets", "heightMm"],
      aio: ["sockets", "radMm"],
    };
    for (const p of seed.DEMO_PRODUCTS)
      for (const k of required[p.category] ?? []) expect(p.specs[k], `${p.slug}.${k}`).not.toBeUndefined();
  });
});

describe("demo prices", () => {
  it("make the median of three observations equal to the price of the table, for every position", () => {
    for (const p of seed.DEMO_PRODUCTS.filter((x) => (x.vendors ?? 3) === 3)) {
      const m = seed.demoMarketPrice(seed.observationPrices(p.price));
      expect(m.median, p.slug).toBe(p.price);
      expect(m.confidence).toBe("medium");
      expect(m.from).toBeLessThan(p.price);
    }
  });
  it("leave fewer than three vendors without a median and with low confidence (RTX 5070: two vendors)", () => {
    const rtx = seed.DEMO_PRODUCTS.find((p) => p.classKey === "gpu.rtx5070");
    expect(rtx?.vendors).toBe(2);
    const m = seed.demoMarketPrice(seed.observationPrices(rtx?.price ?? 0, 2));
    expect(m).toMatchObject({ median: null, vendors: 2, confidence: "low" });
    expect(m.from).not.toBeNull();
  });
  it("use whole sums only", () => {
    for (const p of seed.DEMO_PRODUCTS)
      for (const v of seed.observationPrices(p.price)) expect(Number.isInteger(v), p.slug).toBe(true);
  });
});

describe("guards", () => {
  it("refuses the demo seed in production and for a mode nobody knows", () => {
    expect(() => seed.assertDemoAllowed({ APP_MODE: "production" })).toThrow(/production/);
    expect(() => seed.assertDemoAllowed({ APP_MODE: "development" })).not.toThrow();
    expect(() => seed.assertDemoAllowed({ APP_MODE: "staging" })).not.toThrow();
    // Unset or empty is development, as in packages/config; anything else is not a mode of the project.
    expect(() => seed.assertDemoAllowed({})).not.toThrow();
    expect(() => seed.assertDemoAllowed({ APP_MODE: "" })).not.toThrow();
    for (const mode of ["Production", "prod", "PRODUCTION", " production", "live", "test"]) {
      expect(() => seed.assertDemoAllowed({ APP_MODE: mode }), mode).toThrow(/APP_MODE/);
    }
  });
  it("refuses a reset in production, for an unknown mode and on a host that is not local", () => {
    const local = "postgres://u:p@127.0.0.1:54339/nivel_s3_w1_test";
    expect(() => seed.assertResetAllowed(local, {})).not.toThrow();
    expect(() => seed.assertResetAllowed(local, { APP_MODE: "production" })).toThrow(/production/);
    expect(() => seed.assertResetAllowed(local, { APP_MODE: "Production" })).toThrow(/APP_MODE/);
    expect(() => seed.assertResetAllowed(local, { APP_MODE: "prod" })).toThrow(/APP_MODE/);
    expect(() => seed.assertResetAllowed("postgres://u:p@db.example.com:5432/nivel", {})).toThrow(/not local/);
    expect(() => seed.assertResetAllowed("not a url", {})).toThrow(/not a URL/);
  });
  it("resets only the cluster of this project: the dev database nivel or a throwaway *_test database", () => {
    const ok = (url: string) => expect(() => seed.assertResetAllowed(url, {}), url).not.toThrow();
    const no = (url: string, re: RegExp) => expect(() => seed.assertResetAllowed(url, {}), url).toThrow(re);
    ok("postgres://u:p@127.0.0.1:54329/nivel");
    ok("postgres://u:p@localhost:54339/nivel_s0_template_test");
    // Other projects on this machine and tunnels to a real database look local as well.
    no("postgres://u:p@127.0.0.1:5433/nivel", /port/);
    no("postgres://u:p@127.0.0.1:5432/nivel", /port/);
    no("postgres://u:p@127.0.0.1/nivel", /port/);
    no("postgres://u:p@127.0.0.1:54329/gas_platform", /database/);
    no("postgres://u:p@127.0.0.1:54329/nivel_s1_w1_test", /database/);
    no("postgres://u:p@127.0.0.1:54339/nivel", /database/);
    no("postgres://u:p@127.0.0.1:54339/postgres", /database/);
  });
});

describe("money settings of the seed", () => {
  it("are the default fee settings of packages/domain (the seed is a copy that cannot drift)", () => {
    expect(seed.FEE_SETTINGS).toEqual(DEFAULT_FEE_SETTINGS);
  });

  it("repeat the default money rules of the owner (ARCHITECTURE 4.6, DECISIONS R-8)", () => {
    expect(seed.FEE_SETTINGS).toMatchObject({
      pcLowRateBp: 1500,
      pcHighRateBp: 1000,
      pcThreshold: 20_000_000,
      pcHighMinFee: 3_000_000,
      mountRateBp: 1500,
      complexRateBp: 1500,
      minFullCyclePc: 6_700_000,
      minFreeWindowPc: 4_500_000,
      minFullCycleSetup: 13_300_000,
      advanceBp: 3000,
      reserveBp: 300,
      reserveHighBp: 500,
      reserveHighShareBp: 2500,
      reserveRoundStep: 10_000,
      podborShareBp: 2000,
      podborCreditDays: 30,
      afterTestsRetainBp: 8500,
      shelfLifeHours: { components: 24, furniture: 72 },
    });
    const shares = seed.FEE_SETTINGS.stageSharesBp as Record<string, number>;
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(seed.FEE_SETTINGS.commissionLineStages).toEqual(["selection", "purchase"]);
  });
  it("keep every money value a whole number", () => {
    const walk = (v: unknown, path: string) => {
      if (typeof v === "number") expect(Number.isInteger(v), path).toBe(true);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(seed.FEE_SETTINGS, "fee");
  });
});
