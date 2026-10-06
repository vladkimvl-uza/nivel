// Scenario table for the 28 PC rules: for every rule a clean build, "block" and "warn" builds with the expected
// message key and params, "no data" builds, and a build where the rule must not run (ARCHITECTURE 4.4).
// Consumed by rules.test.ts, the message-key registry test and the golden-set tests. Not part of the public API.
import type { SpecMap } from "../catalog/index.ts";
import type { Nullable } from "../catalog/types.ts";
import { makeProduct, type Part, pcBuild } from "./testkit.ts";
import type { CompatSettings, RuleId, Severity, Task } from "./types.ts";

export interface Expect {
  /** Short description for the test title. */
  name: string;
  parts: Part[];
  tasks?: Task[];
  settings?: Partial<CompatSettings>;
  key: string;
  severity: Severity;
  /** Subset of params that must match exactly. */
  params?: Record<string, string | number>;
  /** Product ids the issue must point at. */
  products?: string[];
  fix?: { category: string; filter: Record<string, string | number | boolean> };
}
export interface Missing {
  name: string;
  parts: Part[];
  tasks?: Task[];
  product: string;
  field: string;
}
export interface RuleScenario {
  ok: { parts: Part[]; tasks?: Task[] };
  issues: Expect[];
  missing: Missing[];
  /** Build in which the rule has nothing to check: it must not appear in checkedRules and must not raise issues. */
  notApplicable: { parts: Part[]; tasks?: Task[] };
}

/** The default PC with the air cooler replaced by a 360 mm AIO (id "aio"); spec overrides apply to the AIO. */
const aioBuild = (aio: Partial<Nullable<SpecMap["aio"]>> = {}, over: Parameters<typeof pcBuild>[0] = {}) =>
  pcBuild({
    ...over,
    drop: ["cooler", ...(over.drop ?? [])],
    add: [makeProduct("aio", "aio", aio), ...(over.add ?? [])],
  });
const noCooler = pcBuild({ drop: ["cooler"] });
const noGpu = (over: Parameters<typeof pcBuild>[0] = {}) => pcBuild({ ...over, drop: ["gpu", ...(over.drop ?? [])] });
const sata = (id: string) => makeProduct("ssd", id, { iface: "sata", formFactor: "2.5" });

export const PC_SCENARIOS: Record<
  Exclude<
    RuleId,
    | "DESK_DEPTH_EYES"
    | "DESK_WIDTH_MONITORS"
    | "ARM_VESA"
    | "ARM_LOAD"
    | "ARM_DIAGONAL"
    | "ARM_DESK_THICKNESS"
    | "ARM_CLAMP_ZONE"
    | "CHAIR_ROLLBACK"
    | "CHAIR_USER_HEIGHT"
  >,
  RuleScenario
> = {
  CPU_MB_SOCKET: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "AM4 processor on an AM5 board",
        parts: pcBuild({ cpu: { socket: "AM4" } }),
        key: "compat.socket_mismatch",
        severity: "block",
        params: { cpuSocket: "AM4", boardSocket: "AM5" },
        products: ["cpu", "mb"],
        fix: { category: "mb", filter: { socket: "AM4" } },
      },
    ],
    missing: [
      { name: "processor socket", parts: pcBuild({ cpu: { socket: null } }), product: "cpu", field: "socket" },
      { name: "board socket", parts: pcBuild({ mb: { socket: null } }), product: "mb", field: "socket" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["mb"] }) },
  },
  CPU_MB_CHIPSET: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "chipset missing from the processor list",
        parts: pcBuild({ mb: { chipset: "A620" } }),
        key: "compat.chipset_unsupported",
        severity: "block",
        params: { chipset: "A620", supported: "B650, X670, B850, X870" },
        products: ["cpu", "mb"],
      },
    ],
    missing: [
      { name: "processor chipsets", parts: pcBuild({ cpu: { chipsets: null } }), product: "cpu", field: "chipsets" },
      { name: "board chipset", parts: pcBuild({ mb: { chipset: null } }), product: "mb", field: "chipset" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["cpu"] }) },
  },
  CPU_MB_BIOS: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "BIOS older than required, flashback available",
        parts: pcBuild({ cpu: { minBiosByChipset: { B650: "1.40" } } }),
        key: "compat.bios_update_flashback",
        severity: "warn",
        params: { chipset: "B650", minBios: "1.40", shippedBios: "1.30" },
        products: ["cpu", "mb"],
      },
      {
        name: "BIOS older than required, no flashback: the seller flashes it",
        parts: pcBuild({ cpu: { minBiosByChipset: { B650: "1.40" } }, mb: { biosFlashback: false } }),
        key: "compat.bios_update_seller",
        severity: "warn",
        params: { chipset: "B650", minBios: "1.40", shippedBios: "1.30" },
        products: ["cpu", "mb"],
      },
    ],
    missing: [
      {
        name: "shipped BIOS unknown while the processor has a floor",
        parts: pcBuild({ mb: { shippedBios: null } }),
        product: "mb",
        field: "shippedBios",
      },
      {
        name: "processor BIOS table unknown",
        parts: pcBuild({ cpu: { minBiosByChipset: null } }),
        product: "cpu",
        field: "minBiosByChipset",
      },
      {
        name: "board chipset unknown while the processor has a table",
        parts: pcBuild({ mb: { chipset: null } }),
        product: "mb",
        field: "chipset",
      },
      {
        name: "flashback unknown when an update is needed",
        parts: pcBuild({ cpu: { minBiosByChipset: { B650: "1.40" } }, mb: { biosFlashback: null } }),
        product: "mb",
        field: "biosFlashback",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["cpu"] }) },
  },
  CPU_NO_VIDEO: {
    ok: { parts: noGpu({ cpu: { hasIgpu: true } }) },
    issues: [
      {
        name: "no integrated graphics and no video card",
        parts: noGpu({ cpu: { hasIgpu: false } }),
        key: "compat.no_video_output",
        severity: "block",
        params: {},
        products: ["cpu"],
        fix: { category: "gpu", filter: {} },
      },
    ],
    missing: [{ name: "iGPU flag", parts: noGpu({ cpu: { hasIgpu: null } }), product: "cpu", field: "hasIgpu" }],
    notApplicable: { parts: pcBuild({ drop: ["cpu"] }) },
  },
  MEM_TYPE: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "DDR4 memory on a DDR5 board",
        parts: pcBuild({ ram: { type: "DDR4" } }),
        key: "compat.mem_type_board",
        severity: "block",
        params: { ramType: "DDR4", boardType: "DDR5" },
        products: ["ram", "mb"],
      },
      {
        name: "DDR5 memory with a DDR4-only processor",
        parts: pcBuild({ cpu: { memTypes: ["DDR4"], memMaxMts: { DDR4: 3200 } } }),
        key: "compat.mem_type_cpu",
        severity: "block",
        params: { ramType: "DDR5", cpuTypes: "DDR4" },
        products: ["ram", "cpu"],
      },
    ],
    missing: [
      { name: "memory type", parts: pcBuild({ ram: { type: null } }), product: "ram", field: "type" },
      { name: "board memory type", parts: pcBuild({ mb: { ramType: null } }), product: "mb", field: "ramType" },
      {
        name: "processor memory types",
        parts: pcBuild({ cpu: { memTypes: null } }),
        product: "cpu",
        field: "memTypes",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["ram"] }) },
  },
  MEM_SLOTS: {
    ok: { parts: pcBuild({ qty: { ram: 2 } }) },
    issues: [
      {
        name: "six modules for four slots",
        parts: pcBuild({ qty: { ram: 3 } }),
        key: "compat.mem_slots_exceeded",
        severity: "block",
        params: { modules: 6, slots: 4 },
        products: ["ram", "mb"],
      },
    ],
    missing: [
      { name: "modules in the kit", parts: pcBuild({ ram: { modules: null } }), product: "ram", field: "modules" },
      { name: "board slots", parts: pcBuild({ mb: { ramSlots: null } }), product: "mb", field: "ramSlots" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["mb"] }) },
  },
  MEM_CAPACITY: {
    ok: { parts: pcBuild({ qty: { ram: 2 } }) },
    issues: [
      {
        name: "64 GB on a board limited to 32 GB",
        parts: pcBuild({ ram: { kitGb: 32 }, mb: { ramMaxGb: 32 }, qty: { ram: 2 } }),
        key: "compat.mem_capacity_exceeded",
        severity: "block",
        params: { totalGb: 64, maxGb: 32 },
        products: ["ram", "mb"],
      },
    ],
    missing: [
      { name: "kit capacity", parts: pcBuild({ ram: { kitGb: null } }), product: "ram", field: "kitGb" },
      { name: "board maximum", parts: pcBuild({ mb: { ramMaxGb: null } }), product: "mb", field: "ramMaxGb" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["mb"] }) },
  },
  MEM_SPEED: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "6000 MT/s memory on a 5200 MT/s processor",
        parts: pcBuild({ ram: { mts: 6000 } }),
        key: "compat.mem_speed_reduced",
        severity: "warn",
        params: { ramMts: 6000, effectiveMts: 5200 },
        products: ["ram"],
      },
      {
        name: "board slower than the processor",
        parts: pcBuild({ ram: { mts: 6000 }, cpu: { memMaxMts: { DDR5: 6400 } }, mb: { ramMaxMts: 5600 } }),
        key: "compat.mem_speed_reduced",
        severity: "warn",
        params: { ramMts: 6000, effectiveMts: 5600 },
        products: ["ram"],
      },
    ],
    missing: [
      { name: "memory speed", parts: pcBuild({ ram: { mts: null } }), product: "ram", field: "mts" },
      { name: "board speed limit", parts: pcBuild({ mb: { ramMaxMts: null } }), product: "mb", field: "ramMaxMts" },
      {
        name: "processor speed limits",
        parts: pcBuild({ cpu: { memMaxMts: null } }),
        product: "cpu",
        field: "memMaxMts",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["ram"] }) },
  },
  MEM_COOLER_CLEARANCE: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "44 mm memory under a cooler with 40 mm clearance",
        parts: pcBuild({ ram: { heightMm: 44 } }),
        key: "compat.mem_cooler_clearance",
        severity: "warn",
        params: { ramMm: 44, clearanceMm: 40 },
        products: ["ram", "cooler"],
      },
    ],
    missing: [
      { name: "memory height", parts: pcBuild({ ram: { heightMm: null } }), product: "ram", field: "heightMm" },
      {
        name: "cooler clearance",
        parts: pcBuild({ cooler: { ramClearanceMm: null } }),
        product: "cooler",
        field: "ramClearanceMm",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["cooler"] }) },
  },
  MB_CASE_FORMFACTOR: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "E-ATX board in a case for ATX and smaller",
        parts: pcBuild({ mb: { formFactor: "E-ATX" } }),
        key: "compat.board_not_supported",
        severity: "block",
        params: { board: "E-ATX", supported: "ATX, mATX, Mini-ITX" },
        products: ["mb", "case"],
        fix: { category: "case", filter: { boards: "E-ATX" } },
      },
    ],
    missing: [
      { name: "board form factor", parts: pcBuild({ mb: { formFactor: null } }), product: "mb", field: "formFactor" },
      { name: "case boards", parts: pcBuild({ case: { boards: null } }), product: "case", field: "boards" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["case"] }) },
  },
  GPU_CASE_LENGTH: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "340 mm card in a 330 mm case",
        parts: pcBuild({ gpu: { lengthMm: 340 } }),
        key: "compat.gpu_too_long",
        severity: "block",
        params: { gpuMm: 340, caseMm: 330 },
        products: ["gpu", "case"],
        fix: { category: "case", filter: { gpuMaxLenMmMin: 340 } },
      },
      {
        name: "5 mm to spare is below the 10 mm margin",
        parts: pcBuild({ gpu: { lengthMm: 325 } }),
        key: "compat.gpu_tight_fit",
        severity: "warn",
        params: { gpuMm: 325, caseMm: 330, marginMm: 5 },
        products: ["gpu", "case"],
      },
      {
        name: "front-only radiator lowers the limit to 300 mm",
        parts: pcBuild({
          gpu: { lengthMm: 310 },
          case: { radiators: [{ side: "front", sizesMm: [240, 280, 360], maxThicknessMm: 55 }] },
          drop: ["cooler"],
          add: [makeProduct("aio", "aio")],
        }),
        key: "compat.gpu_too_long",
        severity: "block",
        params: { gpuMm: 310, caseMm: 300 },
        products: ["gpu", "case"],
      },
    ],
    missing: [
      { name: "card length", parts: pcBuild({ gpu: { lengthMm: null } }), product: "gpu", field: "lengthMm" },
      { name: "case limit", parts: pcBuild({ case: { gpuMaxLenMm: null } }), product: "case", field: "gpuMaxLenMm" },
      {
        name: "limit with a front radiator when the radiator can only sit in front",
        parts: pcBuild({
          case: {
            radiators: [{ side: "front", sizesMm: [240, 280, 360], maxThicknessMm: 55 }],
            gpuMaxLenWithFrontRadMm: null,
          },
          drop: ["cooler"],
          add: [makeProduct("aio", "aio")],
        }),
        product: "case",
        field: "gpuMaxLenWithFrontRadMm",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["gpu"] }) },
  },
  GPU_SLOT_WIDTH: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "4-slot card, 3 expansion slots",
        parts: pcBuild({ gpu: { slots: 4 }, case: { expansionSlots: 3 } }),
        key: "compat.gpu_slots_exceeded",
        severity: "warn",
        params: { gpuSlots: 4, caseSlots: 3 },
        products: ["gpu", "case"],
      },
    ],
    missing: [
      { name: "card slots", parts: pcBuild({ gpu: { slots: null } }), product: "gpu", field: "slots" },
      {
        name: "case expansion slots",
        parts: pcBuild({ case: { expansionSlots: null } }),
        product: "case",
        field: "expansionSlots",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["case"] }) },
  },
  COOLER_SOCKET: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "air cooler without AM5 mount",
        parts: pcBuild({ cooler: { sockets: ["AM4", "LGA1700"] } }),
        key: "compat.cooler_socket_unsupported",
        severity: "block",
        params: { cpuSocket: "AM5", cooler: "air" },
        products: ["cooler", "cpu"],
        fix: { category: "cooler_air", filter: { sockets: "AM5" } },
      },
      {
        name: "AIO without AM5 mount",
        parts: aioBuild({ sockets: ["LGA1700"] }),
        key: "compat.cooler_socket_unsupported",
        severity: "block",
        params: { cpuSocket: "AM5", cooler: "aio" },
        products: ["aio", "cpu"],
        fix: { category: "aio", filter: { sockets: "AM5" } },
      },
    ],
    missing: [
      { name: "processor socket", parts: pcBuild({ cpu: { socket: null } }), product: "cpu", field: "socket" },
      { name: "cooler sockets", parts: pcBuild({ cooler: { sockets: null } }), product: "cooler", field: "sockets" },
    ],
    notApplicable: { parts: noCooler },
  },
  COOLER_CASE_HEIGHT: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "170 mm cooler in a case for 165 mm",
        parts: pcBuild({ cooler: { heightMm: 170 } }),
        key: "compat.cooler_too_tall",
        severity: "block",
        params: { coolerMm: 170, caseMm: 165 },
        products: ["cooler", "case"],
        fix: { category: "cooler_air", filter: { heightMmMax: 165 } },
      },
      {
        name: "3 mm to spare is below the 5 mm margin",
        parts: pcBuild({ cooler: { heightMm: 162 } }),
        key: "compat.cooler_tight_fit",
        severity: "warn",
        params: { coolerMm: 162, caseMm: 165, marginMm: 3 },
        products: ["cooler", "case"],
      },
    ],
    missing: [
      { name: "cooler height", parts: pcBuild({ cooler: { heightMm: null } }), product: "cooler", field: "heightMm" },
      {
        name: "case cooler limit",
        parts: pcBuild({ case: { coolerMaxHeightMm: null } }),
        product: "case",
        field: "coolerMaxHeightMm",
      },
    ],
    notApplicable: { parts: noCooler },
  },
  COOLER_TDP: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "65 W cooler for an 88 W processor",
        parts: pcBuild({ cooler: { tdpRatedW: 65 } }),
        key: "compat.cooler_underpowered",
        severity: "warn",
        params: { coolerW: 65, cpuW: 88 },
        products: ["cooler", "cpu"],
        fix: { category: "cooler_air", filter: { tdpRatedWMin: 88 } },
      },
    ],
    missing: [
      { name: "cooler rating", parts: pcBuild({ cooler: { tdpRatedW: null } }), product: "cooler", field: "tdpRatedW" },
      { name: "processor power", parts: pcBuild({ cpu: { maxPowerW: null } }), product: "cpu", field: "maxPowerW" },
    ],
    notApplicable: { parts: noCooler },
  },
  AIO_RADIATOR_MOUNT: {
    ok: { parts: aioBuild() },
    issues: [
      {
        name: "420 mm radiator, the case takes 360 mm at most",
        parts: aioBuild({ radMm: 420 }),
        key: "compat.aio_no_mount",
        severity: "block",
        params: { radMm: 420 },
        products: ["aio", "case"],
        fix: { category: "case", filter: { radiatorSizeMm: 420 } },
      },
    ],
    missing: [
      { name: "radiator size", parts: aioBuild({ radMm: null }), product: "aio", field: "radMm" },
      {
        name: "case radiators",
        parts: aioBuild({}, { case: { radiators: null } }),
        product: "case",
        field: "radiators",
      },
    ],
    notApplicable: { parts: pcBuild() },
  },
  AIO_RADIATOR_THICKNESS: {
    ok: { parts: aioBuild() },
    issues: [
      {
        name: "60 mm with fans, mounts take 55 mm",
        parts: aioBuild({ radThicknessWithFansMm: 60 }),
        key: "compat.aio_too_thick",
        severity: "warn",
        params: { thicknessMm: 60, maxMm: 55 },
        products: ["aio", "case"],
      },
    ],
    missing: [
      {
        name: "thickness with fans",
        parts: aioBuild({ radThicknessWithFansMm: null }),
        product: "aio",
        field: "radThicknessWithFansMm",
      },
      {
        name: "case radiators",
        parts: aioBuild({}, { case: { radiators: null } }),
        product: "case",
        field: "radiators",
      },
    ],
    notApplicable: { parts: pcBuild() },
  },
  PSU_WATTAGE: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "PSU below the peak",
        parts: pcBuild({ psu: { watts: 250 } }),
        key: "compat.psu_below_peak",
        severity: "block",
        params: { psuW: 250, peakW: 293 },
        products: ["psu"],
        fix: { category: "psu", filter: { wattsMin: 550 } },
      },
      {
        name: "RTX 5070 on 550 W: the vendor recommends 650 W",
        parts: pcBuild({ gpu: { chip: "RTX 5070", tgpW: 250, vendorRecommendedPsuW: 650 }, psu: { watts: 550 } }),
        key: "compat.psu_below_recommended",
        severity: "warn",
        params: { psuW: 550, recommendedW: 650, peakW: 398 },
        products: ["psu"],
        fix: { category: "psu", filter: { wattsMin: 650 } },
      },
      {
        // At the default settings the recommendation (peak x 1.3) is itself a 30 % headroom, so the headroom warning
        // can only be provoked when the owner lowers the multiplier or raises the threshold.
        name: "headroom over the peak under 30 % with a lowered multiplier",
        parts: pcBuild({ cpu: { maxPowerW: 150 }, gpu: { tgpW: 200, vendorRecommendedPsuW: 0 }, psu: { watts: 500 } }),
        settings: { psuMultiplier: 1, psuSeriesW: [] },
        key: "compat.psu_low_headroom",
        severity: "warn",
        params: { headroomPct: 21, minPct: 30, peakW: 410 },
        products: ["psu"],
      },
    ],
    missing: [
      { name: "PSU wattage", parts: pcBuild({ psu: { watts: null } }), product: "psu", field: "watts" },
      { name: "processor power", parts: pcBuild({ cpu: { maxPowerW: null } }), product: "cpu", field: "maxPowerW" },
      { name: "card TGP", parts: pcBuild({ gpu: { tgpW: null } }), product: "gpu", field: "tgpW" },
      {
        name: "card vendor recommendation",
        parts: pcBuild({ gpu: { vendorRecommendedPsuW: null } }),
        product: "gpu",
        field: "vendorRecommendedPsuW",
      },
      { name: "case fans", parts: pcBuild({ case: { fansIncluded: null } }), product: "case", field: "fansIncluded" },
      // the PSU is usually chosen last: the unknown inputs of the estimate are reported before it is in the build
      {
        name: "card TGP, no PSU yet",
        parts: pcBuild({ drop: ["psu", "cooler"], gpu: { tgpW: null } }),
        product: "gpu",
        field: "tgpW",
      },
      {
        name: "card vendor recommendation, no PSU yet",
        parts: pcBuild({ drop: ["psu", "cooler"], gpu: { vendorRecommendedPsuW: null } }),
        product: "gpu",
        field: "vendorRecommendedPsuW",
      },
      {
        name: "processor power, no PSU yet",
        parts: pcBuild({ drop: ["psu", "cooler"], cpu: { maxPowerW: null } }),
        product: "cpu",
        field: "maxPowerW",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["cpu", "gpu"] }) },
  },
  PSU_GPU_CONNECTORS: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "three 8-pin plugs on a PSU with two",
        parts: pcBuild({ gpu: { power: [{ conn: "8pin", count: 3 }] } }),
        key: "compat.psu_8pin_missing",
        severity: "block",
        params: { need: 3, have: 2 },
        products: ["psu", "gpu"],
        fix: { category: "psu", filter: { pcie8pinMin: 3 } },
      },
      {
        name: "12V-2x6 card, no native cable, no adapter in the box",
        parts: pcBuild({ gpu: { power: [{ conn: "12V-2x6", count: 1 }], adapterInBox: false } }),
        key: "compat.psu_12v2x6_missing",
        severity: "block",
        params: { need: 1, have: 0 },
        products: ["psu", "gpu"],
        fix: { category: "psu", filter: { native12v2x6Min: 1 } },
      },
      {
        name: "12V-2x6 card with an adapter from the box",
        parts: pcBuild({ gpu: { power: [{ conn: "12V-2x6", count: 1 }], adapterInBox: true } }),
        key: "compat.psu_12v2x6_adapter",
        severity: "warn",
        params: { need: 1, have: 0 },
        products: ["psu", "gpu"],
      },
    ],
    missing: [
      { name: "card connectors", parts: pcBuild({ gpu: { power: null } }), product: "gpu", field: "power" },
      { name: "PSU 8-pin count", parts: pcBuild({ psu: { pcie8pin: null } }), product: "psu", field: "pcie8pin" },
      {
        name: "PSU native 12V-2x6 count",
        parts: pcBuild({ gpu: { power: [{ conn: "12V-2x6", count: 1 }] }, psu: { native12v2x6: null } }),
        product: "psu",
        field: "native12v2x6",
      },
      {
        name: "adapter in the box",
        parts: pcBuild({ gpu: { power: [{ conn: "12V-2x6", count: 1 }], adapterInBox: null } }),
        product: "gpu",
        field: "adapterInBox",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["gpu"] }) },
  },
  PSU_CASE_FORMFACTOR: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "SFX PSU in an ATX-only case",
        parts: pcBuild({ psu: { formFactor: "SFX" } }),
        key: "compat.psu_form_factor_unsupported",
        severity: "block",
        params: { psuFF: "SFX", supported: "ATX" },
        products: ["psu", "case"],
        fix: { category: "case", filter: { psuFF: "SFX" } },
      },
    ],
    missing: [
      { name: "PSU form factor", parts: pcBuild({ psu: { formFactor: null } }), product: "psu", field: "formFactor" },
      { name: "case PSU form factors", parts: pcBuild({ case: { psuFF: null } }), product: "case", field: "psuFF" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["case"] }) },
  },
  PSU_CASE_LENGTH: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "200 mm PSU, the case allows 180 mm",
        parts: pcBuild({ psu: { lengthMm: 200 } }),
        key: "compat.psu_too_long",
        severity: "warn",
        params: { psuMm: 200, caseMm: 180 },
        products: ["psu", "case"],
      },
    ],
    missing: [
      { name: "PSU length", parts: pcBuild({ psu: { lengthMm: null } }), product: "psu", field: "lengthMm" },
      {
        name: "case PSU limit",
        parts: pcBuild({ case: { psuMaxLenMm: null } }),
        product: "case",
        field: "psuMaxLenMm",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["case"] }) },
  },
  M2_SLOTS: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "three NVMe drives for two M.2 slots",
        parts: pcBuild({ qty: { ssd: 3 } }),
        key: "compat.m2_slots_exceeded",
        severity: "block",
        params: { nvme: 3, slots: 2 },
        products: ["ssd", "mb"],
      },
    ],
    missing: [
      { name: "drive interface", parts: pcBuild({ ssd: { iface: null } }), product: "ssd", field: "iface" },
      { name: "board M.2 slots", parts: pcBuild({ mb: { m2: null } }), product: "mb", field: "m2" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["ssd"] }) },
  },
  M2_LENGTH: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "2280 drive, the only slot takes 60 mm",
        parts: pcBuild({ mb: { m2: [{ id: "M2_1", pcieGen: 4, maxLenMm: 60, disablesSata: [] }] } }),
        key: "compat.m2_too_long",
        severity: "block",
        params: { ssdMm: 80, slotMm: 60 },
        products: ["ssd", "mb"],
      },
    ],
    missing: [
      { name: "drive form factor", parts: pcBuild({ ssd: { formFactor: null } }), product: "ssd", field: "formFactor" },
      { name: "board M.2 slots", parts: pcBuild({ mb: { m2: null } }), product: "mb", field: "m2" },
    ],
    notApplicable: { parts: pcBuild({ drop: ["ssd"] }) },
  },
  M2_SATA_SHARING: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "M.2 occupies two of four SATA ports, three SATA drives need them",
        parts: pcBuild({
          mb: { m2: [{ id: "M2_1", pcieGen: 4, maxLenMm: 80, disablesSata: [3, 4] }] },
          add: [[sata("hdd"), 3]],
        }),
        key: "compat.m2_disables_sata",
        severity: "warn",
        params: { sataDrives: 3, usablePorts: 2 },
        products: ["ssd", "mb"],
      },
    ],
    missing: [
      {
        name: "SATA port count",
        parts: pcBuild({ mb: { sataPorts: null }, add: [sata("hdd")] }),
        product: "mb",
        field: "sataPorts",
      },
      { name: "board M.2 slots", parts: pcBuild({ mb: { m2: null }, add: [sata("hdd")] }), product: "mb", field: "m2" },
      {
        name: "drive form factor",
        parts: pcBuild({ ssd: { formFactor: null }, add: [sata("hdd")] }),
        product: "ssd",
        field: "formFactor",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["ssd"] }) },
  },
  SATA_PORTS: {
    ok: { parts: pcBuild({ add: [[sata("hdd"), 4]] }) },
    issues: [
      {
        name: "five SATA drives for four ports",
        parts: pcBuild({ add: [[sata("hdd"), 5]] }),
        key: "compat.sata_ports_exceeded",
        severity: "block",
        params: { sata: 5, ports: 4 },
        products: ["hdd", "mb"],
      },
    ],
    missing: [
      { name: "drive interface", parts: pcBuild({ ssd: { iface: null } }), product: "ssd", field: "iface" },
      {
        name: "board SATA ports",
        parts: pcBuild({ mb: { sataPorts: null }, add: [sata("hdd")] }),
        product: "mb",
        field: "sataPorts",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["ssd"] }) },
  },
  ARGB_HEADERS: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "three ARGB fan kits, two 5 V headers",
        parts: pcBuild({ add: [[makeProduct("fan", "fan", { argb: true, count: 1 }, { lighting: "argb" }), 3]] }),
        key: "compat.argb_headers_short",
        severity: "warn",
        params: { need: 3, have: 2 },
        products: ["mb", "fan"],
      },
      {
        name: "two RGB fan kits, one 12 V header",
        parts: pcBuild({ add: [[makeProduct("fan", "fan", { argb: false, count: 1 }, { lighting: "rgb" }), 2]] }),
        key: "compat.rgb_headers_short",
        severity: "warn",
        params: { need: 2, have: 1 },
        products: ["mb", "fan"],
      },
    ],
    missing: [
      {
        name: "5 V headers on the board",
        parts: pcBuild({
          mb: { argb5vHeaders: null },
          add: [makeProduct("fan", "fan", { argb: true, count: 1 }, { lighting: "argb" })],
        }),
        product: "mb",
        field: "argb5vHeaders",
      },
      {
        name: "12 V headers on the board",
        parts: pcBuild({
          mb: { rgb12vHeaders: null },
          add: [makeProduct("fan", "fan", { argb: false, count: 1 }, { lighting: "rgb" })],
        }),
        product: "mb",
        field: "rgb12vHeaders",
      },
      {
        name: "fan lighting type",
        parts: pcBuild({ add: [makeProduct("fan", "fan", { argb: null, count: 1 })] }),
        product: "fan",
        field: "argb",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["mb"] }) },
  },
  FAN_HEADERS: {
    ok: { parts: pcBuild() },
    issues: [
      {
        name: "five fans, four mounts",
        parts: pcBuild({ case: { fanMounts: 4 }, add: [makeProduct("fan", "fan", { count: 3 })] }),
        key: "compat.fan_mounts_exceeded",
        severity: "warn",
        params: { need: 5, have: 4 },
        products: ["case", "fan"],
      },
      {
        name: "five fans, three board headers",
        parts: pcBuild({ mb: { fanHeaders: 3 }, add: [makeProduct("fan", "fan", { count: 3 })] }),
        key: "compat.fan_headers_short",
        severity: "warn",
        params: { need: 5, have: 3 },
        products: ["mb", "fan"],
      },
    ],
    missing: [
      { name: "case mounts", parts: pcBuild({ case: { fanMounts: null } }), product: "case", field: "fanMounts" },
      { name: "case fans", parts: pcBuild({ case: { fansIncluded: null } }), product: "case", field: "fansIncluded" },
      { name: "board headers", parts: pcBuild({ mb: { fanHeaders: null } }), product: "mb", field: "fanHeaders" },
      {
        name: "fan kit size",
        parts: pcBuild({ add: [makeProduct("fan", "fan", { count: null })] }),
        product: "fan",
        field: "count",
      },
    ],
    notApplicable: { parts: pcBuild({ drop: ["mb", "case"] }) },
  },
  WIFI_FOR_TASK: {
    ok: { parts: pcBuild(), tasks: ["office"] },
    issues: [
      {
        name: "office PC on a board without Wi-Fi and Bluetooth",
        parts: pcBuild({ mb: { wifi: false, bluetooth: false } }),
        tasks: ["office"],
        key: "compat.no_wireless",
        severity: "warn",
        params: { task: "office" },
        products: ["mb"],
      },
      {
        name: "streaming PC on a board without Wi-Fi and Bluetooth",
        parts: pcBuild({ mb: { wifi: false, bluetooth: false } }),
        tasks: ["gaming", "streaming"],
        key: "compat.no_wireless",
        severity: "warn",
        params: { task: "streaming" },
        products: ["mb"],
      },
    ],
    missing: [
      {
        name: "Wi-Fi flag when Bluetooth is absent",
        parts: pcBuild({ mb: { wifi: null, bluetooth: false } }),
        tasks: ["office"],
        product: "mb",
        field: "wifi",
      },
      {
        name: "Bluetooth flag when Wi-Fi is absent",
        parts: pcBuild({ mb: { wifi: false, bluetooth: null } }),
        tasks: ["streaming"],
        product: "mb",
        field: "bluetooth",
      },
    ],
    notApplicable: { parts: pcBuild({ mb: { wifi: false, bluetooth: false } }), tasks: ["gaming", "programming"] },
  },
};
