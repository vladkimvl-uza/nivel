import { Document, Page, Text, View } from "@react-pdf/renderer";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { toPdfBuffer } from "./render.ts";
import { flat, parsePdf, pdfText } from "./testkit.ts";

async function render(...children: ReturnType<typeof h>[]): Promise<Buffer> {
  return toPdfBuffer(
    h(Document, { title: "T", author: "A" }, h(Page, { size: "A4", style: { fontFamily: "Fira Sans" } }, ...children)),
  );
}

describe("the PDF reader of the tests", () => {
  it("refuses what is not a PDF", () => {
    expect(() => parsePdf(Buffer.from("hello"))).toThrow("not a PDF");
  });

  it("joins the runs of one line that the renderer cut where the script changes", async () => {
    const pdf = await render(h(Text, null, "Видеокарта RTX 5070 12 ГБ · NAMUNA / ОБРАЗЕЦ"));
    expect(parsePdf(pdf).pages[0]).toEqual(["Видеокарта RTX 5070 12 ГБ · NAMUNA / ОБРАЗЕЦ"]);
  });

  it("keeps the reading order: lines from the top, the cells of a row from the left, a gap between cells", async () => {
    const pdf = await render(
      h(Text, null, "first"),
      h(View, { style: { flexDirection: "row" } }, h(Text, { style: { width: 200 } }, "left"), h(Text, null, "right")),
      h(Text, null, "last"),
    );
    expect(parsePdf(pdf).pages[0]).toEqual(["first", "left right", "last"]);
  });

  it("puts each page apart and reads the properties of the document", async () => {
    const pdf = await render(h(Text, null, "one"), h(View, { break: true }, h(Text, null, "two")));
    const parsed = parsePdf(pdf);
    expect(parsed.pages).toEqual([["one"], ["two"]]);
    expect(pdfText(pdf)).toBe("one\ntwo");
    expect(parsed.info).toMatchObject({ Title: "T", Author: "A" });
  });

  it("reads a turned text (a stamp, a watermark) as one line after the rest of the page", async () => {
    const pdf = await render(
      h(Text, null, "upright"),
      h(Text, { style: { transform: "rotate(-20deg)" } }, "Turned А"),
      h(Text, { style: { transform: "rotate(-20deg)" } }, "second"),
    );
    expect(parsePdf(pdf).pages[0]?.[0]).toBe("upright");
    expect(parsePdf(pdf).pages[0]?.at(-1)).toContain("Turned");
  });

  it("flattens white space, the non-breaking space too", () => {
    expect(flat("12 500 000\n soʻm")).toBe("12 500 000 soʻm");
  });

  it("names a missing glyph U+0000 and tells the subsets from whole fonts", async () => {
    const parsed = parsePdf(await render(h(Text, null, "abc")));
    expect(parsed.fonts.length).toBeGreaterThan(0);
    expect(parsed.fonts.every((f) => f.subset && f.name.startsWith("FiraSans"))).toBe(true);
    expect([...(parsed.fonts[0]?.codePoints ?? [])]).toContain(0);
  });
});
