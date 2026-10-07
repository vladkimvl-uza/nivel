import { describe, expect, it } from "vitest";
import { advance, STEPS, type Step, type StepEvent } from "./steps.ts";

describe("the dialog automaton (ARCHITECTURE 7.1: steps kept in the session)", () => {
  it("walks the road of the selection to a request", () => {
    let s: Step = "idle";
    const walk = (event: StepEvent, to: Step, ctx?: { scope?: string }) => {
      const next = advance(s, event, ctx);
      expect(next, `${s} --${event}--> ${to}`).toBe(to);
      s = next as Step;
    };
    walk("start_selection", "sel_task");
    walk("task", "sel_band");
    walk("band", "sel_scope");
    walk("scope", "sel_wishes", { scope: "pc" });
    walk("wishes_done", "sel_result");
    walk("pick", "req_contact");
    walk("contact", "req_district");
    walk("district", "req_term");
    walk("term", "idle");
  });

  it("a setup has no templates and goes from the scope straight to the request", () => {
    expect(advance("sel_scope", "scope", { scope: "setup" })).toBe("req_contact");
    expect(advance("sel_scope", "scope", { scope: "pc_periph" })).toBe("sel_wishes");
  });

  it("a request can be left without a build, from the menu or from an empty result", () => {
    expect(advance("idle", "leave_request")).toBe("req_contact");
    expect(advance("sel_result", "leave_request")).toBe("req_contact");
  });

  it("the phone is optional", () => {
    expect(advance("req_contact", "skip_contact")).toBe("req_district");
  });

  it("a question about the report and a report of a problem have their own steps", () => {
    expect(advance("idle", "ask_question")).toBe("report_question");
    expect(advance("report_question", "question")).toBe("idle");
    expect(advance("idle", "warranty_start")).toBe("warranty_pick");
    expect(advance("warranty_pick", "warranty_order")).toBe("warranty_text");
    expect(advance("idle", "warranty_order")).toBe("warranty_text");
    expect(advance("warranty_text", "warranty_done")).toBe("idle");
  });

  it("an old button does nothing: an event that does not belong to the step is refused", () => {
    expect(advance("idle", "task")).toBeNull();
    expect(advance("sel_band", "task")).toBeNull();
    expect(advance("sel_result", "band")).toBeNull();
    expect(advance("req_district", "term")).toBeNull();
    expect(advance("report_question", "district")).toBeNull();
  });

  it("the selection can be restarted from any of its steps, and everything can be cancelled", () => {
    for (const s of ["sel_task", "sel_band", "sel_scope", "sel_wishes", "sel_result"] as const) {
      expect(advance(s, "start_selection")).toBe("sel_task");
    }
    for (const s of STEPS) expect(advance(s, "cancel")).toBe("idle");
  });

  it("a stranger step or event leads nowhere", () => {
    expect(advance("nonsense" as never, "task")).toBeNull();
    expect(advance("idle", "nonsense" as never)).toBeNull();
    expect(advance("idle", "constructor" as never)).toBeNull();
  });
});
