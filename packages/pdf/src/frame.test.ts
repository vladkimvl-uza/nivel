import { logoSvg } from "@nivel/ui";
import { Text } from "@react-pdf/renderer";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { paperDocument } from "./kit.ts";
import { logoParts } from "./logo.ts";
import { pdfText } from "./messages.ts";
import { PDF_MAX_BYTES, PdfTooLargeError, toPdfBuffer } from "./render.ts";
import { flat, parsePdf } from "./testkit.ts";
import type { PdfLang, RenderOptions } from "./types.ts";

const WATERMARK = "NAMUNA / ОБРАЗЕЦ";

async function sample(
  opts: Partial<RenderOptions> & { lang?: PdfLang } = {},
  lines = 3,
  max = PDF_MAX_BYTES,
): Promise<Buffer> {
  const options: RenderOptions = { lang: "uz", stub: false, ...opts };
  const t = pdfText(options.lang);
  const doc = paperDocument({
    t,
    options,
    title: "Smeta",
    number: "NV-2026-0001",
    meta: [["Sana", "05.10.2026"]],
    children: Array.from({ length: lines }, (_, i) => h(Text, { key: i }, `Qator ${i + 1} — oʻzbekcha gʻoya`)),
  });
  return toPdfBuffer(doc, max);
}

describe("the frame of a document on paper", () => {
  it("makes an A4 PDF with the title, the language and the author in its properties", async () => {
    const pdf = await sample();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const parsed = parsePdf(pdf);
    expect(parsed.info.Title).toContain("NV-2026-0001");
    expect(parsed.info.Author).toBe("Nivel");
    expect(pdf.toString("latin1")).toMatch(/\/Lang \(uz-Latn\)/);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    const ru = await sample({ lang: "ru" });
    expect(ru.toString("latin1")).toMatch(/\/Lang \(ru\)/);
  });

  it("puts the number, the metadata and the line of the footer on the page", async () => {
    const text = flat(parsePdf(await sample()).text);
    expect(text).toContain("NV-2026-0001");
    // Headings of the line under the title are in capitals (the table headings of the design system).
    expect(text.toUpperCase()).toContain("SANA 05.10.2026");
    expect(text).toContain(flat(pdfText("uz")("common.brand")));
    expect(text).toContain("1 / 1");
  });

  it("draws no watermark on a document with published texts and no demo data", async () => {
    const text = parsePdf(await sample()).text;
    expect(text).not.toContain(WATERMARK);
    expect(text).not.toContain(flat(pdfText("uz")("common.notice_stub")));
  });

  it("draws «NAMUNA / ОБРАЗЕЦ» and the notice when the offer is a placeholder (stub)", async () => {
    for (const lang of ["uz", "ru"] as const) {
      const text = parsePdf(await sample({ lang, stub: true })).text;
      expect(text, lang).toContain(WATERMARK);
      expect(flat(text), lang).toContain(flat(pdfText(lang)("common.notice_stub")));
    }
  });

  it("draws the watermark on demo data as well, with its own notice", async () => {
    const text = parsePdf(await sample({ stub: false, demo: true })).text;
    expect(text).toContain(WATERMARK);
    expect(flat(text)).toContain(flat(pdfText("uz")("common.notice_demo")));
    expect(flat(text)).not.toContain(flat(pdfText("uz")("common.notice_stub")));
  });

  it("repeats the watermark, the footer and the page number on every page of a long document", async () => {
    const parsed = parsePdf(await sample({ stub: true }, 120));
    expect(parsed.pages.length).toBeGreaterThanOrEqual(2);
    parsed.pages.forEach((page, i) => {
      const text = flat(page.join("\n"));
      expect(text, `page ${i + 1}`).toContain(WATERMARK);
      expect(text, `page ${i + 1}`).toContain(`${i + 1} / ${parsed.pages.length}`);
      expect(text, `page ${i + 1}`).toContain("NV-2026-0001");
    });
  });

  it("keeps the number of the page when both notices are long (the footer does not squeeze it out)", async () => {
    for (const lang of ["uz", "ru"] as const) {
      const text = flat(parsePdf(await sample({ lang, stub: true, demo: true })).text);
      expect(text, lang).toContain("NV-2026-0001 · 1 / 1");
      expect(text, lang).toContain(flat(pdfText(lang)("common.notice_stub")));
      expect(text, lang).toContain(flat(pdfText(lang)("common.notice_demo")));
    }
  });

  it("is far smaller than the limit: only the glyphs used are embedded", async () => {
    const pdf = await sample({ stub: true }, 40);
    expect(pdf.length).toBeLessThan(80 * 1024);
    expect(parsePdf(pdf).fonts.every((f) => f.subset)).toBe(true);
  });

  it("refuses a document over the limit instead of sending it (300 KB)", async () => {
    expect(PDF_MAX_BYTES).toBe(300 * 1024);
    await expect(sample({}, 3, 1000)).rejects.toThrow(PdfTooLargeError);
    await expect(sample({}, 3, 1000)).rejects.toMatchObject({ limit: 1000 });
  });

  it("carries no raster picture: the mark is vector and the document needs nothing from the network", async () => {
    const raw = (await sample({ stub: true })).toString("latin1");
    expect(raw).not.toMatch(/\/Subtype \/Image/);
  });
});

describe("documents made one after another in one process", () => {
  it("do not damage each other: a document with Cyrillic and Latin letters is followed by one that reads «last», not «ast»", async () => {
    const t = pdfText("ru");
    const body = (text: string) =>
      paperDocument({
        t,
        options: { lang: "ru", stub: false },
        title: "Смета",
        number: "NV-2026-0001",
        children: [h(Text, { key: 1 }, text)],
      });
    await toPdfBuffer(body("Видеокарта RTX 5070 12 ГБ"));
    for (const word of ["last data", "abc last", "Видеокарта RTX 5070 12 ГБ"]) {
      expect(parsePdf(await toPdfBuffer(body(word))).text).toContain(word);
    }
  });

  it("can be rendered at the same moment: the renders take turns", async () => {
    const t = pdfText("uz");
    const make = (text: string) =>
      toPdfBuffer(
        paperDocument({
          t,
          options: { lang: "uz", stub: false },
          title: "Smeta",
          number: "NV-2026-0002",
          children: [h(Text, { key: 1 }, text)],
        }),
      );
    const texts = ["last one", "Видеокарта RTX", "oʻzbekcha gʻoya maʼlumot", "alpha lambda"];
    const out = await Promise.all(texts.map(make));
    out.forEach((pdf, i) => {
      expect(parsePdf(pdf).text).toContain(texts[i] as string);
    });
  });

  it("goes on after a failed render", async () => {
    const t = pdfText("uz");
    const doc = paperDocument({
      t,
      options: { lang: "uz", stub: false },
      title: "Smeta",
      number: "NV-2026-0003",
      children: [],
    });
    await expect(toPdfBuffer(doc, 10)).rejects.toThrow(PdfTooLargeError);
    expect((await toPdfBuffer(doc)).length).toBeGreaterThan(1000);
  });
});

describe("the mark nivel-1 in the header", () => {
  it("is read from the SVG of @nivel/ui, shape by shape, in the colors of the paper", () => {
    const svg = logoSvg({ kind: "lockup", ink: "#1D1D1B", accent: "#D9501A", label: "" });
    const parts = logoParts();
    const paths = [...svg.matchAll(/<path fill="(#[0-9A-Fa-f]{6})" d="([^"]+)"\/>/g)];
    expect(parts.paths).toHaveLength(paths.length);
    expect(parts.paths.map((p) => p.d)).toEqual(paths.map((m) => m[2]));
    expect(parts.paths.map((p) => p.fill)).toEqual(paths.map((m) => m[1]));
    expect(parts.viewBox).toBe(/viewBox="([^"]+)"/.exec(svg)?.[1]);
    expect(new Set(parts.paths.map((p) => p.fill))).toEqual(new Set(["#1D1D1B", "#D9501A"]));
  });

  it("keeps the transforms of the groups of the lockup", () => {
    const parts = logoParts();
    expect(parts.paths.some((p) => p.transforms.length > 0)).toBe(true);
    expect(parts.paths.flatMap((p) => p.transforms).every((tr) => /^(translate|scale)\(/.test(tr))).toBe(true);
  });
});
