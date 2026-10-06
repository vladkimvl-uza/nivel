import { describe, expect, it } from "vitest";
import { createWorkCalendar } from "../calendar/index.ts";
import type { WorkCalendar } from "../order/types.ts";
import {
  type ClientFault,
  type WarrantyEvent,
  type WarrantyStatus,
  warrantyApi,
  warrantyDeadlines,
  warrantyTransition,
} from "./index.ts";

const STATUSES: WarrantyStatus[] = [
  "opened",
  "diagnosing",
  "loaner_issued",
  "at_supplier",
  "resolved",
  "rejected",
  "closed",
];
const FAULTS: ClientFault[] = ["impact", "liquid", "overclocking", "third_party_replacement"];

const EVENTS: Record<string, WarrantyEvent> = {
  START_DIAGNOSIS: { type: "START_DIAGNOSIS" },
  ISSUE_LOANER: { type: "ISSUE_LOANER", loanerItemId: "loaner-1" },
  SEND_TO_SUPPLIER: { type: "SEND_TO_SUPPLIER" },
  RESOLVE: { type: "RESOLVE" },
  REJECT: { type: "REJECT", clientFault: "liquid", evidence: "Coolant traces on the motherboard, photo 14" },
  CLOSE: { type: "CLOSE" },
};

// The whole automaton as data (ARCHITECTURE 4.10): opened -> diagnosing -> (loaner_issued) -> (at_supplier)
// -> resolved | rejected -> closed.
const ALLOWED: ReadonlyArray<readonly [WarrantyStatus, keyof typeof EVENTS, WarrantyStatus]> = [
  ["opened", "START_DIAGNOSIS", "diagnosing"],
  ["diagnosing", "ISSUE_LOANER", "loaner_issued"],
  ["diagnosing", "SEND_TO_SUPPLIER", "at_supplier"],
  ["loaner_issued", "SEND_TO_SUPPLIER", "at_supplier"],
  ["diagnosing", "RESOLVE", "resolved"],
  ["loaner_issued", "RESOLVE", "resolved"],
  ["at_supplier", "RESOLVE", "resolved"],
  ["diagnosing", "REJECT", "rejected"],
  ["loaner_issued", "REJECT", "rejected"],
  ["at_supplier", "REJECT", "rejected"],
  ["resolved", "CLOSE", "closed"],
  ["rejected", "CLOSE", "closed"],
];

describe("warrantyTransition: every allowed transition", () => {
  it.each(ALLOWED)("%s + %s -> %s", (from, event, to) => {
    expect(warrantyTransition(from, EVENTS[event] as WarrantyEvent)).toEqual({ ok: true, next: to });
  });
});

describe("warrantyTransition: every other pair is invalid_transition", () => {
  const allowedKeys = new Set(ALLOWED.map(([from, event]) => `${from}|${event}`));
  const forbidden = STATUSES.flatMap((status) =>
    Object.keys(EVENTS)
      .filter((event) => !allowedKeys.has(`${status}|${event}`))
      .map((event) => [status, event] as const),
  );

  it("covers the whole matrix", () => {
    expect(forbidden.length + ALLOWED.length).toBe(STATUSES.length * Object.keys(EVENTS).length);
  });

  it.each(forbidden)("%s + %s", (status, event) => {
    expect(warrantyTransition(status, EVENTS[event] as WarrantyEvent)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("prototype keys and missing events are not events or statuses", () => {
    const invalid = { ok: false, error: "invalid_transition" };
    expect(warrantyTransition("opened", { type: "constructor" } as unknown as WarrantyEvent)).toEqual(invalid);
    expect(warrantyTransition("opened", { type: "toString" } as unknown as WarrantyEvent)).toEqual(invalid);
    expect(warrantyTransition("constructor" as WarrantyStatus, EVENTS.CLOSE as WarrantyEvent)).toEqual(invalid);
    expect(warrantyTransition("opened", null as unknown as WarrantyEvent)).toEqual(invalid);
    expect(warrantyTransition("opened", undefined as unknown as WarrantyEvent)).toEqual(invalid);
  });

  it("unknown event types and statuses are invalid_transition", () => {
    expect(warrantyTransition("opened", { type: "NOPE" } as unknown as WarrantyEvent)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(warrantyTransition("nope" as WarrantyStatus, EVENTS.START_DIAGNOSIS as WarrantyEvent)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("warrantyTransition: refusal needs a causal link", () => {
  it.each(FAULTS)("client fault %s with evidence is accepted", (clientFault) => {
    expect(warrantyTransition("diagnosing", { type: "REJECT", clientFault, evidence: "act 12" })).toEqual({
      ok: true,
      next: "rejected",
    });
  });

  it.each(["", "   ", "\n\t"])("blank evidence %j -> fault_evidence_missing", (evidence) => {
    expect(warrantyTransition("diagnosing", { type: "REJECT", clientFault: "impact", evidence })).toEqual({
      ok: false,
      error: "fault_evidence_missing",
    });
  });

  it("missing or unknown client fault -> fault_evidence_missing", () => {
    expect(warrantyTransition("diagnosing", { type: "REJECT", evidence: "x" } as unknown as WarrantyEvent)).toEqual({
      ok: false,
      error: "fault_evidence_missing",
    });
    expect(
      warrantyTransition("diagnosing", {
        type: "REJECT",
        clientFault: "bad_luck",
        evidence: "x",
      } as unknown as WarrantyEvent),
    ).toEqual({ ok: false, error: "fault_evidence_missing" });
  });

  it("non-string evidence -> fault_evidence_missing", () => {
    expect(
      warrantyTransition("at_supplier", {
        type: "REJECT",
        clientFault: "impact",
        evidence: 5,
      } as unknown as WarrantyEvent),
    ).toEqual({ ok: false, error: "fault_evidence_missing" });
  });

  it("the state check comes before the evidence check", () => {
    expect(warrantyTransition("opened", { type: "REJECT", clientFault: "impact", evidence: "" })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("warrantyTransition: loaner", () => {
  it("a blank loaner item is a malformed event", () => {
    expect(warrantyTransition("diagnosing", { type: "ISSUE_LOANER", loanerItemId: "  " })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });
});

describe("full warranty cases", () => {
  const run = (start: WarrantyStatus, events: WarrantyEvent[]): WarrantyStatus => {
    let status = start;
    for (const e of events) {
      const r = warrantyTransition(status, e);
      if (!r.ok) throw new Error(`${status} + ${e.type}: ${r.error}`);
      status = r.next;
    }
    return status;
  };

  it("repair with a loaner and the supplier", () => {
    expect(
      run("opened", [
        EVENTS.START_DIAGNOSIS as WarrantyEvent,
        EVENTS.ISSUE_LOANER as WarrantyEvent,
        EVENTS.SEND_TO_SUPPLIER as WarrantyEvent,
        EVENTS.RESOLVE as WarrantyEvent,
        EVENTS.CLOSE as WarrantyEvent,
      ]),
    ).toBe("closed");
  });

  it("refusal with evidence", () => {
    expect(
      run("opened", [
        EVENTS.START_DIAGNOSIS as WarrantyEvent,
        EVENTS.REJECT as WarrantyEvent,
        EVENTS.CLOSE as WarrantyEvent,
      ]),
    ).toBe("closed");
  });

  it("closed is final", () => {
    for (const e of Object.values(EVENTS)) {
      expect(warrantyTransition("closed", e).ok).toBe(false);
    }
  });
});

describe("warrantyDeadlines", () => {
  // Wednesday 2026-10-07 11:00 Tashkent; Tuesday the 13th is a test holiday.
  const cal = createWorkCalendar(["2026-10-13"], { from: "10:00", to: "19:00" });
  const opened = new Date("2026-10-07T11:00:00+05:00");
  const at = (iso: string): number => new Date(`${iso}+05:00`).getTime();

  it("reply 1 working day, diagnosis 2 working days", () => {
    const d = warrantyDeadlines(opened, cal);
    expect(d.reply.getTime()).toBe(at("2026-10-08T11:00:00"));
    expect(d.diagnosis.getTime()).toBe(at("2026-10-09T11:00:00"));
  });

  it("loaner is 3 calendar days (3 суток), also through Sunday", () => {
    expect(warrantyDeadlines(opened, cal).loaner.getTime()).toBe(at("2026-10-10T11:00:00"));
    const friday = new Date("2026-10-09T11:00:00+05:00");
    expect(warrantyDeadlines(friday, cal).loaner.getTime()).toBe(at("2026-10-12T11:00:00"));
  });

  it("fix: 10 working days for work, 20 calendar days for parts", () => {
    const d = warrantyDeadlines(opened, cal);
    // Thu 8, Fri 9, Sat 10, Mon 12, (Tue 13 holiday) Wed 14, 15, 16, 17 Sat, Mon 19, Tue 20.
    expect(d.fixWork.getTime()).toBe(at("2026-10-20T11:00:00"));
    expect(d.fixParts.getTime()).toBe(at("2026-10-27T11:00:00"));
  });

  it("returns new Dates and does not mutate openedAt", () => {
    const before = opened.getTime();
    const d = warrantyDeadlines(opened, cal);
    expect(opened.getTime()).toBe(before);
    for (const v of Object.values(d)) expect(v).not.toBe(opened);
  });

  it("asks the given calendar for working days (1, 2 and 10)", () => {
    const asked: number[] = [];
    const fake: WorkCalendar = {
      isWorkingDay: () => true,
      isResponseHours: () => true,
      nextWorkingDayStart: (d) => d,
      addWorkingDays: (d, n) => {
        asked.push(n);
        return new Date(d.getTime() + n * 1000);
      },
    };
    const d = warrantyDeadlines(opened, fake);
    expect(asked).toEqual([1, 2, 10]);
    expect(d.reply.getTime()).toBe(opened.getTime() + 1000);
    expect(d.fixWork.getTime()).toBe(opened.getTime() + 10_000);
  });

  it("rejects an invalid Date", () => {
    expect(() => warrantyDeadlines(new Date(Number.NaN), cal)).toThrow(RangeError);
  });

  it("exposes the contract object", () => {
    expect(warrantyApi.warrantyTransition).toBe(warrantyTransition);
    expect(warrantyApi.warrantyDeadlines).toBe(warrantyDeadlines);
  });
});
