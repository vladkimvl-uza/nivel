// Frozen contract (ARCHITECTURE 4.4). Change only via ADR and a "contract" PR.
import type { BuildLine, CatalogLookup, CategoryCode, Product, ProductId } from "../catalog/types.ts";
import type { Bp } from "../money/types.ts";

export type Severity = "block" | "warn"; // «нельзя» / «проверьте»
export type Task = "gaming" | "streaming" | "design3d" | "programming" | "office";
export type RuleId =
  | "CPU_MB_SOCKET"
  | "CPU_MB_CHIPSET"
  | "CPU_MB_BIOS"
  | "CPU_NO_VIDEO"
  | "MEM_TYPE"
  | "MEM_SLOTS"
  | "MEM_CAPACITY"
  | "MEM_SPEED"
  | "MEM_COOLER_CLEARANCE"
  | "MB_CASE_FORMFACTOR"
  | "GPU_CASE_LENGTH"
  | "GPU_SLOT_WIDTH"
  | "COOLER_SOCKET"
  | "COOLER_CASE_HEIGHT"
  | "COOLER_TDP"
  | "AIO_RADIATOR_MOUNT"
  | "AIO_RADIATOR_THICKNESS"
  | "PSU_WATTAGE"
  | "PSU_GPU_CONNECTORS"
  | "PSU_CASE_FORMFACTOR"
  | "PSU_CASE_LENGTH"
  | "M2_SLOTS"
  | "M2_LENGTH"
  | "M2_SATA_SHARING"
  | "SATA_PORTS"
  | "ARGB_HEADERS"
  | "FAN_HEADERS"
  | "WIFI_FOR_TASK"
  | "DESK_DEPTH_EYES"
  | "DESK_WIDTH_MONITORS"
  | "ARM_VESA"
  | "ARM_LOAD"
  | "ARM_DIAGONAL"
  | "ARM_DESK_THICKNESS"
  | "ARM_CLAMP_ZONE"
  | "CHAIR_ROLLBACK"
  | "CHAIR_USER_HEIGHT";

export interface CompatIssue {
  ruleId: RuleId;
  severity: Severity;
  productIds: ProductId[];
  messageKey: string; // "compat.gpu_too_long"
  params: Record<string, string | number>; // { gpuMm: 340, caseMm: 330 }
  fix?: { category: CategoryCode; filter: Record<string, string | number | boolean> };
}
export interface PowerEstimate {
  peakW: number;
  recommendedPsuW: number;
  selectedPsuW?: number;
  /**
   * Headroom of the selected PSU over the peak: (selectedPsuW - peakW) / peakW in bp, floored, 0 when the PSU is below
   * the peak, capped at 10 000 (a PSU of twice the peak or more). Absent without a PSU or with no peak (ADR-007, item 7).
   */
  headroomBp?: Bp;
}
export interface CompatResult {
  verdict: "ok" | "warn" | "block" | "incomplete";
  issues: CompatIssue[];
  power: PowerEstimate;
  checkedRules: RuleId[];
  missingData: { productId: ProductId; field: string }[];
}
export interface CompatSettings {
  gpuLenWarnMarginMm: number; // 10
  coolerHeightWarnMarginMm: number; // 5
  psuMultiplier: number; // 1.3
  psuHeadroomWarnBp: Bp; // 3000
  psuSeriesW: number[]; // [550, 650, 750, 850, 1000, 1200]
  baseW: number;
  perFanW: number;
  pumpW: number; // 50, 5, 15
  rollbackZoneMm: number; // 750 (600–900)
  eyeDistanceMm: [number, number]; // [500, 760]
  standDepthMm: [number, number]; // [150, 250]
}
export interface SetupPlan {
  room: { widthMm: number; depthMm: number; window?: "left" | "right" | "back"; userHeightCm?: number };
  lines: BuildLine[];
  placement?: Record<string, { xMm: number; yMm: number }>;
}
export type Rule = (b: ResolvedBuild, ctx: { tasks: Task[]; settings: CompatSettings }) => CompatIssue[];
export interface ResolvedBuild {
  byCategory: Partial<Record<CategoryCode, { product: Product; qty: number }[]>>;
}

export interface CompatApi {
  checkCompatibility(
    lines: BuildLine[],
    catalog: CatalogLookup,
    ctx: { tasks: Task[]; settings: CompatSettings },
  ): CompatResult;
  checkSetup(plan: SetupPlan, catalog: CatalogLookup, s: CompatSettings): CompatResult;
  estimatePower(lines: BuildLine[], catalog: CatalogLookup, s: CompatSettings): PowerEstimate;
}
