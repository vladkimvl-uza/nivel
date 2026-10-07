import type { ops } from "@nivel/db/repos";
import { describe, expect, it } from "vitest";
import { FakeClock, recordingLogger } from "../../queues/test-support/fakes.ts";
import {
  handleVendorExpiry,
  handleWarrantySla,
  overdueTerms,
  type SlaCase,
  type VendorWarranty,
  type WarrantyDeps,
} from "./sla.ts";

const at = (iso: string) => new Date(`${iso}+05:00`);

const warrantyCase = (over: Partial<SlaCase> = {}): SlaCase => ({
  id: "c-1",
  number: "G-2026-0003",
  orderId: "o-1",
  orderNumber: "NV-2026-0001",
  status: "opened",
  dueReply: at("2026-10-13T10:00:00"),
  dueDiagnosis: at("2026-10-14T10:00:00"),
  dueFix: at("2026-10-26T10:00:00"),
  ...over,
});

describe("overdueTerms: the terms of a warranty case (ARCHITECTURE 4.10)", () => {
  it("is nothing before the first term", () => {
    expect(overdueTerms(warrantyCase(), at("2026-10-13T09:59:59"))).toEqual([]);
  });

  it("is the reply of a case nobody has taken after one working day", () => {
    expect(overdueTerms(warrantyCase(), at("2026-10-13T10:00:01"))).toEqual(["reply"]);
    expect(overdueTerms(warrantyCase(), at("2026-10-13T10:00:00"))).toEqual([]);
  });

  it("does not ask for the reply of a case that is taken: it is diagnosing", () => {
    expect(overdueTerms(warrantyCase({ status: "diagnosing" }), at("2026-10-13T12:00:00"))).toEqual([]);
  });

  it("is the diagnosis while the case is opened or diagnosing, and not after it", () => {
    expect(overdueTerms(warrantyCase({ status: "diagnosing" }), at("2026-10-14T10:30:00"))).toEqual(["diagnosis"]);
    expect(overdueTerms(warrantyCase({ status: "loaner_issued" }), at("2026-10-14T10:30:00"))).toEqual([]);
    expect(overdueTerms(warrantyCase({ status: "at_supplier" }), at("2026-10-14T10:30:00"))).toEqual([]);
  });

  it("is the fix for every case that is not resolved yet", () => {
    for (const status of ["opened", "diagnosing", "loaner_issued", "at_supplier"] as const) {
      expect(overdueTerms(warrantyCase({ status }), at("2026-10-27T10:00:00"))).toContain("fix");
    }
  });

  it("is nothing for a case that is resolved, rejected or closed, whatever the date", () => {
    for (const status of ["resolved", "rejected", "closed"] as const) {
      expect(overdueTerms(warrantyCase({ status }), at("2027-01-01T10:00:00"))).toEqual([]);
    }
  });

  it("lists all the terms that have passed, in order", () => {
    expect(overdueTerms(warrantyCase(), at("2026-10-27T10:00:00"))).toEqual(["reply", "diagnosis", "fix"]);
  });

  it("skips a term the case does not have", () => {
    expect(
      overdueTerms(warrantyCase({ dueReply: null, dueDiagnosis: null, dueFix: null }), at("2027-01-01T10:00:00")),
    ).toEqual([]);
  });
});

function setup(cases: SlaCase[], now = at("2026-10-14T11:00:00"), vendor: VendorWarranty[] = []) {
  const clock = new FakeClock(now);
  const enqueued: ops.OutboxInput[] = [];
  const seen = new Set<string>();
  const { log } = recordingLogger();
  const deps: WarrantyDeps = {
    now: clock.now,
    log,
    openCases: async () => cases,
    vendorWarranties: async () => vendor,
    enqueue: async (input) => {
      const duplicate = input.dedupeKey !== undefined && seen.has(input.dedupeKey);
      if (input.dedupeKey !== undefined) seen.add(input.dedupeKey);
      if (!duplicate) enqueued.push(input);
      return { id: "x", duplicate };
    },
  };
  return { deps, enqueued };
}

describe("handleWarrantySla", () => {
  it("tells the owner in the topic of the order about each overdue term, once for each case and term", async () => {
    const t = setup([warrantyCase()]);
    expect(await handleWarrantySla(t.deps)).toEqual({ reminded: 2 });
    expect(t.enqueued).toEqual([
      {
        kind: "telegram_message",
        dedupeKey: "warranty:c-1:sla:reply",
        priority: 4,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.warranty_sla",
          orderId: "o-1",
          orderNumber: "NV-2026-0001",
          params: { caseNumber: "G-2026-0003", kind: "reply" },
        },
      },
      {
        kind: "telegram_message",
        dedupeKey: "warranty:c-1:sla:diagnosis",
        priority: 4,
        payload: {
          target: "owner_topic",
          templateKey: "reminder.warranty_sla",
          orderId: "o-1",
          orderNumber: "NV-2026-0001",
          params: { caseNumber: "G-2026-0003", kind: "diagnosis" },
        },
      },
    ]);
  });

  it("is quiet when nothing is overdue", async () => {
    const t = setup([warrantyCase()], at("2026-10-12T12:00:00"));
    expect(await handleWarrantySla(t.deps)).toEqual({ reminded: 0 });
    expect(t.enqueued).toEqual([]);
  });
});

describe("handleWarrantySla: a term is told once", () => {
  it("does not count, or send again, what the dedupe key already holds", async () => {
    const t = setup([warrantyCase()]);
    expect(await handleWarrantySla(t.deps)).toEqual({ reminded: 2 });
    expect(await handleWarrantySla(t.deps)).toEqual({ reminded: 0 });
    expect(t.enqueued).toHaveLength(2);
  });
});

describe("handleVendorExpiry: the warranty of the shop ends within 30 days", () => {
  const w = (over: Partial<VendorWarranty> = {}): VendorWarranty => ({
    purchaseId: "p-1",
    orderId: "o-1",
    orderNumber: "NV-2026-0001",
    until: "2026-11-11",
    ...over,
  });

  it("tells the owner once for an order and an end date, with the number of items", async () => {
    const t = setup([], at("2026-10-12T09:00:00"), [
      w(),
      w({ purchaseId: "p-2" }),
      w({ purchaseId: "p-3", until: "2026-11-20" }),
    ]);
    expect(await handleVendorExpiry(t.deps, "2026-10-12")).toEqual({ reminded: 2 });
    expect(t.enqueued.map((e) => [e.dedupeKey, (e.payload.params as { items: number }).items])).toEqual([
      ["order:o-1:vendor_warranty:2026-11-11", 2],
      ["order:o-1:vendor_warranty:2026-11-20", 1],
    ]);
    expect(t.enqueued[0]).toMatchObject({
      kind: "telegram_message",
      priority: 4,
      payload: {
        target: "owner_topic",
        templateKey: "reminder.vendor_warranty",
        orderId: "o-1",
        orderNumber: "NV-2026-0001",
        params: { until: "2026-11-11", items: 2 },
      },
    });
  });

  it("does not tell twice and is quiet without warranties", async () => {
    const t = setup([], at("2026-10-12T09:00:00"), [w()]);
    await handleVendorExpiry(t.deps, "2026-10-12");
    expect(await handleVendorExpiry(t.deps, "2026-10-12")).toEqual({ reminded: 0 });
    const none = setup([]);
    expect(await handleVendorExpiry(none.deps, "2026-10-12")).toEqual({ reminded: 0 });
  });
});
