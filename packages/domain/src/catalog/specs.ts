import type {
  AioSpecs,
  AirCoolerSpecs,
  ArmSpecs,
  BoardSpecs,
  CaseSpecs,
  ChairSpecs,
  CpuSpecs,
  DeskSpecs,
  FanSpecs,
  GpuSpecs,
  MonitorSpecs,
  Nullable,
  Product,
  PsuSpecs,
  RamSpecs,
  SsdSpecs,
} from "./types.ts";

/** Category code to its typed specification (the same forms as the zod schemas in `@nivel/contracts`). */
export interface SpecMap {
  cpu: CpuSpecs;
  mb: BoardSpecs;
  ram: RamSpecs;
  ssd: SsdSpecs;
  gpu: GpuSpecs;
  psu: PsuSpecs;
  case: CaseSpecs;
  cooler_air: AirCoolerSpecs;
  aio: AioSpecs;
  fan: FanSpecs;
  monitor: MonitorSpecs;
  arm: ArmSpecs;
  desk: DeskSpecs;
  chair: ChairSpecs;
}
export type DetailedCategory = keyof SpecMap;

/** Categories whose specs are typed; every other category carries a free-form record. */
export const DETAILED_CATEGORIES = [
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
  "chair",
] as const satisfies readonly DetailedCategory[];

/**
 * Typed spec of a product of the given category; `undefined` when the product belongs to another category.
 * Values stay `Nullable`: `null` means "unknown" and must never be read as a default.
 */
export function specOf<C extends DetailedCategory>(product: Product, category: C): Nullable<SpecMap[C]> | undefined {
  if (product.category !== category) return undefined;
  return product.spec as Nullable<SpecMap[C]>;
}
