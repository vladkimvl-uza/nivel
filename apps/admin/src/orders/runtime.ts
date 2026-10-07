// The services of the orders screens on the connection of the admin role. The runtime is passed to every scenario
// explicitly: a bundle of Next.js may hold more than one copy of a module, and a global `configureServices` would be
// set in one copy and read in another. Server only.
import { UuidSchema } from "@nivel/contracts/orders";
import type { Db } from "@nivel/db";
import { sales } from "@nivel/db/repos";
import * as services from "@nivel/services";
import { getRuntime } from "../auth/runtime.ts";
import type { SessionUser } from "../auth/service.ts";
import type { Ctx, Facts } from "./commands.ts";
import { featureOn } from "./flags.ts";
import type { QuoteCtx } from "./quote-editor.ts";
import { loadDraftLines } from "./read-quote.ts";
import type { Writer } from "./writes.ts";

const KEY = Symbol.for("nivel.admin.orders.services");

/** One runtime per database handle of the admin (the handle is kept on globalThis by `getRuntime`). */
export function servicesRuntime(): services.orders.Runtime {
  const admin = getRuntime();
  const holder = globalThis as unknown as Record<symbol, { db: unknown; rt: services.orders.Runtime } | undefined>;
  const existing = holder[KEY];
  if (existing && existing.db === admin.db) return existing.rt;
  const rt = services.orders.createRuntime({ db: admin.db, role: "admin", appMode: admin.env.APP_MODE });
  holder[KEY] = { db: admin.db, rt };
  return rt;
}

/** What the commands read from the database where the services have no scenario to ask (see `Facts`). */
export function factsOf(db: Db): Facts {
  return {
    customerOf: async (orderId) => (await uuidOnly(orderId, () => sales.getOrder(db, orderId)))?.customerId ?? null,
    orderNumber: async (orderId) => (await uuidOnly(orderId, () => sales.getOrder(db, orderId)))?.number ?? null,
    actOrderId: async (actId) =>
      (
        await uuidOnly(actId, () =>
          db.query.acts.findFirst({ columns: { orderId: true }, where: (t, { eq }) => eq(t.id, actId) }),
        )
      )?.orderId ?? null,
    featureOn: (key) => featureOn(db, key),
  };
}

/** An id that is not an id is a record that is not there: the database would answer with its own error. */
async function uuidOnly<T>(id: string, read: () => Promise<T | null | undefined>): Promise<T | null> {
  return UuidSchema.safeParse(id).success ? ((await read()) ?? null) : null;
}

export function ordersCtx(user: SessionUser, ipHash: string | null = null): Ctx {
  const rt = servicesRuntime();
  const admin = getRuntime();
  return {
    user: { id: user.id, role: user.role },
    svc: services,
    rt,
    now: () => rt.now(),
    facts: factsOf(admin.db),
    audit: admin.audit,
    ipHash,
  };
}

export function quoteCtx(user: SessionUser, ipHash: string | null = null): QuoteCtx {
  const base = ordersCtx(user, ipHash);
  return { ...base, drafts: { load: (orderId) => loadDraftLines(getRuntime().db, orderId) } };
}

export function writerFor(user: SessionUser, ipHash: string | null): Writer {
  const admin = getRuntime();
  return {
    db: admin.db,
    audit: admin.audit,
    user: { id: user.id, role: user.role },
    now: () => servicesRuntime().now(),
    ipHash,
  };
}
