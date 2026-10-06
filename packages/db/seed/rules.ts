// WP-06: the rule seed. Categories, ladders, price classes, the 32 base builds of block 28 (they are selection
// rules, not prices), the first rule set and the money settings. No demo data here: this layer may run in production.
import type pg from "pg";

type Loc = { uz: string; ru: string };
const l = (uz: string, ru: string): Loc => ({ uz, ru });
/** U+02BB, the "oʻ" and "gʻ" mark (ARCHITECTURE 5.2); U+02BC would be the other apostrophe. */
const TURNED_COMMA = "ʻ";

// ---- categories (ARCHITECTURE 3.3) -------------------------------------------------------------------------------
type Group = "pc" | "setup" | "service";
type FeeGroup = "pc" | "mount" | "outside_scale";
interface CategorySeed {
  code: string;
  group: Group;
  name: Loc;
  feeGroup: FeeGroup;
  freshnessDays: number;
  returnable: boolean;
}

// Freshness: 7 days, GPU 3 (volatile), furniture and decor 30 (ARCHITECTURE 4.5). Setup items are assembled and
// mounted, so they sit in the "mount" fee group; licences are outside the scale (red line: no fee on them).
const CATEGORY_LIST: CategorySeed[] = [
  { code: "cpu", group: "pc", name: l("Protsessor", "Процессор"), feeGroup: "pc", freshnessDays: 7, returnable: true },
  {
    code: "mb",
    group: "pc",
    name: l("Ona plata", "Материнская плата"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "ram",
    group: "pc",
    name: l("Operativ xotira", "Оперативная память"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "ssd",
    group: "pc",
    name: l("SSD disk", "SSD-накопитель"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  { code: "gpu", group: "pc", name: l("Videokarta", "Видеокарта"), feeGroup: "pc", freshnessDays: 3, returnable: true },
  {
    code: "psu",
    group: "pc",
    name: l("Quvvat bloki", "Блок питания"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  { code: "case", group: "pc", name: l("Korpus", "Корпус"), feeGroup: "pc", freshnessDays: 7, returnable: true },
  {
    code: "cooler_air",
    group: "pc",
    name: l("Havo sovutgichi", "Воздушный кулер"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "aio",
    group: "pc",
    name: l("Suyuqlikli sovutish", "Жидкостное охлаждение"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "fan",
    group: "pc",
    name: l("Ventilyator", "Вентилятор"),
    feeGroup: "pc",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "monitor",
    group: "setup",
    name: l("Monitor", "Монитор"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "arm",
    group: "setup",
    name: l("Monitor kronshteyni", "Кронштейн для монитора"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  { code: "desk", group: "setup", name: l("Stol", "Стол"), feeGroup: "mount", freshnessDays: 30, returnable: true },
  {
    code: "desk_frame",
    group: "setup",
    name: l("Stol karkasi", "Каркас стола"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "desk_top",
    group: "setup",
    name: l("Stol usti", "Столешница"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "chair",
    group: "setup",
    name: l("Kreslo", "Кресло"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "keyboard",
    group: "setup",
    name: l("Klaviatura", "Клавиатура"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "mouse",
    group: "setup",
    name: l("Sichqoncha", "Мышь"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "mousepad",
    group: "setup",
    name: l("Sichqoncha gilamchasi", "Коврик для мыши"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "headset",
    group: "setup",
    name: l("Garnitura", "Гарнитура"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "microphone",
    group: "setup",
    name: l("Mikrofon", "Микрофон"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "webcam",
    group: "setup",
    name: l("Veb-kamera", "Веб-камера"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "light",
    group: "setup",
    name: l("Yoritgich", "Свет"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "speakers",
    group: "setup",
    name: l("Karnaylar", "Колонки"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  {
    code: "acoustic_panel",
    group: "setup",
    name: l("Akustik panel", "Акустическая панель"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "cable_mgmt",
    group: "setup",
    name: l("Kabel kanali", "Кабель-канал"),
    feeGroup: "mount",
    freshnessDays: 30,
    returnable: true,
  },
  {
    code: "ups",
    group: "setup",
    name: l("Uzluksiz quvvat manbai", "Источник бесперебойного питания"),
    feeGroup: "mount",
    freshnessDays: 7,
    returnable: true,
  },
  { code: "decor", group: "setup", name: l("Dekor", "Декор"), feeGroup: "mount", freshnessDays: 30, returnable: true },
  {
    code: "os_license",
    group: "service",
    name: l("Windows litsenziyasi", "Лицензия Windows"),
    feeGroup: "outside_scale",
    freshnessDays: 30,
    returnable: false,
  },
];

export const CATEGORIES = CATEGORY_LIST;

// ---- price classes and ladders (block 28, 1.2 and 1.5) -------------------------------------------------------------
type LadderCode = "gpu" | "cpu_am5" | "cpu_lga1700" | "ram" | "ssd";
interface ClassSeed {
  key: string;
  category: string;
  name: Loc;
  ladder?: LadderCode;
  step?: number;
  /** Equal steps are alternatives (RTX 5060 Ti or RX 9060 XT); the first class of a step is the one in `ladders.steps`. */
  primary?: boolean;
  manualOnly?: boolean;
}
const cls = (
  key: string,
  category: string,
  uz: string,
  ru: string,
  extra: Partial<Pick<ClassSeed, "ladder" | "step" | "primary" | "manualOnly">> = {},
): ClassSeed => ({ key, category, name: l(uz, ru), ...extra });

export const PRICE_CLASSES: ClassSeed[] = [
  // GPU ladder: none (integrated) -> 5050 -> 5060 -> 5060 Ti 16 | RX 9060 XT 16 -> 5070 | RX 9070 -> RX 9070 XT -> 5070 Ti -> 5080 -> 5090 (manual)
  cls("gpu.rtx5050", "gpu", "Videokarta RTX 5050 8 GB", "Видеокарта RTX 5050 8 ГБ", {
    ladder: "gpu",
    step: 1,
    primary: true,
  }),
  cls("gpu.rtx5060", "gpu", "Videokarta RTX 5060 8 GB", "Видеокарта RTX 5060 8 ГБ", {
    ladder: "gpu",
    step: 2,
    primary: true,
  }),
  cls("gpu.rtx5060ti16", "gpu", "Videokarta RTX 5060 Ti 16 GB", "Видеокарта RTX 5060 Ti 16 ГБ", {
    ladder: "gpu",
    step: 3,
    primary: true,
  }),
  cls("gpu.rx9060xt16", "gpu", "Videokarta RX 9060 XT 16 GB", "Видеокарта RX 9060 XT 16 ГБ", {
    ladder: "gpu",
    step: 3,
  }),
  cls("gpu.rtx5070", "gpu", "Videokarta RTX 5070 12 GB", "Видеокарта RTX 5070 12 ГБ", {
    ladder: "gpu",
    step: 4,
    primary: true,
  }),
  cls("gpu.rx9070", "gpu", "Videokarta RX 9070 16 GB", "Видеокарта RX 9070 16 ГБ", { ladder: "gpu", step: 4 }),
  cls("gpu.rx9070xt", "gpu", "Videokarta RX 9070 XT 16 GB", "Видеокарта RX 9070 XT 16 ГБ", {
    ladder: "gpu",
    step: 5,
    primary: true,
  }),
  cls("gpu.rtx5070ti", "gpu", "Videokarta RTX 5070 Ti 16 GB", "Видеокарта RTX 5070 Ti 16 ГБ", {
    ladder: "gpu",
    step: 6,
    primary: true,
  }),
  cls("gpu.rtx5080", "gpu", "Videokarta RTX 5080 16 GB", "Видеокарта RTX 5080 16 ГБ", {
    ladder: "gpu",
    step: 7,
    primary: true,
  }),
  cls("gpu.rtx5090", "gpu", "Videokarta RTX 5090 32 GB", "Видеокарта RTX 5090 32 ГБ", {
    ladder: "gpu",
    step: 8,
    primary: true,
    manualOnly: true,
  }),
  // CPU AM5: 7500F -> 9600X -> 7800X3D | 9700X -> 9800X3D | 9900X -> 9950X -> 9950X3D
  cls("cpu.r5_7500f", "cpu", "Protsessor Ryzen 5 7500F", "Процессор Ryzen 5 7500F", {
    ladder: "cpu_am5",
    step: 1,
    primary: true,
  }),
  cls("cpu.r5_9600x", "cpu", "Protsessor Ryzen 5 9600X", "Процессор Ryzen 5 9600X", {
    ladder: "cpu_am5",
    step: 2,
    primary: true,
  }),
  cls("cpu.r7_7800x3d", "cpu", "Protsessor Ryzen 7 7800X3D", "Процессор Ryzen 7 7800X3D", {
    ladder: "cpu_am5",
    step: 3,
    primary: true,
  }),
  cls("cpu.r7_9700x", "cpu", "Protsessor Ryzen 7 9700X", "Процессор Ryzen 7 9700X", { ladder: "cpu_am5", step: 3 }),
  cls("cpu.r7_9800x3d", "cpu", "Protsessor Ryzen 7 9800X3D", "Процессор Ryzen 7 9800X3D", {
    ladder: "cpu_am5",
    step: 4,
    primary: true,
  }),
  cls("cpu.r9_9900x", "cpu", "Protsessor Ryzen 9 9900X", "Процессор Ryzen 9 9900X", { ladder: "cpu_am5", step: 4 }),
  cls("cpu.r9_9950x", "cpu", "Protsessor Ryzen 9 9950X", "Процессор Ryzen 9 9950X", {
    ladder: "cpu_am5",
    step: 5,
    primary: true,
  }),
  cls("cpu.r9_9950x3d", "cpu", "Protsessor Ryzen 9 9950X3D", "Процессор Ryzen 9 9950X3D", {
    ladder: "cpu_am5",
    step: 6,
    primary: true,
  }),
  // CPU LGA1700 with DDR4: only office and programming T1
  cls("cpu.i3_14100", "cpu", "Protsessor Core i3-14100", "Процессор Core i3-14100", {
    ladder: "cpu_lga1700",
    step: 1,
    primary: true,
  }),
  cls("cpu.i5_12400", "cpu", "Protsessor Core i5-12400", "Процессор Core i5-12400", {
    ladder: "cpu_lga1700",
    step: 2,
    primary: true,
  }),
  // boards
  cls("mb.b760m_ddr4", "mb", "Ona plata B760M, DDR4", "Материнская плата B760M, DDR4"),
  cls("mb.b650m", "mb", "Ona plata B650M", "Материнская плата B650M"),
  cls("mb.b850m_wifi", "mb", "Ona plata B850M, Wi-Fi", "Материнская плата B850M, Wi-Fi"),
  cls("mb.x870_wifi", "mb", "Ona plata X870, Wi-Fi", "Материнская плата X870, Wi-Fi"),
  cls("mb.x870e", "mb", "Ona plata X870E", "Материнская плата X870E"),
  // memory: DDR4 outside the ladder; DDR5 16 -> 32 -> 64 -> 128 (manual)
  cls("ram.ddr4_16_1x16", "ram", "Xotira DDR4 16 GB (1 x 16)", "Память DDR4 16 ГБ (1 × 16)"),
  cls("ram.ddr4_16_2x8", "ram", "Xotira DDR4 16 GB (2 x 8)", "Память DDR4 16 ГБ (2 × 8)"),
  cls("ram.ddr5_16", "ram", "Xotira DDR5 16 GB (2 x 8)", "Память DDR5 16 ГБ (2 × 8)", {
    ladder: "ram",
    step: 1,
    primary: true,
  }),
  cls("ram.ddr5_32", "ram", "Xotira DDR5 32 GB (2 x 16)", "Память DDR5 32 ГБ (2 × 16)", {
    ladder: "ram",
    step: 2,
    primary: true,
  }),
  cls("ram.ddr5_32_white", "ram", "Xotira DDR5 32 GB (2 x 16), oq", "Память DDR5 32 ГБ (2 × 16), белая", {
    ladder: "ram",
    step: 2,
  }),
  cls("ram.ddr5_64", "ram", "Xotira DDR5 64 GB (2 x 32)", "Память DDR5 64 ГБ (2 × 32)", {
    ladder: "ram",
    step: 3,
    primary: true,
  }),
  cls("ram.ddr5_128", "ram", "Xotira DDR5 128 GB (4 x 32)", "Память DDR5 128 ГБ (4 × 32)", {
    ladder: "ram",
    step: 4,
    primary: true,
    manualOnly: true,
  }),
  // SSD: 512 -> 1 TB -> 2 TB (two drives of 2 TB are two rows of a template, the "2 + 2" step)
  cls("ssd.512", "ssd", "SSD NVMe 512 GB", "SSD NVMe 512 ГБ", { ladder: "ssd", step: 1, primary: true }),
  cls("ssd.1tb", "ssd", "SSD NVMe 1 TB", "SSD NVMe 1 ТБ", { ladder: "ssd", step: 2, primary: true }),
  cls("ssd.2tb", "ssd", "SSD NVMe 2 TB", "SSD NVMe 2 ТБ", { ladder: "ssd", step: 3, primary: true }),
  cls("ssd.2tb_senior", "ssd", "SSD NVMe 2 TB, yuqori daraja", "SSD NVMe 2 ТБ, старший класс", {
    ladder: "ssd",
    step: 3,
  }),
  // power supplies (black and white differ in price, so they are classes of their own)
  cls("psu.500_bronze", "psu", "Quvvat bloki 500 W Bronze", "Блок питания 500 Вт Bronze"),
  cls("psu.650_bronze", "psu", "Quvvat bloki 650 W Bronze", "Блок питания 650 Вт Bronze"),
  cls("psu.650_white", "psu", "Quvvat bloki 650 W, oq", "Блок питания 650 Вт, белый"),
  cls("psu.750_gold", "psu", "Quvvat bloki 750 W Gold", "Блок питания 750 Вт Gold"),
  cls("psu.750_gold_white", "psu", "Quvvat bloki 750 W Gold, oq", "Блок питания 750 Вт Gold, белый"),
  cls("psu.850_gold", "psu", "Quvvat bloki 850 W Gold", "Блок питания 850 Вт Gold"),
  cls("psu.850_gold_white", "psu", "Quvvat bloki 850 W Gold, oq", "Блок питания 850 Вт Gold, белый"),
  cls("psu.1000_gold", "psu", "Quvvat bloki 1000 W Gold", "Блок питания 1000 Вт Gold"),
  cls("psu.1000_gold_white", "psu", "Quvvat bloki 1000 W Gold, oq", "Блок питания 1000 Вт Gold, белый"),
  // cases: one class where black and white cost the same
  cls("case.matx", "case", "Korpus mATX", "Корпус mATX"),
  cls("case.atx", "case", "Korpus ATX", "Корпус ATX"),
  cls("case.atx_senior_a", "case", "Korpus ATX, yuqori daraja (A)", "Корпус ATX старший (А)"),
  cls("case.atx_senior_b", "case", "Korpus ATX, yuqori daraja (B)", "Корпус ATX старший (Б)"),
  // cooling and fans
  cls("cooler_air.simple", "cooler_air", "Oddiy kuler", "Простой кулер"),
  cls("cooler_air.tower_a", "cooler_air", "Minorali kuler (A)", "Башенный кулер (А)"),
  cls("cooler_air.tower_b", "cooler_air", "Minorali kuler (B)", "Башенный кулер (Б)"),
  cls("aio.360_a", "aio", "Suyuqlikli sovutish 360 mm (A)", "Жидкостное охлаждение 360 мм (А)"),
  cls("aio.360_b", "aio", "Suyuqlikli sovutish 360 mm (B)", "Жидкостное охлаждение 360 мм (Б)"),
  cls("fan.white_x3", "fan", "Oq ventilyatorlar, 3 dona", "Белые вентиляторы, 3 шт."),
];

export const LADDERS: LadderCode[] = ["gpu", "cpu_am5", "cpu_lga1700", "ram", "ssd"];

// ---- the 32 base builds (block 28, 1.3) ----------------------------------------------------------------------------
type Task = "gaming" | "streaming" | "design3d" | "programming" | "office";
type Tier = "T1" | "T2" | "T3" | "T4";
/** A template row: price class key and quantity. */
type Row = readonly [classKey: string, qty?: number];

interface Template {
  task: Task;
  tier: Tier;
  /** Style A ("dark, quiet"); style B is derived by `toStyleB`. */
  rows: readonly Row[];
}

const TEMPLATES_A: readonly Template[] = [
  {
    task: "gaming",
    tier: "T1",
    rows: [
      ["cpu.r5_7500f"],
      ["mb.b650m"],
      ["ram.ddr5_16"],
      ["ssd.512"],
      ["gpu.rtx5050"],
      ["psu.650_bronze"],
      ["case.matx"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "gaming",
    tier: "T2",
    rows: [
      ["cpu.r5_7500f"],
      ["mb.b650m"],
      ["ram.ddr5_16"],
      ["ssd.1tb"],
      ["gpu.rtx5060"],
      ["psu.650_bronze"],
      ["case.atx"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "gaming",
    tier: "T3",
    rows: [
      ["cpu.r7_7800x3d"],
      ["mb.b850m_wifi"],
      ["ram.ddr5_32"],
      ["ssd.2tb"],
      ["gpu.rtx5070"],
      ["psu.750_gold"],
      ["case.atx_senior_a"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "gaming",
    tier: "T4",
    rows: [
      ["cpu.r7_9800x3d"],
      ["mb.x870_wifi"],
      ["ram.ddr5_32"],
      ["ssd.2tb_senior"],
      ["gpu.rtx5080"],
      ["psu.1000_gold"],
      ["case.atx_senior_a"],
      ["aio.360_a"],
    ],
  },
  {
    task: "streaming",
    tier: "T2",
    rows: [
      ["cpu.r5_7500f"],
      ["mb.b650m"],
      ["ram.ddr5_32"],
      ["ssd.1tb"],
      ["gpu.rtx5060"],
      ["psu.650_bronze"],
      ["case.atx"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "streaming",
    tier: "T3",
    rows: [
      ["cpu.r7_9700x"],
      ["mb.b850m_wifi"],
      ["ram.ddr5_32"],
      ["ssd.1tb"],
      ["ssd.2tb"],
      ["gpu.rtx5070"],
      ["psu.750_gold"],
      ["case.atx_senior_a"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "streaming",
    tier: "T4",
    rows: [
      ["cpu.r9_9950x3d"],
      ["mb.x870e"],
      ["ram.ddr5_64"],
      ["ssd.2tb"],
      ["ssd.2tb_senior"],
      ["gpu.rtx5080"],
      ["psu.1000_gold"],
      ["case.atx_senior_a"],
      ["aio.360_a"],
    ],
  },
  {
    task: "design3d",
    tier: "T1",
    rows: [
      ["cpu.r5_9600x"],
      ["mb.b650m"],
      ["ram.ddr5_32"],
      ["ssd.1tb"],
      ["psu.650_bronze"],
      ["case.matx"],
      ["cooler_air.simple"],
    ],
  },
  {
    task: "design3d",
    tier: "T2",
    rows: [
      ["cpu.r7_9700x"],
      ["mb.b650m"],
      ["ram.ddr5_32"],
      ["ssd.2tb"],
      ["gpu.rtx5060ti16"],
      ["psu.750_gold"],
      ["case.atx"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "design3d",
    tier: "T3",
    rows: [
      ["cpu.r9_9900x"],
      ["mb.b850m_wifi"],
      ["ram.ddr5_64"],
      ["ssd.2tb_senior"],
      ["gpu.rtx5070ti"],
      ["psu.850_gold"],
      ["case.atx_senior_a"],
      ["aio.360_a"],
    ],
  },
  {
    task: "design3d",
    tier: "T4",
    rows: [
      ["cpu.r9_9950x"],
      ["mb.x870e"],
      ["ram.ddr5_128"],
      ["ssd.2tb"],
      ["ssd.2tb_senior"],
      ["gpu.rtx5080"],
      ["psu.1000_gold"],
      ["case.atx_senior_a"],
      ["aio.360_a"],
    ],
  },
  {
    task: "programming",
    tier: "T1",
    rows: [
      ["cpu.i5_12400"],
      ["mb.b760m_ddr4"],
      ["ram.ddr4_16_2x8"],
      ["ssd.1tb"],
      ["psu.500_bronze"],
      ["case.matx"],
      ["cooler_air.simple"],
    ],
  },
  {
    task: "programming",
    tier: "T2",
    rows: [
      ["cpu.r7_9700x"],
      ["mb.b650m"],
      ["ram.ddr5_32"],
      ["ssd.2tb"],
      ["psu.650_bronze"],
      ["case.matx"],
      ["cooler_air.simple"],
    ],
  },
  {
    task: "programming",
    tier: "T3",
    rows: [
      ["cpu.r9_9900x"],
      ["mb.b850m_wifi"],
      ["ram.ddr5_64"],
      ["ssd.2tb_senior"],
      ["gpu.rtx5060ti16"],
      ["psu.750_gold"],
      ["case.atx"],
      ["cooler_air.tower_a"],
    ],
  },
  {
    task: "programming",
    tier: "T4",
    rows: [
      ["cpu.r9_9950x"],
      ["mb.x870e"],
      ["ram.ddr5_128"],
      ["ssd.2tb_senior", 2],
      ["gpu.rtx5080"],
      ["psu.1000_gold"],
      ["case.atx_senior_a"],
      ["aio.360_a"],
    ],
  },
  {
    task: "office",
    tier: "T1",
    rows: [
      ["cpu.i3_14100"],
      ["mb.b760m_ddr4"],
      ["ram.ddr4_16_1x16"],
      ["ssd.512"],
      ["psu.500_bronze"],
      ["case.matx"],
      ["cooler_air.simple"],
    ],
  },
];

/** Style B "light": white power supply, tower cooler and radiator, white 32 GB kit, senior case B, three white fans from T2. */
const WHITE_SWAP: Record<string, string> = {
  "psu.650_bronze": "psu.650_white",
  "psu.750_gold": "psu.750_gold_white",
  "psu.850_gold": "psu.850_gold_white",
  "psu.1000_gold": "psu.1000_gold_white",
  "cooler_air.tower_a": "cooler_air.tower_b",
  "aio.360_a": "aio.360_b",
  "ram.ddr5_32": "ram.ddr5_32_white",
  "case.atx_senior_a": "case.atx_senior_b",
};
function toStyleB(t: Template): readonly Row[] {
  const rows: Row[] = t.rows.map((r): Row => {
    const key = WHITE_SWAP[r[0]] ?? r[0];
    return r[1] === undefined ? [key] : [key, r[1]];
  });
  if (t.tier !== "T1") rows.push(["fan.white_x3"]);
  return rows;
}

/** Main and secondary ladders by task (block 28, 1.5): which slots the fitting step moves first. */
const PRIMARY_SLOTS: Record<Task, readonly string[]> = {
  gaming: ["gpu"],
  streaming: ["gpu"],
  design3d: ["gpu", "ram"],
  programming: ["ram", "cpu"],
  office: ["cpu"],
};
const SECONDARY_SLOTS: Record<Task, readonly string[]> = {
  gaming: ["cpu", "ram", "ssd"],
  streaming: ["ram", "ssd", "cpu"],
  design3d: ["cpu", "ssd"],
  programming: ["ssd", "gpu"],
  office: ["ssd", "ram"],
};

interface NotOffered {
  task: Task;
  tier: Tier;
  redirect: Task;
  explain: Loc;
}
const NOT_OFFERED: readonly NotOffered[] = [
  {
    task: "streaming",
    tier: "T1",
    redirect: "gaming",
    explain: l(
      "Strim T1 darajasida taklif etilmaydi: strim uchun 32 GB xotira va alohida videokarta kerak, minimum T2.",
      "Стрим на уровне Т1 не предлагаем: для стрима нужны 32 ГБ памяти и отдельная видеокарта, минимум Т2.",
    ),
  },
  ...(["T2", "T3", "T4"] as const).map(
    (tier): NotOffered => ({
      task: "office",
      tier,
      redirect: tier === "T2" ? "programming" : "design3d",
      explain: l(
        `Ofis T1 dan yuqori darajada yig${TURNED_COMMA}ilmaydi: 12 mln so${TURNED_COMMA}mdan boshlab «Dasturlash» yoki «Dizayn» vazifasi taklif qilinadi.`,
        "Офис выше Т1 не собираем: при бюджете от 12 млн предлагаем задачу «Программирование» или «Дизайн».",
      ),
    }),
  ),
];

const PLUS_EXPLAIN = l(
  `Ofis T1+ «Dasturlash T1» bilan bir xil yig${TURNED_COMMA}ma.`,
  "Офис Т1+ совпадает со сборкой «Программирование Т1».",
);

/** Rows of all builds as plain data, for tests and for the seed. */
export interface BuildSeed {
  task: Task;
  tier: Tier;
  style: "A" | "B";
  variant: "base" | "plus";
  status: "offered" | "not_offered";
  redirectTask: Task | null;
  explain: Loc | null;
  rows: readonly Row[];
}

export function buildSeeds(): BuildSeed[] {
  const out: BuildSeed[] = [];
  for (const style of ["A", "B"] as const) {
    for (const t of TEMPLATES_A) {
      const rows = style === "A" ? t.rows : toStyleB(t);
      out.push({
        task: t.task,
        tier: t.tier,
        style,
        variant: "base",
        status: "offered",
        redirectTask: null,
        explain: null,
        rows,
      });
      if (t.task === "programming" && t.tier === "T1") {
        // "Office T1+" shares the template of "Programming T1".
        out.push({
          task: "office",
          tier: "T1",
          style,
          variant: "plus",
          status: "offered",
          redirectTask: null,
          explain: PLUS_EXPLAIN,
          rows,
        });
      }
    }
    for (const n of NOT_OFFERED) {
      out.push({
        task: n.task,
        tier: n.tier,
        style,
        variant: "base",
        status: "not_offered",
        redirectTask: n.redirect,
        explain: n.explain,
        rows: [],
      });
    }
  }
  return out;
}

const ROLE = (task: Task, slot: string) =>
  PRIMARY_SLOTS[task].includes(slot) ? "primary" : SECONDARY_SLOTS[task].includes(slot) ? "secondary" : "support";

// ---- rule set 1 and settings --------------------------------------------------------------------------------------
export const COMPAT_SETTINGS = {
  gpuLenWarnMarginMm: 10,
  coolerHeightWarnMarginMm: 5,
  psuMultiplier: 1.3,
  psuHeadroomWarnBp: 3000,
  psuSeriesW: [550, 650, 750, 850, 1000, 1200],
  baseW: 50,
  perFanW: 5,
  pumpW: 15,
  rollbackZoneMm: 750,
  eyeDistanceMm: [500, 760],
  standDepthMm: [150, 250],
} as const;

/** Ladders as ordered class keys: one class per step, the first `primary` class of each step. */
export function ladderKeys(code: LadderCode): string[] {
  return PRICE_CLASSES.filter((c) => c.ladder === code && c.primary).map((c) => c.key);
}

export const SELECTION_SETTINGS = {
  tierBounds: { t1: 12_000_000, t2: 20_000_000, t3: 35_000_000 },
  ladders: { gpu: ladderKeys("gpu"), cpu: ladderKeys("cpu_am5"), ram: ladderKeys("ram"), ssd: ladderKeys("ssd") },
  primaryLadder: {
    gaming: ["gpu"],
    streaming: ["gpu"],
    design3d: ["gpu", "ram"],
    programming: ["ram", "cpu"],
    office: ["cpu"],
  },
  secondaryOrder: {
    gaming: ["cpu", "ram", "ssd"],
    streaming: ["ram", "ssd", "cpu"],
    design3d: ["cpu", "ssd"],
    programming: ["ssd", "gpu"],
    office: ["ssd", "ram"],
  },
  minimums: {
    gaming: { requiresGpu: true },
    streaming: { minTier: "T2", minRamGb: 32, requiresGpu: true },
    design3d: { minRamGb: 32, minVramGb: 16 },
    programming: {},
    office: {},
  },
  budgetTolerance: 1000,
  whiteSurchargeMax: 1000,
  manualOnlyClassKeys: ["gpu.rtx5090", "ram.ddr5_128"],
  manualOnlyPartAbove: 60_000_000,
} as const;

/** FeeSettings with the values of ARCHITECTURE 4.6 and the owner's default money rules of 05.10.2026 (DECISIONS R-8). */
export const FEE_SETTINGS = {
  version: "2026-10-05",
  effectiveFrom: "2026-10-05",
  pcLowRateBp: 1500,
  pcHighRateBp: 1000,
  pcThreshold: 20_000_000,
  pcHighMinFee: 3_000_000,
  mountRateBp: 1500,
  complexRateBp: 1500,
  minFullCyclePc: 6_700_000,
  minFreeWindowPc: 4_500_000,
  minFullCycleSetup: 13_300_000,
  stageSharesBp: { selection: 2000, purchase: 3000, assembly: 3500, handover: 1500 },
  commissionLineStages: ["selection", "purchase"],
  advanceBp: 3000,
  reserveBp: 300,
  reserveHighBp: 500,
  reserveHighShareBp: 2500,
  reserveRoundStep: 10_000,
  podborShareBp: 2000,
  podborCreditDays: 30,
  afterTestsRetainBp: 8500,
  shelfLifeHours: { components: 24, furniture: 72 },
} as const;

export const SETTINGS: Record<string, unknown> = {
  "money.fee_settings": FEE_SETTINGS,
  "money.threshold": {
    annualLimit: 1_000_000_000,
    planCap: 200_000_000,
    alertsBp: [6000, 7000, 8000, 9000, 10000],
    proportion: "without_registration_day",
  },
  // Holidays are filled in by the owner; an empty list means Monday to Saturday are all working days.
  "calendar.work": { tz: "Asia/Tashkent", workdays: [1, 2, 3, 4, 5, 6], from: "10:00", to: "19:00", holidays: [] },
  "feature.ai": false,
  "feature.setupConfigurator": false,
  "feature.scene": false,
  "feature.miniApp": false,
};

// ---- applying -----------------------------------------------------------------------------------------------------
export interface RulesSeedResult {
  categories: number;
  priceClasses: number;
  ladders: number;
  baseBuilds: number;
  baseBuildItems: number;
}

/** Idempotent: safe to run again, existing rows are updated by their natural key. Run inside the caller's transaction. */
export async function seedRules(client: pg.Client): Promise<RulesSeedResult> {
  for (const [i, c] of CATEGORY_LIST.entries()) {
    await client.query(
      `insert into catalog.categories (code, category_group, name, fee_group_default, freshness_days, returnable_default, sort)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (code) do update set category_group = excluded.category_group, name = excluded.name,
         fee_group_default = excluded.fee_group_default, freshness_days = excluded.freshness_days,
         returnable_default = excluded.returnable_default, sort = excluded.sort`,
      [c.code, c.group, JSON.stringify(c.name), c.feeGroup, c.freshnessDays, c.returnable, i + 1],
    );
  }
  for (const code of LADDERS) {
    await client.query("insert into catalog.ladders (code) values ($1) on conflict (code) do nothing", [code]);
  }
  for (const c of PRICE_CLASSES) {
    await client.query(
      `insert into catalog.price_classes (category_code, key, name, ladder_code, step, manual_only)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (key) do update set name = excluded.name, ladder_code = excluded.ladder_code, step = excluded.step,
         manual_only = excluded.manual_only`,
      [c.category, c.key, JSON.stringify(c.name), c.ladder ?? null, c.step ?? null, c.manualOnly ?? false],
    );
  }
  for (const code of LADDERS) {
    await client.query(
      `update catalog.ladders set steps = coalesce((
         select array_agg(pc.id order by pc.step) from catalog.price_classes pc where pc.key = any($2)), '{}')
       where code = $1`,
      [code, ladderKeys(code)],
    );
  }

  const builds = buildSeeds();
  let items = 0;
  for (const b of builds) {
    const { rows } = await client.query<{ id: string }>(
      `insert into catalog.base_builds (task, tier, style, variant, status, redirect_task, explain)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (task, tier, style, variant) do update set status = excluded.status,
         redirect_task = excluded.redirect_task, explain = excluded.explain
       returning id`,
      [b.task, b.tier, b.style, b.variant, b.status, b.redirectTask, b.explain ? JSON.stringify(b.explain) : null],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("base build was not written");
    await client.query("delete from catalog.base_build_items where base_build_id = $1", [id]);
    for (const [position, [classKey, qty]] of b.rows.entries()) {
      const category = PRICE_CLASSES.find((c) => c.key === classKey)?.category;
      if (!category) throw new Error(`template ${b.task} ${b.tier} refers to an unknown price class ${classKey}`);
      await client.query(
        `insert into catalog.base_build_items (base_build_id, position, slot, price_class_id, qty, role)
         select $1, $2, $3, pc.id, $4, $5 from catalog.price_classes pc where pc.key = $6`,
        [id, position + 1, category, qty ?? 1, ROLE(b.task, category), classKey],
      );
      items += 1;
    }
  }

  await client.query(
    `insert into catalog.rule_sets (version, status, payload, published_at)
     values (1, 'published', $1, now()) on conflict (version) do nothing`,
    [JSON.stringify({ compat: COMPAT_SETTINGS, selection: SELECTION_SETTINGS })],
  );
  for (const [key, value] of Object.entries(SETTINGS)) {
    // Never overwrite what the owner changed: settings are seeded once.
    await client.query(
      "insert into ops.settings (key, value, updated_by) values ($1, $2, 'seed') on conflict (key) do nothing",
      [key, JSON.stringify(value)],
    );
  }
  return {
    categories: CATEGORY_LIST.length,
    priceClasses: PRICE_CLASSES.length,
    ladders: LADDERS.length,
    baseBuilds: builds.length,
    baseBuildItems: items,
  };
}
