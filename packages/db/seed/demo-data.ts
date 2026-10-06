// WP-06: demo catalog. Positions of the base builds of block 28 (table 1.2) with prices of 05.10.2026 as a demo
// layer: every row gets is_demo. The characteristics are plausible values for the compatibility rules, not a
// verified reference; a real position is entered in the admin and checked against the manufacturer's page.

export interface DemoProduct {
  slug: string;
  classKey: string;
  category: string;
  brand: string;
  model: string;
  /** Price of 05.10.2026 in whole sums (block 28, 1.2); "E" rows are estimates. */
  price: number;
  color: "black" | "white" | "gray" | "other";
  lighting: "none" | "rgb" | "argb";
  specs: Record<string, unknown>;
  /** Peak power draw for the power estimate (CPU maxPowerW, GPU tgpW). */
  powerPeakW?: number;
  manualOnly?: boolean;
  /** Vendors with a price: 3 by default; fewer gives a low-confidence price without a median. */
  vendors?: 1 | 2 | 3;
  /** The price is an estimate, not an observation (block 28 "E"). */
  estimate?: boolean;
  dimsMm?: { w: number; d: number; h: number };
}

const AM5_CHIPSETS = ["A620", "B650", "B650E", "B840", "B850", "X670", "X670E", "X870", "X870E"];
const LGA1700_CHIPSETS = ["H610", "B660", "H670", "Z690", "B760", "H770", "Z790"];
const M2_GEN4 = (id: string) => ({ id, pcieGen: 4, maxLenMm: 80, disablesSata: [] as number[] });
const M2_GEN5 = (id: string) => ({ id, pcieGen: 5, maxLenMm: 80, disablesSata: [] as number[] });
const M2_GEN3 = (id: string) => ({ id, pcieGen: 3, maxLenMm: 80, disablesSata: [] as number[] });

const cpu = (
  slug: string,
  classKey: string,
  model: string,
  price: number,
  s: {
    socket: "AM5" | "LGA1700";
    cores: number;
    threads: number;
    boostGhz: number;
    tdpW: number;
    maxPowerW: number;
    hasIgpu: boolean;
    mts: number;
    box?: boolean;
  },
): DemoProduct => ({
  slug,
  classKey,
  category: "cpu",
  brand: s.socket === "AM5" ? "AMD" : "Intel",
  model,
  price,
  color: "other",
  lighting: "none",
  powerPeakW: s.maxPowerW,
  specs: {
    socket: s.socket,
    cores: s.cores,
    threads: s.threads,
    boostGhz: s.boostGhz,
    tdpW: s.tdpW,
    maxPowerW: s.maxPowerW,
    hasIgpu: s.hasIgpu,
    memTypes: s.socket === "AM5" ? ["DDR5"] : ["DDR4", "DDR5"],
    memMaxMts: s.socket === "AM5" ? { DDR5: s.mts } : { DDR4: 3200, DDR5: s.mts },
    boxCooler: s.box ?? false,
    chipsets: s.socket === "AM5" ? AM5_CHIPSETS : LGA1700_CHIPSETS,
  },
});

const board = (
  slug: string,
  classKey: string,
  brand: string,
  model: string,
  price: number,
  s: {
    socket: "AM5" | "LGA1700";
    chipset: string;
    formFactor: "ATX" | "mATX";
    ramType: "DDR4" | "DDR5";
    ramSlots: 2 | 4;
    ramMaxGb: number;
    ramMaxMts: number;
    m2: unknown[];
    sataPorts: number;
    wifi: boolean;
    flashback: boolean;
  },
): DemoProduct => ({
  slug,
  classKey,
  category: "mb",
  brand,
  model,
  price,
  color: "black",
  lighting: "none",
  specs: {
    socket: s.socket,
    chipset: s.chipset,
    formFactor: s.formFactor,
    ramType: s.ramType,
    ramSlots: s.ramSlots,
    ramMaxGb: s.ramMaxGb,
    ramMaxMts: s.ramMaxMts,
    m2: s.m2,
    sataPorts: s.sataPorts,
    pcieX16Slots: s.formFactor === "ATX" ? 2 : 1,
    fanHeaders: s.formFactor === "ATX" ? 6 : 4,
    argb5vHeaders: s.formFactor === "ATX" ? 3 : 2,
    rgb12vHeaders: 1,
    wifi: s.wifi,
    bluetooth: s.wifi,
    biosFlashback: s.flashback,
  },
});

const ram = (
  slug: string,
  classKey: string,
  brand: string,
  model: string,
  price: number,
  s: {
    type: "DDR4" | "DDR5";
    kitGb: number;
    modules: number;
    mts: number;
    cl: number;
    profile: "XMP" | "EXPO" | "both" | "none";
    heightMm: number;
    lighting: boolean;
  },
  extra: Partial<DemoProduct> = {},
): DemoProduct => ({
  slug,
  classKey,
  category: "ram",
  brand,
  model,
  price,
  color: s.lighting ? "white" : "black",
  lighting: s.lighting ? "rgb" : "none",
  specs: { ...s },
  ...extra,
});

const ssd = (
  slug: string,
  classKey: string,
  brand: string,
  model: string,
  price: number,
  s: { capacityGb: number; pcieGen: 3 | 4; tbw: number },
): DemoProduct => ({
  slug,
  classKey,
  category: "ssd",
  brand,
  model,
  price,
  color: "black",
  lighting: "none",
  specs: { iface: "nvme", formFactor: "M.2-2280", capacityGb: s.capacityGb, pcieGen: s.pcieGen, tbw: s.tbw },
});

const gpu = (
  slug: string,
  classKey: string,
  brand: string,
  model: string,
  price: number,
  s: {
    chip: string;
    vramGb: number;
    lengthMm: number;
    heightMm: number;
    slots: number;
    conn: "8pin" | "12V-2x6";
    adapter: boolean;
    tgpW: number;
    recPsuW: number;
  },
  extra: Partial<DemoProduct> = {},
): DemoProduct => ({
  slug,
  classKey,
  category: "gpu",
  brand,
  model,
  price,
  color: "black",
  lighting: "none",
  powerPeakW: s.tgpW,
  specs: {
    chip: s.chip,
    vramGb: s.vramGb,
    lengthMm: s.lengthMm,
    heightMm: s.heightMm,
    slots: s.slots,
    power: [{ conn: s.conn, count: 1 }],
    adapterInBox: s.adapter,
    tgpW: s.tgpW,
    vendorRecommendedPsuW: s.recPsuW,
    hwEncoders: ["nvenc"],
  },
  ...extra,
});

const psu = (
  slug: string,
  classKey: string,
  model: string,
  price: number,
  s: { watts: number; rating: "bronze" | "gold"; white: boolean; pcie8pin: number; native12v2x6: number },
): DemoProduct => ({
  slug,
  classKey,
  category: "psu",
  brand: "Deepcool",
  model,
  price,
  color: s.white ? "white" : "black",
  lighting: "none",
  specs: {
    watts: s.watts,
    rating: s.rating,
    formFactor: "ATX",
    lengthMm: 140,
    modular: s.rating === "gold" ? "full" : "no",
    pcie8pin: s.pcie8pin,
    native12v2x6: s.native12v2x6,
    atx3: s.rating === "gold",
  },
});

const pcCase = (
  slug: string,
  classKey: string,
  brand: string,
  model: string,
  price: number,
  white: boolean,
  s: {
    boards: ("ATX" | "mATX" | "Mini-ITX")[];
    gpuMaxLenMm: number;
    coolerMaxHeightMm: number;
    frontRad: 240 | 280 | 360;
    slots: number;
  },
): DemoProduct => ({
  slug,
  classKey,
  category: "case",
  brand,
  model,
  price,
  color: white ? "white" : "black",
  lighting: "none",
  dimsMm: { w: 230, d: 440, h: 460 },
  specs: {
    boards: s.boards,
    gpuMaxLenMm: s.gpuMaxLenMm,
    gpuMaxLenWithFrontRadMm: s.gpuMaxLenMm - 30,
    coolerMaxHeightMm: s.coolerMaxHeightMm,
    radiators: [
      {
        side: "front",
        sizesMm: s.frontRad === 360 ? [120, 140, 240, 280, 360] : [120, 140, 240, 280],
        maxThicknessMm: 30,
      },
      { side: "top", sizesMm: s.frontRad === 360 ? [120, 240, 360] : [120, 240], maxThicknessMm: 30 },
      { side: "rear", sizesMm: [120] },
    ],
    psuFF: ["ATX"],
    psuMaxLenMm: 200,
    expansionSlots: s.slots,
    fanMounts: 7,
    fansIncluded: 1,
    dimsMm: { w: 230, d: 440, h: 460 },
  },
});

const SOCKETS = ["AM5", "AM4", "LGA1700"];

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  // CPU
  cpu("demo-i3-14100", "cpu.i3_14100", "Core i3-14100", 1_586_000, {
    socket: "LGA1700",
    cores: 4,
    threads: 8,
    boostGhz: 4.7,
    tdpW: 60,
    maxPowerW: 110,
    hasIgpu: true,
    mts: 4800,
    box: true,
  }),
  cpu("demo-i5-12400", "cpu.i5_12400", "Core i5-12400", 2_135_000, {
    socket: "LGA1700",
    cores: 6,
    threads: 12,
    boostGhz: 4.4,
    tdpW: 65,
    maxPowerW: 117,
    hasIgpu: true,
    mts: 4800,
    box: true,
  }),
  cpu("demo-r5-7500f", "cpu.r5_7500f", "Ryzen 5 7500F", 1_413_000, {
    socket: "AM5",
    cores: 6,
    threads: 12,
    boostGhz: 5.0,
    tdpW: 65,
    maxPowerW: 88,
    hasIgpu: false,
    mts: 5200,
  }),
  cpu("demo-r5-9600x", "cpu.r5_9600x", "Ryzen 5 9600X", 2_806_000, {
    socket: "AM5",
    cores: 6,
    threads: 12,
    boostGhz: 5.4,
    tdpW: 65,
    maxPowerW: 88,
    hasIgpu: true,
    mts: 5600,
  }),
  cpu("demo-r7-9700x", "cpu.r7_9700x", "Ryzen 7 9700X", 2_590_000, {
    socket: "AM5",
    cores: 8,
    threads: 16,
    boostGhz: 5.5,
    tdpW: 65,
    maxPowerW: 88,
    hasIgpu: true,
    mts: 5600,
  }),
  cpu("demo-r7-7800x3d", "cpu.r7_7800x3d", "Ryzen 7 7800X3D", 3_179_000, {
    socket: "AM5",
    cores: 8,
    threads: 16,
    boostGhz: 5.0,
    tdpW: 120,
    maxPowerW: 162,
    hasIgpu: true,
    mts: 5200,
  }),
  cpu("demo-r7-9800x3d", "cpu.r7_9800x3d", "Ryzen 7 9800X3D", 4_650_000, {
    socket: "AM5",
    cores: 8,
    threads: 16,
    boostGhz: 5.2,
    tdpW: 120,
    maxPowerW: 162,
    hasIgpu: true,
    mts: 5600,
  }),
  cpu("demo-r9-9900x", "cpu.r9_9900x", "Ryzen 9 9900X", 4_121_000, {
    socket: "AM5",
    cores: 12,
    threads: 24,
    boostGhz: 5.6,
    tdpW: 120,
    maxPowerW: 162,
    hasIgpu: true,
    mts: 5600,
  }),
  cpu("demo-r9-9950x", "cpu.r9_9950x", "Ryzen 9 9950X", 5_062_000, {
    socket: "AM5",
    cores: 16,
    threads: 32,
    boostGhz: 5.7,
    tdpW: 170,
    maxPowerW: 230,
    hasIgpu: true,
    mts: 5600,
  }),
  cpu("demo-r9-9950x3d", "cpu.r9_9950x3d", "Ryzen 9 9950X3D", 7_299_000, {
    socket: "AM5",
    cores: 16,
    threads: 32,
    boostGhz: 5.7,
    tdpW: 170,
    maxPowerW: 230,
    hasIgpu: true,
    mts: 5600,
  }),
  // boards
  board("demo-b760m-ddr4", "mb.b760m_ddr4", "MSI", "PRO B760M-E DDR4", 1_720_000, {
    socket: "LGA1700",
    chipset: "B760",
    formFactor: "mATX",
    ramType: "DDR4",
    ramSlots: 2,
    ramMaxGb: 64,
    ramMaxMts: 3200,
    m2: [M2_GEN4("M2_1"), M2_GEN3("M2_2")],
    sataPorts: 4,
    wifi: false,
    flashback: false,
  }),
  board("demo-b650m-p", "mb.b650m", "MSI", "PRO B650M-P", 1_295_000, {
    socket: "AM5",
    chipset: "B650",
    formFactor: "mATX",
    ramType: "DDR5",
    ramSlots: 4,
    ramMaxGb: 192,
    ramMaxMts: 6400,
    m2: [M2_GEN4("M2_1"), M2_GEN4("M2_2")],
    sataPorts: 4,
    wifi: false,
    flashback: false,
  }),
  board("demo-b850m-force", "mb.b850m_wifi", "Gigabyte", "B850M FORCE WF6E", 1_884_000, {
    socket: "AM5",
    chipset: "B850",
    formFactor: "mATX",
    ramType: "DDR5",
    ramSlots: 4,
    ramMaxGb: 256,
    ramMaxMts: 8000,
    m2: [M2_GEN5("M2_1"), M2_GEN4("M2_2"), M2_GEN4("M2_3")],
    sataPorts: 4,
    wifi: true,
    flashback: true,
  }),
  board("demo-x870-gaming", "mb.x870_wifi", "Gigabyte", "X870 GAMING WF6", 2_708_000, {
    socket: "AM5",
    chipset: "X870",
    formFactor: "ATX",
    ramType: "DDR5",
    ramSlots: 4,
    ramMaxGb: 256,
    ramMaxMts: 8000,
    m2: [M2_GEN5("M2_1"), M2_GEN4("M2_2"), M2_GEN4("M2_3"), M2_GEN4("M2_4")],
    sataPorts: 4,
    wifi: true,
    flashback: true,
  }),
  board("demo-x870e-tomahawk", "mb.x870e", "MSI", "MAG X870E TOMAHAWK WIFI", 4_474_000, {
    socket: "AM5",
    chipset: "X870E",
    formFactor: "ATX",
    ramType: "DDR5",
    ramSlots: 4,
    ramMaxGb: 256,
    ramMaxMts: 8400,
    m2: [M2_GEN5("M2_1"), M2_GEN5("M2_2"), M2_GEN4("M2_3"), M2_GEN4("M2_4")],
    sataPorts: 6,
    wifi: true,
    flashback: true,
  }),
  // memory
  ram("demo-ddr4-16-1x16", "ram.ddr4_16_1x16", "Kingston", "DDR4 3200 16 GB", 1_220_000, {
    type: "DDR4",
    kitGb: 16,
    modules: 1,
    mts: 3200,
    cl: 22,
    profile: "none",
    heightMm: 31,
    lighting: false,
  }),
  ram("demo-ddr4-16-2x8", "ram.ddr4_16_2x8", "T-Force", "Vulcan Z DDR4 3200 16 GB (2 x 8)", 1_830_000, {
    type: "DDR4",
    kitGb: 16,
    modules: 2,
    mts: 3200,
    cl: 16,
    profile: "XMP",
    heightMm: 35,
    lighting: false,
  }),
  ram("demo-ddr5-16-2x8", "ram.ddr5_16", "Patriot", "DDR5 5600 16 GB (2 x 8)", 2_120_000, {
    type: "DDR5",
    kitGb: 16,
    modules: 2,
    mts: 5600,
    cl: 46,
    profile: "XMP",
    heightMm: 32,
    lighting: false,
  }),
  ram("demo-ddr5-32-lexar", "ram.ddr5_32", "Lexar", "DDR5 6000 32 GB (2 x 16)", 4_650_000, {
    type: "DDR5",
    kitGb: 32,
    modules: 2,
    mts: 6000,
    cl: 30,
    profile: "both",
    heightMm: 42,
    lighting: false,
  }),
  ram(
    "demo-ddr5-32-corsair-white",
    "ram.ddr5_32_white",
    "Corsair",
    "Vengeance RGB White DDR5 6000 32 GB (2 x 16)",
    4_880_000,
    { type: "DDR5", kitGb: 32, modules: 2, mts: 6000, cl: 30, profile: "both", heightMm: 51, lighting: true },
  ),
  ram("demo-ddr5-64-corsair", "ram.ddr5_64", "Corsair", "DDR5 4800 64 GB (2 x 32)", 7_005_000, {
    type: "DDR5",
    kitGb: 64,
    modules: 2,
    mts: 4800,
    cl: 40,
    profile: "none",
    heightMm: 34,
    lighting: false,
  }),
  ram(
    "demo-ddr5-128",
    "ram.ddr5_128",
    "Corsair",
    "DDR5 4800 128 GB (4 x 32)",
    14_010_000,
    { type: "DDR5", kitGb: 128, modules: 4, mts: 4800, cl: 40, profile: "none", heightMm: 34, lighting: false },
    { manualOnly: true, vendors: 1, estimate: true },
  ),
  // SSD
  ssd("demo-ssd-netac-512", "ssd.512", "Netac", "NV3000 512 GB", 742_000, { capacityGb: 512, pcieGen: 3, tbw: 300 }),
  ssd("demo-ssd-lexar-nm610-1tb", "ssd.1tb", "Lexar", "NM610 PRO 1 TB", 1_401_000, {
    capacityGb: 1024,
    pcieGen: 3,
    tbw: 600,
  }),
  ssd("demo-ssd-lexar-nm620-2tb", "ssd.2tb", "Lexar", "NM620 2 TB", 2_531_000, {
    capacityGb: 2048,
    pcieGen: 3,
    tbw: 1280,
  }),
  ssd("demo-ssd-samsung-990-evo-plus-2tb", "ssd.2tb_senior", "Samsung", "990 EVO Plus 2 TB", 3_179_000, {
    capacityGb: 2048,
    pcieGen: 4,
    tbw: 1200,
  }),
  // GPU
  gpu("demo-gpu-5050", "gpu.rtx5050", "Gigabyte", "GeForce RTX 5050 Windforce OC V2 8 GB", 3_708_000, {
    chip: "RTX 5050",
    vramGb: 8,
    lengthMm: 282,
    heightMm: 120,
    slots: 2,
    conn: "8pin",
    adapter: false,
    tgpW: 130,
    recPsuW: 550,
  }),
  gpu("demo-gpu-5060", "gpu.rtx5060", "MSI", "GeForce RTX 5060 Shadow 2X 8 GB", 5_382_000, {
    chip: "RTX 5060",
    vramGb: 8,
    lengthMm: 245,
    heightMm: 120,
    slots: 2,
    conn: "8pin",
    adapter: false,
    tgpW: 145,
    recPsuW: 550,
  }),
  gpu("demo-gpu-5060ti-16", "gpu.rtx5060ti16", "Inno3D", "GeForce RTX 5060 Ti Twin X2 16 GB", 6_475_000, {
    chip: "RTX 5060 Ti",
    vramGb: 16,
    lengthMm: 245,
    heightMm: 120,
    slots: 2,
    conn: "8pin",
    adapter: false,
    tgpW: 180,
    recPsuW: 600,
  }),
  gpu(
    "demo-gpu-5070",
    "gpu.rtx5070",
    "ASUS",
    "GeForce RTX 5070 Dual 12 GB",
    8_880_000,
    {
      chip: "RTX 5070",
      vramGb: 12,
      lengthMm: 242,
      heightMm: 120,
      slots: 3,
      conn: "12V-2x6",
      adapter: true,
      tgpW: 250,
      recPsuW: 650,
    },
    { vendors: 2 },
  ),
  gpu("demo-gpu-5070ti", "gpu.rtx5070ti", "Gigabyte", "GeForce RTX 5070 Ti Windforce 16 GB", 13_680_000, {
    chip: "RTX 5070 Ti",
    vramGb: 16,
    lengthMm: 304,
    heightMm: 126,
    slots: 3,
    conn: "12V-2x6",
    adapter: true,
    tgpW: 300,
    recPsuW: 750,
  }),
  gpu("demo-gpu-5080", "gpu.rtx5080", "Gigabyte", "GeForce RTX 5080 Gaming OC 16 GB", 23_063_000, {
    chip: "RTX 5080",
    vramGb: 16,
    lengthMm: 340,
    heightMm: 140,
    slots: 4,
    conn: "12V-2x6",
    adapter: true,
    tgpW: 360,
    recPsuW: 850,
  }),
  // power supplies
  psu("demo-psu-500", "psu.500_bronze", "PF500X Bronze", 353_000, {
    watts: 500,
    rating: "bronze",
    white: false,
    pcie8pin: 1,
    native12v2x6: 0,
  }),
  psu("demo-psu-650", "psu.650_bronze", "PF650X Bronze", 471_000, {
    watts: 650,
    rating: "bronze",
    white: false,
    pcie8pin: 2,
    native12v2x6: 0,
  }),
  psu("demo-psu-650-white", "psu.650_white", "PF650X White", 494_000, {
    watts: 650,
    rating: "bronze",
    white: true,
    pcie8pin: 2,
    native12v2x6: 0,
  }),
  psu("demo-psu-750", "psu.750_gold", "PQ750G", 965_000, {
    watts: 750,
    rating: "gold",
    white: false,
    pcie8pin: 3,
    native12v2x6: 1,
  }),
  psu("demo-psu-750-white", "psu.750_gold_white", "PQ750G White", 1_001_000, {
    watts: 750,
    rating: "gold",
    white: true,
    pcie8pin: 3,
    native12v2x6: 1,
  }),
  psu("demo-psu-850", "psu.850_gold", "PQ850G", 1_036_000, {
    watts: 850,
    rating: "gold",
    white: false,
    pcie8pin: 4,
    native12v2x6: 1,
  }),
  psu("demo-psu-850-white", "psu.850_gold_white", "PQ850G White", 1_071_000, {
    watts: 850,
    rating: "gold",
    white: true,
    pcie8pin: 4,
    native12v2x6: 1,
  }),
  psu("demo-psu-1000", "psu.1000_gold", "PQ1000G", 1_354_000, {
    watts: 1000,
    rating: "gold",
    white: false,
    pcie8pin: 4,
    native12v2x6: 1,
  }),
  psu("demo-psu-1000-white", "psu.1000_gold_white", "PQ1000G White", 1_389_000, {
    watts: 1000,
    rating: "gold",
    white: true,
    pcie8pin: 4,
    native12v2x6: 1,
  }),
  // cases
  pcCase("demo-case-205m-mesh", "case.matx", "Lian Li", "LANCOOL 205M MESH", 506_000, false, {
    boards: ["mATX", "Mini-ITX"],
    gpuMaxLenMm: 380,
    coolerMaxHeightMm: 165,
    frontRad: 280,
    slots: 4,
  }),
  pcCase("demo-case-205m-snow", "case.matx", "Lian Li", "LANCOOL 205M SNOW", 506_000, true, {
    boards: ["mATX", "Mini-ITX"],
    gpuMaxLenMm: 380,
    coolerMaxHeightMm: 165,
    frontRad: 280,
    slots: 4,
  }),
  pcCase("demo-case-205-mesh", "case.atx", "Lian Li", "LANCOOL 205 MESH", 624_000, false, {
    boards: ["ATX", "mATX", "Mini-ITX"],
    gpuMaxLenMm: 400,
    coolerMaxHeightMm: 175,
    frontRad: 360,
    slots: 7,
  }),
  pcCase("demo-case-205-mesh-white", "case.atx", "Lian Li", "LANCOOL 205 MESH White", 624_000, true, {
    boards: ["ATX", "mATX", "Mini-ITX"],
    gpuMaxLenMm: 400,
    coolerMaxHeightMm: 175,
    frontRad: 360,
    slots: 7,
  }),
  pcCase("demo-case-215x", "case.atx_senior_a", "Lian Li", "LANCOOL 215X", 883_000, false, {
    boards: ["ATX", "mATX", "Mini-ITX"],
    gpuMaxLenMm: 420,
    coolerMaxHeightMm: 185,
    frontRad: 360,
    slots: 7,
  }),
  pcCase("demo-case-pano-m100r", "case.atx_senior_b", "MSI", "MAG PANO M100R PZ White", 824_000, true, {
    boards: ["ATX", "mATX", "Mini-ITX"],
    gpuMaxLenMm: 400,
    coolerMaxHeightMm: 175,
    frontRad: 360,
    slots: 7,
  }),
  // cooling and fans
  {
    slug: "demo-cooler-zalman-9x",
    classKey: "cooler_air.simple",
    category: "cooler_air",
    brand: "Zalman",
    model: "CNPS9X Optima",
    price: 219_600,
    color: "black",
    lighting: "none",
    specs: { sockets: SOCKETS, heightMm: 125, ramClearanceMm: 50, tdpRatedW: 125 },
  },
  {
    slug: "demo-cooler-ak400",
    classKey: "cooler_air.tower_a",
    category: "cooler_air",
    brand: "Deepcool",
    model: "AK400",
    price: 235_000,
    color: "black",
    lighting: "none",
    specs: { sockets: SOCKETS, heightMm: 155, ramClearanceMm: 47, tdpRatedW: 220 },
  },
  {
    slug: "demo-cooler-a410-white",
    classKey: "cooler_air.tower_b",
    category: "cooler_air",
    brand: "ID-Cooling",
    model: "FROZN A410 DW",
    price: 259_000,
    color: "white",
    lighting: "none",
    specs: { sockets: SOCKETS, heightMm: 156, ramClearanceMm: 55, tdpRatedW: 250 },
  },
  {
    slug: "demo-aio-fx360-pro",
    classKey: "aio.360_a",
    category: "aio",
    brand: "ID-Cooling",
    model: "FX360 PRO",
    price: 600_000,
    color: "black",
    lighting: "none",
    specs: { sockets: SOCKETS, radMm: 360, radThicknessWithFansMm: 52, tubeLenMm: 400, pumpW: 6 },
  },
  {
    slug: "demo-aio-fx360-white",
    classKey: "aio.360_b",
    category: "aio",
    brand: "ID-Cooling",
    model: "FX360 PRO WHITE",
    price: 624_000,
    color: "white",
    lighting: "none",
    specs: { sockets: SOCKETS, radMm: 360, radThicknessWithFansMm: 52, tubeLenMm: 400, pumpW: 6 },
  },
  {
    slug: "demo-fan-sl120w-x3",
    classKey: "fan.white_x3",
    category: "fan",
    brand: "Jonsbo",
    model: "SL-120W (3 pcs)",
    price: 177_000,
    color: "white",
    lighting: "none",
    specs: { sizeMm: 120, count: 3, conn: "4pin", argb: false },
  },
];

/** Rows of table 1.2 without a position here are alternatives of the ladders (RX cards) and the RTX 5090: classes only. */
export const DEMO_VENDORS = [
  { name: "Демо-поставщик 1", kind: "partner", source: "partner_csv", percent: 0 },
  { name: "Демо-поставщик 2", kind: "shop", source: "partner_gsheet", percent: 2 },
  { name: "Демо-поставщик 3", kind: "shop", source: "manual", percent: -2 },
] as const;
