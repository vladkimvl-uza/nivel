// The server actions: each one hands the form and its ids to the right command, under the right journal name, and asks the
// right pages to refresh. The frame (runAction), the commands and the session are replaced; what is checked is the wiring.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  specs: [] as { name: string; entity: string; entityId?: string | null; revalidate: string[] }[],
  commands: [] as { fn: string; args: unknown[] }[],
  order: { customerId: "cust-1" } as { customerId: string } | undefined,
  outcome: { ok: true, message: "Готово." } as { ok: boolean; message: string; id?: string },
}));

class Redirect extends Error {
  to: string;
  constructor(to: string) {
    super(to);
    this.to = to;
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("./action-runner.ts", () => ({
  runAction: async (
    spec: (typeof calls.specs)[number],
    work: (user: unknown, ip: string | null) => Promise<{ ok: boolean; message: string; id?: string }>,
  ) => {
    calls.specs.push(spec);
    const outcome = await work({ id: "u1", role: "owner" }, "iphash");
    return { ok: outcome.ok, message: outcome.message };
  },
}));
vi.mock("./runtime.ts", () => ({
  ordersCtx: (user: unknown) => ({ ctx: "orders", user }),
  quoteCtx: (user: unknown) => ({ ctx: "quote", user }),
  writerFor: (user: unknown, ip: unknown) => ({ writer: true, user, ip }),
}));
vi.mock("../auth/runtime.ts", () => ({
  getRuntime: () => ({
    db: { query: { orders: { findFirst: async () => calls.order } } },
  }),
}));

const record =
  (fn: string) =>
  async (...args: unknown[]) => {
    calls.commands.push({ fn, args });
    return calls.outcome;
  };
vi.mock("./commands.ts", () => {
  const names = [
    "runEvent",
    "sendQuote",
    "expectPayment",
    "confirmPayment",
    "voidPayment",
    "reversePayment",
    "recordPurchase",
    "recordConsent",
    "generateReport",
    "sendReport",
    "resolveObjection",
    "generateAct",
    "signPaperAct",
    "bindLead",
    "convertLead",
    "requestPdf",
  ];
  return Object.fromEntries(names.map((n) => [n, record(n)]));
});
vi.mock("./quote-editor.ts", () => ({ rebuildQuote: record("rebuildQuote") }));
vi.mock("./writes.ts", () => ({
  savePassport: record("savePassport"),
  openWarrantyCase: record("openWarrantyCase"),
  advanceWarranty: record("advanceWarranty"),
  addOtherIncome: record("addOtherIncome"),
}));

const actions = await import("./actions.ts");

const form = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const IDLE = {};
const O = "order-1";

beforeEach(() => {
  calls.specs.length = 0;
  calls.commands.length = 0;
  calls.order = { customerId: "cust-1" };
  calls.outcome = { ok: true, message: "Готово." };
});

type Case = [string, () => Promise<unknown>, string, string, string];
const CASES: Case[] = [
  [
    "runEventAction",
    () => actions.runEventAction(O, "START_PURCHASE", IDLE, form()),
    "runEvent",
    "orders.event_start_purchase",
    "sales.orders",
  ],
  [
    "rebuildQuoteAction",
    () => actions.rebuildQuoteAction(O, IDLE, form({ change: "recalc" })),
    "rebuildQuote",
    "orders.quote_build",
    "sales.quotes",
  ],
  [
    "sendQuoteAction",
    () => actions.sendQuoteAction(O, "q-1", IDLE, form()),
    "sendQuote",
    "orders.quote_send",
    "sales.quotes",
  ],
  [
    "expectPaymentAction",
    () => actions.expectPaymentAction(O, IDLE, form()),
    "expectPayment",
    "orders.pay_expect",
    "sales.payments",
  ],
  [
    "confirmPaymentAction",
    () => actions.confirmPaymentAction(O, IDLE, form()),
    "confirmPayment",
    "orders.pay_confirm",
    "sales.payments",
  ],
  [
    "voidPaymentAction",
    () => actions.voidPaymentAction(O, IDLE, form()),
    "voidPayment",
    "orders.pay_void",
    "sales.payments",
  ],
  [
    "reversePaymentAction",
    () => actions.reversePaymentAction(O, IDLE, form()),
    "reversePayment",
    "orders.pay_reverse",
    "sales.payments",
  ],
  [
    "recordPurchaseAction",
    () => actions.recordPurchaseAction(O, IDLE, form()),
    "recordPurchase",
    "orders.purchase_record",
    "sales.purchases",
  ],
  [
    "recordConsentAction",
    () => actions.recordConsentAction(O, IDLE, form({ kind: "limit_overrun" })),
    "recordConsent",
    "orders.consent_record",
    "ops.consents",
  ],
  [
    "generateReportAction",
    () => actions.generateReportAction(O, IDLE, form()),
    "generateReport",
    "orders.report_generate",
    "sales.commission_reports",
  ],
  [
    "sendReportAction",
    () => actions.sendReportAction(O, IDLE, form()),
    "sendReport",
    "orders.report_send",
    "sales.commission_reports",
  ],
  [
    "resolveObjectionAction",
    () => actions.resolveObjectionAction(O, IDLE, form()),
    "resolveObjection",
    "orders.objection_resolve",
    "sales.commission_reports",
  ],
  [
    "generateActAction",
    () => actions.generateActAction(O, IDLE, form()),
    "generateAct",
    "orders.act_generate",
    "sales.acts",
  ],
  ["signActAction", () => actions.signActAction(O, IDLE, form()), "signPaperAct", "orders.act_sign", "sales.acts"],
  [
    "savePassportAction",
    () => actions.savePassportAction(O, IDLE, form()),
    "savePassport",
    "orders.passport_save",
    "sales.build_passports",
  ],
  [
    "openWarrantyAction",
    () => actions.openWarrantyAction(O, IDLE, form()),
    "openWarrantyCase",
    "orders.warranty_open",
    "sales.warranty_cases",
  ],
  [
    "advanceWarrantyAction",
    () => actions.advanceWarrantyAction(O, "case-1", IDLE, form()),
    "advanceWarranty",
    "orders.warranty_advance",
    "sales.warranty_cases",
  ],
  [
    "bindLeadAction",
    () => actions.bindLeadAction("lead-1", IDLE, form()),
    "bindLead",
    "orders.lead_bind",
    "sales.leads",
  ],
  [
    "addOtherIncomeAction",
    () => actions.addOtherIncomeAction(IDLE, form()),
    "addOtherIncome",
    "registry.other_income_add",
    "sales.other_income",
  ],
  [
    "requestPdfAction",
    () => actions.requestPdfAction(O, "NV-2026-0001", IDLE, form({ doc: "quote" })),
    "requestPdf",
    "orders.pdf_request",
    "sales.orders",
  ],
];

describe("every action", () => {
  it.each(CASES)("%s calls its command once under its journal name", async (_name, run, command, journal, entity) => {
    const answer = await run();
    expect(answer).toEqual({ ok: true, message: "Готово." });
    expect(calls.commands.map((c) => c.fn)).toEqual([command]);
    expect(calls.specs).toHaveLength(1);
    expect(calls.specs[0]).toMatchObject({ name: journal, entity });
    expect(calls.specs[0]?.revalidate.length).toBeGreaterThan(0);
  });

  it("refreshes the card, the board, the dashboard and the registry after a change of an order", async () => {
    await actions.confirmPaymentAction(O, IDLE, form());
    expect(calls.specs[0]?.revalidate).toEqual([`/orders/${O}`, "/orders", "/dashboard", "/registry"]);
    expect(calls.specs[0]?.entityId).toBe(O);
  });
});

describe("what the actions pass on", () => {
  it("gives the event type and the order to the command, as the person signed in", async () => {
    await actions.runEventAction(O, "FEE_PREPAID", IDLE, form({ paymentId: "p1" }));
    const call = calls.commands[0];
    expect(call?.args[0]).toEqual({ ctx: "orders", user: { id: "u1", role: "owner" } });
    expect(call?.args.slice(1, 3)).toEqual([O, "FEE_PREPAID"]);
    const given = call?.args[3] as { get(n: string): string | null };
    expect(given.get("paymentId")).toBe("p1");
  });

  it("refreshes the page of the estimate after a change of the lines and the sending", async () => {
    await actions.rebuildQuoteAction(O, IDLE, form());
    await actions.sendQuoteAction(O, "q1", IDLE, form());
    for (const spec of calls.specs) expect(spec.revalidate).toContain(`/orders/${O}/quote`);
  });

  it("takes the customer of the consent from the order, not from the form", async () => {
    await actions.recordConsentAction(O, IDLE, form({ kind: "limit_overrun", customerId: "somebody-else" }));
    expect(calls.commands[0]?.args.slice(1, 3)).toEqual([O, "cust-1"]);
  });

  it("says the order is not found when it is gone, and records nothing", async () => {
    calls.order = undefined;
    const answer = await actions.recordConsentAction(O, IDLE, form({ kind: "limit_overrun" }));
    expect(answer).toEqual({ ok: false, message: "Заказ не найден." });
    expect(calls.commands).toHaveLength(0);
  });

  it("gives the writes the person and the hash of the address", async () => {
    await actions.savePassportAction(O, IDLE, form());
    expect(calls.commands[0]?.args[0]).toEqual({ writer: true, user: { id: "u1", role: "owner" }, ip: "iphash" });
  });

  it("passes a refusal on without refreshing the pages itself", async () => {
    calls.outcome = { ok: false, message: "Нужен номер чека." };
    const answer = await actions.confirmPaymentAction(O, IDLE, form());
    expect(answer).toEqual({ ok: false, message: "Нужен номер чека." });
  });
});

describe("taking a request into work", () => {
  it("goes to the new order after a success, and stays where it is after a refusal", async () => {
    calls.outcome = { ok: true, message: "Заказ создан.", id: "order-9" };
    await expect(actions.convertLeadAction("lead-1", IDLE, form())).rejects.toMatchObject({ to: "/orders/order-9" });
    calls.outcome = { ok: false, message: "Нет клиента." };
    await expect(actions.convertLeadAction("lead-1", IDLE, form())).resolves.toEqual({
      ok: false,
      message: "Нет клиента.",
    });
    calls.outcome = { ok: true, message: "Готово." };
    await expect(actions.convertLeadAction("lead-1", IDLE, form())).resolves.toMatchObject({ ok: true });
  });
});
