import { MAX_LINE_QTY, MAX_LINES } from "@nivel/domain/compat";
import { describe, expect, it } from "vitest";
import { BuildLinesSchema } from "./index.ts";

const line = (productId: string, qty = 1) => ({ productId, qty });

describe("BuildLinesSchema (server-side lines of a build)", () => {
  it("accepts an ordinary build", () => {
    const lines = [line("cpu-1"), line("ram-1", 2), { productId: "ssd-1", qty: 1, customerOwned: true }];
    expect(BuildLinesSchema.parse(lines)).toEqual(lines);
  });

  it("accepts an empty list: the caller decides whether an empty build is a quote", () => {
    expect(BuildLinesSchema.parse([])).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_LINE_QTY + 1])("rejects quantity %s of one line", (qty) => {
    expect(BuildLinesSchema.safeParse([line("ram-1", qty)]).success).toBe(false);
  });

  it("accepts a quantity of exactly MAX_LINE_QTY", () => {
    expect(BuildLinesSchema.safeParse([line("fan-1", MAX_LINE_QTY)]).success).toBe(true);
  });

  it("limits the quantity of a product after the lines of the same product are merged", () => {
    const r = BuildLinesSchema.safeParse([line("fan-1", 60), line("fan-1", 40)]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain(String(MAX_LINE_QTY));
  });

  it("allows many different products up to MAX_LINES and refuses one more", () => {
    const ok = Array.from({ length: MAX_LINES }, (_, i) => line(`p-${i}`));
    expect(BuildLinesSchema.safeParse(ok).success).toBe(true);
    expect(BuildLinesSchema.safeParse([...ok, line("one-more")]).success).toBe(false);
  });

  it("counts lines, not distinct products, against MAX_LINES", () => {
    const same = Array.from({ length: MAX_LINES + 1 }, () => line("fan-1"));
    expect(BuildLinesSchema.safeParse(same).success).toBe(false);
  });

  it("rejects unknown keys such as a price sent by the client", () => {
    expect(BuildLinesSchema.safeParse([{ productId: "cpu-1", qty: 1, unitSum: 1 }]).success).toBe(false);
  });

  it("rejects an empty product id", () => {
    expect(BuildLinesSchema.safeParse([line("", 1)]).success).toBe(false);
  });
});
