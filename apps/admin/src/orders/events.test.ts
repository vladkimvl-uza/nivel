import { orderTransitionTable } from "@nivel/domain/order";
import { describe, expect, it } from "vitest";
import { ACTIONS, actionsFor, MONEY_EVENTS, STATUS_ORDER } from "./events.ts";

const table = orderTransitionTable();
const types = (status: Parameters<typeof actionsFor>[0], role: Parameters<typeof actionsFor>[1]) =>
  actionsFor(status, role).map((a) => a.type);

describe("the buttons of the card follow the table of the automaton", () => {
  it("offers what the owner may send in the status, and nothing of the customer and the system", () => {
    for (const status of STATUS_ORDER) {
      const allowed = table
        .filter((r) => r.from === status && r.actors.includes("owner"))
        .map((r) => r.event)
        .sort();
      expect(types(status, "owner").sort(), status).toEqual(allowed);
    }
  });

  it("offers the assistant only what the table gives the assistant", () => {
    for (const status of STATUS_ORDER) {
      const allowed = table
        .filter((r) => r.from === status && r.actors.includes("assistant"))
        .map((r) => r.event)
        .sort();
      expect(types(status, "assistant").sort(), status).toEqual(allowed);
    }
  });

  it("gives the assistant no money button in any status", () => {
    for (const status of STATUS_ORDER) {
      for (const type of types(status, "assistant")) expect(MONEY_EVENTS, `${status} ${type}`).not.toContain(type);
    }
  });

  it("gives the accountant and the translator no button at all", () => {
    for (const status of STATUS_ORDER) {
      expect(actionsFor(status, "accountant")).toEqual([]);
      expect(actionsFor(status, "translator")).toEqual([]);
    }
  });

  it("describes every event the owner or the assistant can send, and only those", () => {
    const sendable = new Set(
      table.filter((r) => r.actors.includes("owner") || r.actors.includes("assistant")).map((r) => r.event),
    );
    expect(new Set(Object.keys(ACTIONS))).toEqual(sendable);
  });

  it("every action has a Russian label and says how it is made", () => {
    for (const [type, a] of Object.entries(ACTIONS)) {
      expect(a.label, type).toMatch(/[А-Яа-я]/);
      expect(["button", "form", "elsewhere"]).toContain(a.ui);
    }
  });

  it("sends the estimate, the purchases and the report from their own screens, not from a bare button", () => {
    expect(ACTIONS.SEND_ESTIMATE.ui).toBe("elsewhere");
    expect(ACTIONS.PURCHASE_RECORDED.ui).toBe("elsewhere");
    expect(ACTIONS.SEND_REPORT.ui).toBe("elsewhere");
    expect(ACTIONS.CANCEL.ui).toBe("form");
    expect(ACTIONS.START_PURCHASE.ui).toBe("button");
  });
});
