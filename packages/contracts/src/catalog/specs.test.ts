import { readFileSync } from "node:fs";
import type { DetailedCategory } from "@nivel/domain/catalog";
import { describe, expect, it } from "vitest";
import {
  NULLABLE_SPEC_SCHEMAS,
  ProductBaseSchema,
  ProductSchema,
  ProductSpecsSchema,
  SPEC_CATEGORIES,
  SPEC_SCHEMAS,
  specSchemaFor,
} from "./index.ts";

// The same complete specs the domain tests use (packages/domain checks the file against its test kit).
const defaults = JSON.parse(
  readFileSync(new URL("../../../testing/fixtures/wp-03/default-specs.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

const schemaOf = (c: string) => specSchemaFor(c as DetailedCategory);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const spec = (c: string): Record<string, unknown> => clone(defaults[c] as Record<string, unknown>);

describe("complete specs", () => {
  it("cover the 14 categories with typed specs", () => {
    expect([...SPEC_CATEGORIES].sort()).toEqual(Object.keys(defaults).sort());
    expect(Object.keys(SPEC_SCHEMAS).sort()).toEqual(Object.keys(defaults).sort());
  });

  it.each(Object.keys(defaults))("%s: a complete valid spec parses to itself", (c) => {
    const parsed = schemaOf(c).parse(spec(c));
    expect(parsed).toEqual(spec(c));
  });

  it.each(Object.keys(defaults))("%s: null is rejected in a complete spec", (c) => {
    const s = spec(c);
    const firstKey = Object.keys(s)[0] as string;
    s[firstKey] = null;
    expect(schemaOf(c).safeParse(s).success).toBe(false);
  });

  it.each(Object.keys(defaults))("%s: an unknown key is rejected (typo in an import file)", (c) => {
    expect(schemaOf(c).safeParse({ ...spec(c), colour: "red" }).success).toBe(false);
  });

  it.each(Object.keys(defaults))("%s: a missing required key is rejected", (c) => {
    const s = spec(c);
    const required = Object.keys(s).find(
      (k) => !["minBiosByChipset", "shippedBios", "pcieGen", "heatsinkHeightMm", "vesa"].includes(k),
    ) as string;
    delete s[required];
    expect(schemaOf(c).safeParse(s).success).toBe(false);
  });
});

describe("value rules (complete specs)", () => {
  const bad = (c: string, patch: Record<string, unknown>) => schemaOf(c).safeParse({ ...spec(c), ...patch }).success;

  it("enumerations: socket, memory type, form factors, VESA", () => {
    expect(bad("cpu", { socket: "AM3" })).toBe(false);
    expect(bad("ram", { type: "DDR3" })).toBe(false);
    expect(bad("mb", { formFactor: "XL-ATX" })).toBe(false);
    expect(bad("psu", { formFactor: "TFX" })).toBe(false);
    expect(bad("monitor", { vesa: "150x150" })).toBe(false);
    expect(bad("arm", { vesa: ["500x500"] })).toBe(false);
  });
  it("numbers: positive, whole where the unit is whole", () => {
    expect(bad("gpu", { lengthMm: 0 })).toBe(false);
    expect(bad("gpu", { lengthMm: 240.5 })).toBe(false);
    expect(bad("gpu", { slots: 2.5 })).toBe(true); // 2.5-slot cards exist
    expect(bad("gpu", { tgpW: -1 })).toBe(false);
    expect(bad("cpu", { boostGhz: Number.NaN })).toBe(false);
    expect(bad("cpu", { cores: 0 })).toBe(false);
    expect(bad("monitor", { weightNoStandKg: 0 })).toBe(false);
  });
  it("fixed sets: board memory slots 2 or 4, radiator sizes, fan size, arm screens, desk motors", () => {
    expect(bad("mb", { ramSlots: 3 })).toBe(false);
    expect(bad("aio", { radMm: 120 })).toBe(false);
    expect(bad("fan", { sizeMm: 92 })).toBe(false);
    expect(bad("arm", { screens: 4 })).toBe(false);
    expect(bad("desk", { motors: 3 })).toBe(false);
  });
  it("consistency: threads >= cores, max power >= TDP, NVMe is an M.2 drive", () => {
    expect(bad("cpu", { cores: 8, threads: 6 })).toBe(false);
    expect(bad("cpu", { tdpW: 120, maxPowerW: 100 })).toBe(false);
    expect(bad("ssd", { iface: "nvme", formFactor: "2.5" })).toBe(false);
    expect(bad("ssd", { iface: "sata", formFactor: "2.5" })).toBe(true);
  });
  it("consistency: every memory type the processor supports has a speed limit", () => {
    expect(bad("cpu", { memTypes: ["DDR4", "DDR5"], memMaxMts: { DDR5: 5600 } })).toBe(false);
    expect(bad("cpu", { memTypes: ["DDR5"], memMaxMts: {} })).toBe(false);
    expect(bad("cpu", { memTypes: ["DDR4", "DDR5"], memMaxMts: { DDR4: 3200, DDR5: 5600 } })).toBe(true);
  });
  it("BIOS versions hold a digit or a Latin letter (shapes like 1.30, F15, 7D75v1.A0, 3003)", () => {
    for (const v of ["?", "—", "неизвестно", " "]) {
      expect(bad("mb", { shippedBios: v }), `shippedBios ${v}`).toBe(false);
      expect(bad("cpu", { minBiosByChipset: { B650: v } }), `minBios ${v}`).toBe(false);
    }
    for (const v of ["1.30", "F15", "7D75v1.A0", "3003"]) expect(bad("mb", { shippedBios: v })).toBe(true);
  });
  it("consistency: the front radiator limit is not above the ordinary GPU limit", () => {
    expect(bad("case", { gpuMaxLenMm: 300, gpuMaxLenWithFrontRadMm: 320 })).toBe(false);
  });
  it("consistency: ranges are ordered (arm load, diagonal, thickness, reach; desk height; chair user height)", () => {
    expect(bad("arm", { loadMinKg: 10, loadMaxKg: 5 })).toBe(false);
    expect(bad("arm", { diagMinIn: 40, diagMaxIn: 20 })).toBe(false);
    expect(bad("arm", { topThicknessMinMm: 90, topThicknessMaxMm: 10 })).toBe(false);
    expect(bad("arm", { reachMinMm: 500, reachMaxMm: 100 })).toBe(false);
    expect(bad("desk", { heightMinMm: 900, heightMaxMm: 700 })).toBe(false);
    expect(bad("chair", { userHeightCm: [190, 160] })).toBe(false);
    expect(bad("chair", { seatHeightMinMm: 600, seatHeightMaxMm: 500 })).toBe(false);
  });
  it("leg zones: from is not after to", () => {
    expect(bad("desk", { legZonesMm: [{ fromMm: 200, toMm: 100 }] })).toBe(false);
    expect(bad("desk", { legZonesMm: [] })).toBe(true);
  });
  it("monitor resolution is WxH", () => {
    expect(bad("monitor", { resolution: "2K" })).toBe(false);
    expect(bad("monitor", { resolution: "3840x2160" })).toBe(true);
  });
  it("optional fields may be absent (not applicable) but not null in a complete spec", () => {
    const m = spec("monitor");
    delete m.vesa;
    expect(specSchemaFor("monitor").safeParse(m).success).toBe(true);
    expect(bad("monitor", { vesa: null })).toBe(false);
    const cpu = spec("cpu");
    delete cpu.minBiosByChipset;
    expect(specSchemaFor("cpu").safeParse(cpu).success).toBe(true);
  });
  it("radiator mount: sizes from the fixed list, thickness optional", () => {
    const c = spec("case");
    expect(bad("case", { radiators: [{ side: "front", sizesMm: [120, 360] }] })).toBe(true);
    expect(bad("case", { radiators: [{ side: "front", sizesMm: [100] }] })).toBe(false);
    expect(bad("case", { radiators: [{ side: "front", sizesMm: [] }] })).toBe(false);
    expect(bad("case", { radiators: [{ side: "roof", sizesMm: [120] }] })).toBe(false);
    expect(c).toBeDefined();
  });
});

describe("nullable specs: unknown value is null (ProductSpecsSchema)", () => {
  it.each(Object.keys(defaults))("%s: every field may be null and the spec is still accepted", (c) => {
    const s = Object.fromEntries(Object.keys(spec(c)).map((k) => [k, null]));
    const r = ProductSpecsSchema.safeParse({ category: c, spec: s });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(NULLABLE_SPEC_SCHEMAS[c as keyof typeof NULLABLE_SPEC_SCHEMAS].safeParse(s).success).toBe(true);
  });

  it.each(Object.keys(defaults))("%s: a complete spec is accepted too", (c) => {
    expect(ProductSpecsSchema.safeParse({ category: c, spec: spec(c) }).success).toBe(true);
  });

  const allNull = (c: string) => Object.fromEntries(Object.keys(spec(c)).map((k) => [k, null]));

  it("known values are still validated when others are null", () => {
    expect(ProductSpecsSchema.safeParse({ category: "cpu", spec: { ...allNull("cpu"), socket: "AM3" } }).success).toBe(
      false,
    );
    expect(ProductSpecsSchema.safeParse({ category: "cpu", spec: { ...allNull("cpu"), socket: "AM5" } }).success).toBe(
      true,
    );
  });

  it("unknown means an explicit null: a key that is simply absent is rejected (the type has no optional keys)", () => {
    expect(ProductSpecsSchema.safeParse({ category: "gpu", spec: {} }).success).toBe(false);
    const s = allNull("gpu");
    delete s.tgpW;
    expect(ProductSpecsSchema.safeParse({ category: "gpu", spec: s }).success).toBe(false);
  });

  it("fields that are optional by contract (BIOS table, shipped BIOS, VESA, thickness) may be absent or null", () => {
    const cpu = allNull("cpu");
    delete cpu.minBiosByChipset;
    expect(ProductSpecsSchema.safeParse({ category: "cpu", spec: cpu }).success).toBe(true);
    expect(ProductSpecsSchema.safeParse({ category: "cpu", spec: allNull("cpu") }).success).toBe(true);
  });

  it("an unknown spec key is still rejected", () => {
    expect(ProductSpecsSchema.safeParse({ category: "gpu", spec: { ...allNull("gpu"), colour: null } }).success).toBe(
      false,
    );
  });

  it("categories without typed specs take a free-form record", () => {
    for (const category of ["keyboard", "mouse", "desk_frame", "desk_top", "light", "decor", "os_license"]) {
      expect(ProductSpecsSchema.safeParse({ category, spec: { anything: 1 } }).success, category).toBe(true);
      expect(ProductSpecsSchema.safeParse({ category, spec: "text" }).success, category).toBe(false);
    }
  });

  it("an unknown category is rejected", () => {
    expect(ProductSpecsSchema.safeParse({ category: "toaster", spec: {} }).success).toBe(false);
  });
});

describe("product", () => {
  const base = {
    id: "gpu-rtx5070-asus-dual",
    category: "gpu",
    brand: "ASUS",
    model: "DUAL-RTX5070-O12G",
    color: "black",
    lighting: "none",
    feeGroup: "pc",
    returnable: true,
    manualOnly: false,
    status: "verified",
    isDemo: true,
  };

  it("base fields: valid row, optional price class and ladder step", () => {
    expect(ProductBaseSchema.safeParse(base).success).toBe(true);
    expect(
      ProductBaseSchema.safeParse({ ...base, priceClassId: "rtx5070-base", ladderStep: 5, mpn: "X" }).success,
    ).toBe(true);
  });

  it.each([
    ["empty id", { id: "" }],
    ["unknown colour", { color: "pink" }],
    ["unknown fee group", { feeGroup: "other" }],
    ["unknown status", { status: "deleted" }],
    ["fractional ladder step", { ladderStep: 1.5 }],
    ["missing isDemo", { isDemo: undefined }],
  ])("base fields reject %s", (_n, patch) => {
    expect(ProductBaseSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it("a product is the base fields plus the specs of its category", () => {
    expect(ProductSchema.safeParse({ ...base, spec: spec("gpu") }).success).toBe(true);
    expect(ProductSchema.safeParse({ ...base, spec: { ...spec("gpu"), lengthMm: -5 } }).success).toBe(false);
    expect(ProductSchema.safeParse({ ...base, category: "cpu", spec: spec("gpu") }).success).toBe(false);
  });
});
