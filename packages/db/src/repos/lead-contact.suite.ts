import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectAs, createOrder, one, pgError, uniq } from "./testkit.ts";

// WP-00, request of the site without a customer: the contact of the person lives in its own columns of the request (it
// travelled in the comment before), under the same 12-month retention as the request. Binding the request to a
// customer afterwards is the admin panel's alone, and happens once.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const DENIED = "42501";

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

const number = () => `L-2996-${String(uniq()).padStart(4, "0")}`;
const INSERT_BARE = "insert into sales.leads (number, channel, scope, contact_phone) values ($1, 'web', 'pc', $2)";

async function insertLead(
  c: pg.Client,
  o: { customerId?: string | null; phone?: string | null; name?: string | null; username?: string | null } = {},
): Promise<string> {
  // The site has no right to read a row back: no RETURNING of the contact, only the id and the number of the request.
  const r = await c.query<{ id: string }>(
    `insert into sales.leads (number, customer_id, channel, scope, contact_phone, contact_name, contact_username)
     values ($1, $2, 'web', 'pc', $3, $4, $5) returning id`,
    [number(), o.customerId ?? null, o.phone ?? null, o.name ?? null, o.username ?? null],
  );
  return r.rows[0]?.id as string;
}
const customerOf = (id: string) => one(migrator, "select customer_id from sales.leads where id = $1", [id]);

describe("the contact columns of sales.leads", () => {
  it.each([
    ["web", () => web],
    ["bot", () => bot],
    ["admin", () => admin],
  ])("are written with the request by the %s role", async (_role, client) => {
    const id = await insertLead(client(), { phone: "+998901234567", name: "Aziz", username: "aziz_t" });
    const row = await one(
      migrator,
      "select contact_phone, contact_name, contact_username from sales.leads where id = $1",
      [id],
    );
    expect(row).toEqual({ contact_phone: "+998901234567", contact_name: "Aziz", contact_username: "aziz_t" });
  });

  it("are empty for a request that has a customer (the bot names him; the site may not, see hardening.suite)", async () => {
    const o = await createOrder(migrator);
    const id = await insertLead(bot, { customerId: o.customerId });
    expect(await one(migrator, "select contact_phone from sales.leads where id = $1", [id])).toEqual({
      contact_phone: null,
    });
  });

  it("are not readable by the site: the personal data of the requests stay out of its reach", async () => {
    for (const column of ["contact_phone", "contact_name", "contact_username", "comment"]) {
      expect((await pgError(web, `select ${column} from sales.leads`)).code, column).toBe(DENIED);
    }
    await web.query("select id, number, status, created_at from sales.leads limit 1");
  });

  it("are readable by the bot and the worker, which read the whole request", async () => {
    for (const c of [bot, worker]) {
      await c.query("select contact_phone, contact_name, contact_username from sales.leads limit 1");
    }
  });

  it.each([
    ["8 901 234 567"],
    ["+998 90 123 45 67"],
    ["998901234567"],
    ["+0123456789"],
    ["+12"],
    [""],
    ["+99890123456789012"],
  ])("refuse the phone %j: the international form only, as for customers", async (phone) => {
    const e = await pgError(web, INSERT_BARE, [number(), phone]);
    expect(e.code).toBe("23514");
    expect(e.constraint).toBe("leads_contact_phone_chk");
  });

  it("limit the length of the name and of the Telegram name", async () => {
    const name = await pgError(
      web,
      "insert into sales.leads (number, channel, scope, contact_name) values ($1, 'web', 'pc', $2)",
      [number(), "x".repeat(121)],
    );
    expect(name.constraint).toBe("leads_contact_name_chk");
    const username = await pgError(
      web,
      "insert into sales.leads (number, channel, scope, contact_username) values ($1, 'web', 'pc', $2)",
      [number(), "x".repeat(65)],
    );
    expect(username.constraint).toBe("leads_contact_username_chk");
    await insertLead(web, { name: "x".repeat(120), username: "x".repeat(64) });
  });
});

describe("binding a request to a customer", () => {
  it("is the admin panel's: it sets the customer of a request that has none", async () => {
    const o = await createOrder(migrator);
    const id = await insertLead(web, { phone: "+998901234567" });
    await admin.query("update sales.leads set customer_id = $2 where id = $1", [id, o.customerId]);
    expect(await customerOf(id)).toEqual({ customer_id: o.customerId });
  });

  it("is refused to the bot and the worker (the bot may update a request, but never its customer)", async () => {
    const o = await createOrder(migrator);
    const id = await insertLead(web);
    const e = await pgError(bot, "update sales.leads set customer_id = $2 where id = $1", [id, o.customerId]);
    expect(e.message).toMatch(/^actor_not_allowed:/);
    const w = await pgError(worker, "update sales.leads set customer_id = $2 where id = $1", [id, o.customerId]);
    expect(w.code).toBe(DENIED);
    expect(await customerOf(id)).toEqual({ customer_id: null });
    await bot.query("update sales.leads set status = 'in_review' where id = $1", [id]);
  });

  it("happens once: a customer that is set is never replaced or removed, not even by the admin panel", async () => {
    const a = await createOrder(migrator);
    const b = await createOrder(migrator);
    const id = await insertLead(web);
    await admin.query("update sales.leads set customer_id = $2 where id = $1", [id, a.customerId]);
    const replace = await pgError(admin, "update sales.leads set customer_id = $2 where id = $1", [id, b.customerId]);
    expect(replace.message).toMatch(/^immutable:/);
    const remove = await pgError(admin, "update sales.leads set customer_id = null where id = $1", [id]);
    expect(remove.message).toMatch(/^immutable:/);
    expect(await customerOf(id)).toEqual({ customer_id: a.customerId });
  });

  it("does not stand in the way of the other columns of a request that has a customer", async () => {
    const o = await createOrder(migrator);
    const id = await insertLead(bot, { customerId: o.customerId });
    await bot.query("update sales.leads set status = 'in_review', first_response_at = now() where id = $1", [id]);
    expect(await one(migrator, "select status from sales.leads where id = $1", [id])).toEqual({ status: "in_review" });
  });
});
