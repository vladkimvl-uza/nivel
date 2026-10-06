import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convert, create as createLead } from "../leads/index.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { createWorld, PC_COMPONENTS_SUM, pcLines, type World } from "../orders/test-support/world.ts";
import { build } from "./build.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const owner = () => ({ kind: "owner" as const, id: w.owner.id });
let tg = 7_400_000_000;

async function draftOrder(scope: "pc" | "setup" = "pc"): Promise<string> {
  tg += 1;
  const lead = await createLead({ channel: "bot", scope, customer: { telegramUserId: tg } }, w.bot);
  return (await convert({ leadId: lead.leadId }, owner(), w.admin)).orderId;
}

describe("quotes.build", () => {
  it("writes a draft estimate: the columns of the money, the lines, and makes it the current quote of the order", async () => {
    const orderId = await draftOrder();
    const q = await build({ orderId, lines: pcLines(w), tasks: ["gaming"] }, owner(), w.admin);
    expect(q.version).toBe(1);
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM);

    const { rows } = await w.db.$client.query(
      `select status, version, components_sum::int, purchase_limit::int, fee_total::int, fee_advance::int, fee_final::int,
              settings_version, valid_until, manually_checked_by,
              (select count(*)::int from sales.quote_lines l where l.quote_id = q.id) as lines,
              (select current_quote_id from sales.orders o where o.id = q.order_id) as current
         from sales.quotes q where id = $1`,
      [q.quoteId],
    );
    expect(rows[0]).toMatchObject({
      status: "draft",
      version: 1,
      components_sum: PC_COMPONENTS_SUM,
      purchase_limit: q.totals.purchaseLimit,
      fee_total: q.totals.fee.total,
      fee_advance: q.totals.advance,
      fee_final: q.totals.final,
      settings_version: "2026-10-05",
      manually_checked_by: null,
      lines: 8,
      current: q.quoteId,
    });
    expect(rows[0].valid_until).toEqual(new Date(w.clock.now().getTime() + 24 * 3_600_000));
  });

  it("keeps the whole result of the domain in the quote, with the verdict and the shelf life", async () => {
    const orderId = await draftOrder();
    const q = await build({ orderId, lines: pcLines(w) }, owner(), w.admin);
    const { rows } = await w.db.$client.query("select totals from sales.quotes where id = $1", [q.quoteId]);
    expect(rows[0].totals).toMatchObject({
      schema: 1,
      shelfLifeHours: 24,
      quoteKind: "pc",
      compatVerdict: q.compatVerdict,
      totals: { eligibility: { mode: "full_cycle" }, fee: { total: q.totals.fee.total } },
    });
  });

  it("a second build is the next version and the new current quote; the first stays as a draft", async () => {
    const orderId = await draftOrder();
    const a = await build({ orderId, lines: pcLines(w) }, owner(), w.admin);
    const b = await build({ orderId, lines: pcLines(w).slice(0, 7) }, owner(), w.admin);
    expect(b.version).toBe(2);
    const { rows } = await w.db.$client.query("select current_quote_id from sales.orders where id = $1", [orderId]);
    expect(rows[0].current_quote_id).toBe(b.quoteId);
    expect(a.quoteId).not.toBe(b.quoteId);
  });

  it("journals the build with the prices it used", async () => {
    const orderId = await draftOrder();
    const q = await build({ orderId, lines: pcLines(w) }, owner(), w.admin);
    const { rows } = await w.db.$client.query(
      "select actor, action, after from ops.audit_log where entity = 'sales.quotes' and entity_id = $1",
      [q.quoteId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe(`owner:${w.owner.id}`);
    expect(rows[0].action).toBe("quote.build");
    expect(rows[0].after.priceSnapshot[w.products.cpu.id]).toMatchObject({ median: 2_800_000 });
  });

  it("opens the free window for a small PC when the workshop is empty, and says so in the eligibility", async () => {
    const orderId = await draftOrder();
    const q = await build(
      {
        orderId,
        manualLines: [{ title: "Study PC", categoryCode: "case", feeGroup: "pc", qty: 1, unitSum: 5_000_000 }],
      },
      owner(),
      w.admin,
    );
    expect(q.totals.eligibility).toEqual({ mode: "free_window_only", minEstimate: 4_500_000 });
  });

  it("takes the lines of a saved configuration", async () => {
    const orderId = await draftOrder();
    const { rows } = await w.db.$client.query(
      "insert into sales.configurations (public_code, kind, items, created_via) values ('abcd2345', 'pc', $1, 'admin') returning id",
      [JSON.stringify(pcLines(w))],
    );
    const q = await build({ orderId, configurationId: rows[0].id }, owner(), w.admin);
    expect(q.totals.componentsSum).toBe(PC_COMPONENTS_SUM);
    await expect(
      build({ orderId, configurationId: rows[0].id, lines: pcLines(w) }, owner(), w.admin),
    ).rejects.toMatchObject({ issues: [{ code: "lines_ambiguous" }] });
    await expect(
      build({ orderId, configurationId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is a job of the admin role and of the staff", async () => {
    const orderId = await draftOrder();
    await expect(build({ orderId, lines: [] }, owner(), w.bot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(build({ orderId, lines: [] }, { kind: "customer", id: "c" }, w.admin)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses an order that does not exist and an id that is not a uuid", async () => {
    await expect(
      build({ orderId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", lines: [] }, owner(), w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(build({ orderId: "NV-2026-0001", lines: [] }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("writes nothing when the lines are refused", async () => {
    const orderId = await draftOrder();
    await expect(
      build({ orderId, lines: [...pcLines(w), { productId: w.products.cpu.id, qty: 1 }] }, owner(), w.admin),
    ).rejects.toBeInstanceOf(ValidationError);
    const { rows } = await w.db.$client.query("select count(*)::int as n from sales.quotes where order_id = $1", [
      orderId,
    ]);
    expect(rows[0].n).toBe(0);
  });
});
