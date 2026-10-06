// Helpers for integration tests (WP-06). Every test file runs against its own throwaway database clone;
// the harness (packages/testing) has already pointed all DATABASE_URL_* at it.
import { createHash } from "node:crypto";
import pg from "pg";
import { createDb, type Db } from "../client.ts";

export type Role = "MIGRATOR" | "WEB" | "ADMIN" | "BOT" | "WORKER";

/** Connected client for one application role of the throwaway database. */
export async function connectAs(role: Role): Promise<pg.Client> {
  const url = process.env[`DATABASE_URL_${role}`];
  if (!url) throw new Error(`DATABASE_URL_${role} is not set (integration project only)`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs the query and returns the PostgreSQL error (code, message) it raises; fails when it succeeds. */
export async function pgError(client: pg.Client, text: string, values: unknown[] = []): Promise<pg.DatabaseError> {
  try {
    await client.query(text, values);
  } catch (e) {
    if (e instanceof Error && "code" in e) return e as pg.DatabaseError;
    throw e;
  }
  throw new Error(`expected an error, the statement succeeded: ${text}`);
}

/** One value of `select ... returning` in a single call. */
export async function one<T = Record<string, unknown>>(client: pg.Client, text: string, values: unknown[] = []) {
  const { rows } = await client.query(text, values);
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}: ${text}`);
  return rows[0] as T;
}

let counter = 0;
/** Unique small integer inside one test file. */
export function uniq(): number {
  counter += 1;
  return counter;
}

export interface OrderFixture {
  customerId: string;
  orderId: string;
  quoteId: string;
}

/** Customer + order (estimate_draft) + a draft quote that is the order's current quote. Run as migrator or admin. */
export async function createOrder(
  client: pg.Client,
  o: { purchaseLimit?: number; feeTotal?: number; status?: string } = {},
): Promise<OrderFixture> {
  const n = uniq();
  const purchaseLimit = o.purchaseLimit ?? 10_000_000;
  const feeTotal = o.feeTotal ?? 1_500_000;
  const customer = await one<{ id: string }>(
    client,
    "insert into sales.customers (display_name, telegram_user_id) values ($1, $2) returning id",
    [`Test ${n}`, 7_000_000_000 + n],
  );
  const order = await one<{ id: string }>(
    client,
    `insert into sales.orders (number, customer_id, kind) values ($1, $2, 'pc') returning id`,
    [`NV-2999-${String(n).padStart(4, "0")}`, customer.id],
  );
  const reserve = Math.floor(purchaseLimit / 20);
  const quote = await one<{ id: string }>(
    client,
    `insert into sales.quotes (order_id, version, status, totals, components_sum, reserve_bp, reserve_sum, purchase_limit,
        fee_total, fee_commission_line, fee_works_line, fee_advance, fee_final, outside_scale_sum, settings_version)
     values ($1, 1, 'draft', '{}'::jsonb, $2, 500, $3, $4, $5, $6, $7, $8, $9, 0, '2026-10-05')
     returning id`,
    [
      order.id,
      purchaseLimit - reserve,
      reserve,
      purchaseLimit,
      feeTotal,
      Math.floor(feeTotal / 2),
      feeTotal - Math.floor(feeTotal / 2),
      Math.floor((feeTotal * 3) / 10),
      feeTotal - Math.floor((feeTotal * 3) / 10),
    ],
  );
  await client.query("update sales.orders set current_quote_id = $1 where id = $2", [quote.id, order.id]);
  return { customerId: customer.id, orderId: order.id, quoteId: quote.id };
}

export interface PaymentInput {
  orderId: string;
  kind: string;
  amount: number;
  status?: "expected" | "confirmed" | "void";
  direction?: "in" | "out";
  method?: string;
  receipt?: string | null;
}

const KIND_DEFAULTS: Record<string, { direction: "in" | "out"; method: string }> = {
  fee_advance: { direction: "in", method: "xolis_qr" },
  fee_final: { direction: "in", method: "xolis_qr" },
  fee_extra: { direction: "in", method: "xolis_qr" },
  podbor_fee: { direction: "in", method: "xolis_qr" },
  purchase_funds: { direction: "in", method: "bank_transfer_ip" },
  purchase_topup: { direction: "in", method: "bank_transfer_ip" },
  remainder_refund: { direction: "out", method: "bank_transfer_out" },
  fee_refund: { direction: "out", method: "bank_transfer_out" },
  funds_refund: { direction: "out", method: "bank_transfer_out" },
};

/** Inserts a payment; the receipt number defaults to a fiscal one for confirmed fee payments. */
export async function insertPayment(client: pg.Client, p: PaymentInput): Promise<string> {
  const d = KIND_DEFAULTS[p.kind] ?? { direction: "in", method: "xolis_qr" };
  const status = p.status ?? "expected";
  const isFee = ["fee_advance", "fee_final", "fee_extra", "podbor_fee"].includes(p.kind);
  const receipt = p.receipt === undefined ? (isFee && status === "confirmed" ? `R-${uniq()}` : null) : p.receipt;
  const row = await one<{ id: string }>(
    client,
    `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, fiscal_receipt_no,
        confirmed_at, confirmed_by)
     values ($1, $2, $3, $4, $5, $6, $7, case when $6 = 'confirmed' then now() end,
        case when $6 = 'confirmed' then 'test' end)
     returning id`,
    [p.orderId, p.kind, p.direction ?? d.direction, p.method ?? d.method, p.amount, status, receipt],
  );
  return row.id;
}

/** A vendor row for purchases. */
export async function createVendor(client: pg.Client): Promise<string> {
  const n = uniq();
  const v = await one<{ id: string }>(
    client,
    "insert into pricing.vendors (name, kind, price_source) values ($1, 'shop', 'manual') returning id",
    [`Vendor ${n}`],
  );
  return v.id;
}

/** A purchase of the order (receipt kind fiscal). */
export async function insertPurchase(
  client: pg.Client,
  o: { orderId: string; vendorId: string; amount: number; refundOf?: string },
): Promise<string> {
  const n = uniq();
  const row = await one<{ id: string }>(
    client,
    `insert into sales.purchases (order_id, vendor_id, qty, amount_sum, paid_via, receipt_kind, receipt_no, refund_of, bought_by)
     values ($1, $2, 1, $3, 'bank_transfer', 'fiscal', $4, $5, 'test') returning id`,
    [o.orderId, o.vendorId, o.amount, `CH-${n}`, o.refundOf ?? null],
  );
  return row.id;
}

/** The regular life of an order: the events in order and the status each one leads to (ARCHITECTURE 4.9). */
export const ORDER_PATH: readonly (readonly [event: string, to: string])[] = [
  ["SEND_ESTIMATE", "estimate_sent"],
  ["ACCEPT", "accepted"],
  ["FEE_PREPAID", "accepted"],
  ["FUNDS_RECEIVED", "accepted"],
  ["MEETING_DONE", "accepted"],
  ["START_PURCHASE", "purchasing"],
  ["PURCHASE_RECORDED", "purchasing"],
  ["PURCHASE_DONE", "report_due"],
  ["SEND_REPORT", "report_sent"],
  ["OBJECTION", "report_sent"],
  ["REPORT_ACCEPTED", "report_sent"],
  ["REMAINDER_SETTLED", "settled"],
  ["MATERIALS_ACCEPTED", "assembling"],
  ["ASSEMBLED", "testing"],
  ["TESTS_PASSED", "ready"],
  ["DISPATCH", "delivering"],
  ["HANDOVER", "handed_over"],
  ["CLOSE", "closed"],
];

const SYSTEM_EVENTS = new Set(["EXPIRE", "REPORT_DEEMED_ACCEPTED", "CLOSE"]);
const CUSTOMER_EVENTS = new Set(["ACCEPT", "OBJECTION", "REPORT_ACCEPTED"]);

export interface TransitionOptions {
  actorKind?: string;
  actorId?: string;
  expectedFrom?: string | null;
  changes?: Record<string, unknown>;
  event?: Record<string, unknown>;
}

/** Calls sales.apply_transition and returns [seq, from, to]. */
export async function transition(client: pg.Client, orderId: string, type: string, o: TransitionOptions = {}) {
  const actorKind =
    o.actorKind ?? (SYSTEM_EVENTS.has(type) ? "system" : CUSTOMER_EVENTS.has(type) ? "customer" : "owner");
  const { rows } = await client.query<{ out_seq: number; out_from: string; out_to: string }>(
    "select * from sales.apply_transition($1, $2::jsonb, $3, $4, $5, null, $6::jsonb)",
    [
      orderId,
      JSON.stringify({ type, ...(o.event ?? {}) }),
      actorKind,
      o.actorId ?? "tester",
      o.expectedFrom ?? null,
      JSON.stringify(o.changes ?? {}),
    ],
  );
  const r = rows[0];
  if (!r) throw new Error("apply_transition returned no row");
  return { seq: r.out_seq, from: r.out_from, to: r.out_to };
}

/** The error apply_transition raises for a named actor and order fields; fails when the call succeeds. */
export function applyError(
  client: pg.Client,
  orderId: string,
  event: string,
  kind: string,
  changes: object,
): Promise<pg.DatabaseError> {
  return pgError(client, "select * from sales.apply_transition($1, $2::jsonb, $3, 'x', null, null, $4::jsonb)", [
    orderId,
    JSON.stringify({ type: event }),
    kind,
    JSON.stringify(changes),
  ]);
}

/** Status and number of journal rows of an order: what a refused call must leave as it was. */
export async function orderState(client: pg.Client, orderId: string): Promise<{ status: string; events: string }> {
  return one(
    client,
    `select o.status, (select count(*)::text from sales.order_events e where e.order_id = o.id) as events
       from sales.orders o where o.id = $1`,
    [orderId],
  );
}

/** Walks the regular path until the order reaches `status` (the first time it is reached). */
export async function driveTo(client: pg.Client, orderId: string, status: string): Promise<void> {
  if (status === "estimate_draft") return;
  for (const [event, to] of ORDER_PATH) {
    await transition(client, orderId, event);
    if (to === status) return;
  }
  throw new Error(`status ${status} is not on the regular path`);
}

/**
 * An account of the admin panel. `telegramUserId` links it to a person of the owner's Telegram group: the bot acts
 * for the owner and the assistant only as such an account (sales.apply_transition). Run as migrator or admin.
 */
export async function insertAdminUser(
  client: pg.Client,
  o: { role: "owner" | "assistant" | "translator" | "accountant"; telegramUserId?: number | null; active?: boolean },
): Promise<{ id: string; telegramId: string | null }> {
  const n = uniq();
  const telegramUserId = o.telegramUserId === undefined ? 6_000_000_000 + n : o.telegramUserId;
  const row = await one<{ id: string }>(
    client,
    `insert into ops.admin_users (email, password_hash, role, telegram_user_id, active)
     values ($1, 'x', $2, $3, $4) returning id`,
    [`${o.role}${n}@admin.example.test`, o.role, telegramUserId, o.active ?? true],
  );
  return { id: row.id, telegramId: telegramUserId === null ? null : String(telegramUserId) };
}

/** A stub offer version (content.legal_documents) that an order can point to. */
export async function insertOfferStub(client: pg.Client, lang: "uz" | "ru" = "uz"): Promise<string> {
  const n = uniq();
  const body = `Offer stub ${n}`;
  const row = await one<{ id: string }>(
    client,
    `insert into content.legal_documents (kind, version, lang, body_md, status, text_sha256, effective_from)
     values ('offer', $1, $2, $3, 'stub', $4, '2026-11-01') returning id`,
    [`t${n}`, lang, body, createHash("sha256").update(body, "utf8").digest("hex")],
  );
  return row.id;
}

/** One consent row of the order (the latest row of a kind wins). */
export async function insertConsent(
  client: pg.Client,
  o: { orderId: string; customerId: string; kind: string; granted: boolean; at?: string },
): Promise<void> {
  await client.query(
    `insert into ops.consents (customer_id, order_id, kind, granted, channel, at)
     values ($1, $2, $3, $4, 'test', coalesce($5::timestamptz, now()))`,
    [o.customerId, o.orderId, o.kind, o.granted, o.at ?? null],
  );
}

/** Confirms purchase funds of the order (bank transfer to the sole proprietor). */
export async function receiveFunds(client: pg.Client, orderId: string, amount: number): Promise<void> {
  if (amount > 0) await insertPayment(client, { orderId, kind: "purchase_funds", amount, status: "confirmed" });
}

/** A Drizzle handle for one application role of the throwaway database; close it with `db.$client.end()`. */
export function openDb(role: Role = "ADMIN"): Db {
  const url = process.env[`DATABASE_URL_${role}`];
  if (!url) throw new Error(`DATABASE_URL_${role} is not set (integration project only)`);
  return createDb(url, { max: 4 });
}
