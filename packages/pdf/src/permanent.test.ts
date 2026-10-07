import { describe, expect, it } from "vitest";
import { renderAct } from "./act.ts";
import { DocumentDataError, DocumentNumberError, whole } from "./guards.ts";
import { isPermanentPdfError } from "./index.ts";
import { PdfTooLargeError } from "./render.ts";
import { CardNumberError } from "./requisites.ts";
import { actFixture } from "./test-support/fixtures.ts";

describe("which failures of the package no second try can mend", () => {
  it("knows the data that do not add up, a card number, a paper that is too heavy and a number that is not whole", () => {
    expect(isPermanentPdfError(new DocumentDataError("x"))).toBe(true);
    expect(isPermanentPdfError(new CardNumberError("notes"))).toBe(true);
    expect(isPermanentPdfError(new PdfTooLargeError(400_000, 300_000))).toBe(true);
    expect(isPermanentPdfError(new DocumentNumberError("qty is 1.5"))).toBe(true);
  });

  it("does not take for permanent what is not the fault of the data: any other error, a RangeError of the engine, a thrown string", () => {
    expect(isPermanentPdfError(new Error("out of memory"))).toBe(false);
    expect(isPermanentPdfError(new RangeError("Offset is outside the bounds of the DataView"))).toBe(false);
    expect(isPermanentPdfError("DocumentDataError")).toBe(false);
    expect(isPermanentPdfError(null)).toBe(false);
    // the name alone is not enough: a renamed look-alike is not the class of the package
    const lookAlike = Object.assign(new Error("x"), { name: "DocumentDataError" });
    expect(isPermanentPdfError(lookAlike)).toBe(false);
  });

  it("is what the guards raise for a number that is not a whole one, and still a RangeError for whoever expects that", () => {
    expect(() => whole("qty", 1.5)).toThrow(DocumentNumberError);
    expect(() => whole("qty", 1.5)).toThrow(RangeError);
  });

  it("is what a document with a fraction in it is refused with", async () => {
    const doc = actFixture({ lines: [{ title: "x", qty: 1.5 }] });
    const error = await renderAct("handover", doc, { lang: "uz", stub: false }).catch((e: unknown) => e);
    expect(isPermanentPdfError(error)).toBe(true);
  });
});
