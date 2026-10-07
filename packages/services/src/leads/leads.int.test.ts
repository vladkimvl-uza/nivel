import { MAX_BUDGET_SUM } from "@nivel/domain/fee";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../orders/errors.ts";
import { createWorld, type World } from "../orders/test-support/world.ts";
import { bindCustomer, budgetBandOf, convert, create } from "./index.ts";

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

  it("takes a lead from the site role, which can neither read phones nor numbers other than L-, and gives it no customer id", async () => {
    const r = await create(
      { channel: "web", scope: "setup", lang: "ru", customer: { phoneE164: "+998901112233", displayName: "Dilnoza" } },
      w.web,
    );
    expect(r.number).toMatch(/^L-2026-/);
    expect(r).not.toHaveProperty("customerId");
    const row = await w.db.$client.query(
      "select l.customer_id, c.phone_e164, c.display_name from sales.leads l left join sales.customers c on c.id = l.customer_id where l.id = $1",
      [r.leadId],
    );
    expect(row.rows[0]).toEqual({
      customer_id: expect.any(String),
      phone_e164: "+998901112233",
      display_name: "Dilnoza",
    });
  });

  it("answers the site the same whether the phone is already a customer or not: the lead is taken, the contact is kept for the owner", async () => {
    const first = await create(
      { channel: "web", scope: "pc", customer: { phoneE164: "+998901112244", displayName: "Aziz" } },
      w.web,
    );
    const again = await create(
      { channel: "web", scope: "setup", comment: "Second try", customer: { phoneE164: "+998901112244" } },
      w.web,
    );
    expect(Object.keys(again).sort()).toEqual(Object.keys(first).sort());
    expect(again.number).toMatch(/^L-2026-\d{4}$/);
    const row = (
      await w.db.$client.query(
        "select customer_id, comment, contact_phone, contact_name, contact_username from sales.leads where id = $1",
        [again.leadId],
      )
    ).rows[0];
    // The contact has its own columns (kept like the request); the comment is the words of the person and nothing else.
    expect(row).toEqual({
      customer_id: null,
      comment: "Second try",
      contact_phone: "+998901112244",
      contact_name: null,
      contact_username: null,
    });
    // The owner is told about it like about any lead.
    expect(await outboxOf(again.leadId)).toHaveLength(1);
    // The lead without a customer cannot become an order until the owner links it.
    await expect(convert({ leadId: again.leadId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ code: "lead_without_customer" }],
    });
  });

  it("does not take a Telegram id from the site: it cannot know whose it is", async () => {
    const bot = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const stolen = (
      await w.db.$client.query("select telegram_user_id from sales.customers where id = $1", [bot.customerId])
    ).rows[0].telegram_user_id;
    await expect(
      create({ channel: "web", scope: "pc", customer: { telegramUserId: Number(stolen) } }, w.web),
    ).rejects.toMatchObject({ issues: [{ path: "customer.telegramUserId", code: "telegram_id_not_allowed" }] });
  });

  it("gives one customer to two requests that come at once with the same new Telegram id or phone, for every role that can look", async () => {
    for (const rt of [w.bot, w.admin]) {
      const id = newTelegram();
      const both = await Promise.allSettled([
        create({ channel: "bot", scope: "pc", customer: { telegramUserId: id } }, rt),
        create({ channel: "bot", scope: "setup", customer: { telegramUserId: id } }, rt),
      ]);
      expect(both.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
      const [a, b] = both.map((x) => (x as PromiseFulfilledResult<{ customerId?: string }>).value.customerId);
      expect(a).toBeDefined();
      expect(a).toBe(b);
      const phone = `+99890${String(Math.floor(1_000_000 + Math.random() * 8_000_000))}`;
      const byPhone = await Promise.allSettled([
        create({ channel: "bot", scope: "pc", customer: { phoneE164: phone } }, rt),
        create({ channel: "bot", scope: "pc", customer: { phoneE164: phone } }, rt),
      ]);
      expect(byPhone.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
      const [c, d] = byPhone.map((x) => (x as PromiseFulfilledResult<{ customerId?: string }>).value.customerId);
      expect(c).toBe(d);
    }
  });

  it("finds the customer of the same phone for the roles that may read it", async () => {
    const a = await create({ channel: "bot", scope: "pc", customer: { phoneE164: "+998907770011" } }, w.bot);
    const b = await create({ channel: "bot", scope: "pc", customer: { phoneE164: "+998907770011" } }, w.bot);
    expect(b.customerId).toBe(a.customerId);
  });

  it("attaches the lead to a customer that exists and refuses one that does not", async () => {
    const a = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    const b = await create({ channel: "admin", scope: "pc", customerId: a.customerId as string }, w.admin);
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

  it("refuses a customer that is not an object and fields of the wrong type with a validation error, never a TypeError", async () => {
    const customers: unknown[] = [
      null,
      "x",
      5,
      [],
      { phoneE164: ["+998901112233"] },
      { phoneE164: 998901112233 },
      { age18Confirmed: "yes" },
      { telegramUserId: "7" },
      { displayName: 5 },
    ];
    for (const customer of customers) {
      for (const rt of [w.bot, w.web]) {
        await expect(create({ channel: "bot", scope: "pc", customer: customer as never }, rt)).rejects.toMatchObject({
          name: "ValidationError",
        });
      }
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

  it("refuses a day that is not in the calendar and a configuration that does not exist, with a validation error", async () => {
    for (const wantedBy of ["2026-02-31", "2026-04-31", "2027-02-29"]) {
      await expect(
        create({ channel: "bot", scope: "pc", wantedBy, customer: { telegramUserId: newTelegram() } }, w.bot),
      ).rejects.toMatchObject({ name: "ValidationError", issues: [{ path: "wantedBy", code: "date_invalid" }] });
    }
    await expect(
      create(
        {
          channel: "bot",
          scope: "pc",
          configurationId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
          customer: { telegramUserId: newTelegram() },
        },
        w.bot,
      ),
    ).rejects.toMatchObject({
      name: "ValidationError",
      issues: [{ path: "configurationId", code: "configuration_unknown" }],
    });
  });

  it("limits the free texts of the lead, which go to the owner in a message", async () => {
    const base = { channel: "bot", scope: "pc" } as const;
    await expect(
      create({ ...base, district: "x".repeat(81), customer: { telegramUserId: newTelegram() } }, w.bot),
    ).rejects.toMatchObject({ issues: [{ path: "district", code: "text_invalid" }] });
    await expect(
      create({ ...base, customer: { telegramUserId: newTelegram(), displayName: "x".repeat(121) } }, w.bot),
    ).rejects.toMatchObject({ issues: [{ path: "customer.displayName", code: "text_invalid" }] });
    await expect(
      create({ ...base, utm: { source: "x".repeat(201) }, customer: { telegramUserId: newTelegram() } }, w.bot),
    ).rejects.toMatchObject({ issues: [{ path: "utm", code: "utm_invalid" }] });
    await expect(
      create(
        {
          ...base,
          utm: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])),
          customer: { telegramUserId: newTelegram() },
        },
        w.bot,
      ),
    ).rejects.toMatchObject({ issues: [{ path: "utm", code: "utm_invalid" }] });
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
      convert({ leadId: lead.leadId }, { kind: "customer", id: lead.customerId as string }, w.admin),
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

describe("leads.create: the contact of a request that has no customer", () => {
  it("keeps the name, the phone and the Telegram name of the site in the columns of the request, not in the comment", async () => {
    await create({ channel: "web", scope: "pc", customer: { phoneE164: "+998901112255", displayName: "Aziz" } }, w.web);
    const again = await create(
      {
        channel: "web",
        scope: "pc",
        comment: "After five please",
        customer: { phoneE164: "+998901112255", displayName: "Aziz T.", telegramUsername: "aziz_t" },
      },
      w.web,
    );
    const row = (
      await w.db.$client.query(
        "select customer_id, comment, contact_phone, contact_name, contact_username from sales.leads where id = $1",
        [again.leadId],
      )
    ).rows[0];
    expect(row).toEqual({
      customer_id: null,
      comment: "After five please",
      contact_phone: "+998901112255",
      contact_name: "Aziz T.",
      contact_username: "aziz_t",
    });
  });

  it("leaves the columns empty when the request has a customer, and a request without a comment has no comment", async () => {
    const r = await create(
      { channel: "web", scope: "pc", customer: { phoneE164: "+998901112266", displayName: "Dilnoza" } },
      w.web,
    );
    const row = (
      await w.db.$client.query("select comment, contact_phone, contact_name from sales.leads where id = $1", [r.leadId])
    ).rows[0];
    expect(row).toEqual({ comment: null, contact_phone: null, contact_name: null });
    const twin = await create({ channel: "web", scope: "pc", customer: { phoneE164: "+998901112266" } }, w.web);
    const twinRow = (
      await w.db.$client.query("select comment, contact_phone from sales.leads where id = $1", [twin.leadId])
    ).rows[0];
    expect(twinRow).toEqual({ comment: null, contact_phone: "+998901112266" });
  });
});

describe("leads.bindCustomer", () => {
  async function unlinked(phone: string) {
    await create({ channel: "web", scope: "pc", customer: { phoneE164: phone, displayName: "First" } }, w.web);
    return create({ channel: "web", scope: "pc", customer: { phoneE164: phone } }, w.web);
  }
  const customerOfLead = async (leadId: string) =>
    (await w.db.$client.query("select customer_id from sales.leads where id = $1", [leadId])).rows[0].customer_id;

  it("links the request to the customer the owner chose, writes the audit row, and lets the request become an order", async () => {
    const lead = await unlinked("+998901113301");
    const customerId = await newCustomerId();
    const r = await bindCustomer({ leadId: lead.leadId, customerId }, owner(), w.admin);
    expect(r).toEqual({ bound: true });
    expect(await customerOfLead(lead.leadId)).toBe(customerId);
    const { rows } = await w.db.$client.query(
      "select actor, action, before, after from ops.audit_log where entity = 'sales.leads' and entity_id = $1",
      [lead.leadId],
    );
    expect(rows).toEqual([
      {
        actor: `owner:${w.owner.id}`,
        action: "lead.bind_customer",
        before: { customerId: null },
        after: { customerId },
      },
    ]);
    const order = await convert({ leadId: lead.leadId }, owner(), w.admin);
    expect(order.created).toBe(true);
  });

  it("is for the assistant too, and repeated for the same customer it does nothing and writes no second audit row", async () => {
    const lead = await unlinked("+998901113302");
    const customerId = await newCustomerId();
    const a = { kind: "assistant" as const, id: w.assistant.id };
    expect(await bindCustomer({ leadId: lead.leadId, customerId }, a, w.admin)).toEqual({ bound: true });
    expect(await bindCustomer({ leadId: lead.leadId, customerId }, owner(), w.admin)).toEqual({ bound: false });
    const audit = await w.db.$client.query(
      "select 1 from ops.audit_log where entity = 'sales.leads' and entity_id = $1 and action = 'lead.bind_customer'",
      [lead.leadId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("never replaces a customer: another customer is a validation error and the request stays as it was", async () => {
    const lead = await unlinked("+998901113303");
    const first = await newCustomerId();
    const second = await newCustomerId();
    await bindCustomer({ leadId: lead.leadId, customerId: first }, owner(), w.admin);
    await expect(bindCustomer({ leadId: lead.leadId, customerId: second }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ path: "leadId", code: "lead_already_bound" }],
    });
    expect(await customerOfLead(lead.leadId)).toBe(first);
  });

  it("is the admin role's alone: the bot, the site and the worker are refused, and so are the customer and the system", async () => {
    const lead = await unlinked("+998901113304");
    const customerId = await newCustomerId();
    for (const rt of [w.bot, w.web, w.worker]) {
      await expect(bindCustomer({ leadId: lead.leadId, customerId }, owner(), rt)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    for (const actor of [
      { kind: "customer" as const, id: customerId },
      { kind: "system" as const, id: "system" },
    ]) {
      await expect(bindCustomer({ leadId: lead.leadId, customerId }, actor, w.admin)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(await customerOfLead(lead.leadId)).toBeNull();
  });

  it("refuses an unknown request or customer and an id that is not a uuid", async () => {
    const lead = await unlinked("+998901113305");
    const customerId = await newCustomerId();
    const missing = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    await expect(bindCustomer({ leadId: missing, customerId }, owner(), w.admin)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bindCustomer({ leadId: lead.leadId, customerId: missing }, owner(), w.admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(bindCustomer({ leadId: "L-1", customerId }, owner(), w.admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(bindCustomer({ leadId: lead.leadId, customerId: "x" }, owner(), w.admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await customerOfLead(lead.leadId)).toBeNull();
  });

  it("serves two owners who press at once: one customer wins, the other is told the request is bound", async () => {
    const lead = await unlinked("+998901113306");
    const a = await newCustomerId();
    const b = await newCustomerId();
    const results = await Promise.allSettled([
      bindCustomer({ leadId: lead.leadId, customerId: a }, owner(), w.admin),
      bindCustomer({ leadId: lead.leadId, customerId: b }, owner(), w.admin),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ issues: [{ code: "lead_already_bound" }] });
    expect([a, b]).toContain(await customerOfLead(lead.leadId));
  });
});

async function newCustomerId(): Promise<string> {
  const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
  return lead.customerId as string;
}

describe("a customer that the 12-month erasure made anonymous", () => {
  const erase = (customerId: string) =>
    w.db.$client.query(
      `update sales.customers set erased_at = now(), display_name = null, phone_e164 = null, telegram_user_id = null,
              telegram_username = null, address = null where id = $1`,
      [customerId],
    );

  it("does not become an order: the owner cannot convert a request of an erased customer", async () => {
    const lead = await create({ channel: "bot", scope: "pc", customer: { telegramUserId: newTelegram() } }, w.bot);
    await erase(lead.customerId as string);
    await expect(convert({ leadId: lead.leadId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ path: "leadId", code: "customer_erased" }],
    });
    const orders = await w.db.$client.query("select count(*)::int as n from sales.orders where lead_id = $1", [
      lead.leadId,
    ]);
    expect(orders.rows[0].n).toBe(0);
  });

  it("is not bound to a request: the owner cannot choose an erased customer", async () => {
    const lead = await create(
      { channel: "web", scope: "pc", customer: { phoneE164: "+998901113399", displayName: "First" } },
      w.web,
    );
    const second = await create({ channel: "web", scope: "pc", customer: { phoneE164: "+998901113399" } }, w.web);
    expect(lead.leadId).not.toBe(second.leadId);
    const customerId = await newCustomerId();
    await erase(customerId);
    await expect(bindCustomer({ leadId: second.leadId, customerId }, owner(), w.admin)).rejects.toMatchObject({
      issues: [{ path: "customerId", code: "customer_erased" }],
    });
    const row = await w.db.$client.query("select customer_id from sales.leads where id = $1", [second.leadId]);
    expect(row.rows[0].customer_id).toBeNull();
  });
});
