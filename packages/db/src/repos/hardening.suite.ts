import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_SCHEMAS } from "../index.ts";
import {
  connectAs,
  createOrder,
  createVendor,
  insertAct,
  insertFile,
  insertPurchase,
  one,
  pgError,
  receiveFunds,
  sendQuote,
  uniq,
} from "./testkit.ts";

// The review of WP-00, second round. (1) A guard is a plain function: the operators it uses (=, <, IS DISTINCT FROM)
// were looked up in the search_path of the caller, and the worker may create a schema with an operator of its own
// (pg-boss needs CREATE on the database). So every function of the application schemas pins its search_path, and the
// guards hold for the holder of the credentials of the worker, the bot and the admin panel. (2) The id of a file is as
// much an input of the retention as its class and its day. (3) A request is written by the site and the bot with the day
// of the database and, for the site, only with a customer it made in the same transaction.
let migrator: pg.Client;
let web: pg.Client;
let admin: pg.Client;
let bot: pg.Client;
let worker: pg.Client;

const CHECK = "23514";
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

const purge = async (c: pg.Client) =>
  (await c.query<{ storage_key: string }>("select * from ops.purge_expired_files(null)")).rows
    .map((r) => r.storage_key)
    .sort();
const exists = async (id: string) =>
  Number((await one<{ n: string }>(migrator, "select count(*)::text as n from ops.files where id = $1", [id])).n) === 1;

/**
 * A schema of the worker with an operator of its own: `=` of the given types says "equal" and `<` of integers says "not
 * less". Without a fixed search_path of the guard, `x IS DISTINCT FROM y` there says "not distinct" for anything. The
 * types are only the ones the guard under test compares: the statement of the caller must still find its own row.
 */
async function withShadow(types: string[], users: pg.Client[], run: (path: string) => Promise<void>): Promise<void> {
  const name = `shadow_${uniq()}`;
  await worker.query(`create schema ${name}`);
  try {
    for (const t of types) {
      await worker.query(`create function ${name}.eq_${t}(${t}, ${t}) returns boolean language sql as 'select true'`);
      await worker.query(`create operator ${name}.= (leftarg = ${t}, rightarg = ${t}, function = ${name}.eq_${t})`);
    }
    await worker.query(
      `create function ${name}.lt_int(integer, integer) returns boolean language sql as 'select false'`,
    );
    await worker.query(`create operator ${name}.< (leftarg = integer, rightarg = integer, function = ${name}.lt_int)`);
    await worker.query(`grant usage on schema ${name} to nivel_bot, nivel_admin, nivel_web`);
    await run(`${name}, pg_catalog`);
  } finally {
    for (const c of [worker, ...users]) await c.query("reset search_path").catch(() => undefined);
    await worker.query(`drop schema ${name} cascade`);
  }
}

describe("every function of the application schemas pins its search_path", () => {
  it("lists none that takes the path of the caller (an extension's own functions are not ours)", async () => {
    const { rows } = await migrator.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1) and p.prokind = 'f'
          and not coalesce(p.proconfig @> array['search_path=pg_catalog, pg_temp'], false)
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        order by 1`,
      [[...APP_SCHEMAS]],
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
  });
});

describe("the guards hold against an operator the caller made (the worker may create schemas)", () => {
  it("files_guard: the day of a receipt cannot be moved, and the purge keeps the receipt", async () => {
    const o = await createOrder(migrator);
    await migrator.query("update sales.orders set warranty_until = now() - interval '10 years' where id = $1", [
      o.orderId,
    ]);
    const receipt = await insertFile(migrator, { retention: "tax_5y", age: "10 days" });
    await receiveFunds(migrator, o.orderId, 1_000_000);
    const p = await insertPurchase(migrator, {
      orderId: o.orderId,
      vendorId: await createVendor(migrator),
      amount: 1000,
    });
    await migrator.query("insert into sales.purchase_files (purchase_id, file_id, kind) values ($1, $2, 'receipt')", [
      p,
      receipt.id,
    ]);
    expect(await purge(worker)).not.toContain(receipt.storageKey);
    await withShadow(["timestamptz"], [], async (path) => {
      await worker.query(`set search_path = ${path}`);
      const e = await pgError(worker, "update ops.files set created_at = now() - interval '6 years' where id = $1", [
        receipt.id,
      ]);
      expect(e.code).toBe(CHECK);
      expect(e.message).toMatch(/^immutable:/);
      await worker.query("reset search_path");
    });
    expect(await purge(worker)).not.toContain(receipt.storageKey);
    expect(await exists(receipt.id)).toBe(true);
  });

  it("files_guard: the class of a file is not shortened by a '<' of the caller", async () => {
    const f = await insertFile(migrator, { retention: "tax_5y", age: "1 day" });
    await withShadow([], [], async (path) => {
      await worker.query(`set search_path = ${path}`);
      const e = await pgError(worker, "update ops.files set retention_class = 'ai_90d' where id = $1", [f.id]);
      expect(e.message).toMatch(/^immutable:/);
      await worker.query("reset search_path");
    });
    expect((await one(migrator, "select retention_class from ops.files where id = $1", [f.id])).retention_class).toBe(
      "tax_5y",
    );
  });

  it("customers_guard: the bot cannot change the Telegram id of a customer", async () => {
    const c = await one<{ id: string }>(
      migrator,
      "insert into sales.customers (display_name, telegram_user_id) values ('Victim', 7880000001) returning id",
    );
    await withShadow(["bigint"], [bot], async (path) => {
      await bot.query(`set search_path = ${path}`);
      const e = await pgError(bot, "update sales.customers set telegram_user_id = 7999999999 where id = $1", [c.id]);
      expect(e.message).toMatch(/^immutable:/);
      await bot.query("reset search_path");
    });
    expect(
      (await one(migrator, "select telegram_user_id::text as t from sales.customers where id = $1", [c.id])).t,
    ).toBe("7880000001");
  });

  it("leads_guard: the bot cannot move the day of a request", async () => {
    const id = (
      await one<{ id: string }>(
        migrator,
        "insert into sales.leads (number, channel, scope) values ($1, 'bot', 'pc') returning id",
        [`L-2995-${String(uniq()).padStart(4, "0")}`],
      )
    ).id;
    await withShadow(["timestamptz"], [bot], async (path) => {
      await bot.query(`set search_path = ${path}`);
      const e = await pgError(bot, "update sales.leads set created_at = '2020-01-01' where id = $1", [id]);
      expect(e.message).toMatch(/^immutable:/);
      await bot.query("reset search_path");
    });
  });

  it("in_owner_context: a table named pg_proc in the path of the caller does not make the caller the owner", async () => {
    const name = `fakeproc_${uniq()}`;
    await worker.query(`create schema ${name}`);
    try {
      await worker.query(`create table ${name}.pg_proc (oid oid, proowner oid)`);
      await worker.query(
        `insert into ${name}.pg_proc select 'ops.purge_expired_files'::regproc::oid, r.oid from pg_roles r where r.rolname = current_user`,
      );
      await worker.query("set nivel.files_purge = 'on'");
      const honest = await one<{ ok: boolean }>(
        worker,
        "select ops.in_owner_context('nivel.files_purge', 'ops.purge_expired_files'::regproc) as ok",
      );
      expect(honest.ok).toBe(false);
      await worker.query(`set search_path = ${name}, pg_catalog`);
      const faked = await one<{ ok: boolean }>(
        worker,
        "select ops.in_owner_context('nivel.files_purge', 'ops.purge_expired_files'::regproc) as ok",
      );
      expect(faked.ok).toBe(false);
    } finally {
      await worker.query("reset search_path");
      await worker.query("reset nivel.files_purge");
      await worker.query(`drop schema ${name} cascade`);
    }
  });

  /**
   * The way of the review: a temporary table named pg_proc whose row says that the caller owns the function, then the flag.
   * Where the role may make a temporary table (the clone of the template keeps the default right of PUBLIC; the database
   * `nivel` revokes it) the table is there, and the guard must still not read it.
   */
  async function fakeOwner(fn: string): Promise<boolean> {
    const made = await admin.query("create temp table pg_proc (oid oid, proowner oid)").then(
      () => true,
      () => false,
    );
    if (made) {
      await admin.query(
        "insert into pg_temp.pg_proc select $1::regproc::oid, r.oid from pg_roles r where r.rolname = current_user",
        [fn],
      );
    }
    return made;
  }
  const dropFake = async () => {
    await admin.query("drop table if exists pg_temp.pg_proc");
    await admin.query("reset all");
  };

  it("guard_quote: an admin cannot fake the owner of the purge to empty the PDF link of an accepted quote", async () => {
    const o = await createOrder(migrator);
    const pdf = await insertFile(migrator, { retention: "tax_5y", age: "1 day" });
    await migrator.query("update sales.quotes set pdf_uz_file_id = $2 where id = $1", [o.quoteId, pdf.id]);
    await sendQuote(migrator, o.quoteId);
    await migrator.query(
      "update sales.quotes set status = 'accepted', accepted_at = now(), acceptance = '{}'::jsonb where id = $1",
      [o.quoteId],
    );
    try {
      await fakeOwner("ops.purge_expired_files");
      await admin.query("set nivel.files_purge = 'on'");
      const e = await pgError(admin, "update sales.quotes set pdf_uz_file_id = null where id = $1", [o.quoteId]);
      expect(e.code).toBe(CHECK);
      expect(e.message).toMatch(/^immutable:/);
    } finally {
      await dropFake();
    }
    expect(
      (await one(migrator, "select pdf_uz_file_id from sales.quotes where id = $1", [o.quoteId])).pdf_uz_file_id,
    ).toBe(pdf.id);
  });

  it("guard_order: an admin cannot fake the owner of apply_transition to change the status of an order directly", async () => {
    const o = await createOrder(migrator);
    try {
      await fakeOwner("sales.apply_transition");
      await admin.query("set nivel.apply_transition = 'on'");
      const e = await pgError(admin, "update sales.orders set status = 'purchasing' where id = $1", [o.orderId]);
      expect(e.code).toBe(DENIED);
      expect(e.message).toMatch(/direct_status_change/);
    } finally {
      await dropFake();
    }
    expect((await one(migrator, "select status from sales.orders where id = $1", [o.orderId])).status).toBe(
      "estimate_draft",
    );
  });
});

describe("the id of a file is not rewritten: it names the file in the JSON of an order", () => {
  it.each(["worker", "admin"] as const)(
    "the %s role cannot detach the evidence photo of a signed act, so the purge keeps it",
    async (role) => {
      const client = role === "worker" ? worker : admin;
      const o = await createOrder(migrator);
      const f = await insertFile(migrator, { retention: "lead_12m", age: "13 months", kind: "act_photo" });
      const actId = await insertAct(migrator, o.orderId, "customer_parts");
      await migrator.query(
        "update sales.acts set signed_at = now(), signed_via = 'paper_photo', evidence = $2::jsonb where id = $1",
        [actId, JSON.stringify({ fileId: f.id })],
      );
      expect(await purge(worker)).not.toContain(f.storageKey);
      const e = await pgError(client, "update ops.files set id = gen_random_uuid() where id = $1", [f.id]);
      expect(e.code).toBe(CHECK);
      expect(e.message).toMatch(/^immutable:/);
      expect(await purge(worker)).not.toContain(f.storageKey);
      expect(await exists(f.id)).toBe(true);
    },
  );

  it("the migrator still can (a repair by hand)", async () => {
    const f = await insertFile(migrator, { retention: "media", age: "1 day" });
    await migrator.query("update ops.files set id = gen_random_uuid() where id = $1", [f.id]);
    expect(await exists(f.id)).toBe(false);
  });
});

describe("a request written by the site or the bot", () => {
  const number = () => `L-2994-${String(uniq()).padStart(4, "0")}`;
  const daysOld = async (id: string) =>
    Number(
      (
        await one<{ d: string }>(
          migrator,
          "select extract(epoch from now() - created_at)::text as d from sales.leads where id = $1",
          [id],
        )
      ).d,
    );
  /** A customer with personal data and no activity for 14 months: due for the erasure of the 12-month retention. */
  const victim = async () =>
    (
      await one<{ id: string }>(
        migrator,
        `insert into sales.customers (display_name, phone_e164, telegram_user_id, address, created_at)
         values ('Victim', $1, $2, 'Tashkent, X str', now() - interval '14 months') returning id`,
        [`+99890${String(3_000_000 + uniq())}`, 7_880_100_000 + uniq()],
      )
    ).id;

  it.each([
    ["web", () => web],
    ["bot", () => bot],
  ])(
    "%s: the day is the day of the database, whatever the INSERT says (a request cannot be made due)",
    async (_r, c) => {
      const n = number();
      await c().query(
        "insert into sales.leads (number, channel, scope, created_at) values ($1, 'web', 'pc', '2020-01-01')",
        [n],
      );
      const id = (await one<{ id: string }>(migrator, "select id from sales.leads where number = $1", [n])).id;
      expect(await daysOld(id)).toBeLessThan(60);
    },
  );

  it("web: a request cannot name a customer the site did not make in the same transaction", async () => {
    const id = await victim();
    const e = await pgError(
      web,
      "insert into sales.leads (number, customer_id, channel, scope) values ($1, $2, 'web', 'pc')",
      [number(), id],
    );
    expect(e.code).toBe(DENIED);
    expect(e.message).toMatch(/^actor_not_allowed:/);
  });

  it("web: a request names the customer it made itself in the same transaction", async () => {
    await web.query("begin");
    try {
      const c = await one<{ id: string }>(
        web,
        "insert into sales.customers (display_name) values ('New') returning id",
      );
      await web.query("insert into sales.leads (number, customer_id, channel, scope) values ($1, $2, 'web', 'pc')", [
        number(),
        c.id,
      ]);
      await web.query("commit");
    } catch (e) {
      await web.query("rollback");
      throw e;
    }
  });

  it("web: a request is opened as new", async () => {
    const e = await pgError(
      web,
      "insert into sales.leads (number, channel, scope, status) values ($1, 'web', 'pc', 'converted')",
      [number()],
    );
    expect(e.message).toMatch(/^actor_not_allowed:/);
  });

  it("the exploit of the review: an old-dated request of the site no longer makes a customer due, and the erasure leaves him", async () => {
    const id = await victim();
    await pgError(
      web,
      "insert into sales.leads (number, customer_id, channel, scope, created_at) values ($1, $2, 'web', 'pc', '2020-01-01')",
      [number(), id],
    );
    // The bot may name a customer (it finds him by his Telegram id), but the day it writes is today: the customer is active.
    await bot.query(
      "insert into sales.leads (number, customer_id, channel, scope, created_at) values ($1, $2, 'bot', 'pc', '2020-01-01')",
      [number(), id],
    );
    expect((await worker.query("select sales.purge_expired_leads() as n")).rows[0].n).toBe(0);
    const c = await one<{ display_name: string; erased_at: string | null }>(
      migrator,
      "select display_name, erased_at from sales.customers where id = $1",
      [id],
    );
    expect(c).toEqual({ display_name: "Victim", erased_at: null });
  });

  it("the admin panel and the migrator still write a request with a customer and a day (an import, a repair)", async () => {
    const id = await victim();
    await admin.query("insert into sales.leads (number, customer_id, channel, scope) values ($1, $2, 'admin', 'pc')", [
      number(),
      id,
    ]);
    await migrator.query(
      "insert into sales.leads (number, customer_id, channel, scope, created_at) values ($1, $2, 'web', 'pc', '2020-01-01')",
      [number(), id],
    );
  });
});
