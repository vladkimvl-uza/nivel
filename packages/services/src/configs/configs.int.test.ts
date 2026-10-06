import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ValidationError } from "../orders/errors.ts";
import { createWorld, newCustomer, PC_COMPONENTS_SUM, pcLines, type World } from "../orders/test-support/world.ts";
import { save } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const row = async (id: string) =>
  (await w.db.$client.query("select * from sales.configurations where id = $1", [id])).rows[0];

describe("configs.save", () => {
  it("saves a configuration from the site role: the code of eight characters, the recalculated quote and the verdict", async () => {
    const r = await save({ kind: "pc", lines: pcLines(w), tasks: ["gaming"], createdVia: "web" }, w.web);
    expect(r.publicCode).toMatch(/^[a-z2-7]{8}$/);
    const saved = await row(r.id);
    expect(saved.kind).toBe("pc");
    expect(saved.created_via).toBe("web");
    expect(saved.items).toEqual(pcLines(w));
    expect(saved.quote.totals.componentsSum).toBe(PC_COMPONENTS_SUM);
    expect(saved.quote.totals.fee.total).toBe(r.quote.feeTotal);
    expect(saved.compat.verdict).toBe(r.compat.verdict);
    expect(saved.engine_version).toBeTruthy();
    expect(saved.price_snapshot[w.products.gpu.id]).toMatchObject({ median: 3_600_000, confidence: "high" });
  });

  it("returns the numbers the customer is shown, all of them calculated here", async () => {
    const r = await save({ kind: "pc", lines: pcLines(w), createdVia: "bot" }, w.bot);
    expect(r.quote).toMatchObject({
      componentsSum: PC_COMPONENTS_SUM,
      purchaseLimit: PC_COMPONENTS_SUM + 360_000,
      feeTotal: 1_777_500,
    });
    expect(r.quote.grandTotal).toBe(r.quote.purchaseLimit + r.quote.feeTotal);
    expect(["ok", "warn", "incomplete"]).toContain(r.compat.verdict);
  });

  it("does not look at any price or sum the client sent along", async () => {
    const lines = pcLines(w).map((l) => ({ ...l, unitSum: 1, price: 1 }));
    const r = await save({ kind: "pc", lines, createdVia: "web" }, w.web);
    expect(r.quote.componentsSum).toBe(PC_COMPONENTS_SUM);
    expect((await row(r.id)).items).toEqual(pcLines(w));
  });

  it("does not run the free-window arithmetic for the site, which cannot read the load of the workshop", async () => {
    const small = pcLines(w).filter((l) => l.productId === w.products.cpu.id || l.productId === w.products.mb.id);
    const r = await save({ kind: "pc", lines: small, createdVia: "web" }, w.web);
    expect(r.quote.eligibility.mode).toBe("podbor_only");
  });

  it("refuses a second processor and a quantity above 99 with a validation error, never with a RangeError", async () => {
    await expect(
      save({ kind: "pc", lines: [...pcLines(w), { productId: w.products.cpu.id, qty: 1 }], createdVia: "web" }, w.web),
    ).rejects.toMatchObject({ name: "ValidationError", issues: [{ code: "single_part_violated" }] });
    await expect(
      save({ kind: "pc", lines: [{ productId: w.products.ram.id, qty: 100 }], createdVia: "web" }, w.web),
    ).rejects.toMatchObject({ name: "ValidationError", issues: [{ code: "qty_too_large" }] });
    await expect(
      save(
        {
          kind: "pc",
          lines: [
            { productId: w.products.ram.id, qty: 60 },
            { productId: w.products.ram.id, qty: 60 },
          ],
          createdVia: "web",
        },
        w.web,
      ),
    ).rejects.toMatchObject({ issues: [{ code: "qty_too_large" }] });
    const many = Array.from({ length: 201 }, () => ({ productId: w.products.ram.id, qty: 1 }));
    await expect(save({ kind: "pc", lines: many, createdVia: "web" }, w.web)).rejects.toMatchObject({
      issues: [{ code: "too_many_lines" }],
    });
  });

  it("keeps the budget the client named within the limit of the money rules", async () => {
    const ok = await save({ kind: "pc", lines: pcLines(w), createdVia: "web", budgetSum: MAX_BUDGET_SUM }, w.web);
    expect((await row(ok.id)).prefs).toMatchObject({ budgetSum: MAX_BUDGET_SUM });
    for (const budgetSum of [MAX_BUDGET_SUM + 1, -1, 1.5]) {
      await expect(save({ kind: "pc", lines: pcLines(w), createdVia: "web", budgetSum }, w.web)).rejects.toMatchObject({
        issues: [{ path: "budgetSum", code: "sum_invalid" }],
      });
    }
  });

  it("a changed configuration is a new one that names its parent; the saved one stays as it was", async () => {
    const a = await save({ kind: "pc", lines: pcLines(w), createdVia: "web" }, w.web);
    const b = await save({ kind: "pc", lines: pcLines(w).slice(0, 6), createdVia: "web", parentId: a.id }, w.web);
    expect((await row(b.id)).parent_id).toBe(a.id);
    expect((await row(a.id)).items).toEqual(pcLines(w));
    await expect(
      save({ kind: "pc", lines: [], createdVia: "web", parentId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, w.web),
    ).rejects.toMatchObject({ issues: [{ path: "parentId", code: "parent_unknown" }] });
  });

  it("links the customer when it is known and refuses one that is not", async () => {
    const customerId = await newCustomer(w);
    const r = await save({ kind: "pc", lines: pcLines(w), createdVia: "bot", customerId }, w.bot);
    expect((await row(r.id)).customer_id).toBe(customerId);
    await expect(
      save(
        { kind: "pc", lines: pcLines(w), createdVia: "bot", customerId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
        w.bot,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "customerId", code: "customer_unknown" }] });
  });

  it("refuses an unknown product, a bad kind and a bad source", async () => {
    await expect(
      save(
        {
          kind: "pc",
          lines: [{ productId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" as never, qty: 1 }],
          createdVia: "web",
        },
        w.web,
      ),
    ).rejects.toMatchObject({ issues: [{ code: "unknown_product" }] });
    await expect(save({ kind: "laptop" as never, lines: [], createdVia: "web" }, w.web)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(save({ kind: "pc", lines: [], createdVia: "carrier" as never }, w.web)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("saves an empty build as a start: nothing is calculated for nothing", async () => {
    const r = await save({ kind: "pc", lines: [], createdVia: "web" }, w.web);
    expect(r.quote.componentsSum).toBe(0);
    expect(r.quote.feeTotal).toBe(0);
  });
});
