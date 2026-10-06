// configs.save (BUILD_PLAN WP-07, ARCHITECTURE 3.3, 5.3): a build put together on the site or in the bot is saved under a code
// of eight characters, with the quote and the verdict of compatibility that the SERVER calculated from its own prices;
// whatever sums the client has are not looked at. A saved configuration never changes: a changed one is saved again
// and names its parent.
import { sales } from "@nivel/db/repos";
import type { BuildLine } from "@nivel/domain/catalog";
import type { Task } from "@nivel/domain/compat";
import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { ValidationError } from "../orders/errors.ts";
import { freeWindowAvailable } from "../orders/load.ts";
import { can, type Runtime, runtimeOf } from "../orders/runtime.ts";
import { loadFeeSettings } from "../orders/settings.ts";
import { assertUuid } from "../orders/validate.ts";
import { computeQuoteFor } from "../quotes/compute.ts";
import { serializeTotals } from "../quotes/stored.ts";

export const ENGINE_VERSION = "domain-2026-10";
const SOURCES = ["web", "tma", "bot", "ai", "admin", "idea"] as const;
const KINDS = ["pc", "setup"] as const;
const CODE_ATTEMPTS = 3;

export interface SaveConfigInput {
  kind: (typeof KINDS)[number];
  lines: BuildLine[];
  tasks?: Task[];
  createdVia: (typeof SOURCES)[number];
  customerId?: string;
  parentId?: string;
  /** The budget the client named, whole sums up to MAX_BUDGET_SUM (`partsBudgetFromTotal` throws above it). */
  budgetSum?: number;
  room?: Record<string, unknown>;
  prefs?: Record<string, unknown>;
}

export interface SavedConfig {
  id: string;
  publicCode: string;
  quote: {
    componentsSum: number;
    outsideScaleSum: number;
    reserveSum: number;
    purchaseLimit: number;
    feeTotal: number;
    advance: number;
    final: number;
    grandTotal: number;
    eligibility: { mode: string } & Record<string, unknown>;
    warnings: { key: string; params?: Record<string, string | number> }[];
  };
  compat: { verdict: string; issues: unknown[]; missingData: unknown[] };
}

export async function save(input: SaveConfigInput, rt?: Runtime): Promise<SavedConfig> {
  const r = runtimeOf(rt);
  if (!KINDS.includes(input.kind)) throw ValidationError.of("kind", "kind_unknown", "kind must be pc or setup");
  if (!SOURCES.includes(input.createdVia)) {
    throw ValidationError.of("createdVia", "source_unknown", `createdVia must be one of ${SOURCES.join(", ")}`);
  }
  if (
    input.budgetSum !== undefined &&
    (!Number.isSafeInteger(input.budgetSum) || input.budgetSum < 0 || input.budgetSum > MAX_BUDGET_SUM)
  ) {
    throw ValidationError.of(
      "budgetSum",
      "sum_invalid",
      `budgetSum must be a whole number of sums from 0 to ${MAX_BUDGET_SUM}`,
    );
  }
  const customerId = input.customerId === undefined ? undefined : assertUuid(input.customerId, "customerId");
  const parentId = input.parentId === undefined ? undefined : assertUuid(input.parentId, "parentId");

  const settings = await loadFeeSettings(r.db);
  const computed = await computeQuoteFor(r.db, {
    lines: input.lines,
    ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
    kind: input.kind,
    // The site cannot read the load of the workshop: it promises no free window.
    freeWindowAvailable: can(r, "orders.read") ? await freeWindowAvailable(r.db, settings) : false,
    now: r.now(),
  });

  if (customerId !== undefined) {
    const known = await r.db.query.customers.findFirst({
      columns: { id: true },
      where: (t, { eq }) => eq(t.id, customerId),
    });
    if (!known) throw ValidationError.of("customerId", "customer_unknown", "the customer does not exist");
  }
  if (parentId !== undefined) {
    const parent = await r.db.query.configurations.findFirst({
      columns: { id: true },
      where: (t, { eq }) => eq(t.id, parentId),
    });
    if (!parent)
      throw ValidationError.of("parentId", "parent_unknown", "the configuration it was changed from does not exist");
  }

  const items: BuildLine[] = input.lines.map((l) => ({
    productId: l.productId,
    qty: l.qty,
    ...(l.customerOwned === undefined ? {} : { customerOwned: l.customerOwned }),
  }));
  const compat = computed.compat
    ? {
        verdict: computed.compat.verdict,
        issues: computed.compat.issues,
        missingData: computed.compat.missingData,
        power: computed.compat.power,
      }
    : { verdict: computed.compatVerdict, issues: [], missingData: [] };
  const prefs = {
    ...(input.prefs ?? {}),
    ...(input.budgetSum === undefined ? {} : { budgetSum: input.budgetSum }),
    ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
  };

  const t = computed.totals;
  const saved = await insertWithCode(r, {
    kind: input.kind,
    parentId: parentId ?? null,
    items,
    room: input.room ?? null,
    prefs: Object.keys(prefs).length > 0 ? prefs : null,
    engineVersion: ENGINE_VERSION,
    ruleSetVersion: computed.ruleSetVersion,
    priceSnapshot: computed.priceSnapshot,
    quote: serializeTotals(t, {
      compatVerdict: computed.compatVerdict,
      shelfLifeHours: computed.shelfLifeHours,
      quoteKind: input.kind,
    }),
    compat: JSON.parse(JSON.stringify(compat)) as Record<string, unknown>,
    createdVia: input.createdVia,
    customerId: customerId ?? null,
  });
  return {
    id: saved.id,
    publicCode: saved.publicCode,
    quote: {
      componentsSum: t.componentsSum,
      outsideScaleSum: t.outsideScaleSum,
      reserveSum: t.reserveSum,
      purchaseLimit: t.purchaseLimit,
      feeTotal: t.fee.total,
      advance: t.advance,
      final: t.final,
      grandTotal: t.grandTotal,
      eligibility: t.eligibility as SavedConfig["quote"]["eligibility"],
      warnings: t.warnings,
    },
    compat: compat as SavedConfig["compat"],
  };
}

/** 40 random bits make a collision very unlikely; the unique index is the judge, so a second code is tried. */
async function insertWithCode(rt: Runtime, row: Parameters<typeof sales.saveConfiguration>[1]) {
  let last: unknown;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    try {
      return await sales.saveConfiguration(rt.db, { ...row, publicCode: sales.newPublicCode() });
    } catch (e) {
      last = e;
      if ((e as { code?: string } | null)?.code !== "unique_violation") throw e;
    }
  }
  throw last;
}
