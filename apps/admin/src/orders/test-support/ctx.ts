// A context of the commands for unit tests: the services are the fakes the test gives, the database is not there. What
// the commands look up (the customer of an order, the number of an order, the order an act belongs to, a switch) is a
// table the test can change; the journal keeps what the commands wrote.
import type { Role } from "../../auth/roles.ts";
import type { AuditEntry } from "../../auth/store.ts";
import type { Ctx, Svc } from "../commands.ts";

export const ORDER_ID = "0199aaaa-bbbb-7ccc-8ddd-000000000001";
export const CUSTOMER_ID = "0199aaaa-bbbb-7ccc-8ddd-000000000008";
export const ACT_ID = "0199aaaa-bbbb-7ccc-8ddd-000000000006";

export interface TestWorld {
  customers: Record<string, string>;
  numbers: Record<string, string>;
  actOrders: Record<string, string>;
  flags: Record<string, boolean>;
}

export function fakeCtx(
  role: Role,
  svc: Partial<Svc> = {},
  world: Partial<TestWorld> = {},
): Ctx & { journal: AuditEntry[]; world: TestWorld } {
  const full: TestWorld = {
    customers: { [ORDER_ID]: CUSTOMER_ID },
    numbers: { [ORDER_ID]: "NV-2026-0001" },
    actOrders: { [ACT_ID]: ORDER_ID },
    flags: { "feature.pdf": true },
    ...world,
  };
  const journal: AuditEntry[] = [];
  return {
    user: { id: `${role}-1`, role },
    svc: svc as Svc,
    rt: {} as Ctx["rt"],
    now: () => new Date("2026-10-12T05:00:00Z"),
    ipHash: "ip-1",
    audit: {
      append: async (entry) => {
        journal.push(entry);
      },
    },
    facts: {
      customerOf: async (orderId) => full.customers[orderId] ?? null,
      orderNumber: async (orderId) => full.numbers[orderId] ?? null,
      actOrderId: async (actId) => full.actOrders[actId] ?? null,
      featureOn: async (key) => full.flags[key] === true,
    },
    journal,
    world: full,
  };
}
