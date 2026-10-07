// warranty.sla (ARCHITECTURE 9): every 15 minutes the worker looks at the open warranty cases and tells the owner of the terms that have
// passed: the reply to the customer (1 working day), the diagnosis (2 working days), the fix (10 working days for work, 20 days
// for parts). The terms are fixed in the case when it is opened (`warrantyDeadlines` of the domain); the worker only compares them
// with the clock. One message for each case and term (the dedupe key).
// warranty.vendor_expiry (09:00): the warranty of the shop on a purchase ends within 30 days, once for each order and end date.
import type { ops } from "@nivel/db/repos";
import type { Logger } from "pino";

export type SlaTerm = "reply" | "diagnosis" | "fix";

export interface SlaCase {
  id: string;
  /** G-2026-0003 */
  number: string;
  orderId: string;
  orderNumber: string;
  status: "opened" | "diagnosing" | "loaner_issued" | "at_supplier" | "resolved" | "rejected" | "closed";
  dueReply: Date | null;
  dueDiagnosis: Date | null;
  dueFix: Date | null;
}

export interface VendorWarranty {
  purchaseId: string;
  orderId: string;
  orderNumber: string;
  /** The day the warranty of the shop ends (YYYY-MM-DD). */
  until: string;
}

export interface WarrantyDeps {
  now(): Date;
  log: Logger;
  /** Cases that are not resolved, rejected or closed. */
  openCases(): Promise<SlaCase[]>;
  /** Purchases whose warranty of the shop ends within 30 days and that have no reminder yet. */
  vendorWarranties(today: string): Promise<VendorWarranty[]>;
  enqueue(input: ops.OutboxInput): Promise<{ duplicate: boolean }>;
}

const PRIORITY = 4;
const OPEN: readonly SlaCase["status"][] = ["opened", "diagnosing", "loaner_issued", "at_supplier"];

/** The terms of the case that have passed at `now`, in the order of the life of a case. */
export function overdueTerms(c: SlaCase, now: Date): SlaTerm[] {
  if (!OPEN.includes(c.status)) return [];
  const late = (due: Date | null): boolean => due !== null && now.getTime() > due.getTime();
  const out: SlaTerm[] = [];
  // Nobody has taken the case: it is still `opened`.
  if (c.status === "opened" && late(c.dueReply)) out.push("reply");
  // The diagnosis is not done: the case has not gone past `diagnosing`.
  if ((c.status === "opened" || c.status === "diagnosing") && late(c.dueDiagnosis)) out.push("diagnosis");
  if (late(c.dueFix)) out.push("fix");
  return out;
}

export async function handleWarrantySla(
  deps: Pick<WarrantyDeps, "now" | "log" | "openCases" | "enqueue">,
): Promise<{ reminded: number }> {
  const now = deps.now();
  let reminded = 0;
  for (const c of await deps.openCases()) {
    for (const kind of overdueTerms(c, now)) {
      const made = await deps.enqueue({
        kind: "telegram_message",
        dedupeKey: `warranty:${c.id}:sla:${kind}`,
        priority: PRIORITY,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.warranty_sla",
          orderId: c.orderId,
          orderNumber: c.orderNumber,
          params: { caseNumber: c.number, kind },
        },
      });
      // A term told yesterday is not told again: only what is new counts.
      if (!made.duplicate) reminded += 1;
    }
  }
  if (reminded > 0) deps.log.info({ reminded }, "warranty.sla");
  return { reminded };
}

/** One message for each order and end date: "the warranty of the shop on N items ends on <date>" (within 30 days of the end). */
export async function handleVendorExpiry(
  deps: Pick<WarrantyDeps, "now" | "log" | "vendorWarranties" | "enqueue">,
  today: string,
): Promise<{ reminded: number }> {
  const groups = new Map<string, { orderId: string; orderNumber: string; until: string; items: number }>();
  for (const w of await deps.vendorWarranties(today)) {
    const key = `${w.orderId}:${w.until}`;
    const g = groups.get(key);
    if (g) g.items += 1;
    else groups.set(key, { orderId: w.orderId, orderNumber: w.orderNumber, until: w.until, items: 1 });
  }
  let reminded = 0;
  for (const g of groups.values()) {
    const made = await deps.enqueue({
      kind: "telegram_message",
      dedupeKey: `order:${g.orderId}:vendor_warranty:${g.until}`,
      priority: PRIORITY,
      payload: {
        target: "owner_topic",
        templateKey: "reminder.vendor_warranty",
        orderId: g.orderId,
        orderNumber: g.orderNumber,
        params: { until: g.until, items: g.items },
      },
    });
    if (!made.duplicate) reminded += 1;
  }
  if (reminded > 0) deps.log.info({ reminded }, "warranty.vendor_expiry");
  return { reminded };
}
