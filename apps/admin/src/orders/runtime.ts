// The services of the orders screens on the connection of the admin role. The runtime is passed to every scenario
// explicitly: a bundle of Next.js may hold more than one copy of a module, and a global `configureServices` would be
// set in one copy and read in another. Server only.
import * as services from "@nivel/services";
import { getRuntime } from "../auth/runtime.ts";
import type { SessionUser } from "../auth/service.ts";
import type { Ctx } from "./commands.ts";
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

export function ordersCtx(user: SessionUser): Ctx {
  const rt = servicesRuntime();
  return { user: { id: user.id, role: user.role }, svc: services, rt, now: () => rt.now() };
}

export function quoteCtx(user: SessionUser): QuoteCtx {
  const base = ordersCtx(user);
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
