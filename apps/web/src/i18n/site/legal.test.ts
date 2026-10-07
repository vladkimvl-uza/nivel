import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCS,
  type LegalRow,
  legalKindOf,
  parseInline,
  parseMarkdown,
  pickLegalDocument,
  safeHref,
} from "./legal.ts";

const row = (o: Partial<LegalRow> = {}): LegalRow => ({
  kind: "offer",
  version: "1",
  lang: "uz",
  bodyMd: "# Oferta",
  status: "published",
  textSha256: "a".repeat(64),
  effectiveFrom: "2026-10-01",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...o,
});

describe("the legal pages", () => {
  it("has the six documents of R0 with neutral Latin paths", () => {
    expect(LEGAL_DOCS.map((d) => d.slug)).toEqual([
      "offer",
      "privacy",
      "warranty",
      "returns",
      "consent-pd",
      "stage-tariff",
    ]);
  });

  it("maps a path to the kind of the document in the database", () => {
    expect(legalKindOf("offer")).toBe("offer");
    expect(legalKindOf("consent-pd")).toBe("consent_pd");
    expect(legalKindOf("stage-tariff")).toBe("stage_tariff");
    expect(legalKindOf("requisites")).toBeNull();
    expect(legalKindOf("../etc/passwd")).toBeNull();
    expect(legalKindOf("")).toBeNull();
  });
});

describe("pickLegalDocument", () => {
  const today = "2026-10-07";

  it("takes the newest published version in the language and the kind", () => {
    const rows = [
      row({ version: "1", effectiveFrom: "2026-09-01" }),
      row({ version: "2", effectiveFrom: "2026-10-01" }),
      row({ version: "9", lang: "ru", effectiveFrom: "2026-10-05" }),
      row({ version: "7", kind: "privacy" }),
    ];
    expect(pickLegalDocument(rows, "offer", "uz", today)?.version).toBe("2");
    expect(pickLegalDocument(rows, "offer", "ru", today)?.version).toBe("9");
  });

  it("does not show a published version before its date", () => {
    const rows = [
      row({ version: "1", effectiveFrom: "2026-09-01" }),
      row({ version: "2", effectiveFrom: "2026-11-01" }),
    ];
    expect(pickLegalDocument(rows, "offer", "uz", today)?.version).toBe("1");
  });

  it("prefers a published document to a newer stub", () => {
    const rows = [
      row({ version: "1", status: "published" }),
      row({ version: "2", status: "stub", effectiveFrom: null, createdAt: new Date("2026-10-06T00:00:00Z") }),
    ];
    expect(pickLegalDocument(rows, "offer", "uz", today)?.version).toBe("1");
  });

  it("falls back to the newest stub (then it is a draft) when nothing is published", () => {
    const rows = [
      row({ version: "1", status: "stub", effectiveFrom: null, createdAt: new Date("2026-10-01T00:00:00Z") }),
      row({
        version: "2",
        status: "lawyer_approved",
        effectiveFrom: null,
        createdAt: new Date("2026-10-03T00:00:00Z"),
      }),
    ];
    expect(pickLegalDocument(rows, "offer", "uz", today)?.version).toBe("2");
  });

  it("is null when there is nothing in the language (the page then shows the text built into the site)", () => {
    expect(pickLegalDocument([], "offer", "uz", today)).toBeNull();
    expect(pickLegalDocument([row({ lang: "ru" })], "offer", "uz", today)).toBeNull();
    expect(pickLegalDocument([row({ kind: "privacy" })], "offer", "uz", today)).toBeNull();
  });
});

describe("safeHref", () => {
  it.each([
    ["https://t.me/niveluzbot", "https://t.me/niveluzbot"],
    ["http://example.com/a?b=1", "http://example.com/a?b=1"],
    ["mailto:hello@nivel.uz", "mailto:hello@nivel.uz"],
    ["tel:+998901234567", "tel:+998901234567"],
    ["/uz/legal/offer", "/uz/legal/offer"],
    ["#ceny", "#ceny"],
  ])("lets %j through", (href, expected) => {
    expect(safeHref(href)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>",
    "vbscript:x",
    "//evil.example/x",
    "ftp://x",
    "",
    "java\nscript:alert(1)",
  ])("refuses %j", (href) => {
    expect(safeHref(href)).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads strong, emphasis, code and links", () => {
    expect(parseInline("a **b** c *d* `e` [f](https://t.me/x)")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", text: "b" },
      { type: "text", text: " c " },
      { type: "em", text: "d" },
      { type: "text", text: " " },
      { type: "code", text: "e" },
      { type: "text", text: " " },
      { type: "link", text: "f", href: "https://t.me/x" },
    ]);
  });

  it("keeps the text of a link with an unsafe address and drops the address", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ type: "text", text: "x" }]);
  });

  it("leaves raw html as text: there is no raw html in the documents", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ type: "text", text: "<script>alert(1)</script>" }]);
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([
      { type: "text", text: '<img src=x onerror="alert(1)">' },
    ]);
  });

  it("does not choke on stars and brackets that open nothing", () => {
    expect(parseInline("2 * 3 = 6, [не ссылка], **не закрыто")).toEqual([
      { type: "text", text: "2 * 3 = 6, [не ссылка], **не закрыто" },
    ]);
    expect(parseInline("")).toEqual([]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs and lists", () => {
    const md = [
      "# Политика",
      "",
      "Первая строка",
      "вторая строка.",
      "",
      "## Что собираем",
      "",
      "- имя",
      "- телефон",
      "",
      "1. раз",
      "2. два",
      "",
      "### Малый",
    ].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { type: "heading", level: 1, inline: [{ type: "text", text: "Политика" }] },
      { type: "paragraph", inline: [{ type: "text", text: "Первая строка вторая строка." }] },
      { type: "heading", level: 2, inline: [{ type: "text", text: "Что собираем" }] },
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "имя" }], [{ type: "text", text: "телефон" }]],
      },
      { type: "list", ordered: true, items: [[{ type: "text", text: "раз" }], [{ type: "text", text: "два" }]] },
      { type: "heading", level: 3, inline: [{ type: "text", text: "Малый" }] },
    ]);
  });

  it("reads Windows line ends", () => {
    expect(parseMarkdown("# A\r\n\r\ntext\r\n")).toHaveLength(2);
  });

  it("does not make a heading deeper than four", () => {
    expect(parseMarkdown("##### x")).toEqual([{ type: "paragraph", inline: [{ type: "text", text: "##### x" }] }]);
  });

  it("is empty for an empty text", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });

  it("takes a star bullet as well as a dash", () => {
    expect(parseMarkdown("* a\n* b")).toEqual([
      { type: "list", ordered: false, items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]] },
    ]);
  });
});
