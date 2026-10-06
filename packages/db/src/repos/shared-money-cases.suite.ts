import { readFileSync } from "node:fs";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectAs,
  createOrder,
  createVendor,
  driveTo,
  insertPurchase,
  one,
  pgError,
  receiveFunds,
  transition,
} from "./testkit.ts";

// The table of money cases shared with packages/domain (ADR-004, ARCHITECTURE 3.4): one table, two lines of defence.
// The domain tests run it against the functions; here it runs against the real database.
interface SharedCases {
  applyBp: { base: number; rateBp: number; floor: number; half_up: number; ceil: number }[];
  split: { total: number; sharesBp: number[]; parts: number[] }[];
  fee: {
    name: string;
    fee: number;
    advance: number;
    final: number;
    commissionLine: number;
    worksLine: number;
  }[];
  payments: {
    kind: string;
    direction: "in" | "out";
    method: string;
    status: "expected" | "confirmed" | "void";
    fiscalReceiptNo: string | null;
    valid: boolean;
  }[];
  cancel: {
    name: string;
    point: string;
    fundsReceived: number;
    receiptsTotal: number;
    shopRefunds: number;
    documentedLosses: number;
    expect: { fundsToRefund: number };
  }[];
}
const shared = JSON.parse(
  readFileSync(new URL("../../../testing/fixtures/money-cases.json", import.meta.url), "utf8"),
) as SharedCases;

let c: pg.Client;
let admin: pg.Client;
let vendorId: string;
let paymentsOrder: string;

beforeAll(async () => {
  c = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
  vendorId = await createVendor(c);
  paymentsOrder = (await createOrder(c)).orderId;
});
afterAll(async () => {
  await c.end();
  await admin.end();
});

describe("shared money cases: arithmetic in the database", () => {
  it.each(shared.applyBp)("applyBp $base x $rateBp bp: floor, half up, ceil", async (k) => {
    const r = await one<{ floor: string; half_up: string; ceil: string }>(
      c,
      `select ($1::bigint * $2::bigint / 10000)::text as floor,
              (($1::bigint * $2::bigint + 5000) / 10000)::text as half_up,
              (($1::bigint * $2::bigint + 9999) / 10000)::text as ceil`,
      [k.base, k.rateBp],
    );
    expect([Number(r.floor), Number(r.half_up), Number(r.ceil)]).toEqual([k.floor, k.half_up, k.ceil]);
  });

  it.each(shared.split)("split $total by $sharesBp: largest remainder, ties to the lower index", async (k) => {
    const { rows } = await c.query<{ part: string }>(
      `with shares as (select ord - 1 as i, s from unnest($2::int[]) with ordinality as t(s, ord)),
            base as (select i, ($1::bigint * s) / 10000 as q, ($1::bigint * s) % 10000 as r from shares),
            left_over as (select $1::bigint - sum(q) as n from base),
            ranked as (select i, q, row_number() over (order by r desc, i asc) as rk from base)
       select (q + case when rk <= (select n from left_over) then 1 else 0 end)::text as part
         from ranked order by i`,
      [k.total, k.sharesBp],
    );
    expect(rows.map((r) => Number(r.part))).toEqual(k.parts);
    expect(rows.reduce((s, r) => s + Number(r.part), 0)).toBe(k.total);
  });
});

describe("shared money cases: the fee parts of a quote", () => {
  async function insertQuote(
    order: string,
    version: number,
    f: { fee: number; commissionLine: number; worksLine: number; advance: number; final: number },
  ) {
    return c.query(
      `insert into sales.quotes (order_id, version, status, totals, components_sum, reserve_bp, reserve_sum, purchase_limit,
          fee_total, fee_commission_line, fee_works_line, fee_advance, fee_final, outside_scale_sum, settings_version)
       values ($1, $2, 'draft', '{}', 1000000, 500, 50000, 1050000, $3, $4, $5, $6, $7, 0, '2026-10-05')`,
      [order, version, f.fee, f.commissionLine, f.worksLine, f.advance, f.final],
    );
  }

  it.each(shared.fee.map((k, i) => [k.name, k, i + 2] as const))("%s", async (_name, k, version) => {
    const { orderId } = await createOrder(c);
    await expect(insertQuote(orderId, version, k)).resolves.toBeDefined();
    // The same quote with one part moved by a sum no longer adds up, on either side of the split.
    await expect(insertQuote(orderId, version + 100, { ...k, advance: k.advance + 1 })).rejects.toThrow(
      /quotes_fee_split_chk/,
    );
    await expect(insertQuote(orderId, version + 200, { ...k, final: k.final - 1 })).rejects.toThrow(
      /quotes_fee_split_chk/,
    );
    await expect(insertQuote(orderId, version + 300, { ...k, commissionLine: k.commissionLine + 1 })).rejects.toThrow(
      /quotes_fee_lines_chk/,
    );
    await expect(insertQuote(orderId, version + 400, { ...k, worksLine: k.worksLine - 1 })).rejects.toThrow(
      /quotes_fee_lines_chk/,
    );
  });
});

describe("shared money cases: the payments CHECK", () => {
  it("has 115 cases of the nine kinds, and as many valid as invalid ones to be meaningful", () => {
    expect(shared.payments.length).toBeGreaterThanOrEqual(100);
    expect(shared.payments.some((p) => p.valid)).toBe(true);
    expect(shared.payments.some((p) => !p.valid)).toBe(true);
  });

  it("accepts exactly the valid ones and rejects the others with a CHECK of the table", async () => {
    const wrong: string[] = [];
    for (const [i, p] of shared.payments.entries()) {
      const confirmed = p.status === "confirmed";
      // The table models the pair and the receipt; the database also wants who confirmed and when.
      const outcome = await c
        .query(
          `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, fiscal_receipt_no, confirmed_by, confirmed_at)
           values ($1, $2, $3, $4, 1000000, $5, $6, $7, $8)`,
          [
            paymentsOrder,
            p.kind,
            p.direction,
            p.method,
            p.status,
            p.fiscalReceiptNo,
            confirmed ? "owner" : null,
            confirmed ? new Date() : null,
          ],
        )
        .then(
          () => "accepted",
          (e: Error) =>
            /payments_(fee|purchase_funds|refund)_chk/.test(e.message) ? "rejected" : `error: ${e.message}`,
        );
      if (outcome !== (p.valid ? "accepted" : "rejected")) {
        wrong.push(
          `#${i} ${p.kind} ${p.direction} ${p.method} ${p.status} ${JSON.stringify(p.fiscalReceiptNo)} -> ${outcome}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("does not let a blank receipt number confirm a fee payment later either", async () => {
    const { rows } = await c.query<{ id: string }>(
      `insert into sales.payments (order_id, kind, direction, method, amount_sum)
       values ($1, 'fee_advance', 'in', 'xolis_qr', 450000) returning id`,
      [paymentsOrder],
    );
    const id = rows[0]?.id;
    for (const blank of ["", "   ", null]) {
      const e = await pgError(
        c,
        "update sales.payments set status = 'confirmed', fiscal_receipt_no = $2, confirmed_by = 'owner', confirmed_at = now() where id = $1",
        [id, blank],
      );
      expect(e.message).toMatch(/payments_fee_chk/);
    }
    await c.query(
      "update sales.payments set status = 'confirmed', fiscal_receipt_no = 'FM-000123', confirmed_by = 'owner', confirmed_at = now() where id = $1",
      [id],
    );
  });
});

describe("shared money cases: the closure invariant of a cancellation", () => {
  it.each(shared.cancel)("$name", async (k) => {
    const { fundsReceived: F, receiptsTotal: R, shopRefunds: S, documentedLosses: L } = k;
    // fundsToRefund = fundsReceived - receiptsTotal + shopRefunds - documentedLosses (ARCHITECTURE 4.7) ...
    expect(k.expect.fundsToRefund).toBe(F - R + S - L);

    const settle = async (refund: number) => {
      const o = await createOrder(c, { purchaseLimit: Math.max(R, 1_000_000) });
      await receiveFunds(c, o.orderId, F);
      if (R > 0) {
        const bought = await insertPurchase(c, { orderId: o.orderId, vendorId, amount: R });
        // ... where what a shop gave back is a negative row of the purchase it reduces.
        if (S > 0) await insertPurchase(c, { orderId: o.orderId, vendorId, amount: -S, refundOf: bought });
      }
      if (L > 0) await c.query("update sales.orders set documented_losses_sum = $1 where id = $2", [L, o.orderId]);
      if (refund > 0) {
        await c.query(
          `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, confirmed_by, confirmed_at)
           values ($1, 'funds_refund', 'out', 'bank_transfer_out', $2, 'confirmed', 'owner', now())`,
          [o.orderId, refund],
        );
      }
      await driveTo(admin, o.orderId, "accepted");
      await transition(admin, o.orderId, "CANCEL");
      return transition(admin, o.orderId, "CANCEL_SETTLED");
    };

    // ... and the database closes the order exactly when the refund is that amount.
    await expect(settle(k.expect.fundsToRefund)).resolves.toMatchObject({ to: "cancelled" });
    await expect(settle(k.expect.fundsToRefund + 1)).rejects.toThrow(/not_reconciled/);
    if (k.expect.fundsToRefund > 0) await expect(settle(k.expect.fundsToRefund - 1)).rejects.toThrow(/not_reconciled/);
  });
});
