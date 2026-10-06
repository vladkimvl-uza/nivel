// Boundary values and rule interplay that the scenario table does not spell out.
import { describe, expect, it } from "vitest";
import { checkCompatibility } from "../index.ts";
import { build, ctx, makeProduct, type Part, pcBuild } from "../testkit.ts";
import type { CompatIssue, RuleId, Task } from "../types.ts";

const run = (parts: Part[], tasks: Task[] = [], settings = {}) => {
  const b = build(...parts);
  return checkCompatibility(b.lines, b.catalog, ctx(tasks, settings));
};
const of = (parts: Part[], rule: RuleId, tasks: Task[] = [], settings = {}): CompatIssue[] =>
  run(parts, tasks, settings).issues.filter((i) => i.ruleId === rule);
const keys = (issues: CompatIssue[]) => issues.map((i) => i.messageKey);

describe("GPU_CASE_LENGTH boundaries", () => {
  const len = (gpuMm: number, over = {}) => of(pcBuild({ gpu: { lengthMm: gpuMm }, ...over }), "GPU_CASE_LENGTH");
  it("exactly the margin to spare (10 mm) is fine", () => expect(len(320)).toEqual([]));
  it("one millimetre less than the margin warns", () => expect(keys(len(321))).toEqual(["compat.gpu_tight_fit"]));
  it("filling the case to the millimetre still warns, not blocks", () =>
    expect(keys(len(330))).toEqual(["compat.gpu_tight_fit"]));
  it("one millimetre over blocks", () => expect(keys(len(331))).toEqual(["compat.gpu_too_long"]));
  it("takes the margin from the settings", () => {
    const parts = pcBuild({ gpu: { lengthMm: 300 } });
    expect(of(parts, "GPU_CASE_LENGTH")).toEqual([]);
    expect(keys(of(parts, "GPU_CASE_LENGTH", [], { gpuLenWarnMarginMm: 40 }))).toEqual(["compat.gpu_tight_fit"]);
  });
  it("checks every card, each against the same limit", () => {
    const two = pcBuild({
      drop: ["gpu"],
      add: [makeProduct("gpu", "g1", { lengthMm: 300 }), makeProduct("gpu", "g2", { lengthMm: 350 })],
    });
    const found = of(two, "GPU_CASE_LENGTH");
    expect(found.map((i) => [i.messageKey, i.productIds[0]])).toEqual([["compat.gpu_too_long", "g2"]]);
  });
  it("uses the ordinary limit when the radiator can also go on top", () => {
    const parts = pcBuild({
      gpu: { lengthMm: 320 },
      drop: ["cooler"],
      add: [makeProduct("aio", "aio", { radMm: 280 })],
    });
    expect(of(parts, "GPU_CASE_LENGTH")).toEqual([]); // 280 mm fits the top mount of the default case
  });
  it("uses the front-radiator limit only when the radiator fits nowhere but the front", () => {
    const parts = pcBuild({
      gpu: { lengthMm: 320 },
      drop: ["cooler"],
      add: [makeProduct("aio", "aio", { radMm: 360 })],
    });
    expect(keys(of(parts, "GPU_CASE_LENGTH"))).toEqual(["compat.gpu_too_long"]);
    const fix = of(parts, "GPU_CASE_LENGTH")[0]?.fix;
    expect(fix).toEqual({ category: "case", filter: { gpuMaxLenWithFrontRadMmMin: 320 } });
  });
  it("never lets the front-radiator limit exceed the ordinary one", () => {
    const parts = pcBuild({
      gpu: { lengthMm: 335 },
      case: { gpuMaxLenMm: 330, gpuMaxLenWithFrontRadMm: 400, radiators: [{ side: "front", sizesMm: [360] }] },
      drop: ["cooler"],
      add: [makeProduct("aio", "aio")],
    });
    expect(of(parts, "GPU_CASE_LENGTH")[0]?.params).toMatchObject({ caseMm: 330 });
  });
  it("a radiator that fits nowhere does not shorten the limit (AIO_RADIATOR_MOUNT blocks it)", () => {
    const parts = pcBuild({
      gpu: { lengthMm: 320 },
      drop: ["cooler"],
      add: [makeProduct("aio", "aio", { radMm: 420 })],
    });
    expect(of(parts, "GPU_CASE_LENGTH")).toEqual([]);
    expect(keys(of(parts, "AIO_RADIATOR_MOUNT"))).toEqual(["compat.aio_no_mount"]);
  });
});

describe("COOLER_CASE_HEIGHT boundaries", () => {
  const h = (mm: number) => keys(of(pcBuild({ cooler: { heightMm: mm } }), "COOLER_CASE_HEIGHT"));
  it("5 mm to spare is fine, 4 mm warns, 0 mm warns, 1 mm over blocks", () => {
    expect(h(160)).toEqual([]);
    expect(h(161)).toEqual(["compat.cooler_tight_fit"]);
    expect(h(165)).toEqual(["compat.cooler_tight_fit"]);
    expect(h(166)).toEqual(["compat.cooler_too_tall"]);
  });
});

describe("PSU_WATTAGE boundaries (block 28, 3.4)", () => {
  const withPsu = (watts: number, gpu = {}, cpu = {}) => pcBuild({ psu: { watts }, gpu, cpu });
  const psu = (parts: Part[]) => keys(of(parts, "PSU_WATTAGE"));

  it("a PSU exactly at the peak is not blocked (peak 293 W, recommended 550 W: it warns)", () => {
    expect(psu(withPsu(293))).toEqual(["compat.psu_below_recommended"]);
    expect(psu(withPsu(292))).toEqual(["compat.psu_below_peak"]);
  });
  it("a PSU exactly at the recommendation passes the recommendation check", () => {
    expect(psu(withPsu(550))).toEqual([]);
    expect(psu(withPsu(549))).toEqual(["compat.psu_below_recommended"]);
  });
  it("RTX 5070 (vendor 650 W): 650 W is fine, 550 W warns, 750 W is fine", () => {
    const rtx5070 = { chip: "RTX 5070", tgpW: 250, vendorRecommendedPsuW: 650 };
    expect(psu(withPsu(650, rtx5070, { maxPowerW: 65 }))).toEqual([]);
    expect(psu(withPsu(550, rtx5070, { maxPowerW: 65 }))).toEqual(["compat.psu_below_recommended"]);
    expect(psu(withPsu(750, rtx5070, { maxPowerW: 65 }))).toEqual([]);
  });
  it("RTX 5070 Ti (vendor 750 W) wants 750 W", () => {
    const ti = { chip: "RTX 5070 Ti", tgpW: 300, vendorRecommendedPsuW: 750 };
    expect(psu(withPsu(650, ti, { maxPowerW: 65 }))).toEqual(["compat.psu_below_recommended"]);
    expect(psu(withPsu(750, ti, { maxPowerW: 65 }))).toEqual([]);
  });
  it("the headroom warning applies only above the recommendation, at 3000 bp exactly it passes", () => {
    // peak 410 W, recommended 550 W; headroom of 550 W is 2545 bp, of 586 W is 3003 bp, of 585 W is 2991 bp
    const base = { maxPowerW: 150 };
    const gpu = { tgpW: 200, vendorRecommendedPsuW: 0 };
    expect(psu(withPsu(585, gpu, base))).toEqual(["compat.psu_low_headroom"]);
    expect(psu(withPsu(586, gpu, base))).toEqual([]);
  });
  it("takes the headroom threshold from the settings", () => {
    const parts = withPsu(650);
    expect(psu(parts)).toEqual([]);
    const strict = of(parts, "PSU_WATTAGE", [], { psuHeadroomWarnBp: 9000 });
    expect(keys(strict)).toEqual(["compat.psu_low_headroom"]);
  });
  it("exposes the estimate in the result", () => {
    const r = run(withPsu(650));
    expect(r.power).toEqual({ peakW: 293, recommendedPsuW: 550, selectedPsuW: 650, headroomBp: 5492 });
  });
  it("is not checked for a build without a CPU or a card", () => {
    const r = run(pcBuild({ drop: ["cpu", "gpu"] }));
    expect(r.checkedRules).not.toContain("PSU_WATTAGE");
  });
  it("still blocks on a lower bound when some inputs are unknown, and lists the unknowns", () => {
    const r = run(pcBuild({ psu: { watts: 100 }, gpu: { tgpW: null } }));
    const found = r.issues.filter((i) => i.ruleId === "PSU_WATTAGE");
    expect(keys(found)).toContain("compat.psu_below_peak");
    expect(r.missingData).toContainEqual({ productId: "gpu", field: "tgpW" });
    expect(r.verdict).toBe("block");
  });
});

describe("CPU_MB_BIOS details", () => {
  it("an equal BIOS version is enough", () => {
    expect(of(pcBuild({ cpu: { minBiosByChipset: { B650: "1.30" } } }), "CPU_MB_BIOS")).toEqual([]);
  });
  it("compares versions numerically, not as text (1.9 < 1.10)", () => {
    const parts = pcBuild({ cpu: { minBiosByChipset: { B650: "1.10" } }, mb: { shippedBios: "1.9" } });
    expect(keys(of(parts, "CPU_MB_BIOS"))).toEqual(["compat.bios_update_flashback"]);
  });
  it("matches the chipset case-insensitively", () => {
    const parts = pcBuild({ cpu: { minBiosByChipset: { b650: "9.99" } } });
    expect(of(parts, "CPU_MB_BIOS")).toHaveLength(1);
  });
  it("no BIOS floor for the board chipset means nothing to check", () => {
    expect(of(pcBuild({ cpu: { minBiosByChipset: { X870: "9.99" } } }), "CPU_MB_BIOS")).toEqual([]);
  });
  it("a processor without the BIOS table at all has no floor", () => {
    const cpu = makeProduct("cpu", "cpu");
    const spec = cpu.spec as Record<string, unknown>;
    delete spec.minBiosByChipset;
    expect(of([cpu, makeProduct("mb", "mb")], "CPU_MB_BIOS")).toEqual([]);
    expect(run([cpu, makeProduct("mb", "mb")]).checkedRules).toContain("CPU_MB_BIOS");
  });
  it("an unknown shipped BIOS is not needed when there is no floor", () => {
    const r = run(pcBuild({ cpu: { minBiosByChipset: { X870: "9.99" } }, mb: { shippedBios: null } }));
    expect(r.issues.filter((i) => i.ruleId === "CPU_MB_BIOS")).toEqual([]);
  });
});

describe("CPU_NO_VIDEO details", () => {
  it("a video card settles it: unknown iGPU data does not matter", () => {
    const r = run(pcBuild({ cpu: { hasIgpu: null } }));
    expect(r.issues.filter((i) => i.ruleId === "CPU_NO_VIDEO")).toEqual([]);
    expect(r.checkedRules).toContain("CPU_NO_VIDEO");
  });
});

describe("memory rules with a partial build", () => {
  it("MEM_TYPE checks against the board alone when there is no processor", () => {
    const parts = pcBuild({ ram: { type: "DDR4" }, drop: ["cpu", "cooler"] });
    expect(keys(of(parts, "MEM_TYPE"))).toEqual(["compat.mem_type_board"]);
  });
  it("MEM_TYPE checks against the processor alone when there is no board", () => {
    const parts = pcBuild({ ram: { type: "DDR4" }, drop: ["mb"] });
    expect(keys(of(parts, "MEM_TYPE"))).toEqual(["compat.mem_type_cpu"]);
  });
  it("MEM_SPEED ignores a processor table that lacks the memory type (MEM_TYPE blocks that pair)", () => {
    const parts = pcBuild({
      ram: { type: "DDR4", mts: 6000 },
      cpu: { memMaxMts: { DDR5: 5200 } },
      mb: { ramMaxMts: 6400 },
    });
    expect(of(parts, "MEM_SPEED")).toEqual([]);
  });
  it("MEM_SPEED with memory exactly at the limit is fine", () => {
    expect(of(pcBuild({ ram: { mts: 5200 } }), "MEM_SPEED")).toEqual([]);
  });
  it("MEM_SLOTS: two kits of two modules fill four slots, a fifth module does not fit", () => {
    expect(of(pcBuild({ qty: { ram: 2 } }), "MEM_SLOTS")).toEqual([]);
    expect(of(pcBuild({ ram: { modules: 1 }, qty: { ram: 5 } }), "MEM_SLOTS")).toHaveLength(1);
  });
  it("MEM_CAPACITY: exactly the board maximum is fine", () => {
    expect(of(pcBuild({ mb: { ramMaxGb: 32 }, ram: { kitGb: 16 }, qty: { ram: 2 } }), "MEM_CAPACITY")).toEqual([]);
    expect(of(pcBuild({ mb: { ramMaxGb: 31 }, ram: { kitGb: 16 }, qty: { ram: 2 } }), "MEM_CAPACITY")).toHaveLength(1);
  });
});

describe("COOLER rules with both an air cooler and an AIO", () => {
  it("COOLER_SOCKET checks each cooler separately", () => {
    const parts = pcBuild({
      cooler: { sockets: ["AM4"] },
      add: [makeProduct("aio", "aio", { sockets: ["LGA1700"] })],
    });
    expect(of(parts, "COOLER_SOCKET").map((i) => i.params.cooler)).toEqual(["air", "aio"]);
  });
  it("COOLER_TDP does not judge an AIO", () => {
    const parts = pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio")] });
    expect(run(parts).checkedRules).not.toContain("COOLER_TDP");
  });
  it("COOLER_TDP: a cooler exactly at the CPU power is fine", () => {
    expect(of(pcBuild({ cooler: { tdpRatedW: 88 } }), "COOLER_TDP")).toEqual([]);
    expect(of(pcBuild({ cooler: { tdpRatedW: 87 } }), "COOLER_TDP")).toHaveLength(1);
  });
});

describe("AIO radiator rules", () => {
  const aio = (spec = {}, over = {}) => pcBuild({ drop: ["cooler"], add: [makeProduct("aio", "aio", spec)], ...over });
  it("a mount without a thickness limit states no limit", () => {
    const parts = aio({ radThicknessWithFansMm: 80 }, { case: { radiators: [{ side: "front", sizesMm: [360] }] } });
    expect(of(parts, "AIO_RADIATOR_THICKNESS")).toEqual([]);
  });
  it("any suitable mount that is thick enough settles it", () => {
    const parts = aio(
      { radThicknessWithFansMm: 60, radMm: 240 },
      {
        case: {
          radiators: [
            { side: "top", sizesMm: [240], maxThicknessMm: 40 },
            { side: "front", sizesMm: [240], maxThicknessMm: 65 },
          ],
        },
      },
    );
    expect(of(parts, "AIO_RADIATOR_THICKNESS")).toEqual([]);
  });
  it("thickness exactly at the limit is fine", () => {
    expect(of(aio({ radThicknessWithFansMm: 55 }), "AIO_RADIATOR_THICKNESS")).toEqual([]);
  });
  it("a radiator without a suitable mount is left to AIO_RADIATOR_MOUNT", () => {
    expect(of(aio({ radMm: 420, radThicknessWithFansMm: 99 }), "AIO_RADIATOR_THICKNESS")).toEqual([]);
  });
});

describe("PSU_GPU_CONNECTORS details", () => {
  const conn = (power: { conn: "6pin" | "8pin" | "12V-2x6"; count: number }[], psu = {}, gpu = {}) =>
    of(pcBuild({ gpu: { power, ...gpu }, psu }), "PSU_GPU_CONNECTORS");
  it("counts 6-pin plugs against the PCIe 8-pin outlets", () => {
    expect(
      conn([
        { conn: "6pin", count: 1 },
        { conn: "8pin", count: 1 },
      ]),
    ).toEqual([]);
    expect(
      keys(
        conn([
          { conn: "6pin", count: 2 },
          { conn: "8pin", count: 1 },
        ]),
      ),
    ).toEqual(["compat.psu_8pin_missing"]);
  });
  it("a native 12V-2x6 cable is enough, with no adapter involved", () => {
    expect(conn([{ conn: "12V-2x6", count: 1 }], { native12v2x6: 1 })).toEqual([]);
  });
  it("two identical cards double the plugs needed", () => {
    const parts = pcBuild({ gpu: { power: [{ conn: "8pin", count: 1 }] }, qty: { gpu: 3 } });
    expect(of(parts, "PSU_GPU_CONNECTORS")[0]?.params).toEqual({ need: 3, have: 2 });
  });
  it("a card without external power needs nothing", () => {
    expect(conn([], { pcie8pin: 0 })).toEqual([]);
  });
  it("does not ask for 12V-2x6 data when the card has none", () => {
    const r = run(pcBuild({ psu: { native12v2x6: null } }));
    expect(r.missingData).toEqual([]);
  });
});

describe("storage rules", () => {
  const nvme = (id: string, formFactor: "M.2-2242" | "M.2-2260" | "M.2-2280" = "M.2-2280") =>
    makeProduct("ssd", id, { iface: "nvme", formFactor });
  const sata = (id: string) => makeProduct("ssd", id, { iface: "sata", formFactor: "2.5" });
  const slot = (id: string, maxLenMm: 42 | 60 | 80 | 110, disablesSata: number[] = []) => ({
    id,
    pcieGen: 4 as const,
    maxLenMm,
    disablesSata,
  });

  it("M2_LENGTH: a long drive takes the long slot, short drives take the short one", () => {
    const parts = pcBuild({
      mb: { m2: [slot("a", 60), slot("b", 80)] },
      drop: ["ssd"],
      add: [nvme("long"), nvme("short", "M.2-2242")],
    });
    expect(of(parts, "M2_LENGTH")).toEqual([]);
  });
  it("M2_LENGTH: two 2280 drives, one 60 mm slot: the second one is too long, not 'too many'", () => {
    const parts = pcBuild({
      mb: { m2: [slot("a", 60), slot("b", 80)] },
      drop: ["ssd"],
      add: [nvme("d1"), nvme("d2")],
    });
    expect(keys(of(parts, "M2_LENGTH"))).toEqual(["compat.m2_too_long"]);
    expect(of(parts, "M2_SLOTS")).toEqual([]);
  });
  it("M2_LENGTH: a 2.5-inch form factor on an NVMe drive is inconsistent data, reported as missing", () => {
    const parts = pcBuild({ drop: ["ssd"], add: [makeProduct("ssd", "odd", { iface: "nvme", formFactor: "2.5" })] });
    expect(run(parts).missingData).toContainEqual({ productId: "odd", field: "formFactor" });
  });
  it("M2_SLOTS counts quantity: two drives in the second slot of a one-slot board", () => {
    const parts = pcBuild({ mb: { m2: [slot("a", 80)] }, qty: { ssd: 2 } });
    expect(of(parts, "M2_SLOTS")[0]?.params).toEqual({ nvme: 2, slots: 1 });
  });
  it("M2_SATA_SHARING: the drive prefers the slot that does not disable SATA ports", () => {
    const parts = pcBuild({
      mb: { m2: [slot("a", 80, [1, 2]), slot("b", 80, [])], sataPorts: 2 },
      add: [[sata("hdd"), 2]],
    });
    expect(of(parts, "M2_SATA_SHARING")).toEqual([]);
  });
  it("M2_SATA_SHARING: both slots busy, the shared ports are lost", () => {
    const parts = pcBuild({
      mb: { m2: [slot("a", 80, [1]), slot("b", 80, [2])], sataPorts: 2 },
      qty: { ssd: 2 },
      add: [sata("hdd")],
    });
    expect(of(parts, "M2_SATA_SHARING")[0]?.params).toEqual({ sataDrives: 1, usablePorts: 0 });
  });
  it("M2_SATA_SHARING stays silent when SATA_PORTS already blocks", () => {
    const parts = pcBuild({ mb: { m2: [slot("a", 80, [1])], sataPorts: 1 }, add: [[sata("hdd"), 2]] });
    expect(of(parts, "M2_SATA_SHARING")).toEqual([]);
    expect(keys(of(parts, "SATA_PORTS"))).toEqual(["compat.sata_ports_exceeded"]);
  });
  it("SATA_PORTS: exactly the port count is fine", () => {
    expect(of(pcBuild({ add: [[sata("hdd"), 4]] }), "SATA_PORTS")).toEqual([]);
  });
  it("storage rules do not ask for SATA data when there are only NVMe drives", () => {
    const r = run(pcBuild({ mb: { sataPorts: null } }));
    expect(r.missingData).toEqual([]);
  });
});

describe("lighting and fan headers", () => {
  it("counts lit AIO, tower cooler and case against the headers", () => {
    const parts = pcBuild({
      mb: { argb5vHeaders: 1 },
      drop: ["cooler"],
      add: [
        makeProduct("aio", "aio", {}, { lighting: "argb" }),
        makeProduct("case", "case2", {}, { lighting: "argb" }),
      ],
    });
    expect(of(parts, "ARGB_HEADERS")[0]?.params).toEqual({ need: 2, have: 1 });
  });
  it("a fan flagged ARGB counts as ARGB even when the product says no lighting", () => {
    const parts = pcBuild({ mb: { argb5vHeaders: 0 }, add: [makeProduct("fan", "fan", { argb: true, count: 1 })] });
    expect(keys(of(parts, "ARGB_HEADERS"))).toEqual(["compat.argb_headers_short"]);
  });
  it("unlit parts need no headers and no header data", () => {
    const r = run(pcBuild({ mb: { argb5vHeaders: null, rgb12vHeaders: null } }));
    expect(r.missingData).toEqual([]);
  });
  it("FAN_HEADERS: fans exactly at the mounts and at the headers are fine", () => {
    const parts = pcBuild({
      case: { fanMounts: 5 },
      mb: { fanHeaders: 5 },
      add: [makeProduct("fan", "fan", { count: 3 })],
    });
    expect(of(parts, "FAN_HEADERS")).toEqual([]);
  });
  it("FAN_HEADERS: a bare board is not 'incomplete' when no fans are involved", () => {
    const r = run(pcBuild({ drop: ["case"], mb: { fanHeaders: null } }));
    expect(r.missingData).toEqual([]);
    expect(r.checkedRules).toContain("FAN_HEADERS");
  });
});

describe("WIFI_FOR_TASK details", () => {
  it("one known wireless module is enough even if the other flag is unknown", () => {
    const parts = pcBuild({ mb: { wifi: true, bluetooth: null } });
    const r = run(parts, ["office"]);
    expect(r.missingData).toEqual([]);
    expect(r.issues.filter((i) => i.ruleId === "WIFI_FOR_TASK")).toEqual([]);
  });
  it("Bluetooth alone satisfies the check", () => {
    expect(of(pcBuild({ mb: { wifi: false, bluetooth: true } }), "WIFI_FOR_TASK", ["office"])).toEqual([]);
  });
  it("is not checked for gaming-only builds", () => {
    expect(run(pcBuild({ mb: { wifi: false, bluetooth: false } }), ["gaming"]).checkedRules).not.toContain(
      "WIFI_FOR_TASK",
    );
  });
});
