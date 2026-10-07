// The feed of the CRM, from the real database to the real script of the CRM: an order lives its life through the scenarios of the
// services (a request, an estimate, the acceptance, payments, purchases, the report, the settlement), the worker collects what is new,
// builds the events from the rows and sends them (signed, one by one, in the order of the journal) to `doPost` of the script of
// tools/crm-sheets on the mock of Apps Script. Every event must be applied by the CRM.
import { fileURLToPath, pathToFileURL } from "node:url";
import { ops } from "@nivel/db/repos";
import { leads } from "@nivel/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordingLogger } from "../../../queues/test-support/fakes.ts";
import { settledOrder } from "../../../queues/test-support/flow.ts";
import { createWorld, theRow, type World } from "../../../queues/test-support/world.ts";
import { createPgLedgerPort, handleLedgerAppend } from "../../outbox/ledger-append.ts";
import { createPgCandidates } from "./candidates.ts";
import {
  loadLeadFacts,
  loadOrderChangeFacts,
  loadPaymentFacts,
  loadPurchaseFacts,
  loadWarrantyFacts,
} from "./facts.ts";
import { type CrmConfig, collectCrmEvents, createRateLimiter, handleCrmSync } from "./sync.ts";

const SECRET = "dGVzdC1rZXktbm90LWEtcmVhbC1zZWNyZXQ="; // gitleaks:allow test value, not a secret
const CONFIG: CrmConfig = { url: "https://script.google.com/macros/s/TEST/exec", secret: SECRET };

let w: World;
// biome-ignore lint/suspicious/noExplicitAny: the mock of Apps Script is a plain ES module without types
let crm: any;
beforeAll(async () => {
  w = await createWorld();
  // The facts of the rows are stamped by the clock of the database and by the clock of the world: keep them within the window of three days.
  w.clock.set(new Date());
  const href = pathToFileURL(
    fileURLToPath(new URL("../../../../../../tools/crm-sheets/scripts/env.mjs", import.meta.url)),
  ).href;
  const { createProject } = await import(/* @vite-ignore */ href);
  crm = createProject({
    now: new Date(),
    scriptProps: { NIVEL_HMAC_SECRET: SECRET, OWNER_EMAIL: "owner@example.com" },
  });
  crm.call("nvSetup");
}, 180_000);
afterAll(async () => {
  await w.close();
});

const q = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  w.db.$client.query<T>(sql, params).then((r) => r.rows);

/** `fetch` of the worker, answered by the script of the CRM itself (with the clock of the CRM kept at the time of the request). */
function crmFetch(log: { type: string; answer: Record<string, unknown> }[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const body = String(init?.body);
    crm.env.now = new Date(Number(u.searchParams.get("ts")) * 1000);
    crm.env.cache.clear();
    const out = crm.call("doPost", {
      postData: { contents: body, type: "application/json" },
      parameter: Object.fromEntries(u.searchParams),
      parameters: {},
    });
    const answer = JSON.parse(out.getContent()) as Record<string, unknown>;
    log.push({ type: JSON.parse(body).type as string, answer });
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
}

function depsOf(log: { type: string; answer: Record<string, unknown> }[]) {
  const { log: logger } = recordingLogger();
  let t = Date.now();
  const clock = () => {
    t += 1000; // every call is a second later: the limit of one event a second holds in the test too
    return new Date(t);
  };
  return {
    collect: {
      // ten minutes later than the last row: the waits of the collector have passed
      now: () => new Date(Math.max(Date.now(), w.clock.now().getTime()) + 600_000),
      log: logger,
      config: CONFIG,
      candidates: createPgCandidates(w.workerDb),
      enqueue: (input: ops.OutboxInput) => ops.enqueueOutbox(w.workerDb, input),
    },
    send: {
      now: clock,
      log: logger,
      config: CONFIG,
      env: "production",
      fetch: crmFetch(log),
      limiter: createRateLimiter({ now: () => 0, sleep: async () => undefined, gapMs: 0 }),
      facts: {
        lead: (id: string) => loadLeadFacts(w.workerDb, id),
        order: (id: string, seq: number) => loadOrderChangeFacts(w.workerDb, id, seq),
        payment: (id: string) => loadPaymentFacts(w.workerDb, id),
        purchase: (id: string) => loadPurchaseFacts(w.workerDb, id),
        warranty: (id: string) => loadWarrantyFacts(w.workerDb, id),
      },
    },
  };
}

describe("the CRM is fed from the database", () => {
  it("collects every new thing once, in the order of the journal, and the CRM applies each event it is sent", async () => {
    const o = await settledOrder(w, { via: "bot" });
    // the reserve of the settlement is booked by the worker from the job the bot queued
    const [job] = await q<{ payload: Record<string, unknown> }>(
      "select payload from ops.outbox where payload->>'job' = 'ledger.append' and payload->>'orderId' = $1",
      [o.orderId],
    );
    await handleLedgerAppend(
      { log: recordingLogger().log, port: createPgLedgerPort(w.workerDb) },
      theRow(job ? [job] : []).payload,
    );
    // a warranty case on the order
    const caseNumber = await ops.nextNumber(w.db, "G", 2026);
    await q(
      "insert into sales.warranty_cases (number, order_id, description, due_reply, due_diagnosis, due_loaner, due_fix) values ($1, $2, 'Не включается', now() + interval '1 day', now() + interval '2 days', now() + interval '3 days', now() + interval '10 days')",
      [caseNumber, o.orderId],
    );

    const sentLog: { type: string; answer: Record<string, unknown> }[] = [];
    const d = depsOf(sentLog);
    const first = await collectCrmEvents(d.collect);
    expect(first.queued).toBeGreaterThan(15);
    // a second collection finds nothing new: the outbox remembers
    expect(await collectCrmEvents(d.collect)).toEqual({ queued: 0 });

    const rows = await q<{ id: string; dedupe_key: string; payload: Record<string, unknown> }>(
      "select id, dedupe_key, payload from ops.outbox where payload->>'job' = 'crm.sync' order by created_at, dedupe_key",
    );
    const bySeq = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      const key = (r: typeof a) =>
        `${r.payload.type === "order.status_changed" ? "1" : r.payload.type === "lead.created" ? "0" : "2"}`;
      return key(a).localeCompare(key(b)) || Number(a.payload.seq ?? 0) - Number(b.payload.seq ?? 0);
    };
    for (const row of [...rows].sort(bySeq)) {
      await handleCrmSync(d.send, row.payload, row.id);
    }

    const types = new Set(sentLog.map((s) => s.type));
    expect(types).toEqual(
      new Set([
        "lead.created",
        "order.status_changed",
        "payment.confirmed",
        "purchase.recorded",
        "warranty.case_opened",
      ]),
    );
    const refused = sentLog.filter((s) => s.answer.ok !== true);
    expect(refused, JSON.stringify(refused)).toEqual([]);

    // the book: the order is in the status of the platform, with the number of the last event, the receipts, the payments, the reserve
    const order = crm.call("nvReadTable", "orders").find((r: { num: string }) => r.num === o.number);
    expect(order).toMatchObject({ code: "settled", src: "Платформа" });
    const journalSeq = (
      await q<{ s: number }>("select max(seq) as s from sales.order_events where order_id = $1", [o.orderId])
    )[0]?.s;
    expect(order.seq).toBe(journalSeq);
    const purchases = crm.call("nvReadTable", "purchases").filter((p: { order: string }) => p.order === o.number);
    expect(purchases).toHaveLength(8);
    const payments = crm.call("nvReadTable", "payments").filter((p: { order: string }) => p.order === o.number);
    expect(payments.length).toBeGreaterThanOrEqual(3);
    const reserve = crm.call("nvReadTable", "reserves").filter((r: { ref: string }) => r.ref === o.number);
    expect(reserve).toEqual([expect.objectContaining({ fund: "Налоговый риск" })]);
    expect(crm.call("nvReadTable", "warranty").some((r: { num: string }) => r.num === caseNumber)).toBe(true);
  }, 120_000);

  it("takes the requests of the bot as leads of the CRM with the customer by his reference and without the phone", async () => {
    const lead = await leads.create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: 7_800_000_001 } },
      w.bot,
    );
    const facts = await loadLeadFacts(w.workerDb, lead.leadId);
    expect(facts).toMatchObject({ channel: "bot", scope: "pc", customer: { ref: lead.customerId } });
    expect(JSON.stringify(facts)).not.toMatch(/phone|address/i);
  });

  it("sends a full reversal of a payment as the void of the payment it reverses, and not a partial one: the CRM takes no negative sum", async () => {
    const pay = async (orderId: string) => {
      const [p] = await q<{ id: string; amount_sum: string }>(
        "select id, amount_sum::text from sales.payments where order_id = $1 and kind = 'fee_advance' and status = 'confirmed' limit 1",
        [orderId],
      );
      return theRow(p ? [p] : []);
    };
    const reverse = async (id: string, amount: string) =>
      theRow(
        await q<{ id: string }>(
          `insert into sales.payments (order_id, kind, direction, method, amount_sum, status, reversal_of, confirmed_by, confirmed_at, occurred_at, fiscal_receipt_no)
           select order_id, kind, direction, method, ${amount}, 'confirmed', id, 'test', now(), now(), 'FR-X' from sales.payments where id = $1 returning id`,
          [id],
        ),
      ).id;

    const partialOrder = await settledOrder(w);
    const partialOf = await pay(partialOrder.orderId);
    const partial = await reverse(partialOf.id, "-1000");
    expect(await loadPaymentFacts(w.workerDb, partial)).toBeNull();

    const fullOrder = await settledOrder(w);
    const original = await pay(fullOrder.orderId);
    const full = await reverse(original.id, "-amount_sum");
    expect(await loadPaymentFacts(w.workerDb, full)).toMatchObject({
      paymentId: original.id,
      status: "void",
      amountSum: Number(original.amount_sum),
      reversalOf: full,
    });
  }, 120_000);
});
