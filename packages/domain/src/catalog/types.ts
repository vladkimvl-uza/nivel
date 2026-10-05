// Frozen contract (ARCHITECTURE 4.3). Change only via ADR and a "contract" PR.

export type ProductId = string & { readonly __brand: "ProductId" };
export type CategoryCode =
  | "cpu"
  | "mb"
  | "ram"
  | "ssd"
  | "gpu"
  | "psu"
  | "case"
  | "cooler_air"
  | "aio"
  | "fan"
  | "monitor"
  | "arm"
  | "desk"
  | "desk_frame"
  | "desk_top"
  | "chair"
  | "keyboard"
  | "mouse"
  | "mousepad"
  | "headset"
  | "microphone"
  | "webcam"
  | "light"
  | "speakers"
  | "acoustic_panel"
  | "cable_mgmt"
  | "ups"
  | "decor"
  | "os_license";
export type FeeGroup = "pc" | "mount" | "outside_scale";
export type Socket = "AM5" | "AM4" | "LGA1700" | "LGA1851";
export type RamType = "DDR4" | "DDR5";
export type BoardFF = "E-ATX" | "ATX" | "mATX" | "Mini-ITX";
export type PsuFF = "ATX" | "SFX" | "SFX-L";
export type Vesa = "75x75" | "100x100" | "200x100" | "200x200" | "300x300" | "400x400";

export interface CpuSpecs {
  socket: Socket;
  cores: number;
  threads: number;
  boostGhz: number;
  tdpW: number;
  maxPowerW: number;
  hasIgpu: boolean;
  memTypes: RamType[];
  memMaxMts: Partial<Record<RamType, number>>;
  boxCooler: boolean;
  chipsets: string[];
  minBiosByChipset?: Record<string, string>;
}
export interface M2Slot {
  id: string;
  pcieGen: 3 | 4 | 5;
  maxLenMm: 42 | 60 | 80 | 110;
  disablesSata: number[];
}
export interface BoardSpecs {
  socket: Socket;
  chipset: string;
  formFactor: BoardFF;
  ramType: RamType;
  ramSlots: 2 | 4;
  ramMaxGb: number;
  ramMaxMts: number;
  m2: M2Slot[];
  sataPorts: number;
  pcieX16Slots: number;
  fanHeaders: number;
  argb5vHeaders: number;
  rgb12vHeaders: number;
  wifi: boolean;
  bluetooth: boolean;
  biosFlashback: boolean;
  shippedBios?: string;
}
export interface RamSpecs {
  type: RamType;
  kitGb: number;
  modules: number;
  mts: number;
  cl: number;
  profile: "XMP" | "EXPO" | "both" | "none";
  heightMm: number;
  lighting: boolean;
}
export interface SsdSpecs {
  iface: "nvme" | "sata";
  formFactor: "M.2-2242" | "M.2-2260" | "M.2-2280" | "2.5";
  capacityGb: number;
  pcieGen?: 3 | 4 | 5;
  tbw: number;
  heatsinkHeightMm?: number;
}
export interface GpuSpecs {
  chip: string;
  vramGb: number;
  lengthMm: number;
  heightMm: number;
  slots: number;
  power: { conn: "6pin" | "8pin" | "12V-2x6"; count: number }[];
  adapterInBox: boolean;
  tgpW: number;
  vendorRecommendedPsuW: number;
  hwEncoders: string[];
}
export interface PsuSpecs {
  watts: number;
  rating: "none" | "bronze" | "gold" | "platinum" | "titanium";
  formFactor: PsuFF;
  lengthMm: number;
  modular: "no" | "semi" | "full";
  pcie8pin: number;
  native12v2x6: number;
  atx3: boolean;
}
export interface RadiatorMount {
  side: "front" | "top" | "rear" | "side" | "bottom";
  sizesMm: (120 | 140 | 240 | 280 | 360 | 420)[];
  maxThicknessMm?: number;
}
export interface CaseSpecs {
  boards: BoardFF[];
  gpuMaxLenMm: number;
  gpuMaxLenWithFrontRadMm: number;
  coolerMaxHeightMm: number;
  radiators: RadiatorMount[];
  psuFF: PsuFF[];
  psuMaxLenMm: number;
  expansionSlots: number;
  fanMounts: number;
  fansIncluded: number;
  dimsMm: { w: number; d: number; h: number };
}
export interface AirCoolerSpecs {
  sockets: Socket[];
  heightMm: number;
  ramClearanceMm: number;
  tdpRatedW: number;
}
export interface AioSpecs {
  sockets: Socket[];
  radMm: 240 | 280 | 360 | 420;
  radThicknessWithFansMm: number;
  tubeLenMm: number;
  pumpW: number;
}
export interface FanSpecs {
  sizeMm: 120 | 140;
  count: number;
  conn: "3pin" | "4pin";
  argb: boolean;
}
// Setup items (2D plan)
export interface MonitorSpecs {
  diagIn: number;
  aspect: "16:9" | "16:10" | "21:9" | "32:9";
  resolution: string;
  hz: number;
  panelWmm: number;
  panelHmm: number;
  depthWithStandMm: number;
  standFootprintMm: { w: number; d: number };
  weightNoStandKg: number;
  vesa?: Vesa;
  curved: boolean;
}
export interface ArmSpecs {
  reachMinMm: number;
  reachMaxMm: number;
  poleHeightMm: number;
  mount: "clamp" | "grommet" | "both";
  topThicknessMinMm: number;
  topThicknessMaxMm: number;
  vesa: Vesa[];
  loadMinKg: number;
  loadMaxKg: number;
  diagMinIn: number;
  diagMaxIn: number;
  screens: 1 | 2 | 3;
}
export interface DeskSpecs {
  topWmm: number;
  topDmm: number;
  heightMinMm: number;
  heightMaxMm: number;
  topThicknessMm: number;
  legZonesMm: { fromMm: number; toMm: number }[];
  cableCutout: boolean;
  loadKg: number;
  motors: 0 | 1 | 2;
}
export interface ChairSpecs {
  baseDiamMm: number;
  seatHeightMinMm: number;
  seatHeightMaxMm: number;
  rollbackZoneMm: number;
  userHeightCm: [number, number];
  userMaxKg: number;
}

/** Unknown value is `null` and yields a "check" (warn) with missingData, never "ok". */
export type Nullable<T> = { [K in keyof T]: T[K] | null };
type DetailedCategory =
  | "cpu"
  | "mb"
  | "ram"
  | "ssd"
  | "gpu"
  | "psu"
  | "case"
  | "cooler_air"
  | "aio"
  | "fan"
  | "monitor"
  | "arm"
  | "desk"
  | "chair";
export type ProductSpecs =
  | { category: "cpu"; spec: Nullable<CpuSpecs> }
  | { category: "mb"; spec: Nullable<BoardSpecs> }
  | { category: "ram"; spec: Nullable<RamSpecs> }
  | { category: "ssd"; spec: Nullable<SsdSpecs> }
  | { category: "gpu"; spec: Nullable<GpuSpecs> }
  | { category: "psu"; spec: Nullable<PsuSpecs> }
  | { category: "case"; spec: Nullable<CaseSpecs> }
  | { category: "cooler_air"; spec: Nullable<AirCoolerSpecs> }
  | { category: "aio"; spec: Nullable<AioSpecs> }
  | { category: "fan"; spec: Nullable<FanSpecs> }
  | { category: "monitor"; spec: Nullable<MonitorSpecs> }
  | { category: "arm"; spec: Nullable<ArmSpecs> }
  | { category: "desk"; spec: Nullable<DeskSpecs> }
  | { category: "chair"; spec: Nullable<ChairSpecs> }
  | { category: Exclude<CategoryCode, DetailedCategory>; spec: Record<string, unknown> };

export interface ProductBase {
  id: ProductId;
  category: CategoryCode;
  brand: string;
  model: string;
  mpn?: string;
  priceClassId?: string;
  ladderStep?: number;
  color: "black" | "white" | "gray" | "other";
  lighting: "none" | "rgb" | "argb";
  feeGroup: FeeGroup;
  returnable: boolean;
  manualOnly: boolean;
  status: "draft" | "verified" | "retired";
  isDemo: boolean;
}
export type Product = ProductBase & ProductSpecs;
export interface CatalogLookup {
  get(id: ProductId): Product | undefined;
  byCategory(c: CategoryCode): readonly Product[];
}
export interface BuildLine {
  productId: ProductId;
  qty: number;
  customerOwned?: boolean;
}
