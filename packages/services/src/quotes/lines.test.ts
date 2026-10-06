import { readFileSync } from "node:fs";
import {
  type CatalogLookup,
  type CategoryCode,
  createCatalogLookup,
  type Product,
  type ProductId,
} from "@nivel/domain/catalog";
import { MAX_LINE_QTY, MAX_LINES } from "@nivel/domain/compat";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../orders/errors.ts";
import { normalizeBuildLines } from "./lines.ts";

const specs = JSON.parse(
  readFileSync(new URL("../../../testing/fixtures/wp-03/default-specs.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>>;

const pid = (s: string) => s as ProductId;
const product = (id: string, category: CategoryCode): Product =>
  ({
    id: pid(id),
    category,
    brand: "T",
    model: id,
    color: "black",
    lighting: "none",
    feeGroup: "pc",
    returnable: true,
    manualOnly: false,
    status: "verified",
    isDemo: false,
    spec: specs[category] ?? {},
  }) as unknown as Product;

const lookup: CatalogLookup = createCatalogLookup([
  product("cpu-1", "cpu"),
  product("cpu-2", "cpu"),
  product("mb-1", "mb"),
  product("mb-2", "mb"),
  product("case-1", "case"),
  product("psu-1", "psu"),
  product("psu-2", "psu"),
  product("ram-1", "ram"),
  product("ssd-1", "ssd"),
  product("fan-1", "fan"),
]);

const line = (productId: string, qty = 1, customerOwned?: boolean) => ({
  productId: pid(productId),
  qty,
  ...(customerOwned === undefined ? {} : { customerOwned }),
});

function issuesOf(fn: () => unknown): { path: string; code: string }[] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).issues.map((i) => ({ path: i.path, code: i.code }));
  }
  throw new Error("expected a ValidationError");
}

describe("normalizeBuildLines", () => {
  it("merges the lines of one product and keeps the order of first appearance", () => {
    const out = normalizeBuildLines([line("ram-1", 1), line("ssd-1", 1), line("ram-1", 2)], lookup);
    expect(out).toEqual([
      { productId: "ram-1", qty: 3, customerOwned: false },
      { productId: "ssd-1", qty: 1, customerOwned: false },
    ]);
  });

  it("accepts a complete PC", () => {
    const out = normalizeBuildLines(
      [line("cpu-1"), line("mb-1"), line("case-1"), line("psu-1"), line("ram-1", 2), line("ssd-1")],
      lookup,
    );
    expect(out).toHaveLength(6);
  });

  it("accepts an empty list", () => {
    expect(normalizeBuildLines([], lookup)).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses quantity %s with a validation error", (qty) => {
    expect(issuesOf(() => normalizeBuildLines([line("ram-1", qty)], lookup))).toEqual([
      { path: "lines.0.qty", code: "qty_invalid" },
    ]);
  });

  it("refuses more than MAX_LINE_QTY of a product after the lines are merged", () => {
    expect(normalizeBuildLines([line("fan-1", MAX_LINE_QTY)], lookup)).toHaveLength(1);
    expect(issuesOf(() => normalizeBuildLines([line("fan-1", MAX_LINE_QTY + 1)], lookup))).toEqual([
      { path: "lines.0.qty", code: "qty_too_large" },
    ]);
    expect(issuesOf(() => normalizeBuildLines([line("fan-1", 60), line("fan-1", 40)], lookup))).toEqual([
      { path: "lines.1.qty", code: "qty_too_large" },
    ]);
  });

  it("refuses more than MAX_LINES lines before it looks at any of them", () => {
    const many = Array.from({ length: MAX_LINES + 1 }, () => line("fan-1"));
    expect(issuesOf(() => normalizeBuildLines(many, lookup))).toEqual([{ path: "lines", code: "too_many_lines" }]);
    const spread = Array.from({ length: MAX_LINES }, (_, i) => line(["fan-1", "ssd-1", "ram-1"][i % 3] as string));
    expect(normalizeBuildLines(spread, lookup)).toHaveLength(3);
  });

  it("refuses a product that is not in the catalog, naming it", () => {
    const issues = issuesOf(() => normalizeBuildLines([line("ghost"), line("ram-1")], lookup));
    expect(issues).toEqual([{ path: "lines.0.productId", code: "unknown_product" }]);
  });

  it.each([
    [[line("cpu-1"), line("cpu-2")], "cpu"],
    [[line("mb-1"), line("mb-2")], "mb"],
    [[line("psu-1"), line("psu-2")], "psu"],
    [[line("cpu-1", 2)], "cpu"],
    [[line("mb-1", 2)], "mb"],
    [[line("case-1", 2)], "case"],
    [[line("psu-1", 2)], "psu"],
    [[line("cpu-1"), line("cpu-1")], "cpu"],
  ] as const)("refuses more than one processor, board, case or PSU: %j", (lines, category) => {
    const issues = issuesOf(() => normalizeBuildLines([...lines], lookup));
    expect(issues).toEqual([{ path: `category.${category}`, code: "single_part_violated" }]);
  });

  it("allows several of them when the plan is not a PC (single parts off)", () => {
    expect(normalizeBuildLines([line("cpu-1"), line("cpu-2")], lookup, { singlePcParts: false })).toHaveLength(2);
  });

  it("reports every problem at once", () => {
    const issues = issuesOf(() =>
      normalizeBuildLines([line("ghost"), line("ram-1", 0), line("cpu-1"), line("cpu-2")], lookup),
    );
    expect(issues.map((i) => i.code).sort()).toEqual(["qty_invalid", "single_part_violated", "unknown_product"]);
  });

  it("refuses a product that is the customer's in one line and ours in another", () => {
    expect(issuesOf(() => normalizeBuildLines([line("ssd-1", 1, true), line("ssd-1", 1, false)], lookup))).toEqual([
      { path: "lines.1.customerOwned", code: "mixed_ownership" },
    ]);
    expect(normalizeBuildLines([line("ssd-1", 1, true), line("ssd-1", 1, true)], lookup)).toEqual([
      { productId: "ssd-1", qty: 2, customerOwned: true },
    ]);
  });

  it("refuses something that is not a list", () => {
    expect(issuesOf(() => normalizeBuildLines(undefined as never, lookup))).toEqual([
      { path: "lines", code: "not_a_list" },
    ]);
  });

  it("refuses a line that is not an object or has no product id", () => {
    expect(issuesOf(() => normalizeBuildLines([null as never, { qty: 1 } as never], lookup))).toEqual([
      { path: "lines.0", code: "line_invalid" },
      { path: "lines.1.productId", code: "product_id_invalid" },
    ]);
  });
});
