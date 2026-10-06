// zod schemas of the catalog specifications (ARCHITECTURE 4.3): the same forms as the frozen types in
// `@nivel/domain/catalog`; the admin builds its forms from them, so the owner never edits JSON.
//
// Two flavours per category:
// - SPEC_SCHEMAS: a complete spec, no `null` (what is required to publish a position);
// - NULLABLE_SPEC_SCHEMAS (and ProductSpecsSchema): every value may be `null` = "unknown" (a draft). Keys are required,
//   as in `Nullable<T>`; an optional field of the type may also be absent.
//
// Conventions (ARCHITECTURE 4.4): an absent optional field means "not applicable / no constraint", `null` means
// "unknown" and makes compatibility rules answer "incomplete".
import type {
  AioSpecs,
  AirCoolerSpecs,
  ArmSpecs,
  BoardFF,
  BoardSpecs,
  CaseSpecs,
  CategoryCode,
  ChairSpecs,
  CpuSpecs,
  DeskSpecs,
  DetailedCategory,
  FanSpecs,
  FeeGroup,
  GpuSpecs,
  M2Slot,
  MonitorSpecs,
  Nullable,
  Product,
  ProductBase,
  ProductId,
  ProductSpecs,
  PsuFF,
  PsuSpecs,
  RadiatorMount,
  RamSpecs,
  RamType,
  Socket,
  SpecMap,
  SsdSpecs,
  Vesa,
} from "@nivel/domain/catalog";
import { z } from "zod";

// --- enumerations ---------------------------------------------------------------------------------------------

export const SocketSchema = z.enum(["AM5", "AM4", "LGA1700", "LGA1851"]) satisfies z.ZodType<Socket>;
export const RamTypeSchema = z.enum(["DDR4", "DDR5"]) satisfies z.ZodType<RamType>;
export const BoardFFSchema = z.enum(["E-ATX", "ATX", "mATX", "Mini-ITX"]) satisfies z.ZodType<BoardFF>;
export const PsuFFSchema = z.enum(["ATX", "SFX", "SFX-L"]) satisfies z.ZodType<PsuFF>;
export const VesaSchema = z.enum([
  "75x75",
  "100x100",
  "200x100",
  "200x200",
  "300x300",
  "400x400",
]) satisfies z.ZodType<Vesa>;
export const FeeGroupSchema = z.enum(["pc", "mount", "outside_scale"]) satisfies z.ZodType<FeeGroup>;
export const CategoryCodeSchema = z.enum([
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
  "desk_frame",
  "desk_top",
  "chair",
  "keyboard",
  "mouse",
  "mousepad",
  "headset",
  "microphone",
  "webcam",
  "light",
  "speakers",
  "acoustic_panel",
  "cable_mgmt",
  "ups",
  "decor",
  "os_license",
]) satisfies z.ZodType<CategoryCode>;

// --- numbers --------------------------------------------------------------------------------------------------

const posInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();
const posNum = z.number().positive();
const nonNegNum = z.number().nonnegative();
const pcieGen = z.union([z.literal(3), z.literal(4), z.literal(5)]);
const text = z.string().min(1);

/** All values may be `null` (unknown); a key that is optional in the complete shape stays optional. */
type NullableShape<S extends Record<string, z.ZodType>> = { [K in keyof S]: z.ZodNullable<S[K]> };
function nullableShape<S extends Record<string, z.ZodType>>(shape: S): NullableShape<S> {
  return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.nullable()])) as NullableShape<S>;
}

// --- shapes ---------------------------------------------------------------------------------------------------

const cpuShape = {
  socket: SocketSchema,
  cores: posInt,
  threads: posInt,
  boostGhz: posNum,
  tdpW: posInt,
  maxPowerW: posInt,
  hasIgpu: z.boolean(),
  memTypes: z.array(RamTypeSchema).min(1),
  memMaxMts: z.partialRecord(RamTypeSchema, posInt),
  boxCooler: z.boolean(),
  chipsets: z.array(text).min(1),
  minBiosByChipset: z.record(z.string(), text).exactOptional(),
};

export const M2SlotSchema = z.strictObject({
  id: text,
  pcieGen,
  maxLenMm: z.union([z.literal(42), z.literal(60), z.literal(80), z.literal(110)]),
  disablesSata: z.array(posInt),
}) satisfies z.ZodType<M2Slot>;

const boardShape = {
  socket: SocketSchema,
  chipset: text,
  formFactor: BoardFFSchema,
  ramType: RamTypeSchema,
  ramSlots: z.union([z.literal(2), z.literal(4)]),
  ramMaxGb: posInt,
  ramMaxMts: posInt,
  m2: z.array(M2SlotSchema),
  sataPorts: nonNegInt,
  pcieX16Slots: nonNegInt,
  fanHeaders: nonNegInt,
  argb5vHeaders: nonNegInt,
  rgb12vHeaders: nonNegInt,
  wifi: z.boolean(),
  bluetooth: z.boolean(),
  biosFlashback: z.boolean(),
  shippedBios: text.exactOptional(),
};

const ramShape = {
  type: RamTypeSchema,
  kitGb: posInt,
  modules: posInt,
  mts: posInt,
  cl: posInt,
  profile: z.enum(["XMP", "EXPO", "both", "none"]),
  heightMm: posInt,
  lighting: z.boolean(),
};

const ssdShape = {
  iface: z.enum(["nvme", "sata"]),
  formFactor: z.enum(["M.2-2242", "M.2-2260", "M.2-2280", "2.5"]),
  capacityGb: posInt,
  pcieGen: pcieGen.exactOptional(),
  tbw: nonNegInt,
  heatsinkHeightMm: posInt.exactOptional(),
};

const gpuShape = {
  chip: text,
  vramGb: posInt,
  lengthMm: posInt,
  heightMm: posInt,
  slots: posNum,
  power: z.array(z.strictObject({ conn: z.enum(["6pin", "8pin", "12V-2x6"]), count: posInt })),
  adapterInBox: z.boolean(),
  tgpW: posInt,
  vendorRecommendedPsuW: posInt,
  hwEncoders: z.array(text),
};

const psuShape = {
  watts: posInt,
  rating: z.enum(["none", "bronze", "gold", "platinum", "titanium"]),
  formFactor: PsuFFSchema,
  lengthMm: posInt,
  modular: z.enum(["no", "semi", "full"]),
  pcie8pin: nonNegInt,
  native12v2x6: nonNegInt,
  atx3: z.boolean(),
};

export const RadiatorMountSchema = z.strictObject({
  side: z.enum(["front", "top", "rear", "side", "bottom"]),
  sizesMm: z
    .array(z.union([z.literal(120), z.literal(140), z.literal(240), z.literal(280), z.literal(360), z.literal(420)]))
    .min(1),
  maxThicknessMm: posInt.exactOptional(),
}) satisfies z.ZodType<RadiatorMount>;

const caseShape = {
  boards: z.array(BoardFFSchema).min(1),
  gpuMaxLenMm: posInt,
  gpuMaxLenWithFrontRadMm: posInt,
  coolerMaxHeightMm: posInt,
  radiators: z.array(RadiatorMountSchema),
  psuFF: z.array(PsuFFSchema).min(1),
  psuMaxLenMm: posInt,
  expansionSlots: posInt,
  fanMounts: nonNegInt,
  fansIncluded: nonNegInt,
  dimsMm: z.strictObject({ w: posInt, d: posInt, h: posInt }),
};

const airCoolerShape = {
  sockets: z.array(SocketSchema).min(1),
  heightMm: posInt,
  ramClearanceMm: nonNegInt,
  tdpRatedW: posInt,
};

const aioShape = {
  sockets: z.array(SocketSchema).min(1),
  radMm: z.union([z.literal(240), z.literal(280), z.literal(360), z.literal(420)]),
  radThicknessWithFansMm: posInt,
  tubeLenMm: posInt,
  pumpW: posInt,
};

const fanShape = {
  sizeMm: z.union([z.literal(120), z.literal(140)]),
  count: posInt,
  conn: z.enum(["3pin", "4pin"]),
  argb: z.boolean(),
};

const monitorShape = {
  diagIn: posNum,
  aspect: z.enum(["16:9", "16:10", "21:9", "32:9"]),
  resolution: z.string().regex(/^\d{3,5}x\d{3,5}$/),
  hz: posInt,
  panelWmm: posInt,
  panelHmm: posInt,
  depthWithStandMm: posInt,
  standFootprintMm: z.strictObject({ w: posInt, d: posInt }),
  weightNoStandKg: posNum,
  vesa: VesaSchema.exactOptional(),
  curved: z.boolean(),
};

const armShape = {
  reachMinMm: posInt,
  reachMaxMm: posInt,
  poleHeightMm: posInt,
  mount: z.enum(["clamp", "grommet", "both"]),
  topThicknessMinMm: posInt,
  topThicknessMaxMm: posInt,
  vesa: z.array(VesaSchema).min(1),
  loadMinKg: nonNegNum,
  loadMaxKg: posNum,
  diagMinIn: posNum,
  diagMaxIn: posNum,
  screens: z.union([z.literal(1), z.literal(2), z.literal(3)]),
};

const deskShape = {
  topWmm: posInt,
  topDmm: posInt,
  heightMinMm: posInt,
  heightMaxMm: posInt,
  topThicknessMm: posInt,
  legZonesMm: z.array(
    z.strictObject({ fromMm: nonNegInt, toMm: nonNegInt }).refine((z0) => z0.fromMm <= z0.toMm, {
      error: "fromMm must not be greater than toMm",
    }),
  ),
  cableCutout: z.boolean(),
  loadKg: posNum,
  motors: z.union([z.literal(0), z.literal(1), z.literal(2)]),
};

const chairShape = {
  baseDiamMm: posInt,
  seatHeightMinMm: posInt,
  seatHeightMaxMm: posInt,
  rollbackZoneMm: posInt,
  userHeightCm: z.tuple([posInt, posInt]),
  userMaxKg: posInt,
};

// --- complete specs (with consistency checks) -----------------------------------------------------------------

export const CpuSpecsSchema = z
  .strictObject(cpuShape)
  .refine((s) => s.threads >= s.cores, { error: "threads must not be fewer than cores", path: ["threads"] })
  .refine((s) => s.maxPowerW >= s.tdpW, {
    error: "maxPowerW must not be below tdpW",
    path: ["maxPowerW"],
  }) satisfies z.ZodType<CpuSpecs>;
export const BoardSpecsSchema = z.strictObject(boardShape) satisfies z.ZodType<BoardSpecs>;
export const RamSpecsSchema = z.strictObject(ramShape) satisfies z.ZodType<RamSpecs>;
export const SsdSpecsSchema = z
  .strictObject(ssdShape)
  .refine((s) => s.iface !== "nvme" || s.formFactor.startsWith("M.2"), {
    error: "an NVMe drive is an M.2 drive",
    path: ["formFactor"],
  }) satisfies z.ZodType<SsdSpecs>;
export const GpuSpecsSchema = z.strictObject(gpuShape) satisfies z.ZodType<GpuSpecs>;
export const PsuSpecsSchema = z.strictObject(psuShape) satisfies z.ZodType<PsuSpecs>;
export const CaseSpecsSchema = z.strictObject(caseShape).refine((s) => s.gpuMaxLenWithFrontRadMm <= s.gpuMaxLenMm, {
  error: "the limit with a front radiator must not exceed the ordinary limit",
  path: ["gpuMaxLenWithFrontRadMm"],
}) satisfies z.ZodType<CaseSpecs>;
export const AirCoolerSpecsSchema = z.strictObject(airCoolerShape) satisfies z.ZodType<AirCoolerSpecs>;
export const AioSpecsSchema = z.strictObject(aioShape) satisfies z.ZodType<AioSpecs>;
export const FanSpecsSchema = z.strictObject(fanShape) satisfies z.ZodType<FanSpecs>;
export const MonitorSpecsSchema = z.strictObject(monitorShape) satisfies z.ZodType<MonitorSpecs>;
export const ArmSpecsSchema = z
  .strictObject(armShape)
  .refine((s) => s.reachMinMm <= s.reachMaxMm, { error: "reachMinMm must not exceed reachMaxMm", path: ["reachMinMm"] })
  .refine((s) => s.topThicknessMinMm <= s.topThicknessMaxMm, {
    error: "topThicknessMinMm must not exceed topThicknessMaxMm",
    path: ["topThicknessMinMm"],
  })
  .refine((s) => s.loadMinKg <= s.loadMaxKg, { error: "loadMinKg must not exceed loadMaxKg", path: ["loadMinKg"] })
  .refine((s) => s.diagMinIn <= s.diagMaxIn, {
    error: "diagMinIn must not exceed diagMaxIn",
    path: ["diagMinIn"],
  }) satisfies z.ZodType<ArmSpecs>;
export const DeskSpecsSchema = z.strictObject(deskShape).refine((s) => s.heightMinMm <= s.heightMaxMm, {
  error: "heightMinMm must not exceed heightMaxMm",
  path: ["heightMinMm"],
}) satisfies z.ZodType<DeskSpecs>;
export const ChairSpecsSchema = z
  .strictObject(chairShape)
  .refine((s) => s.seatHeightMinMm <= s.seatHeightMaxMm, {
    error: "seatHeightMinMm must not exceed seatHeightMaxMm",
    path: ["seatHeightMinMm"],
  })
  .refine((s) => s.userHeightCm[0] <= s.userHeightCm[1], {
    error: "the lower user height must not exceed the upper",
    path: ["userHeightCm"],
  }) satisfies z.ZodType<ChairSpecs>;

export const SPEC_SCHEMAS = {
  cpu: CpuSpecsSchema,
  mb: BoardSpecsSchema,
  ram: RamSpecsSchema,
  ssd: SsdSpecsSchema,
  gpu: GpuSpecsSchema,
  psu: PsuSpecsSchema,
  case: CaseSpecsSchema,
  cooler_air: AirCoolerSpecsSchema,
  aio: AioSpecsSchema,
  fan: FanSpecsSchema,
  monitor: MonitorSpecsSchema,
  arm: ArmSpecsSchema,
  desk: DeskSpecsSchema,
  chair: ChairSpecsSchema,
} satisfies { [C in DetailedCategory]: z.ZodType<SpecMap[C]> };

// --- draft specs: `null` = unknown ----------------------------------------------------------------------------

const nullable = <S extends Record<string, z.ZodType>>(shape: S) => z.strictObject(nullableShape(shape));

export const NULLABLE_SPEC_SCHEMAS = {
  cpu: nullable(cpuShape) satisfies z.ZodType<Nullable<CpuSpecs>>,
  mb: nullable(boardShape) satisfies z.ZodType<Nullable<BoardSpecs>>,
  ram: nullable(ramShape) satisfies z.ZodType<Nullable<RamSpecs>>,
  ssd: nullable(ssdShape) satisfies z.ZodType<Nullable<SsdSpecs>>,
  gpu: nullable(gpuShape) satisfies z.ZodType<Nullable<GpuSpecs>>,
  psu: nullable(psuShape) satisfies z.ZodType<Nullable<PsuSpecs>>,
  case: nullable(caseShape) satisfies z.ZodType<Nullable<CaseSpecs>>,
  cooler_air: nullable(airCoolerShape) satisfies z.ZodType<Nullable<AirCoolerSpecs>>,
  aio: nullable(aioShape) satisfies z.ZodType<Nullable<AioSpecs>>,
  fan: nullable(fanShape) satisfies z.ZodType<Nullable<FanSpecs>>,
  monitor: nullable(monitorShape) satisfies z.ZodType<Nullable<MonitorSpecs>>,
  arm: nullable(armShape) satisfies z.ZodType<Nullable<ArmSpecs>>,
  desk: nullable(deskShape) satisfies z.ZodType<Nullable<DeskSpecs>>,
  chair: nullable(chairShape) satisfies z.ZodType<Nullable<ChairSpecs>>,
};

export const SPEC_CATEGORIES = Object.keys(SPEC_SCHEMAS) as DetailedCategory[];

/** Complete-spec schema of a category with typed specs. */
export function specSchemaFor<C extends DetailedCategory>(category: C): (typeof SPEC_SCHEMAS)[C] {
  return SPEC_SCHEMAS[category];
}

// --- products -------------------------------------------------------------------------------------------------

/** Categories whose spec is a free-form record (ARCHITECTURE 4.3). */
const GENERIC_CATEGORIES = [
  "desk_frame",
  "desk_top",
  "keyboard",
  "mouse",
  "mousepad",
  "headset",
  "microphone",
  "webcam",
  "light",
  "speakers",
  "acoustic_panel",
  "cable_mgmt",
  "ups",
  "decor",
  "os_license",
] as const satisfies readonly Exclude<CategoryCode, DetailedCategory>[];
// Compile-time exhaustiveness: every category without a typed spec is listed above.
const _allGenericListed: Exclude<
  Exclude<CategoryCode, DetailedCategory>,
  (typeof GENERIC_CATEGORIES)[number]
> extends never
  ? true
  : never = true;
void _allGenericListed;

const specArm = <C extends DetailedCategory>(category: C, spec: (typeof NULLABLE_SPEC_SCHEMAS)[C]) =>
  z.object({ category: z.literal(category), spec });

export const ProductSpecsSchema = z.discriminatedUnion("category", [
  specArm("cpu", NULLABLE_SPEC_SCHEMAS.cpu),
  specArm("mb", NULLABLE_SPEC_SCHEMAS.mb),
  specArm("ram", NULLABLE_SPEC_SCHEMAS.ram),
  specArm("ssd", NULLABLE_SPEC_SCHEMAS.ssd),
  specArm("gpu", NULLABLE_SPEC_SCHEMAS.gpu),
  specArm("psu", NULLABLE_SPEC_SCHEMAS.psu),
  specArm("case", NULLABLE_SPEC_SCHEMAS.case),
  specArm("cooler_air", NULLABLE_SPEC_SCHEMAS.cooler_air),
  specArm("aio", NULLABLE_SPEC_SCHEMAS.aio),
  specArm("fan", NULLABLE_SPEC_SCHEMAS.fan),
  specArm("monitor", NULLABLE_SPEC_SCHEMAS.monitor),
  specArm("arm", NULLABLE_SPEC_SCHEMAS.arm),
  specArm("desk", NULLABLE_SPEC_SCHEMAS.desk),
  specArm("chair", NULLABLE_SPEC_SCHEMAS.chair),
  z.object({ category: z.enum(GENERIC_CATEGORIES), spec: z.record(z.string(), z.unknown()) }),
]) satisfies z.ZodType<ProductSpecs>;

export const ProductIdSchema = z.custom<ProductId>((v) => typeof v === "string" && v.length > 0, {
  error: "product id must be a non-empty string",
});

export const ProductBaseSchema = z.object({
  id: ProductIdSchema,
  category: CategoryCodeSchema,
  brand: text,
  model: text,
  mpn: text.exactOptional(),
  priceClassId: text.exactOptional(),
  ladderStep: z.number().int().nonnegative().exactOptional(),
  color: z.enum(["black", "white", "gray", "other"]),
  lighting: z.enum(["none", "rgb", "argb"]),
  feeGroup: FeeGroupSchema,
  returnable: z.boolean(),
  manualOnly: z.boolean(),
  status: z.enum(["draft", "verified", "retired"]),
  isDemo: z.boolean(),
}) satisfies z.ZodType<ProductBase>;

/** Base fields plus the spec of the product category; the category of the spec must match. */
export const ProductSchema = ProductBaseSchema.omit({ category: true }).and(
  ProductSpecsSchema,
) satisfies z.ZodType<Product>;
