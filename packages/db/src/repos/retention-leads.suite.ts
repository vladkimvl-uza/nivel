import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, one, pgError, uniq } from "./testkit.ts";

// WP-00 (d): requests that did not become an order are kept 12 months (DATA-MAP 9). The worker has no right to DELETE
// from sales.leads or sales.customers; sales.purge_expired_leads() does the erasure under the owner, by the pattern of
// ai.purge_expired(): EXECUTE only for the admin panel and the worker, never a moment later than the clock of the database.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const DENIED = "42501";
const PURGE = "select sales.purge_expired_leads($1::timestamptz) as n";

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

const pad = (n: number) => String(n).padStart(4, "0");

/** A customer with every kind of personal data. `age` is a SQL interval: the customer was created that long ago. */
async function person(age = "14 months", telegram = true): Promise<{ id: string; telegramId: number | null }> {
  const n = uniq();
  const telegramId = telegram ? 7_300_000_000 + n : null;
  const row = await one<{ id: string }>(
    migrator,
    `insert into sales.customers (display_name, phone_e164, telegram_user_id, telegram_username, address, district, created_at)
     values ($1, $2, $3, $4, 'Tashkent, secret street 7', 'Yunusabad', now() - $5::interval) returning id`,
    [`Person ${n}`, `+99890${String(2_000_000 + n)}`, telegramId, `user${n}`, age],
  );
  return { id: row.id, telegramId };
}

async function lead(
  customerId: string | null,
  age: string,
  extra: { comment?: string; contact?: boolean } = {},
): Promise<string> {
  const n = uniq();
  const row = await one<{ id: string }>(
    migrator,
    `insert into sales.leads (number, customer_id, channel, scope, comment, contact_phone, contact_name, contact_username, created_at)
     values ($1, $2, 'web', 'pc', $3, $4, $5, $6, now() - $7::interval) returning id`,
    [
      `L-2997-${pad(n)}`,
      customerId,
      extra.comment ?? null,
      extra.contact ? "+998901112233" : null,
      extra.contact ? "Contact Person" : null,
      extra.contact ? "contact_user" : null,
      age,
    ],
  );
  return row.id;
}

async function orderFor(leadId: string, customerId: string): Promise<void> {
  const n = uniq();
  await migrator.query("insert into sales.orders (number, customer_id, kind, lead_id) values ($1, $2, 'pc', $3)", [
    `NV-2997-${pad(n)}`,
    customerId,
    leadId,
  ]);
}

const customerRow = (id: string) =>
  one<{
    display_name: string | null;
    phone_e164: string | null;
    telegram_user_id: string | null;
    telegram_username: string | null;
    address: string | null;
    district: string | null;
    lang: string;
    erased_at: Date | null;
  }>(
    migrator,
    `select display_name, phone_e164, telegram_user_id::text, telegram_username, address, district, lang, erased_at
       from sales.customers where id = $1`,
    [id],
  );
const leadRow = (id: string) =>
  one<{
    comment: string | null;
    contact_phone: string | null;
    contact_name: string | null;
    contact_username: string | null;
    scope: string;
    status: string;
  }>(
    migrator,
    "select comment, contact_phone, contact_name, contact_username, scope, status from sales.leads where id = $1",
    [id],
  );
const purge = async (c: pg.Client, now: string | null = null) => Number((await one<{ n: number }>(c, PURGE, [now])).n);

describe.each(["worker", "admin"] as const)("sales.purge_expired_leads as the %s role", (role) => {
  const client = () => (role === "worker" ? worker : admin);

  it("runs in the session of the real role", async () => {
    expect(await one(client(), "select current_user, session_user")).toEqual({
      current_user: `nivel_${role}`,
      session_user: `nivel_${role}`,
    });
  });

  it("erases the customer of a request older than 12 months that never became an order, and what the request carries", async () => {
    const p = await person("14 months");
    const id = await lead(p.id, "13 months", { comment: "call me after five, my mother is Anna", contact: true });
    expect(await purge(client())).toBeGreaterThanOrEqual(1);
    expect(await customerRow(p.id)).toEqual({
      display_name: null,
      phone_e164: null,
      telegram_user_id: null,
      telegram_username: null,
      address: null,
      // The district and the language say nothing of a person: they stay for the statistics.
      district: "Yunusabad",
      lang: "uz",
      erased_at: expect.any(Date),
    });
    expect(await leadRow(id)).toEqual({
      comment: null,
      contact_phone: null,
      contact_name: null,
      contact_username: null,
      scope: "pc",
      status: "new",
    });
  });

  it("returns the number of requests it cleaned and no more on the next run", async () => {
    await purge(client());
    const a = await person();
    const b = await person();
    await lead(a.id, "20 months", { comment: "x" });
    await lead(b.id, "15 months"); // nothing of its own to clean, but its customer goes
    await lead(null, "16 months", { contact: true }); // a request of the site that was never linked
    await lead(null, "16 months"); // nothing personal in it at all
    expect(await purge(client())).toBe(3);
    expect(await purge(client())).toBe(0);
  });

  it("keeps a request younger than 12 months, with its customer", async () => {
    const p = await person("14 months");
    const id = await lead(p.id, "11 months", { comment: "fresh", contact: true });
    await purge(client());
    expect((await customerRow(p.id)).phone_e164).not.toBeNull();
    expect(await leadRow(id)).toMatchObject({ comment: "fresh", contact_phone: "+998901112233" });
  });

  it("keeps a request that became an order: the customer and the request stay for the warranty term", async () => {
    const p = await person();
    const id = await lead(p.id, "30 months", { comment: "became an order" });
    await orderFor(id, p.id);
    await purge(client());
    expect((await customerRow(p.id)).erased_at).toBeNull();
    expect((await leadRow(id)).comment).toBe("became an order");
  });

  it("keeps the customer who has an order from another request, but cleans the old request itself", async () => {
    const p = await person();
    const old = await lead(p.id, "30 months", { comment: "old, never an order", contact: true });
    const won = await lead(p.id, "29 months");
    await orderFor(won, p.id);
    await purge(client());
    const c = await customerRow(p.id);
    expect(c.erased_at).toBeNull();
    expect(c.phone_e164).not.toBeNull();
    expect(await leadRow(old)).toMatchObject({ comment: null, contact_phone: null, contact_name: null });
  });

  it("keeps the customer who wrote again within the year, or saved a configuration within the year", async () => {
    const again = await person();
    await lead(again.id, "20 months", { comment: "old" });
    await lead(again.id, "3 months", { comment: "new" });
    const saved = await person();
    await lead(saved.id, "20 months");
    await migrator.query(
      "insert into sales.configurations (public_code, kind, items, created_via, customer_id, created_at) values ($1, 'pc', '[]', 'web', $2, now() - interval '2 months')",
      [`c${String(uniq()).padStart(7, "0")}`, saved.id],
    );
    await purge(client());
    expect((await customerRow(again.id)).erased_at).toBeNull();
    expect((await customerRow(saved.id)).erased_at).toBeNull();
  });

  it("does not erase a customer who is younger than the year though an old request is bound to him", async () => {
    // The owner merged an old request of the site into a customer who came last week.
    const fresh = await person("1 week");
    await lead(fresh.id, "20 months", { comment: "merged by hand" });
    await purge(client());
    expect((await customerRow(fresh.id)).erased_at).toBeNull();
  });

  it("counts the day: a request of exactly 12 months is out, one a second younger is in", async () => {
    const edge = await person("30 months");
    const keep = await person("30 months");
    const outId = await lead(edge.id, "1 month", { comment: "on the day" });
    const inId = await lead(keep.id, "1 month", { comment: "a second short" });
    const at = (await one<{ at: Date }>(migrator, "select now() - interval '6 months' as at")).at.toISOString();
    await migrator.query("update sales.leads set created_at = $2::timestamptz - interval '12 months' where id = $1", [
      outId,
      at,
    ]);
    await migrator.query(
      "update sales.leads set created_at = $2::timestamptz - interval '12 months' + interval '1 second' where id = $1",
      [inId, at],
    );
    await purge(client(), at);
    expect((await customerRow(edge.id)).erased_at).not.toBeNull();
    expect((await customerRow(keep.id)).erased_at).toBeNull();
    expect((await leadRow(outId)).comment).toBeNull();
    expect((await leadRow(inId)).comment).toBe("a second short");
  });

  it("never reads a moment later than the clock of the database", async () => {
    const p = await person("2 months");
    await lead(p.id, "6 months", { comment: "six months old" });
    await purge(client(), "2999-01-01T00:00:00Z");
    expect((await customerRow(p.id)).erased_at).toBeNull();
  });

  it("removes the secrets and the subscriptions of the Telegram id of an erased customer, and only of them", async () => {
    const gone = await person();
    const stays = await person();
    await lead(gone.id, "20 months");
    await lead(stays.id, "2 months");
    await migrator.query(
      "insert into sales.customer_secrets (customer_id, kind, ciphertext, iv, key_version) values ($1, 'passport_for_poa', '\\x00', '\\x00', 1)",
      [gone.id],
    );
    for (const p of [gone, stays]) {
      await migrator.query("insert into bot.subscriptions (telegram_user_id, topic) values ($1, 'news')", [
        p.telegramId,
      ]);
    }
    await purge(client());
    const secrets = await one<{ n: string }>(
      migrator,
      "select count(*)::text as n from sales.customer_secrets where customer_id = $1",
      [gone.id],
    );
    expect(secrets.n).toBe("0");
    const subs = await migrator.query(
      "select telegram_user_id::text as id from bot.subscriptions where telegram_user_id in ($1, $2)",
      [gone.telegramId, stays.telegramId],
    );
    expect(subs.rows).toEqual([{ id: String(stays.telegramId) }]);
  });

  it("is repeatable and leaves the journals alone: consents and audit rows of an erased customer stay", async () => {
    const p = await person();
    await lead(p.id, "20 months");
    await migrator.query(
      "insert into ops.consents (customer_id, kind, granted, channel) values ($1, 'pd_processing', true, 'test')",
      [p.id],
    );
    await purge(client());
    const consents = await one<{ n: string }>(
      migrator,
      "select count(*)::text as n from ops.consents where customer_id = $1",
      [p.id],
    );
    expect(consents.n).toBe("1");
    expect(await purge(client())).toBe(0);
  });

  it("writes one audit row with the counts and no personal data", async () => {
    const p = await person();
    await lead(p.id, "20 months", { comment: "private words", contact: true });
    await purge(client());
    const audit = await migrator.query(
      "select actor, action, entity, after from ops.audit_log where action = 'retention.purge_leads' order by at desc limit 1",
    );
    expect(audit.rows[0]).toMatchObject({
      actor: `db:nivel_${role}`,
      action: "retention.purge_leads",
      entity: "sales.leads",
      after: { leads: expect.any(Number), customers: expect.any(Number), db_role: `nivel_${role}` },
    });
    expect(JSON.stringify(audit.rows[0])).not.toMatch(/private words|998901112233|Person/);
  });
});

describe("who may call sales.purge_expired_leads", () => {
  it("only the admin panel and the worker", async () => {
    for (const [role, ok] of [
      ["nivel_admin", true],
      ["nivel_worker", true],
      ["nivel_web", false],
      ["nivel_bot", false],
      ["public", false],
    ] as const) {
      const r = await one<{ ok: boolean }>(
        migrator,
        "select has_function_privilege($1, 'sales.purge_expired_leads(timestamptz)'::regprocedure, 'EXECUTE') as ok",
        [role],
      );
      expect(r.ok, role).toBe(ok);
    }
  });

  it("the site and the bot are refused, and nothing is erased", async () => {
    const p = await person();
    await lead(p.id, "20 months");
    for (const c of [web, bot]) expect((await pgError(c, PURGE, [null])).code).toBe(DENIED);
    expect((await customerRow(p.id)).erased_at).toBeNull();
  });

  it("the worker still has no DELETE right on the tables: the function is the only way", async () => {
    expect((await pgError(worker, "delete from sales.leads")).code).toBe(DENIED);
    expect((await pgError(worker, "update sales.customers set erased_at = now()")).code).toBe(DENIED);
  });
});
