import type { ProductId } from "@nivel/domain/catalog";
import { computeQuote, DEFAULT_FEE_SETTINGS } from "@nivel/domain/fee";
import { sum } from "@nivel/domain/money";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../orders/errors.ts";
import { quoteColumns, readStoredTotals, serializeTotals } from "./stored.ts";

const NOW = new Date("2026-10-12T05:00:00Z");
const totals = computeQuote(
  [
    {
      key: "a",
      productId: "p-1" as ProductId,
      group: "pc",
      qty: 1,
      unitSum: sum(10_000_000),
      isRamOrSsd: false,
      isFurnitureLike: false,
      customerOwned: false,
      purchasedByIp: true,
    },
  ],
  DEFAULT_FEE_SETTINGS,
  { now: NOW, kind: "pc", complexBuild: false, freeWindowAvailable: false, confirmed: true },
);

describe("stored quote totals", () => {
  it("maps the totals of the domain to the columns of the quote", () => {
    const c = quoteColumns(totals);
    expect(c.componentsSum).toBe(10_000_000);
    expect(c.feeTotal).toBe(1_500_000);
    expect(c.feeAdvance + c.feeFinal).toBe(c.feeTotal);
    expect(c.feeCommissionLine + c.feeWorksLine).toBe(c.feeTotal);
    expect(c.purchaseLimit).toBe(10_300_000);
    expect(c.reserveSum).toBe(300_000);
    expect(c.validUntil).toEqual(new Date("2026-10-13T05:00:00Z"));
  });

  it("writes JSON that comes back as the eligibility, the verdict and the shelf life", () => {
    const json = serializeTotals(totals, { compatVerdict: "warn", shelfLifeHours: 24, quoteKind: "pc" });
    const back = readStoredTotals(JSON.parse(JSON.stringify(json)));
    expect(back.compatVerdict).toBe("warn");
    expect(back.shelfLifeHours).toBe(24);
    expect(back.eligibility).toEqual({ mode: "full_cycle" });
    expect(back.totals.fee.total).toBe(1_500_000);
  });

  it("keeps the dates of the totals as ISO text", () => {
    const json = serializeTotals(totals, { compatVerdict: "ok", shelfLifeHours: 24, quoteKind: "pc" });
    expect((json.totals as { validUntil: string }).validUntil).toBe("2026-10-13T05:00:00.000Z");
  });

  it.each([
    null,
    "x",
    {},
    { totals: {} },
    { compatVerdict: "ok", shelfLifeHours: 24, totals: { eligibility: { mode: "teleport" } } },
  ])("refuses broken stored totals: %j", (bad) => {
    expect(() => readStoredTotals(bad)).toThrow(ConfigError);
  });

  it("refuses an unknown verdict", () => {
    const json = serializeTotals(totals, { compatVerdict: "ok", shelfLifeHours: 24, quoteKind: "pc" });
    expect(() => readStoredTotals({ ...json, compatVerdict: "great" })).toThrow(ConfigError);
  });
});
