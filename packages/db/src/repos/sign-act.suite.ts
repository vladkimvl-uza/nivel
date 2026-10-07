import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, insertAct, one, pgError, uniq } from "./testkit.ts";

// WP-00 (c): the customer signs an act with the button of the bot. The bot cannot write acts itself; the function
// sales.sign_act() does it for nivel_bot and only when the Telegram id of the press is the id of the customer of the
// order. The CHECK on sales.acts keeps a signature without evidence out for every other writer.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const DENIED = "42501";
const SIGN = "select sales.sign_act($1::uuid, $2, $3::jsonb) as signed_at";

beforeAll(async () => {
  [migrator, web, admin, bot, worker] = await Promise.all([
    connectAs("MIGRATOR"),
    connectAs("WEB"),
    connectAs("ADMIN"),
    connectAs("BOT"),
    connectAs("WORKER"),
  ]);
});
afterAll(async () => {
  for (const c of [migrator, web, admin, bot, worker]) await c.end();
});

/** An order of a customer with a known Telegram id and one unsigned act. */
async function actOfCustomer() {
  const o = await createOrder(migrator);
  const customer = await one<{ telegram_user_id: string }>(
    migrator,
    "select telegram_user_id::text from sales.customers where id = $1",
    [o.customerId],
  );
  const actId = await insertAct(migrator, o.orderId);
  return { ...o, actId, telegramId: Number(customer.telegram_user_id) };
}

const press = (telegramUserId: unknown, messageId: unknown = 4242) => JSON.stringify({ telegramUserId, messageId });
const actRow = (id: string) =>
  one<{ signed_at: Date | null; signed_via: string | null; evidence: Record<string, unknown> | null }>(
    migrator,
    "select signed_at, signed_via, evidence from sales.acts where id = $1",
    [id],
  );

describe("sales.sign_act as the bot", () => {
  it("runs in the session of the real role", async () => {
    expect(await one(bot, "select current_user, session_user")).toEqual({
      current_user: "nivel_bot",
      session_user: "nivel_bot",
    });
  });

  it("signs the act of the customer whose Telegram id pressed the button, with the time of the database", async () => {
    const a = await actOfCustomer();
    const r = await one<{ signed_at: Date }>(bot, SIGN, [a.actId, "tg_button", press(a.telegramId)]);
    const row = await actRow(a.actId);
    expect(row.signed_via).toBe("tg_button");
    expect(row.evidence).toEqual({ telegramUserId: a.telegramId, messageId: 4242 });
    expect(row.signed_at?.toISOString()).toBe(r.signed_at.toISOString());
    const now = await one<{ delta: number }>(
      migrator,
      "select extract(epoch from now() - $1::timestamptz)::float8 as delta",
      [row.signed_at],
    );
    expect(now.delta).toBeGreaterThanOrEqual(0);
    expect(now.delta).toBeLessThan(60);
  });

  it("keeps only the two facts of the press, never the other words of the caller", async () => {
    const a = await actOfCustomer();
    await bot.query(SIGN, [
      a.actId,
      "tg_button",
      JSON.stringify({ telegramUserId: a.telegramId, messageId: 7, note: "x".repeat(5000), fileId: "nope" }),
    ]);
    expect((await actRow(a.actId)).evidence).toEqual({ telegramUserId: a.telegramId, messageId: 7 });
  });

  it("refuses the press of another Telegram id, and leaves the act unsigned", async () => {
    const a = await actOfCustomer();
    const e = await pgError(bot, SIGN, [a.actId, "tg_button", press(a.telegramId + 1)]);
    expect(e.message).toMatch(/^evidence_mismatch:/);
    expect((await actRow(a.actId)).signed_at).toBeNull();
  });

  it("refuses a customer without a Telegram id: nobody can prove they pressed it", async () => {
    const a = await actOfCustomer();
    await migrator.query("update sales.customers set telegram_user_id = null where id = $1", [a.customerId]);
    const e = await pgError(bot, SIGN, [a.actId, "tg_button", press(a.telegramId)]);
    expect(e.message).toMatch(/^evidence_mismatch:/);
    expect((await actRow(a.actId)).signed_at).toBeNull();
  });

  it.each([
    ["a text with the same digits", (id: number) => press(String(id))],
    ["a fraction of the same value", (id: number) => `{"telegramUserId": ${id}.0, "messageId": 1}`],
    ["a negative id", (id: number) => press(-id)],
    ["no id", () => JSON.stringify({ messageId: 1 })],
    ["an id that is null", () => press(null)],
    ["a list instead of the id", (id: number) => press([id])],
  ])("refuses %s as the id", async (_name, evidence) => {
    const a = await actOfCustomer();
    const e = await pgError(bot, SIGN, [a.actId, "tg_button", evidence(a.telegramId)]);
    expect(e.message).toMatch(/^(evidence_mismatch|invalid_evidence):/);
    expect((await actRow(a.actId)).signed_at).toBeNull();
  });

  it.each([
    ["no message", (id: number) => JSON.stringify({ telegramUserId: id })],
    ["a message id of zero", (id: number) => press(id, 0)],
    ["a message id that is text", (id: number) => press(id, "12")],
    ["a message id with a fraction", (id: number) => press(id, 1.5)],
    ["evidence that is not an object", () => "[1, 2]"],
    ["evidence that is a number", () => "7"],
    ["evidence that is null", () => "null"],
  ])("refuses %s: the press is proved by the message with the button", async (_name, evidence) => {
    const a = await actOfCustomer();
    const e = await pgError(bot, SIGN, [a.actId, "tg_button", evidence(a.telegramId)]);
    expect(e.message).toMatch(/^invalid_evidence:/);
    expect((await actRow(a.actId)).signed_at).toBeNull();
  });

  it.each(["paper_photo", "site_button", "", "button"])("signs only by the button, not by %j", async (via) => {
    const a = await actOfCustomer();
    const e = await pgError(bot, SIGN, [a.actId, via, press(a.telegramId)]);
    expect(e.message).toMatch(/^invalid_evidence:/);
    expect((await actRow(a.actId)).signed_at).toBeNull();
  });

  it("signs once: the second press fails and the first evidence stays", async () => {
    const a = await actOfCustomer();
    await bot.query(SIGN, [a.actId, "tg_button", press(a.telegramId, 1)]);
    const first = await actRow(a.actId);
    const e = await pgError(bot, SIGN, [a.actId, "tg_button", press(a.telegramId, 2)]);
    expect(e.message).toMatch(/^act_already_signed:/);
    expect(await actRow(a.actId)).toEqual(first);
  });

  it("signs once also when two presses arrive at the same moment", async () => {
    const a = await actOfCustomer();
    const other = await connectAs("BOT");
    try {
      const results = await Promise.allSettled([
        bot.query(SIGN, [a.actId, "tg_button", press(a.telegramId, 11)]),
        other.query(SIGN, [a.actId, "tg_button", press(a.telegramId, 12)]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected");
      expect((lost as PromiseRejectedResult).reason.message).toMatch(/^act_already_signed:/);
    } finally {
      await other.end();
    }
  });

  it("refuses an act that does not exist, or none", async () => {
    const a = await actOfCustomer();
    const e = await pgError(bot, SIGN, ["0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "tg_button", press(a.telegramId)]);
    expect(e.message).toMatch(/^act_not_found:/);
    expect((await pgError(bot, SIGN, [null, "tg_button", press(a.telegramId)])).message).toMatch(
      /^(act_not_found|invalid_evidence):/,
    );
  });

  it("leaves an audit row with the customer, the way and the role of the database", async () => {
    const a = await actOfCustomer();
    await bot.query(SIGN, [a.actId, "tg_button", press(a.telegramId)]);
    const audit = await migrator.query("select actor, action, entity, after from ops.audit_log where entity_id = $1", [
      a.actId,
    ]);
    expect(audit.rows).toEqual([
      {
        actor: `customer:${a.customerId}`,
        action: "act.sign",
        entity: "sales.acts",
        after: { orderId: a.orderId, via: "tg_button", db_role: "nivel_bot" },
      },
    ]);
  });

  it("does not give the bot the table: it still cannot write acts directly", async () => {
    const a = await actOfCustomer();
    expect((await pgError(bot, "update sales.acts set signed_at = now() where id = $1", [a.actId])).code).toBe(DENIED);
    expect(
      (await pgError(bot, "insert into sales.acts (order_id, kind) values ($1, 'handover')", [a.orderId])).code,
    ).toBe(DENIED);
  });
});

describe("who may call sales.sign_act", () => {
  it("only the bot", async () => {
    for (const [role, ok] of [
      ["nivel_bot", true],
      ["nivel_web", false],
      ["nivel_worker", false],
      ["nivel_admin", false],
      ["public", false],
    ] as const) {
      const r = await one<{ ok: boolean }>(
        migrator,
        "select has_function_privilege($1, 'sales.sign_act(uuid,text,jsonb)'::regprocedure, 'EXECUTE') as ok",
        [role],
      );
      expect(r.ok, role).toBe(ok);
    }
  });

  it.each(["web", "worker", "admin"] as const)(
    "refuses the %s role with a permission error and signs nothing",
    async (role) => {
      const a = await actOfCustomer();
      const c = { web, worker, admin }[role];
      expect((await pgError(c, SIGN, [a.actId, "tg_button", press(a.telegramId)])).code).toBe(DENIED);
      expect((await actRow(a.actId)).signed_at).toBeNull();
    },
  );
});

describe("acts_evidence_chk: a signature always has evidence", () => {
  it("refuses a signed act without evidence, on insert and on update, whoever writes it", async () => {
    const o = await createOrder(migrator);
    for (const client of [migrator, admin]) {
      const e = await pgError(
        client,
        "insert into sales.acts (order_id, kind, signed_at, signed_via) values ($1, 'handover', now(), 'tg_button')",
        [o.orderId],
      );
      expect(e.code).toBe("23514");
      expect(e.constraint).toBe("acts_evidence_chk");
    }
    const actId = await insertAct(migrator, o.orderId, "handover");
    const u = await pgError(
      admin,
      "update sales.acts set signed_at = now(), signed_via = 'paper_photo' where id = $1",
      [actId],
    );
    expect(u.constraint).toBe("acts_evidence_chk");
  });

  it.each(["null", "[]", '"pressed"', "42", "true"])(
    "a signature rests on an object: the evidence %s is no evidence (the JSON null is not an SQL NULL)",
    async (evidence) => {
      const o = await createOrder(migrator);
      for (const client of [migrator, admin]) {
        const actId = await insertAct(migrator, o.orderId, "handover");
        const e = await pgError(
          client,
          "update sales.acts set signed_at = now(), signed_via = 'paper_photo', evidence = $2::jsonb where id = $1",
          [actId, evidence],
        );
        expect(e.constraint, evidence).toBe("acts_evidence_chk");
      }
    },
  );

  it("accepts an unsigned act without evidence and a signed one with it", async () => {
    const o = await createOrder(migrator);
    const actId = await insertAct(migrator, o.orderId, "customer_parts");
    await admin.query(
      "update sales.acts set signed_at = now(), signed_via = 'paper_photo', evidence = $2::jsonb where id = $1",
      [actId, JSON.stringify({ fileId: `f-${uniq()}` })],
    );
    expect((await actRow(actId)).signed_via).toBe("paper_photo");
  });
});
