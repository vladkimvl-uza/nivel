import { describe, expect, it } from "vitest";
import { PermanentJobError } from "../../queues/define.ts";
import { PDF_DOCS, parsePdfRequest } from "./payload.ts";

const ORDER = "0199aaaa-bbbb-7ccc-8ddd-000000000001";
const ACT = "0199aaaa-bbbb-7ccc-8ddd-000000000002";

describe("the request of pdf.render", () => {
  it("knows the seven documents of the automaton", () => {
    expect([...PDF_DOCS]).toEqual([
      "quote",
      "commission_report",
      "act_materials",
      "act_customer_parts",
      "act_handover",
      "passport",
      "warranty",
    ]);
  });

  it("takes the order and the document, and ignores the hint about the watermark (the renderer reads the offer)", () => {
    expect(
      parsePdfRequest({
        job: "pdf.render",
        doc: "quote",
        orderId: ORDER,
        orderNumber: "NV-2026-0001",
        watermarkDraft: true,
      }),
    ).toEqual({ doc: "quote", orderId: ORDER, actId: null });
  });

  it("takes the id of the act for an act", () => {
    expect(parsePdfRequest({ doc: "act_handover", orderId: ORDER, actId: ACT })).toEqual({
      doc: "act_handover",
      orderId: ORDER,
      actId: ACT,
    });
  });

  it("does not need the id of the act: the latest act of that kind is taken", () => {
    expect(parsePdfRequest({ doc: "act_materials", orderId: ORDER })).toEqual({
      doc: "act_materials",
      orderId: ORDER,
      actId: null,
    });
  });

  it("refuses for good what no retry can mend: not an object, a missing or unknown document, an id that is not a uuid", () => {
    const bad: unknown[] = [
      null,
      "quote",
      [],
      {},
      { doc: "quote" },
      { doc: "contract", orderId: ORDER },
      { doc: "quote", orderId: "NV-2026-0001" },
      { doc: "quote", orderId: 42 },
      { doc: "act_handover", orderId: ORDER, actId: "x" },
    ];
    for (const data of bad) expect(() => parsePdfRequest(data), JSON.stringify(data)).toThrow(PermanentJobError);
  });

  it("ignores an id of an act on a document that is not an act", () => {
    expect(parsePdfRequest({ doc: "passport", orderId: ORDER, actId: ACT })).toEqual({
      doc: "passport",
      orderId: ORDER,
      actId: null,
    });
  });
});
