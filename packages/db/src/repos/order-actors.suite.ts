import { orderTransitionTable } from "@nivel/domain/order";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyError,
  connectAs,
  createOrder,
  driveTo,
  insertAdminUser,
  insertOfferStub,
  one,
  orderState,
  pgError,
  transition,
  uniq,
} from "./testkit.ts";

// ARCHITECTURE 4.9, 4.13, 3.2: who may call sales.apply_transition(), as whom, and which order fields they may write
// with an event. The second line of defence after packages/domain; the graph itself is in orders.suite.ts.
let migrator: pg.Client;
let admin: pg.Client;
let web: pg.Client;
let worker: pg.Client;
let bot: pg.Client;

beforeAll(async () => {
  migrator = await connectAs("MIGRATOR");
  admin = await connectAs("ADMIN");
  web = await connectAs("WEB");
  worker = await connectAs("WORKER");
  bot = await connectAs("BOT");
});
afterAll(async () => {
  for (const c of [migrator, admin, web, worker, bot]) await c.end();
});

// A NULL passes every `<>` and `NOT IN` test of the function (the comparison is unknown, not true), so a missing actor
// or event has to be refused by name before any other check, whatever the role of the caller.
describe("a call without an actor or an event is refused by name", () => {
  const ROLES = ["MIGRATOR", "ADMIN", "WEB", "BOT", "WORKER"] as const;
  const clientOf = (role: (typeof ROLES)[number]) =>
    ({ MIGRATOR: migrator, ADMIN: admin, WEB: web, BOT: bot, WORKER: worker })[role];
  const call = (client: pg.Client, orderId: string, event: string | null, kind: string | null, id: string | null) =>
    pgError(client, "select * from sales.apply_transition($1, $2::jsonb, $3, $4)", [orderId, event, kind, id]);
  const SEND = '{"type":"SEND_ESTIMATE"}';

  it.each(ROLES)("%s: no actor kind is invalid_actor, not a NOT NULL violation of the journal", async (role) => {
    const { orderId } = await createOrder(migrator);
    const e = await call(clientOf(role), orderId, SEND, null, "x");
    expect(e.message).toMatch(/^invalid_actor/);
    expect(e.code).toBe("22023");
    expect(await orderState(migrator, orderId)).toEqual({ status: "estimate_draft", events: "0" });
  });

  it.each(ROLES)("%s: no event is invalid_event", async (role) => {
    const { orderId } = await createOrder(migrator);
    const e = await call(clientOf(role), orderId, null, "owner", "x");
    expect(e.message).toMatch(/^invalid_event/);
    expect(e.code).toBe("22023");
    expect(await orderState(migrator, orderId)).toEqual({ status: "estimate_draft", events: "0" });
  });

  it.each([
    ["JSON null", "null"],
    ["an array", '["SEND_ESTIMATE"]'],
    ["a string", '"SEND_ESTIMATE"'],
    ["an object with a null type", '{"type":null}'],
  ])("refuses an event that is %s", async (_what, event) => {
    const { orderId } = await createOrder(migrator);
    const e = await call(admin, orderId, event, "owner", "x");
    expect(e.message).toMatch(/^invalid_event/);
    expect(await orderState(migrator, orderId)).toEqual({ status: "estimate_draft", events: "0" });
  });

  it.each([
    ["NULL", null],
    ["empty", ""],
    ["blank", "   "],
  ])("refuses an actor id that is %s: the journal would carry nobody", async (_what, id) => {
    const { orderId } = await createOrder(migrator);
    for (const client of [admin, bot, web]) {
      const kind = client === web ? "customer" : "owner";
      const event = client === web ? '{"type":"ACCEPT"}' : SEND;
      const e = await call(client, orderId, event, kind, id);
      expect(e.message, `${kind} with a ${_what} id`).toMatch(/^invalid_actor/);
      expect(e.code).toBe("22023");
    }
    expect(await orderState(migrator, orderId)).toEqual({ status: "estimate_draft", events: "0" });
  });

  it("names the missing actor before the right of the role to call", async () => {
    const { orderId } = await createOrder(migrator);
    // The site may act only as the customer and the worker only as the system: with no kind the answer is the same.
    for (const client of [web, worker]) {
      expect((await call(client, orderId, SEND, null, "x")).message).toMatch(/^invalid_actor/);
    }
  });
});

// The bot lives in the group of the owner and acts for the owner and the assistant, so its word alone is not enough:
// anybody who holds the credentials of nivel_bot could otherwise name any actor. The function checks the actor id
// against the accounts of the admin panel. ops.admin_users.telegram_user_id is a bigint, p_actor_id is text: the id
// is compared as the canonical text of the number, so '+123', ' 123', '0123' and '123.0' are not the account 123.
describe("the bot speaks for the owner and the assistant only as an active account of that role", () => {
  const send = (orderId: string, event: string, kind: string, actorId: string) =>
    pgError(bot, "select * from sales.apply_transition($1, $2::jsonb, $3, $4)", [
      orderId,
      JSON.stringify({ type: event }),
      kind,
      actorId,
    ]);
  const NOT_AN_ACCOUNT = /actor_not_allowed: .* is not the Telegram id of an active (owner|assistant) account/;

  type Account = Awaited<ReturnType<typeof insertAdminUser>>;
  /** The Telegram id of an account that has one. */
  const tg = (a: Account): string => {
    if (a.telegramId === null) throw new Error("the account has no Telegram id");
    return a.telegramId;
  };
  let owner: Account;
  let assistant: Account;
  let inactiveOwner: Account;
  let translator: Account;
  let accountant: Account;
  let noTelegram: Account;
  beforeAll(async () => {
    owner = await insertAdminUser(migrator, { role: "owner" });
    assistant = await insertAdminUser(migrator, { role: "assistant" });
    inactiveOwner = await insertAdminUser(migrator, { role: "owner", active: false });
    translator = await insertAdminUser(migrator, { role: "translator" });
    accountant = await insertAdminUser(migrator, { role: "accountant" });
    noTelegram = await insertAdminUser(migrator, { role: "owner", telegramUserId: null });
  });

  it("lets the bot send an owner event with the Telegram id of an active owner, and journals that id and the role", async () => {
    const { orderId } = await createOrder(migrator);
    const r = await transition(bot, orderId, "SEND_ESTIMATE", { actorKind: "owner", actorId: tg(owner) });
    expect(r).toMatchObject({ from: "estimate_draft", to: "estimate_sent" });
    const event = await one(migrator, "select actor_kind, actor_id from sales.order_events where order_id = $1", [
      orderId,
    ]);
    expect(event).toEqual({ actor_kind: "owner", actor_id: owner.telegramId });
    const audit = await one(
      migrator,
      "select actor, after ->> 'db_role' as role from ops.audit_log where entity_id = $1",
      [orderId],
    );
    expect(audit).toEqual({ actor: `owner:${owner.telegramId}`, role: "nivel_bot" });
  });

  it("lets the bot send the events of the assistant with the Telegram id of an active assistant", async () => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, "purchasing");
    const r = await transition(bot, orderId, "PURCHASE_RECORDED", {
      actorKind: "assistant",
      actorId: tg(assistant),
    });
    expect(r.to).toBe("purchasing");
  });

  it("still keeps the assistant from the money events, with the id of its own account", async () => {
    const { orderId } = await createOrder(migrator);
    const e = await send(orderId, "SEND_ESTIMATE", "assistant", tg(assistant));
    expect(e.message).toMatch(/actor_not_allowed: assistant cannot send SEND_ESTIMATE/);
    expect(e.code).toBe("42501");
  });

  const REFUSED: [what: string, kind: string, event: string, id: () => string][] = [
    ["an unknown Telegram id", "owner", "SEND_ESTIMATE", () => "6999999999"],
    ["the id of an assistant account, as the owner", "owner", "SEND_ESTIMATE", () => tg(assistant)],
    ["the id of an owner account, as the assistant", "assistant", "PURCHASE_RECORDED", () => tg(owner)],
    ["the id of an owner account that is not active", "owner", "SEND_ESTIMATE", () => tg(inactiveOwner)],
    ["the id of a translator, as the owner", "owner", "SEND_ESTIMATE", () => tg(translator)],
    ["the id of an accountant, as the owner", "owner", "SEND_ESTIMATE", () => tg(accountant)],
    ["the id of the account row instead of the Telegram id", "owner", "SEND_ESTIMATE", () => owner.id],
    ["the text 'null' for an account without Telegram", "owner", "SEND_ESTIMATE", () => "null"],
    ["the text 'system'", "owner", "SEND_ESTIMATE", () => "system"],
    ["a text that is not a number", "owner", "SEND_ESTIMATE", () => "abc"],
    ["the id of the owner with a plus sign", "owner", "SEND_ESTIMATE", () => `+${tg(owner)}`],
    ["the id of the owner with a leading zero", "owner", "SEND_ESTIMATE", () => `0${tg(owner)}`],
    ["the id of the owner with a leading space", "owner", "SEND_ESTIMATE", () => ` ${tg(owner)}`],
    ["the id of the owner with a trailing space", "owner", "SEND_ESTIMATE", () => `${tg(owner)} `],
    ["the id of the owner as a decimal", "owner", "SEND_ESTIMATE", () => `${tg(owner)}.0`],
    ["the id of the owner followed by a SQL fragment", "owner", "SEND_ESTIMATE", () => `${tg(owner)}' or '1'='1`],
    ["a SQL fragment", "owner", "SEND_ESTIMATE", () => "1 or 1=1"],
  ];
  it.each(REFUSED)("refuses %s", async (_what, kind, event, id) => {
    const { orderId } = await createOrder(migrator);
    const e = await send(orderId, event, kind, id());
    expect(e.message).toMatch(NOT_AN_ACCOUNT);
    expect(e.code).toBe("42501");
    expect(await orderState(migrator, orderId)).toEqual({ status: "estimate_draft", events: "0" });
  });

  it("refuses an account that has no Telegram id whatever id is named", async () => {
    expect(noTelegram.telegramId).toBeNull();
    const { orderId } = await createOrder(migrator);
    for (const id of ["0", "1", noTelegram.id]) {
      expect((await send(orderId, "SEND_ESTIMATE", "owner", id)).message).toMatch(NOT_AN_ACCOUNT);
    }
  });

  it("follows the account: a deactivated owner loses the right at once and gets it back when reactivated", async () => {
    const own = await insertAdminUser(migrator, { role: "owner" });
    const { orderId } = await createOrder(migrator);
    await migrator.query("update ops.admin_users set active = false where id = $1", [own.id]);
    expect((await send(orderId, "SEND_ESTIMATE", "owner", tg(own))).message).toMatch(NOT_AN_ACCOUNT);
    await migrator.query("update ops.admin_users set active = true where id = $1", [own.id]);
    const r = await transition(bot, orderId, "SEND_ESTIMATE", { actorKind: "owner", actorId: tg(own) });
    expect(r.to).toBe("estimate_sent");
  });

  it("finds the one account of the Telegram id and judges its role and state", async () => {
    const shared = 6_500_000_000 + uniq();
    const own = await insertAdminUser(migrator, { role: "assistant", telegramUserId: shared, active: false });
    const { orderId } = await createOrder(migrator);
    // Inactive: the owner's name is refused whatever the role of the account.
    expect((await send(orderId, "SEND_ESTIMATE", "owner", String(shared))).message).toMatch(NOT_AN_ACCOUNT);
    // Active, but it is the assistant's account: the owner's name is refused.
    await migrator.query("update ops.admin_users set active = true where id = $1", [own.id]);
    expect((await send(orderId, "SEND_ESTIMATE", "owner", String(shared))).message).toMatch(NOT_AN_ACCOUNT);
    // The same account promoted to the owner: now the owner's name passes.
    await migrator.query("update ops.admin_users set role = 'owner' where id = $1", [own.id]);
    const r = await transition(bot, orderId, "SEND_ESTIMATE", { actorKind: "owner", actorId: String(shared) });
    expect(r.to).toBe("estimate_sent");
  });

  it("leaves the identity of a customer to the application, and the admin panel authenticates its own people", async () => {
    const { orderId } = await createOrder(migrator);
    await transition(admin, orderId, "SEND_ESTIMATE", { actorId: "nobody-in-particular" });
    expect((await transition(bot, orderId, "ACCEPT", { actorId: "whoever-the-bot-names" })).to).toBe("accepted");
  });
});

// The fields an actor may write with an event are a whitelist of the pair (actor, event), not of the actor alone: the
// objection of a customer must not move the acceptance time, nor the acceptance the handover and the warranty.
const CHANGEABLE = [
  "fee_prepaid",
  "funds_received",
  "funds_received_at",
  "purchase_not_before",
  "first_order_meeting_done",
  "current_quote_id",
  "offer_version_uz_id",
  "offer_version_ru_id",
  "accepted_at",
  "report_due_at",
  "objection_until",
  "refund_due_at",
  "handed_over_at",
  "warranty_until",
  "podbor_credit_until",
  "cancel",
  "documented_losses_sum",
] as const;
/** A value of the right type for each field: the whitelist is checked before the value is used. */
const SAMPLE: Record<(typeof CHANGEABLE)[number], unknown> = {
  fee_prepaid: true,
  funds_received: true,
  funds_received_at: "2026-10-07T05:00:00Z",
  purchase_not_before: "2026-10-07T05:00:00Z",
  first_order_meeting_done: true,
  current_quote_id: "00000000-0000-7000-8000-000000000001",
  offer_version_uz_id: "00000000-0000-7000-8000-000000000001",
  offer_version_ru_id: "00000000-0000-7000-8000-000000000001",
  accepted_at: "2026-10-07T05:00:00Z",
  report_due_at: "2026-10-07T05:00:00Z",
  objection_until: "2026-10-07T05:00:00Z",
  refund_due_at: "2026-10-07T05:00:00Z",
  handed_over_at: "2026-10-07T05:00:00Z",
  warranty_until: "2026-10-07T05:00:00Z",
  podbor_credit_until: "2026-10-07T05:00:00Z",
  cancel: { point: "x" },
  documented_losses_sum: 1,
};
/** What the customer writes, and with which event: the acceptance of the estimate and the handover (table 4.9). */
const CUSTOMER_FIELDS: Record<string, readonly string[]> = {
  ACCEPT: ["accepted_at", "offer_version_uz_id", "offer_version_ru_id"],
  HANDOVER: ["handed_over_at", "warranty_until"],
};
/** The rule under test: the fields `kind` may write together with `event`. The system and the assistant write none. */
function mayWrite(kind: string, event: string): readonly string[] {
  if (kind === "owner") return CHANGEABLE;
  if (kind === "customer") return CUSTOMER_FIELDS[event] ?? [];
  return [];
}

describe("the whitelist of order fields, event by event and actor by actor (table 4.9)", () => {
  const EVENTS = [...new Map(orderTransitionTable().map((r) => [r.event, r.actors])).entries()];

  it.each(EVENTS)("%s: every listed actor writes exactly the fields the rule names", async (event, actors) => {
    const { orderId } = await createOrder(migrator);
    for (const kind of actors) {
      const rights = mayWrite(kind, event);
      for (const key of CHANGEABLE) {
        // An expected status that the order does not have ends every call that passed the checks in stale_status,
        // without changing the order.
        const e = await pgError(
          admin,
          "select * from sales.apply_transition($1, $2::jsonb, $3, 'x', 'accepted', null, $4::jsonb)",
          [orderId, JSON.stringify({ type: event }), kind, JSON.stringify({ [key]: SAMPLE[key] })],
        );
        if (rights.includes(key)) {
          expect(e.message, `${kind} may write ${key} with ${event}`).toMatch(/stale_status/);
        } else {
          expect(e.message, `${kind} may not write ${key} with ${event}`).toMatch(/change_not_allowed/);
          expect(e.code).toBe("42501");
        }
      }
    }
    expect(await orderState(migrator, orderId)).toEqual({ status: "estimate_draft", events: "0" });
  });
});

// Table 4.9: EXPIRE, REPORT_DEEMED_ACCEPTED and CLOSE write no order field, so the system has no field to write. The
// list is empty on purpose: the deadlines the system used to be allowed to set are the owner's to set.
describe("the system (the worker) writes no order field", () => {
  const SYSTEM_EVENTS = [
    ["EXPIRE", "estimate_sent", "estimate_expired"],
    ["REPORT_DEEMED_ACCEPTED", "report_sent", "report_sent"],
    ["CLOSE", "handed_over", "closed"],
  ] as const;

  it.each(SYSTEM_EVENTS)("%s: refuses the worker as the system writing any order field", async (event, status) => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, status);
    const before = await orderState(migrator, orderId);
    for (const key of CHANGEABLE) {
      const e = await applyError(worker, orderId, event, "system", { [key]: SAMPLE[key] });
      expect(e.message, `${event} writing ${key}`).toMatch(/change_not_allowed/);
      expect(e.code).toBe("42501");
    }
    expect(await orderState(migrator, orderId)).toEqual(before);
  });

  it.each(SYSTEM_EVENTS)("lets the worker send %s without fields", async (event, status, to) => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, status);
    const r = await transition(worker, orderId, event, { actorKind: "system", actorId: "worker" });
    expect(r.to).toBe(to);
  });

  it("lets the worker send an event of the system with an empty change set", async () => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, "estimate_sent");
    const r = await transition(worker, orderId, "EXPIRE", { actorKind: "system", actorId: "worker", changes: {} });
    expect(r.to).toBe("estimate_expired");
  });

  it("keeps the unknown field apart: it is named unknown_change, not refused as the system's", async () => {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, "estimate_sent");
    const e = await applyError(worker, orderId, "EXPIRE", "system", { status: "closed" });
    expect(e.message).toMatch(/unknown_change/);
  });
});

describe("the customer writes a field only with the event that owns it", () => {
  /** The status in which the customer sends the event. */
  const STATUS_OF: Record<string, string> = {
    ACCEPT: "estimate_sent",
    HANDOVER: "delivering",
    OBJECTION: "report_sent",
    REPORT_ACCEPTED: "report_sent",
  };
  async function orderFor(event: string) {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, STATUS_OF[event] ?? "estimate_draft");
    return orderId;
  }

  it.each([
    ["ACCEPT", "handed_over_at"],
    ["ACCEPT", "warranty_until"],
    ["HANDOVER", "accepted_at"],
    ["HANDOVER", "offer_version_uz_id"],
    ["HANDOVER", "offer_version_ru_id"],
    ["OBJECTION", "accepted_at"],
    ["OBJECTION", "offer_version_uz_id"],
    ["OBJECTION", "handed_over_at"],
    ["OBJECTION", "warranty_until"],
    ["REPORT_ACCEPTED", "accepted_at"],
    ["REPORT_ACCEPTED", "offer_version_ru_id"],
    ["REPORT_ACCEPTED", "handed_over_at"],
    ["REPORT_ACCEPTED", "warranty_until"],
  ] as const)("refuses the customer's %s writing %s", async (event, key) => {
    const orderId = await orderFor(event);
    const before = await orderState(migrator, orderId);
    const e = await applyError(web, orderId, event, "customer", { [key]: SAMPLE[key] });
    expect(e.message).toMatch(/change_not_allowed/);
    expect(e.code).toBe("42501");
    expect(await orderState(migrator, orderId)).toEqual(before);
    const row = await one<Record<string, unknown>>(migrator, `select ${key} as v from sales.orders where id = $1`, [
      orderId,
    ]);
    expect(row.v).toBeNull();
  });

  it("lets the customer write the acceptance time and both offer versions with ACCEPT", async () => {
    const [uz, ru] = [await insertOfferStub(migrator, "uz"), await insertOfferStub(migrator, "ru")];
    const orderId = await orderFor("ACCEPT");
    const r = await transition(web, orderId, "ACCEPT", {
      changes: { accepted_at: "2026-10-06T09:00:00Z", offer_version_uz_id: uz, offer_version_ru_id: ru },
    });
    expect(r.to).toBe("accepted");
    const row = await one<{ at: Date; uz: string; ru: string }>(
      migrator,
      "select accepted_at as at, offer_version_uz_id as uz, offer_version_ru_id as ru from sales.orders where id = $1",
      [orderId],
    );
    expect({ at: row.at.toISOString(), uz: row.uz, ru: row.ru }).toEqual({
      at: "2026-10-06T09:00:00.000Z",
      uz,
      ru,
    });
  });

  it("lets the customer write the handover time and the warranty with HANDOVER", async () => {
    const orderId = await orderFor("HANDOVER");
    const r = await transition(web, orderId, "HANDOVER", {
      actorKind: "customer",
      changes: { handed_over_at: "2026-10-20T10:00:00Z", warranty_until: "2027-10-20T10:00:00Z" },
    });
    expect(r.to).toBe("handed_over");
    const row = await one<{ h: Date; w: Date }>(
      migrator,
      "select handed_over_at as h, warranty_until as w from sales.orders where id = $1",
      [orderId],
    );
    expect([row.h.toISOString(), row.w.toISOString()]).toEqual([
      "2026-10-20T10:00:00.000Z",
      "2027-10-20T10:00:00.000Z",
    ]);
  });

  it("applies the same rule to the customer of the bot", async () => {
    const orderId = await orderFor("OBJECTION");
    const e = await applyError(bot, orderId, "OBJECTION", "customer", { accepted_at: SAMPLE.accepted_at });
    expect(e.message).toMatch(/change_not_allowed/);
  });
});

// A value that the order already has is the record of what happened first (who accepted, when it was handed over):
// the customer's next call does not write over it, even with the same value.
describe("a value the order already has is not rewritten by the customer", () => {
  type Field = "accepted_at" | "offer_version_uz_id" | "offer_version_ru_id" | "handed_over_at" | "warranty_until";
  const isOffer = (f: Field) => f === "offer_version_uz_id" || f === "offer_version_ru_id";
  const langOf = (f: Field) => (f === "offer_version_ru_id" ? "ru" : "uz");
  const FIRST_TIME = "2026-10-01T08:00:00.000Z";
  const LATER_TIME = "2026-10-05T08:00:00.000Z";
  /** Another value of the same type as the one the order has. */
  const anotherValue = (f: Field) => (isOffer(f) ? insertOfferStub(migrator, langOf(f)) : LATER_TIME);

  /** An order in the status of the event, with `field` already written (as the admin may do directly). */
  async function orderWith(event: "ACCEPT" | "HANDOVER", field: Field) {
    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, event === "ACCEPT" ? "estimate_sent" : "delivering");
    const first = isOffer(field) ? await insertOfferStub(migrator, langOf(field)) : FIRST_TIME;
    await migrator.query(`update sales.orders set ${field} = $1 where id = $2`, [first, orderId]);
    return { orderId, first };
  }
  /** The stored value as text: an ISO time with milliseconds, or the uuid. */
  async function storedValue(orderId: string, field: Field): Promise<string> {
    const row = await one<{ v: Date | string }>(migrator, `select ${field} as v from sales.orders where id = $1`, [
      orderId,
    ]);
    return row.v instanceof Date ? row.v.toISOString() : row.v;
  }

  it.each([
    ["ACCEPT", "accepted_at"],
    ["ACCEPT", "offer_version_uz_id"],
    ["ACCEPT", "offer_version_ru_id"],
    ["HANDOVER", "handed_over_at"],
    ["HANDOVER", "warranty_until"],
  ] as const)("refuses the customer's %s writing %s over a value", async (event, field) => {
    const { orderId, first } = await orderWith(event, field);
    const before = await orderState(migrator, orderId);
    const e = await applyError(web, orderId, event, "customer", { [field]: await anotherValue(field) });
    expect(e.message).toMatch(/change_not_allowed/);
    expect(e.code).toBe("42501");
    expect(await orderState(migrator, orderId)).toEqual(before);
    expect(await storedValue(orderId, field)).toBe(first);
  });

  it("refuses a rewrite with the very same value", async () => {
    const { orderId, first } = await orderWith("ACCEPT", "accepted_at");
    const e = await applyError(web, orderId, "ACCEPT", "customer", { accepted_at: first });
    expect(e.message).toMatch(/change_not_allowed/);
  });

  it("counts a JSON null as writing the field: refused over a value, nothing over an empty field", async () => {
    const taken = await orderWith("ACCEPT", "accepted_at");
    const e = await applyError(web, taken.orderId, "ACCEPT", "customer", { accepted_at: null });
    expect(e.message).toMatch(/change_not_allowed/);
    expect(await storedValue(taken.orderId, "accepted_at")).toBe(taken.first);

    const { orderId } = await createOrder(migrator);
    await driveTo(admin, orderId, "estimate_sent");
    expect((await transition(web, orderId, "ACCEPT", { changes: { accepted_at: null } })).to).toBe("accepted");
    const row = await one<{ at: Date | null }>(migrator, "select accepted_at as at from sales.orders where id = $1", [
      orderId,
    ]);
    expect(row.at).toBeNull();
  });

  it("refuses the whole call when one of the fields is taken, and writes none of the others", async () => {
    const { orderId, first } = await orderWith("ACCEPT", "offer_version_uz_id");
    const e = await applyError(web, orderId, "ACCEPT", "customer", {
      accepted_at: LATER_TIME,
      offer_version_uz_id: await anotherValue("offer_version_uz_id"),
      offer_version_ru_id: await anotherValue("offer_version_ru_id"),
    });
    expect(e.message).toMatch(/change_not_allowed/);
    const row = await one(
      migrator,
      "select accepted_at as at, offer_version_uz_id as uz, offer_version_ru_id as ru from sales.orders where id = $1",
      [orderId],
    );
    expect(row).toEqual({ at: null, uz: first, ru: null });
  });

  it("writes the fields that are still empty, next to a taken field that is not written", async () => {
    const { orderId, first } = await orderWith("ACCEPT", "offer_version_uz_id");
    const ru = await insertOfferStub(migrator, "ru");
    const r = await transition(web, orderId, "ACCEPT", {
      changes: { accepted_at: LATER_TIME, offer_version_ru_id: ru },
    });
    expect(r.to).toBe("accepted");
    const row = await one<{ at: Date; uz: string; ru: string }>(
      migrator,
      "select accepted_at as at, offer_version_uz_id as uz, offer_version_ru_id as ru from sales.orders where id = $1",
      [orderId],
    );
    expect({ at: row.at.toISOString(), uz: row.uz, ru: row.ru }).toEqual({ at: LATER_TIME, uz: first, ru });
  });

  it("applies to the customer of the bot as well", async () => {
    const { orderId } = await orderWith("HANDOVER", "warranty_until");
    const e = await applyError(bot, orderId, "HANDOVER", "customer", { warranty_until: LATER_TIME });
    expect(e.message).toMatch(/change_not_allowed/);
  });

  it("does not bind the owner: the owner corrects a date the order has", async () => {
    const { orderId } = await orderWith("HANDOVER", "handed_over_at");
    const r = await transition(admin, orderId, "HANDOVER", {
      actorKind: "owner",
      changes: { handed_over_at: LATER_TIME },
    });
    expect(r.to).toBe("handed_over");
    expect(await storedValue(orderId, "handed_over_at")).toBe(LATER_TIME);
  });
});
