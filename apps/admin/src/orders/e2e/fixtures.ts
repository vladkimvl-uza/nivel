// Playwright fixtures of the orders screens (e2e/orders-*.spec.ts). Built on the harness of the admin (a database, the real
// standalone build, the users with a second factor): a worker also gets the catalog of the tests and the services of the
// roles that act for the customer and for the system, because the admin does not do their parts (a customer accepts in the
// bot, a handed over order is closed by the worker). Not part of the application.
import type { Db } from "@nivel/db";
import { consents, leads, orders } from "@nivel/services";
import { testDatabaseNames, withDatabase } from "@nivel/testing";
import { test as adminTest, expect, onlyDesktop, onlyPhone, signIn, tashkentToday } from "../../auth/e2e/fixtures.ts";
import type { AdminHarness, TestUser } from "../../auth/e2e/harness.ts";
import { type CatalogSeed, createRuntimes, newCustomer, seedCatalog } from "../test-support/world.ts";

export type { AdminHarness, TestUser };
export { expect, onlyDesktop, onlyPhone, signIn, tashkentToday };

/** What the browser tests need besides the admin: the catalog and the services of the other roles on the same database. */
export interface OrdersWorld {
  admin: orders.Runtime;
  bot: orders.Runtime;
  web: orders.Runtime;
  worker: orders.Runtime;
  db: Db;
  catalog: CatalogSeed;
  close(): Promise<void>;
}

function urlsFor(slot: number, parallelIndex: number) {
  const names = testDatabaseNames(slot, `adm${parallelIndex}`);
  const from = (key: string) => {
    const base = process.env[`TEST_DATABASE_URL_${key}`];
    if (!base) throw new Error(`TEST_DATABASE_URL_${key} is not set (pnpm env:init)`);
    return withDatabase(base, names.worker);
  };
  return { ADMIN: from("ADMIN"), BOT: from("BOT"), WEB: from("WEB"), WORKER: from("WORKER") };
}

export const test = adminTest.extend<object, { world: OrdersWorld }>({
  world: [
    async ({ admin: _admin }, use, workerInfo) => {
      const slot = Number(process.env.NIVEL_SLOT ?? "0");
      const rts = createRuntimes({ urls: urlsFor(slot, workerInfo.parallelIndex), appMode: "development" });
      const catalog = await seedCatalog(rts.admin.db, { offers: "published", suffix: "-e2e" });
      const world: OrdersWorld = {
        admin: rts.admin,
        bot: rts.bot,
        web: rts.web,
        worker: rts.worker,
        db: rts.admin.db,
        catalog,
        close: rts.close,
      };
      try {
        await use(world);
      } finally {
        await world.close();
      }
    },
    { scope: "worker", timeout: 5 * 60_000 },
  ],
});

let telegram = 7_800_000_000 + Math.floor(Math.random() * 100_000_000);

/** A request of the bot for the owner to take: the customer exists, the order does not. */
export async function botLead(world: OrdersWorld, name: string) {
  telegram += 1;
  const made = await leads.create(
    {
      channel: "bot",
      scope: "pc",
      district: "Юнусабад",
      budgetSum: 15_000_000,
      customer: { telegramUserId: telegram, displayName: name },
    },
    world.bot,
  );
  return { leadId: made.leadId, number: made.number, customerId: made.customerId as string };
}

/** A request of the site that could not be linked to a customer: its phone is already a customer's. */
export async function siteLeadWithoutCustomer(world: OrdersWorld, name: string, phone: string) {
  const known = await newCustomer(world.db, `Существующий ${name}`);
  await world.db.$client.query("update sales.customers set phone_e164 = $2 where id = $1", [known, phone]);
  const made = await leads.create(
    { channel: "web", scope: "pc", customer: { displayName: name, phoneE164: phone } },
    world.web,
  );
  return { ...made, existingCustomerId: known };
}

async function orderOf(world: OrdersWorld, orderId: string) {
  const row = (
    await world.db.$client.query<{ customer_id: string; current_quote_id: string }>(
      "select customer_id, current_quote_id from sales.orders where id = $1",
      [orderId],
    )
  ).rows[0];
  if (!row) throw new Error(`order ${orderId} not found`);
  return { customerId: row.customer_id, quoteId: row.current_quote_id };
}

/** The customer reads the estimate in the bot and presses "accept": the three consents, then ACCEPT. */
export async function customerAcceptsEstimate(world: OrdersWorld, orderId: string): Promise<void> {
  const { customerId, quoteId } = await orderOf(world, orderId);
  const ids = [
    (await consents.record({ kind: "pd_processing", customerId, granted: true, channel: "bot" }, world.bot)).id,
  ];
  for (const kind of ["supplier_data_transfer", "non_returnable"] as const) {
    ids.push((await consents.record({ kind, customerId, orderId, granted: true, channel: "bot" }, world.bot)).id);
  }
  const r = await orders.dispatch(
    orderId,
    { type: "ACCEPT", quoteId, consentIds: ids, channel: "bot" },
    { kind: "customer", id: customerId },
    world.bot,
  );
  if (!r.ok) throw new Error(`the estimate was not accepted: ${r.error}`);
}

/** The customer confirms the report in the bot. */
export async function customerAcceptsReport(world: OrdersWorld, orderId: string): Promise<void> {
  const { customerId } = await orderOf(world, orderId);
  const r = await orders.dispatch(
    orderId,
    { type: "REPORT_ACCEPTED" },
    { kind: "customer", id: customerId },
    world.bot,
  );
  if (!r.ok) throw new Error(`the report was not accepted: ${r.error}`);
}

/** The worker closes a handed over order after the reconciliation (the admin has no such button: the automaton gives it to the system). */
export async function workerCloses(world: OrdersWorld, orderId: string) {
  return orders.dispatch(orderId, { type: "CLOSE" }, { kind: "system", id: "system" }, world.worker);
}

/**
 * A GET made by the page itself, with its cookies: the session cookie is `Secure` and the request context of Playwright
 * does not send it over plain http (the browser does for 127.0.0.1).
 */
export async function getInBrowser(page: import("@playwright/test").Page, url: string) {
  return page.evaluate(async (target) => {
    const r = await fetch(target, { credentials: "same-origin" });
    const type = r.headers.get("content-type");
    return {
      status: r.status,
      type,
      disposition: r.headers.get("content-disposition"),
      text: type?.startsWith("text/") ? await r.text() : "",
    };
  }, url);
}
