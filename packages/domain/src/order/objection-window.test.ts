// WP-00, ADR-007 item 3: the objection window (report.objectionUntil) decides OBJECTION and REPORT_DEEMED_ACCEPTED.
import { describe, expect, it } from "vitest";
import { transition } from "./index.ts";
import { CAL, DAY, EVENTS, NOW, type OrderPatch, order, SETTINGS, sum, tk } from "./testkit.ts";
import type { Actor, OrderEvent, TransitionResult } from "./types.ts";

/** The window closes at UNTIL; `at(0)` is that very instant. */
const UNTIL = tk("2026-10-09T12:00:00");
const at = (offsetMs: number): Date => new Date(UNTIL.getTime() + offsetMs);

function run(
  report: NonNullable<OrderPatch["report"]> | null,
  event: OrderEvent,
  actor: Actor,
  now: Date,
): TransitionResult {
  return transition(order({ status: "report_sent", report }), event, actor, now, CAL, SETTINGS);
}
const objection = (now: Date, report: NonNullable<OrderPatch["report"]> = { objectionUntil: UNTIL }) =>
  run(report, EVENTS.OBJECTION, "customer", now);
const deemed = (now: Date, report: NonNullable<OrderPatch["report"]> = { objectionUntil: UNTIL }) =>
  run(report, EVENTS.REPORT_DEEMED_ACCEPTED, "system", now);

const OK = { ok: true, next: "report_sent" } as const;

describe("OBJECTION and the objection window", () => {
  it("is accepted long before, a millisecond before and exactly at the end of the window", () => {
    expect(objection(NOW)).toMatchObject(OK);
    expect(objection(at(-1))).toMatchObject(OK);
    expect(objection(at(0))).toMatchObject(OK);
  });

  it("is rejected a millisecond after the end of the window and any time later", () => {
    expect(objection(at(1))).toEqual({ ok: false, error: "invalid_transition" });
    expect(objection(at(30 * DAY))).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("without a known window (null) it stays possible: the customer is not cut off by a missing date", () => {
    expect(objection(at(30 * DAY), { objectionUntil: null })).toMatchObject(OK);
  });

  it("an unusable date fails closed", () => {
    expect(objection(NOW, { objectionUntil: new Date("nope") })).toEqual({ ok: false, error: "invalid_transition" });
    // A snapshot that went through JSON holds a string instead of a Date.
    const json = { objectionUntil: UNTIL.toISOString() as unknown as Date };
    expect(objection(NOW, json)).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("the old rules stay: an accepted report and a blank text are still rejected inside the window", () => {
    expect(objection(NOW, { objectionUntil: UNTIL, accepted: true })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(run({ objectionUntil: UNTIL }, { type: "OBJECTION", text: " " }, "customer", NOW)).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("only the customer objects, also inside the window", () => {
    expect(run({ objectionUntil: UNTIL }, EVENTS.OBJECTION, "system", NOW)).toEqual({
      ok: false,
      error: "actor_not_allowed",
    });
  });

  it("an objection that is already open does not close the window to another message", () => {
    expect(objection(at(0), { objectionUntil: UNTIL, objectionOpen: true })).toMatchObject(OK);
  });
});

describe("REPORT_DEEMED_ACCEPTED and the objection window", () => {
  it("is rejected before the end of the window: a millisecond before and exactly at the end", () => {
    expect(deemed(NOW)).toEqual({ ok: false, error: "report_objection_open" });
    expect(deemed(at(-1))).toEqual({ ok: false, error: "report_objection_open" });
    expect(deemed(at(0))).toEqual({ ok: false, error: "report_objection_open" });
  });

  it("is accepted from the first millisecond after the window", () => {
    expect(deemed(at(1))).toMatchObject(OK);
    expect(deemed(at(30 * DAY))).toMatchObject(OK);
  });

  it("without a window (null) the report is never deemed accepted", () => {
    expect(deemed(at(30 * DAY), { objectionUntil: null })).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("an unusable date fails closed", () => {
    expect(deemed(at(DAY), { objectionUntil: new Date("nope") })).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("an open objection still blocks it after the window", () => {
    expect(deemed(at(DAY), { objectionUntil: UNTIL, objectionOpen: true })).toEqual({
      ok: false,
      error: "report_objection_open",
    });
  });

  it("an accepted report cannot be deemed accepted again, a missing report is invalid", () => {
    expect(deemed(at(DAY), { objectionUntil: UNTIL, accepted: true })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(run(null, EVENTS.REPORT_DEEMED_ACCEPTED, "system", at(DAY))).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("only the system sends it, also after the window", () => {
    for (const actor of ["customer", "owner", "assistant"] as const) {
      expect(run({ objectionUntil: UNTIL }, EVENTS.REPORT_DEEMED_ACCEPTED, actor, at(DAY))).toEqual({
        ok: false,
        error: "actor_not_allowed",
      });
    }
  });

  it("has no effects, as before", () => {
    expect(deemed(at(1))).toEqual({ ok: true, next: "report_sent", effects: [] });
  });
});

describe("REPORT_ACCEPTED does not depend on the window", () => {
  it.each([-DAY, 0, DAY])("the customer may accept the report at %s ms from the end of the window", (offset) => {
    expect(run({ objectionUntil: UNTIL }, EVENTS.REPORT_ACCEPTED, "customer", at(offset))).toMatchObject(OK);
  });
});

describe("exactly one of OBJECTION and REPORT_DEEMED_ACCEPTED is possible at any moment", () => {
  it("they partition the time line at objectionUntil", () => {
    for (const offset of [-DAY, -1, 0, 1, DAY]) {
      const now = at(offset);
      expect(objection(now).ok !== deemed(now).ok, `offset ${String(offset)}`).toBe(true);
    }
  });

  it("works with the window that SEND_REPORT itself sets (+3 working days)", () => {
    const sent = transition(
      order({
        status: "report_due",
        purchasesComplete: true,
        money: { fundsReceived: sum(10_300_000), receiptsTotal: sum(9_000_000), refunded: sum(1_300_000) },
      }),
      EVENTS.SEND_REPORT,
      "owner",
      NOW,
      CAL,
      SETTINGS,
    );
    if (!sent.ok) throw new Error(sent.error);
    const set = sent.effects.find((e) => e.kind === "set" && e.field === "objectionUntil");
    if (set?.kind !== "set") throw new Error("SEND_REPORT must set objectionUntil");
    const report = { objectionUntil: set.at };
    expect(objection(set.at, report)).toMatchObject(OK);
    expect(deemed(set.at, report).ok).toBe(false);
    expect(objection(new Date(set.at.getTime() + 1), report).ok).toBe(false);
    expect(deemed(new Date(set.at.getTime() + 1), report)).toMatchObject(OK);
  });
});
