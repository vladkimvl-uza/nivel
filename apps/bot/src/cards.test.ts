import { orderTransitionTable } from "@nivel/domain/order";
import { orderCallback } from "@nivel/telegram";
import { describe, expect, it } from "vitest";
import { BUTTON_EVENTS, eventsFor, isButtonEvent } from "./cards.ts";

describe("the events a button may send", () => {
  it("are events of the automaton that need nothing but the press", () => {
    const known = new Set(orderTransitionTable().map((r) => r.event));
    for (const e of BUTTON_EVENTS) expect(known.has(e), e).toBe(true);
    for (const needsMore of [
      "SEND_ESTIMATE",
      "ACCEPT",
      "FEE_PREPAID",
      "FUNDS_RECEIVED",
      "HANDOVER",
      "CANCEL",
      "SEND_REPORT",
    ]) {
      expect(isButtonEvent(needsMore)).toBe(false);
    }
    expect(isButtonEvent("constructor")).toBe(false);
    expect(isButtonEvent(undefined)).toBe(false);
  });

  it("the owner has the buttons of his statuses, in the order of the road", () => {
    expect(eventsFor("estimate_sent", "owner")).toEqual(["REVISE"]);
    expect(eventsFor("estimate_expired", "owner")).toEqual(["REVISE"]);
    expect(eventsFor("accepted", "owner")).toEqual(["MEETING_DONE", "START_PURCHASE"]);
    expect(eventsFor("purchasing", "owner")).toEqual(["PURCHASE_DONE"]);
    expect(eventsFor("assembling", "owner")).toEqual(["ASSEMBLED"]);
    expect(eventsFor("ready", "owner")).toEqual(["DISPATCH"]);
  });

  it("the assistant has none of the money ones (START_PURCHASE, DISPATCH, PURCHASE_DONE are the owner's)", () => {
    expect(eventsFor("accepted", "assistant")).toEqual([]);
    expect(eventsFor("purchasing", "assistant")).toEqual([]);
    expect(eventsFor("ready", "assistant")).toEqual([]);
    expect(eventsFor("assembling", "assistant")).toEqual(["ASSEMBLED"]);
  });

  it("a status that has no event of the kind has no button", () => {
    expect(eventsFor("closed", "owner")).toEqual([]);
    expect(eventsFor("cancelled", "owner")).toEqual([]);
    expect(eventsFor("delivering", "owner")).toEqual([]);
  });

  it("every button fits callback_data even with an order number of eight digits", () => {
    for (const e of BUTTON_EVENTS) {
      expect(Buffer.byteLength(orderCallback("NV-2026-99999999", "ev", e), "utf8")).toBeLessThanOrEqual(64);
    }
  });
});
