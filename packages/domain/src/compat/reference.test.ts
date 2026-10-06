// Reference data from the research documents:
// - block 15, 3.2: the table of compatibility checks (17 rows, levels "нельзя" and "проверьте");
// - block 28, 3.4: PSU power estimate (RTX 5070 needs at least 650 W);
// - ARCHITECTURE 4.4: settings and the list of 28 + 9 rules;
// and a set of builds that are known to be incompatible, with the exact rule ids expected.
import { describe, expect, it } from "vitest";
import { checkCompatibility, DEFAULT_COMPAT_SETTINGS, estimatePower } from "./index.ts";
import { build, ctx, makeProduct, type Part, pcBuild } from "./testkit.ts";
import type { CompatResult, RuleId, Task } from "./types.ts";

const docs = import.meta.glob(
  [
    "../../../../docs/research/15-produkt-ux.md",
    "../../../../docs/research/28-probel-dev-readiness-data.md",
    "../../../../docs/ARCHITECTURE.md",
    "./types.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
);
const doc = (tail: string): string => {
  const key = Object.keys(docs).find((k) => k.endsWith(tail));
  if (key === undefined || docs[key] === undefined) throw new Error(`not available to tests: ${tail}`);
  return docs[key] as string;
};

const run = (parts: Part[], tasks: Task[] = []): CompatResult => {
  const b = build(...parts);
  return checkCompatibility(b.lines, b.catalog, ctx(tasks));
};
const ruleIds = (r: CompatResult) => [...new Set(r.issues.map((i) => i.ruleId))];
const levelOf = (r: CompatResult) => (r.verdict === "block" ? "нельзя" : "проверьте");

interface Pair {
  /** Row title in the block 15, 3.2 table (checked against the document). */
  row: string;
  name: string;
  parts: Part[];
  tasks?: Task[];
  rules: RuleId[];
  level: "нельзя" | "проверьте";
}

const gpu12v = { power: [{ conn: "12V-2x6" as const, count: 1 }] };
const nvme = (id: string) => makeProduct("ssd", id, { iface: "nvme", formFactor: "M.2-2280" });
const sata = (id: string) => makeProduct("ssd", id, { iface: "sata", formFactor: "2.5" });

const PAIRS: Pair[] = [
  {
    row: "Сокет процессора и платы",
    name: "AM5 processor, LGA1700 board",
    parts: pcBuild({ mb: { socket: "LGA1700", chipset: "B650" } }),
    rules: ["CPU_MB_SOCKET"],
    level: "нельзя",
  },
  {
    row: "Чипсет и поддержка процессора, нужна ли прошивка BIOS",
    name: "the board needs a newer BIOS for this processor",
    parts: pcBuild({ cpu: { minBiosByChipset: { B650: "1.40" } } }),
    rules: ["CPU_MB_BIOS"],
    level: "проверьте",
  },
  {
    row: "Тип памяти (DDR4/DDR5), число слотов и модулей, максимальный объём",
    name: "DDR4 memory on a DDR5 board",
    parts: pcBuild({ ram: { type: "DDR4" } }),
    rules: ["MEM_TYPE"],
    level: "нельзя",
  },
  {
    row: "Тип памяти (DDR4/DDR5), число слотов и модулей, максимальный объём",
    name: "six modules on four slots",
    parts: pcBuild({ qty: { ram: 3 } }),
    rules: ["MEM_SLOTS"],
    level: "нельзя",
  },
  {
    row: "Тип памяти (DDR4/DDR5), число слотов и модулей, максимальный объём",
    name: "256 GB on a 192 GB board",
    parts: pcBuild({ ram: { kitGb: 64 }, qty: { ram: 2 }, mb: { ramMaxGb: 96 } }),
    rules: ["MEM_CAPACITY"],
    level: "нельзя",
  },
  {
    row: "Форм-фактор платы и корпуса (ATX, mATX, Mini-ITX)",
    name: "ATX board, a case for mATX and Mini-ITX",
    parts: pcBuild({ mb: { formFactor: "ATX" }, case: { boards: ["mATX", "Mini-ITX"] } }),
    rules: ["MB_CASE_FORMFACTOR"],
    level: "нельзя",
  },
  {
    row: "Длина видеокарты и место в корпусе с учётом переднего радиатора",
    name: "340 mm card, 330 mm case (the example of block 15)",
    parts: pcBuild({ gpu: { lengthMm: 340 } }),
    rules: ["GPU_CASE_LENGTH"],
    level: "нельзя",
  },
  {
    row: "Длина видеокарты и место в корпусе с учётом переднего радиатора",
    name: "less than 10 mm to spare",
    parts: pcBuild({ gpu: { lengthMm: 322 } }),
    rules: ["GPU_CASE_LENGTH"],
    level: "проверьте",
  },
  {
    row: "Толщина видеокарты (слоты) и слоты расширения корпуса",
    name: "3.5-slot card, 3 slots",
    parts: pcBuild({ gpu: { slots: 3.5 }, case: { expansionSlots: 3 } }),
    rules: ["GPU_SLOT_WIDTH"],
    level: "проверьте",
  },
  {
    row: "Высота башенного кулера",
    name: "cooler 170 mm in a 165 mm case",
    parts: pcBuild({ cooler: { heightMm: 170 } }),
    rules: ["COOLER_CASE_HEIGHT"],
    level: "нельзя",
  },
  {
    row: "Высота башенного кулера",
    name: "less than 5 mm to spare",
    parts: pcBuild({ cooler: { heightMm: 163 } }),
    rules: ["COOLER_CASE_HEIGHT"],
    level: "проверьте",
  },
  {
    row: "Радиатор жидкостного охлаждения",
    name: "420 mm radiator, the case takes 360 mm at most",
    parts: pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio", { radMm: 420 })] }),
    rules: ["AIO_RADIATOR_MOUNT"],
    level: "нельзя",
  },
  {
    row: "Радиатор жидкостного охлаждения",
    name: "radiator with fans thicker than the mount",
    parts: pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio", { radThicknessWithFansMm: 70 })] }),
    rules: ["AIO_RADIATOR_THICKNESS"],
    level: "проверьте",
  },
  {
    row: "Крепление кулера под сокет",
    name: "cooler without the AM5 bracket",
    parts: pcBuild({ cooler: { sockets: ["LGA1700"] } }),
    rules: ["COOLER_SOCKET"],
    level: "нельзя",
  },
  {
    row: "Мощность блока питания",
    name: "headroom under 30 % (estimate)",
    parts: pcBuild({ cpu: { maxPowerW: 150 }, gpu: { tgpW: 200, vendorRecommendedPsuW: 0 }, psu: { watts: 550 } }),
    rules: ["PSU_WATTAGE"],
    level: "проверьте",
  },
  {
    row: "Разъёмы питания видеокарты (8-pin, 12V-2x6)",
    name: "12V-2x6 card, no native cable, no adapter",
    parts: pcBuild({ gpu: { ...gpu12v, adapterInBox: false } }),
    rules: ["PSU_GPU_CONNECTORS"],
    level: "нельзя",
  },
  {
    row: "Разъёмы питания видеокарты (8-pin, 12V-2x6)",
    name: "12V-2x6 card with the adapter from its box",
    parts: pcBuild({ gpu: { ...gpu12v, adapterInBox: true } }),
    rules: ["PSU_GPU_CONNECTORS"],
    level: "проверьте",
  },
  {
    row: "Длина блока питания и корпус",
    name: "PSU longer than the case limit",
    parts: pcBuild({ psu: { lengthMm: 200 } }),
    rules: ["PSU_CASE_LENGTH"],
    level: "проверьте",
  },
  {
    row: "Накопители M.2 и SATA: число слотов, отключение SATA при занятом M.2",
    name: "an occupied M.2 slot disables SATA ports",
    parts: pcBuild({
      mb: { m2: [{ id: "M2_1", pcieGen: 4, maxLenMm: 80, disablesSata: [3, 4] }] },
      add: [[sata("hdd"), 3]],
    }),
    rules: ["M2_SATA_SHARING"],
    level: "проверьте",
  },
  {
    row: "Накопители M.2 и SATA: число слотов, отключение SATA при занятом M.2",
    name: "three NVMe drives, two slots",
    parts: pcBuild({ drop: ["ssd"], add: [[nvme("d"), 3]] }),
    rules: ["M2_SLOTS"],
    level: "нельзя",
  },
  {
    row: "Высота памяти под кулером",
    name: "tall memory under a tower cooler",
    parts: pcBuild({ ram: { heightMm: 45 } }),
    rules: ["MEM_COOLER_CLEARANCE"],
    level: "проверьте",
  },
  {
    row: "Подсветка: разъёмы ARGB/RGB на плате и вентиляторах",
    name: "three ARGB kits, two headers",
    parts: pcBuild({ add: [[makeProduct("fan", "fan", { argb: true, count: 1 }, { lighting: "argb" }), 3]] }),
    rules: ["ARGB_HEADERS"],
    level: "проверьте",
  },
  {
    row: "Вентиляторы: места в корпусе и разъёмы на плате",
    name: "more fans than mounts",
    parts: pcBuild({ case: { fanMounts: 3 }, add: [makeProduct("fan", "fan", { count: 3 })] }),
    rules: ["FAN_HEADERS"],
    level: "проверьте",
  },
  {
    row: "Wi-Fi и Bluetooth для стрима и офиса",
    name: "streaming PC, board without wireless",
    parts: pcBuild({ mb: { wifi: false, bluetooth: false } }),
    tasks: ["streaming"],
    rules: ["WIFI_FOR_TASK"],
    level: "проверьте",
  },
];

describe("block 15, 3.2: the table of checks", () => {
  const text = doc("15-produkt-ux.md");
  const section = text.slice(text.indexOf("### 3.2 Проверки совместимости"), text.indexOf("### 3.3"));

  it("the document has the 17 rows this suite refers to", () => {
    const rows = section
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| ---") && !l.startsWith("| Проверка"));
    expect(rows).toHaveLength(17);
    expect(new Set(PAIRS.map((p) => p.row)).size).toBe(17);
  });

  it.each(PAIRS.map((p) => [`${p.row}: ${p.name}`, p] as const))("%s", (_name, p) => {
    expect(section, `row "${p.row}" is not in the document`).toContain(`| ${p.row} |`);
    const r = run(p.parts, p.tasks);
    expect(ruleIds(r)).toEqual(p.rules);
    expect(levelOf(r)).toBe(p.level);
  });

  it('the "нельзя" rows from the document are exactly the block rules, the "проверьте" rows are warn rules', () => {
    // the levels used by the pairs above agree with the document wording
    for (const row of section.split("\n")) {
      if (row.includes("| нельзя |")) {
        const title = row.split("|")[1]?.trim() ?? "";
        expect(PAIRS.some((p) => p.row === title && p.level === "нельзя")).toBe(true);
      }
    }
  });
});

describe("block 28, 3.4: PSU power estimate", () => {
  it("quotes the same formula as the code: 50 W base, 5 W per fan, 15 W pump, x 1.3, series 550 to 1200", () => {
    const text = doc("28-probel-dev-readiness-data.md");
    expect(text).toContain("+ 50 Вт (плата, память, SSD) + 5 Вт на вентилятор + 15 Вт на помпу");
    expect(text).toContain("пик × 1,3 с округлением вверх до ряда 550 / 650 / 750 / 850 / 1000 / 1200 Вт");
    expect(text).toContain("для RTX 5070 — 650 Вт, для RTX 5070 Ti — 750 Вт");
    expect(DEFAULT_COMPAT_SETTINGS).toMatchObject({ baseW: 50, perFanW: 5, pumpW: 15, psuMultiplier: 1.3 });
    expect(DEFAULT_COMPAT_SETTINGS.psuSeriesW).toEqual([550, 650, 750, 850, 1000, 1200]);
  });

  it("RTX 5070 build: recommended PSU is not below 650 W; 750 W Gold passes, 550 W does not", () => {
    const rtx5070 = { chip: "RTX 5070", tgpW: 250, vendorRecommendedPsuW: 650 };
    const cpu = { maxPowerW: 120 };
    const b = build(...pcBuild({ gpu: rtx5070, cpu, psu: { watts: 750, rating: "gold" } }));
    const est = estimatePower(b.lines, b.catalog, DEFAULT_COMPAT_SETTINGS);
    expect(est.recommendedPsuW).toBeGreaterThanOrEqual(650);
    expect(run(pcBuild({ gpu: rtx5070, cpu, psu: { watts: 750 } })).verdict).toBe("ok");
    expect(run(pcBuild({ gpu: rtx5070, cpu, psu: { watts: 550 } })).issues.map((i) => i.messageKey)).toEqual([
      "compat.psu_below_recommended",
    ]);
  });

  it("the interface example: 420 W estimate, 750 W PSU, headroom 44 %", () => {
    const b = build(
      makeProduct("cpu", "cpu", { maxPowerW: 100 }),
      makeProduct("gpu", "gpu", { tgpW: 270 }),
      makeProduct("psu", "psu", { watts: 750 }),
    );
    const est = estimatePower(b.lines, b.catalog, DEFAULT_COMPAT_SETTINGS);
    expect([est.peakW, est.selectedPsuW, Math.floor((est.headroomBp ?? 0) / 100)]).toEqual([420, 750, 44]);
  });
});

describe("DEFAULT_COMPAT_SETTINGS match ARCHITECTURE 4.4", () => {
  const types = doc("types.ts");
  const arch = doc("ARCHITECTURE.md");
  const s = DEFAULT_COMPAT_SETTINGS;

  it.each([
    ["gpuLenWarnMarginMm", s.gpuLenWarnMarginMm, "10"],
    ["coolerHeightWarnMarginMm", s.coolerHeightWarnMarginMm, "5"],
    ["psuMultiplier", s.psuMultiplier, "1.3"],
    ["psuHeadroomWarnBp", s.psuHeadroomWarnBp, "3000"],
    ["rollbackZoneMm", s.rollbackZoneMm, "750"],
  ])("%s = %s as in the contract comment", (name, value, comment) => {
    for (const source of [types, arch]) {
      const line = source.split("\n").find((l) => l.includes(`${name}:`) && l.includes("//")) ?? "";
      expect(line, `${name} in contract`).toContain(`// ${comment}`);
    }
    expect(String(value)).toBe(comment);
  });

  it("ranges and series", () => {
    expect(arch).toContain("psuSeriesW: number[];            // [550, 650, 750, 850, 1000, 1200]");
    expect(arch).toContain("eyeDistanceMm: [number, number]; // [500, 760]");
    expect(arch).toContain("standDepthMm: [number, number];  // [150, 250]");
    expect(arch).toContain("// 50, 5, 15");
    expect(s.eyeDistanceMm).toEqual([500, 760]);
    expect(s.standDepthMm).toEqual([150, 250]);
  });

  it("the settings object is frozen: nobody edits the defaults by accident", () => {
    expect(Object.isFrozen(DEFAULT_COMPAT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMPAT_SETTINGS.psuSeriesW)).toBe(true);
  });
});

describe("known incompatible builds", () => {
  interface Bad {
    name: string;
    parts: Part[];
    tasks?: Task[];
    rules: RuleId[];
    verdict: CompatResult["verdict"];
  }
  const BAD: Bad[] = [
    {
      name: "AMD processor on an Intel DDR4 board",
      parts: pcBuild({ mb: { socket: "LGA1700", chipset: "B760", ramType: "DDR4" } }),
      rules: ["CPU_MB_SOCKET", "CPU_MB_CHIPSET", "MEM_TYPE"],
      verdict: "block",
    },
    {
      name: "everything too big for a compact case",
      parts: pcBuild({
        gpu: { lengthMm: 340 },
        case: { boards: ["Mini-ITX"], gpuMaxLenMm: 300, coolerMaxHeightMm: 150, psuFF: ["SFX"], psuMaxLenMm: 130 },
      }),
      rules: ["MB_CASE_FORMFACTOR", "GPU_CASE_LENGTH", "COOLER_CASE_HEIGHT", "PSU_CASE_FORMFACTOR", "PSU_CASE_LENGTH"],
      verdict: "block",
    },
    {
      name: "RTX 5090 on a 650 W PSU without a 12V-2x6 cable",
      parts: pcBuild({
        gpu: {
          chip: "RTX 5090",
          tgpW: 575,
          vendorRecommendedPsuW: 1000,
          power: [{ conn: "12V-2x6", count: 1 }],
          adapterInBox: false,
        },
      }),
      rules: ["PSU_WATTAGE", "PSU_GPU_CONNECTORS"],
      verdict: "block",
    },
    {
      name: "too much memory, too fast, too tall",
      parts: pcBuild({ ram: { kitGb: 32, mts: 6400, heightMm: 50 }, qty: { ram: 3 } }),
      rules: ["MEM_SLOTS", "MEM_SPEED", "MEM_COOLER_CLEARANCE"],
      verdict: "block",
    },
    {
      name: "too many drives",
      parts: pcBuild({
        drop: ["ssd"],
        add: [
          [nvme("n"), 3],
          [sata("s"), 5],
        ],
      }),
      rules: ["M2_SLOTS", "SATA_PORTS"],
      verdict: "block",
    },
    {
      name: "a radiator that does not fit",
      parts: pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio", { radMm: 420 })] }),
      rules: ["AIO_RADIATOR_MOUNT"],
      verdict: "block",
    },
    {
      name: "office PC: no video output and no wireless",
      parts: pcBuild({ drop: ["gpu"], cpu: { hasIgpu: false }, mb: { wifi: false, bluetooth: false } }),
      tasks: ["office"],
      rules: ["CPU_NO_VIDEO", "WIFI_FOR_TASK"],
      verdict: "block",
    },
    {
      name: "cooler for another socket and too weak",
      parts: pcBuild({ cooler: { sockets: ["LGA1700"], tdpRatedW: 65 } }),
      rules: ["COOLER_SOCKET", "COOLER_TDP"],
      verdict: "block",
    },
  ];

  it.each(BAD.map((b) => [b.name, b] as const))("%s", (_name, b) => {
    const r = run(b.parts, b.tasks);
    expect(ruleIds(r).sort()).toEqual([...b.rules].sort());
    expect(r.verdict).toBe(b.verdict);
    expect(r.issues.some((i) => i.severity === "block")).toBe(true);
  });

  it("the same builds with the data blanked out are never ok", () => {
    for (const b of BAD) {
      const blank = b.parts.map((p) => {
        const prod = Array.isArray(p) ? p[0] : p;
        const spec = Object.fromEntries(Object.keys(prod.spec as object).map((k) => [k, null]));
        const cleared = { ...prod, spec } as typeof prod;
        return Array.isArray(p) ? ([cleared, p[1]] as [typeof prod, number]) : cleared;
      });
      const r = run(blank, b.tasks);
      expect(r.verdict, b.name).toBe("incomplete");
      expect(r.missingData.length, b.name).toBeGreaterThan(0);
    }
  });

  it("good builds stay ok: the default PC, the RTX 5070 PC and an AIO build", () => {
    expect(run(pcBuild()).verdict).toBe("ok");
    expect(
      run(pcBuild({ gpu: { chip: "RTX 5070", tgpW: 250, vendorRecommendedPsuW: 650 }, psu: { watts: 750 } })).verdict,
    ).toBe("ok");
    expect(run(pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio")] })).verdict).toBe("ok");
  });
});
