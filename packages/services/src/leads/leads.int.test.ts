import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { createWorld, type World } from "../test-support/world.ts";
import { budgetBandOf, convert, create } from "./index.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const owner = () => ({ kind: "owner" as const, id: w.owner.id });
let telegram = 7_300_000_000;
const newTelegram = () => {
  telegram += 1;
  return telegram;
};

async function outboxOf(leadId: string) {
  const { rows } = await w.db.$client.query("select kind, payload, dedupe_key from ops.outbox where dedupe_key = $1", [
    `lead:${leadId}:created`,
  ]);
  return rows;
}

describe("leads.create", () => {
  it("opens a lead of the bot with a new customer, a number L-<year>-NNNN and a message to the owner", async () => {
    const r = await create(
      {
        channel: "bot",
        scope: "pc",
        district: "Chilonzor",
        budgetSum: 15_000_000,
        customer: { telegramUserId: newTelegram() },
      },
      w.bot,
    );
    expect(r.number).toMatch(/^L-2026-\d{4}$/);
    const rows = await outboxOf(r.leadId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("telegram_message");
    expect(rows[0].payload).toMatchObject({
      target: "owner_topic",
      templateKey: "lead.created",
      leadId: r.leadId,
      params: { number: r.number, scope: "pc", district: "Chilonzor", budgetBand: "12m_20m" },
    });
    const lead = await w.db.$client.query("select status, channel, budget_band, lang from sales.leads where id = $1", [
      r.leadId,
    ]);
    expect(lead.rows[0]).toEqual({ status: "new", channel: "bot", budget_band: "12m_20m", lang: "uz" });
  });

  it("numbers the leads one after another without gaps", async () => {
    const a = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const b = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const n = (s: string) => Number(s.split("-")[2]);
    expect(n(b.number)).toBe(n(a.number) + 1);
  });

  it("numbers by the year of the business calendar of Tashkent, not of the server", async () => {
    w.clock.set(new Date("2026-12-31T20:00:00Z")); // 01:00 on 1 January 2027 in Tashkent
    try {
      const r = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
      expect(r.number).toMatch(/^L-2027-0001$/);
    } finally {
      w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    }
  });

  it("reuses the customer of the same Telegram id", async () => {
    const id = newTelegram();
    const a = await create(
      { channel: "bot", scope: "pc", customer: { telegramUserId: id, displayName: "Aziz" } },
      w.bot,
    );
    const b = await create({ channel: "bot", scope: "setup", customer: { telegramUserId: id } }, w.bot);
    expect(b.customerId).toBe(a.customerId);
    expect(b.leadId).not.toBe(a.leadId);
  });

  it("takes a lead from the site role, which can neither read phones nor numbers other than L-", async () => {
    const r = await create(
      { channel: "web", scope: "setup", lang: "ru", customer: { phoneE164: "+998901112233", displayName: "Dilnoza" } },
      w.web,
    );
    expect(r.number).toMatch(/^L-2026-/);
    const again = create({ channel: "web", scope: "setup", customer: { phoneE164: "+998901112233" } }, w.web);
    await expect(again).rejects.toMatchObject({ issues: [{ code: "customer_exists" }] });
  });

  it("finds the customer of the same phone for the roles that may read it", async () => {
    const a = await create({ channel: "bot", scope: "pc", customer: { phoneE164: "+998907770011" } }, w.bot);
    const b = await create({ channel: "bot", scope: "pc", customer: { phoneE164: "+998907770011" } }, w.bot);
    expect(b.customerId).toBe(a.customerId);
  });

  it("attaches the lead to a customer that exists and refuses one that does not", async () => {
    const a = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const b = await create({ channel: "admin", scope: "pc", customerId: a.customerId }, w.admin);
    expect(b.customerId).toBe(a.customerId);
    await expect(
      create({ channel: "admin", scope: "pc", customerId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, w.admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps a budget at the limit and refuses a budget above it", async () => {
    const ok = await create(
      { channel: "bot", scope: "pc", budgetSum: MAX_BUDGET_SUM, customer: { telegramUserId: newTelegram() } },
      w.bot,
    );
    expect(ok.number).toBeTruthy();
    for (const budgetSum of [MAX_BUDGET_SUM + 1, -1, 1.5, Number.NaN]) {
      await expect(
        create({ channel: "bot", scope: "pc", budgetSum, customer: { telegramUserId: newTelegram() } }, w.bot),
      ).rejects.toMatchObject({ issues: [{ path: "budgetSum", code: "sum_invalid" }] });
    }
  });

  it("refuses a lead without a customer, an unknown scope and a bad phone with a validation error", async () => {
    await expect(create({ channel: "bot", scope: "pc" }, w.bot)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ channel: "bot", scope: "laptop" as never, customer: { telegramUserId: newTelegram() } }, w.bot),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ channel: "bot", scope: "pc", customer: { phoneE164: "901234567" } }, w.bot),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create(
        { channel: "bot", scope: "pc", wantedBy: "2026-13-40", customer: { telegramUserId: newTelegram() } },
        w.bot,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("writes nothing when a part of it fails: the number is not burnt, there is no customer without a lead", async () => {
    const before = await w.db.$client.query("select count(*)::int as n from sales.customers");
    await expect(
      create({ channel: "bot", scope: "pc", budgetSum: -5, customer: { telegramUserId: newTelegram() } }, w.bot),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await w.db.$client.query("select count(*)::int as n from sales.customers");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe("budgetBandOf", () => {
  it("cuts the budget on the bounds of the tiers of the autobuild", () => {
    expect(budgetBandOf(0)).toBe("lt_6_7m");
    expect(budgetBandOf(6_699_999)).toBe("lt_6_7m");
    expect(budgetBandOf(6_700_000)).toBe("6_7m_12m");
    expect(budgetBandOf(11_999_999)).toBe("6_7m_12m");
    expect(budgetBandOf(12_000_000)).toBe("12m_20m");
    expect(budgetBandOf(20_000_000)).toBe("20m_35m");
    expect(budgetBandOf(35_000_000)).toBe("gte_35m");
    expect(budgetBandOf(undefined)).toBeNull();
  });
});

describe("leads.convert", () => {
  it("turns a lead into an order NV-<year>-NNNN of the right kind and marks the lead converted", async () => {
    const lead = await create({ channel: "bot", scope: "setup", customer: { telegramUserId: newTelegram() } }, w.bot);
    const r = await convert({ leadId: lead.leadId }, owner(), w.admin);
    expect(r.created).toBe(true);
    expect(r.number).toMatch(/^NV-2026-\d{4}$/);
    const order = await w.db.$client.query(
      "select kind, status, customer_id, lead_id from sales.orders where id = $1",
      [r.orderId],
    );
    expect(order.rows[0]).toEqual({
      kind: "setup",
      status: "estimate_draft",
      customer_id: lead.customerId,
      lead_id: lead.leadId,
    });
    const status = await w.db.$client.query("select status from sales.leads where id = $1", [lead.leadId]);
    expect(status.rows[0].status).toBe("converted");
  });

  it.each([
    ["pc", "pc"],
    ["pc_periph", "pc"],
    ["podbor", "podbor"],
  ] as const)("maps the scope %s to the kind %s", async (scope, kind) => {
    const lead = await create({ channel: "bot", scope, customer: { telegramUserId: newTelegram() } }, w.bot);
    const r = await convert({ leadId: lead.leadId }, owner(), w.admin);
    const order = await w.db.$client.query("select kind from sales.orders where id = $1", [r.orderId]);
    expect(order.rows[0].kind).toBe(kind);
  });

  it("is idempotent: a second call returns the same order and takes no new number", async () => {
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const a = await convert({ leadId: lead.leadId }, owner(), w.admin);
    const b = await convert({ leadId: lead.leadId }, owner(), w.admin);
    expect(b).toEqual({ orderId: a.orderId, number: a.number, created: false });
  });

  it("creates one order when two owners press the button at once", async () => {
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const [a, b] = await Promise.all([
      convert({ leadId: lead.leadId }, owner(), w.admin),
      convert({ leadId: lead.leadId }, owner(), w.admin),
    ]);
    expect(a.orderId).toBe(b.orderId);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it("takes the number of an order only for the admin role (the database gives NV- numbers to nobody else)", async () => {
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    await expect(convert({ leadId: lead.leadId }, owner(), w.bot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(convert({ leadId: lead.leadId }, owner(), w.web)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is for the owner and the assistant, not for the customer or the system", async () => {
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    await expect(
      convert({ leadId: lead.leadId }, { kind: "customer", id: lead.customerId }, w.admin),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(convert({ leadId: lead.leadId }, { kind: "system", id: "system" }, w.admin)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const ok = await convert({ leadId: lead.leadId }, { kind: "assistant", id: w.assistant.id }, w.admin);
    expect(ok.created).toBe(true);
  });

  it("refuses an unknown lead, an id that is not a uuid and a lead that was rejected", async () => {
    await expect(convert({ leadId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, owner(), w.admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(convert({ leadId: "L-2026-0001" }, owner(), w.admin)).rejects.toBeInstanceOf(ValidationError);
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    await w.db.$client.query("update sales.leads set status = 'rejected', reject_reason = 'too small' where id = $1", [
      lead.leadId,
    ]);
    await expect(convert({ leadId: lead.leadId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "lead_not_open" }],
    });
  });

  it("journals the conversion in the audit log", async () => {
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const r = await convert({ leadId: lead.leadId }, owner(), w.admin);
    const { rows } = await w.db.$client.query(
      "select actor, action, after from ops.audit_log where entity = 'sales.leads' and entity_id = $1",
      [lead.leadId],
    );
    expect(rows).toEqual([
      { actor: `owner:${w.owner.id}`, action: "lead.convert", after: { orderId: r.orderId, number: r.number } },
    ]);
  });
});
