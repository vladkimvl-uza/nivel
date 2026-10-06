// Texts of the compatibility checks (WP-03 request, ARCHITECTURE 4.4): namespace "compat". The issue key is the message
// key: t(issue.key, issue.params). The field names for compat.missing_data live under compat.field.<category>.<field>.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DETAILED_CATEGORIES, type DetailedCategory, type SpecMap } from "@nivel/domain/catalog";
import { COMPAT_MESSAGE_KEYS, fieldNameKey } from "@nivel/domain/compat";
import { describe, expect, it } from "vitest";
import { glossaryProblems, parseGlossary } from "./glossary.ts";
import { placeholders, sampleValues } from "./icu.ts";
import { getMessages, namespaces } from "./index.ts";
import { checkNamespace, flattenMessages, type MetaEntry } from "./messages-check.ts";
import { createNodeTranslator } from "./node-translator.ts";
import { checkUzString } from "./uz-apostrophes.ts";

const base = fileURLToPath(new URL("../messages/", import.meta.url));
const read = (kind: string) => JSON.parse(readFileSync(`${base}${kind}/compat.json`, "utf8"));
const flat = (kind: string) => new Map(flattenMessages(read(kind)));
const meta = read("meta") as Record<string, MetaEntry>;
const glossary = parseGlossary(
  JSON.parse(readFileSync(new URL("../../db/seed/glossary/glossary.json", import.meta.url), "utf8")),
);

/**
 * Every field of every typed spec. `Record<keyof …, true>` makes the compiler fail when SpecMap gets a field that is
 * not listed here (and when a field is listed that SpecMap does not have): the dictionary cannot fall behind unnoticed.
 */
const SPEC_FIELDS: { [C in DetailedCategory]: Record<keyof SpecMap[C], true> } = {
  cpu: {
    socket: true,
    cores: true,
    threads: true,
    boostGhz: true,
    tdpW: true,
    maxPowerW: true,
    hasIgpu: true,
    memTypes: true,
    memMaxMts: true,
    boxCooler: true,
    chipsets: true,
    minBiosByChipset: true,
  },
  mb: {
    socket: true,
    chipset: true,
    formFactor: true,
    ramType: true,
    ramSlots: true,
    ramMaxGb: true,
    ramMaxMts: true,
    m2: true,
    sataPorts: true,
    pcieX16Slots: true,
    fanHeaders: true,
    argb5vHeaders: true,
    rgb12vHeaders: true,
    wifi: true,
    bluetooth: true,
    biosFlashback: true,
    shippedBios: true,
  },
  ram: { type: true, kitGb: true, modules: true, mts: true, cl: true, profile: true, heightMm: true, lighting: true },
  ssd: { iface: true, formFactor: true, capacityGb: true, pcieGen: true, tbw: true, heatsinkHeightMm: true },
  gpu: {
    chip: true,
    vramGb: true,
    lengthMm: true,
    heightMm: true,
    slots: true,
    power: true,
    adapterInBox: true,
    tgpW: true,
    vendorRecommendedPsuW: true,
    hwEncoders: true,
  },
  psu: {
    watts: true,
    rating: true,
    formFactor: true,
    lengthMm: true,
    modular: true,
    pcie8pin: true,
    native12v2x6: true,
    atx3: true,
  },
  case: {
    boards: true,
    gpuMaxLenMm: true,
    gpuMaxLenWithFrontRadMm: true,
    coolerMaxHeightMm: true,
    radiators: true,
    psuFF: true,
    psuMaxLenMm: true,
    expansionSlots: true,
    fanMounts: true,
    fansIncluded: true,
    dimsMm: true,
  },
  cooler_air: { sockets: true, heightMm: true, ramClearanceMm: true, tdpRatedW: true },
  aio: { sockets: true, radMm: true, radThicknessWithFansMm: true, tubeLenMm: true, pumpW: true },
  fan: { sizeMm: true, count: true, conn: true, argb: true },
  monitor: {
    diagIn: true,
    aspect: true,
    resolution: true,
    hz: true,
    panelWmm: true,
    panelHmm: true,
    depthWithStandMm: true,
    standFootprintMm: true,
    weightNoStandKg: true,
    vesa: true,
    curved: true,
  },
  arm: {
    reachMinMm: true,
    reachMaxMm: true,
    poleHeightMm: true,
    mount: true,
    topThicknessMinMm: true,
    topThicknessMaxMm: true,
    vesa: true,
    loadMinKg: true,
    loadMaxKg: true,
    diagMinIn: true,
    diagMaxIn: true,
    screens: true,
  },
  desk: {
    topWmm: true,
    topDmm: true,
    heightMinMm: true,
    heightMaxMm: true,
    topThicknessMm: true,
    legZonesMm: true,
    cableCutout: true,
    loadKg: true,
    motors: true,
  },
  chair: {
    baseDiamMm: true,
    seatHeightMinMm: true,
    seatHeightMaxMm: true,
    rollbackZoneMm: true,
    userHeightCm: true,
    userMaxKg: true,
  },
};
/** Not spec fields, but "no data" fields of the rules: ARM_CLAMP_ZONE reports a missing position of the arm or the desk on the plan. */
const PLAN_FIELDS = [
  ["arm", "placement"],
  ["desk", "placement"],
] as const;
const FIELD_KEYS = [
  ...Object.entries(SPEC_FIELDS).flatMap(([category, fields]) =>
    Object.keys(fields).map((field) => fieldNameKey(category, field)),
  ),
  ...PLAN_FIELDS.map(([category, field]) => fieldNameKey(category, field)),
];
const MESSAGE_KEYS = Object.keys(COMPAT_MESSAGE_KEYS);

describe("namespace compat", () => {
  it("is registered in the catalog and loads in both locales", () => {
    expect(namespaces).toContain("compat");
    for (const locale of ["uz", "ru"] as const) {
      expect(flattenMessages(getMessages(locale, "compat").compat).length).toBeGreaterThan(MESSAGE_KEYS.length);
    }
  });

  it("has exactly the registered message keys and the field names, in uz and in ru", () => {
    const expected = [...MESSAGE_KEYS, ...FIELD_KEYS].sort();
    expect([...flat("ru").keys()].sort()).toEqual(expected);
    expect([...flat("uz").keys()].sort()).toEqual(expected);
    expect(MESSAGE_KEYS).toHaveLength(51);
  });

  it("passes the same consistency check as tools/check-messages (keys, meta, ICU, limits)", () => {
    expect(checkNamespace("compat", read("uz"), read("ru"), meta)).toEqual([]);
  });

  it("marks every Uzbek text as a draft for the translator, with a context and a limit", () => {
    expect(Object.keys(meta).sort()).toEqual([...MESSAGE_KEYS, ...FIELD_KEYS].sort());
    for (const [key, m] of Object.entries(meta)) {
      expect(m.status, key).toBe("draft");
      expect(m.context.length, key).toBeGreaterThan(20);
      expect(m.maxLen, key).toBeGreaterThanOrEqual(40);
    }
  });

  it("every message uses its registered params and all of them, except the technical `category`", () => {
    for (const locale of ["ru", "uz"] as const) {
      const texts = flat(locale);
      for (const [key, spec] of Object.entries(COMPAT_MESSAGE_KEYS)) {
        const used = placeholders(texts.get(key) ?? "");
        for (const name of used) expect(spec.params, `${locale} ${key}: {${name}}`).toContain(name);
        for (const name of spec.params) {
          if (name === "category") continue; // chooses the field name; not shown
          expect(used, `${locale} ${key} should show {${name}}`).toContain(name);
        }
      }
    }
  });

  it("field names take no placeholders", () => {
    for (const locale of ["ru", "uz"] as const) {
      for (const key of FIELD_KEYS) expect(placeholders(flat(locale).get(key) ?? ""), `${locale} ${key}`).toEqual([]);
    }
  });

  it("uses U+02BB and U+02BC in Uzbek, no Latin-ASCII apostrophes inside words and no Cyrillic", () => {
    const entries = [...flat("uz")];
    expect(entries.flatMap(([k, v]) => checkUzString(k, v))).toEqual([]);
    const text = entries.map(([, v]) => v).join(" ");
    expect(text).toContain("ʻ");
    expect(text).toContain("ʼ");
    expect(text).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(text).not.toMatch(/['’‘`]/u);
  });

  it("writes Russian in Cyrillic without ASCII apostrophes, dollars or fixed-width spaces", () => {
    for (const [key, text] of flat("ru")) {
      expect(text, key).toMatch(/\p{Script=Cyrillic}/u);
      expect(text, key).not.toMatch(/['`]|\$|USD/);
      expect(text, key).toBe(text.trim());
    }
  });

  it("follows the glossary: no forbidden Uzbek variants of a term", () => {
    for (const key of [...MESSAGE_KEYS, ...FIELD_KEYS]) {
      const { errors } = glossaryProblems(flat("ru").get(key) ?? "", flat("uz").get(key) ?? "", glossary);
      expect(errors, key).toEqual([]);
    }
  });

  it("the Uzbek text of a key differs from its Russian text", () => {
    for (const [key, ru] of flat("ru")) expect(flat("uz").get(key), key).not.toBe(ru);
  });
});

describe("compat.missing_data and the field dictionary", () => {
  it("has a name for every field of every typed spec (SpecMap) and for the plan position, in uz and ru", () => {
    expect(Object.keys(SPEC_FIELDS).sort()).toEqual([...DETAILED_CATEGORIES].sort());
    expect(FIELD_KEYS).toHaveLength(123 + PLAN_FIELDS.length);
    for (const locale of ["ru", "uz"] as const) {
      const texts = flat(locale);
      for (const key of FIELD_KEYS) expect(texts.get(key)?.trim().length ?? 0, `${locale} ${key}`).toBeGreaterThan(2);
    }
  });

  it("names differ within a category (the reader can tell two fields apart)", () => {
    for (const locale of ["ru", "uz"] as const) {
      for (const [category, fields] of Object.entries(SPEC_FIELDS)) {
        const all = [...Object.keys(fields), ...PLAN_FIELDS.filter(([c]) => c === category).map(([, f]) => f)];
        const names = all.map((f) => flat(locale).get(fieldNameKey(category, f)));
        expect(new Set(names).size, `${locale} ${category}`).toBe(names.length);
      }
    }
  });

  it("names are lower case phrases that read inside the sentence, not technical keys", () => {
    for (const locale of ["ru", "uz"] as const) {
      for (const key of FIELD_KEYS) {
        const name = flat(locale).get(key) ?? "";
        const field = key.split(".").pop() ?? "";
        expect(name, key).not.toBe(field);
        expect(name, key).not.toMatch(/^[\p{Lu}]/u);
        expect(name, key).not.toMatch(/[.:«»]$/u);
      }
    }
  });

  it("fieldNameKey is the documented key: compat.field.<category>.<field>", () => {
    expect(fieldNameKey("gpu", "tgpW")).toBe("compat.field.gpu.tgpW");
    expect(fieldNameKey("monitor", "standFootprintMm")).toBe("compat.field.monitor.standFootprintMm");
  });

  it.each(["uz", "ru"] as const)("%s: the issue is shown with the field name, not the technical key", (locale) => {
    const t = createNodeTranslator(locale, "compat");
    const params = { field: "tgpW", category: "gpu" };
    const text = t("compat.missing_data", { ...params, field: t(fieldNameKey(params.category, params.field)) });
    expect(text).not.toContain("tgpW");
    expect(text).toContain(t("compat.field.gpu.tgpW"));
    expect(text).not.toContain("{");
  });

  it("the Russian text shows the Russian name of the field", () => {
    const t = createNodeTranslator("ru", "compat");
    const text = t("compat.missing_data", { field: t("compat.field.monitor.standFootprintMm") });
    expect(text).toMatch(/основани/);
  });
});

describe("every message formats in both locales", () => {
  it.each(["uz", "ru"] as const)("%s: t(key, sampleValues) gives a text without raw braces", (locale) => {
    const t = createNodeTranslator(locale, "compat");
    for (const [key, text] of flat(locale)) {
      const out = t(key, sampleValues(text));
      expect(out.trim().length, key).toBeGreaterThan(5);
      expect(out, key).not.toContain("{");
      expect(out, key).not.toMatch(/^compat\./);
    }
  });

  it.each(["uz", "ru"] as const)("%s: the select of {task} and {cooler} has a branch per value", (locale) => {
    const t = createNodeTranslator(locale, "compat");
    const task = (v: string) => t("compat.no_wireless", { task: v });
    expect(new Set([task("streaming"), task("office"), task("gaming")]).size).toBe(3);
    const cooler = (v: string) => t("compat.cooler_socket_unsupported", { cooler: v, cpuSocket: "AM5" });
    expect(new Set([cooler("air"), cooler("aio"), cooler("other")]).size).toBe(3);
    expect(cooler("air")).toContain("AM5");
  });

  it("psu_low_headroom speaks of the headroom over the peak and shows the numbers", () => {
    const ru = createNodeTranslator("ru", "compat")("compat.psu_low_headroom", {
      headroomPct: 21,
      minPct: 30,
      peakW: 410,
    });
    expect(ru).toMatch(/над .*пик/);
    for (const n of ["21", "30", "410"]) expect(ru).toContain(n);
  });
});
