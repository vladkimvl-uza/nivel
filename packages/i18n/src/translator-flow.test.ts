import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { normalizeUz } from "@nivel/domain/text";
import { describe, expect, it } from "vitest";
import { botFixture, makeRoot, readJson, readText, siteFixture } from "./flow-fixtures.ts";
import { parseGlossary } from "./glossary.ts";
import {
  buildExportSheets,
  exportTranslations,
  importTranslations,
  readCatalog,
  TRANSLATION_COLUMNS,
  TRANSLATIONS_SHEET,
} from "./translator-flow.ts";
import { readXlsx, writeXlsx, type XlsxCell, type XlsxSheet } from "./xlsx.ts";

const O = "ʻ";
const T = "ʼ";
const glossary = parseGlossary(
  JSON.parse(readFileSync(new URL("../../db/seed/glossary/glossary.json", import.meta.url), "utf8")),
);

function newRoot() {
  return makeRoot({ site: siteFixture, bot: botFixture });
}

/** Rows of the Translations sheet as objects, plus helpers to edit the exported workbook. */
function open(xlsx: Buffer) {
  const sheets = readXlsx(xlsx);
  const sheet = sheets.find((s) => s.name === TRANSLATIONS_SHEET) as XlsxSheet;
  const header = sheet.rows[0] as string[];
  const col = (name: string) => header.indexOf(name);
  const rowOf = (ns: string, key: string) =>
    sheet.rows.findIndex((r, i) => i > 0 && r[col("namespace")] === ns && r[col("key")] === key);
  const set = (ns: string, key: string, column: string, value: XlsxCell) => {
    const i = rowOf(ns, key);
    if (i < 0) throw new Error(`no row ${ns}:${key}`);
    (sheet.rows[i] as XlsxCell[])[col(column)] = value;
  };
  const save = () => writeXlsx(sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map((c) => c)) })));
  return { sheets, sheet, col, rowOf, set, save };
}

describe("readCatalog", () => {
  it("reads every namespace found under uz, ru and meta", () => {
    const catalog = readCatalog(newRoot());
    expect(Object.keys(catalog).sort()).toEqual(["bot", "site"]);
    expect(catalog.site?.uz).toEqual(siteFixture.uz);
    expect(catalog.bot?.meta).toEqual(botFixture.meta);
  });

  it("limits to the requested namespaces and rejects unknown ones", () => {
    expect(Object.keys(readCatalog(newRoot(), ["bot"]))).toEqual(["bot"]);
    expect(() => readCatalog(newRoot(), ["nope"])).toThrow(/Unknown namespace "nope"/);
  });

  it("treats a missing uz, ru or meta file as an empty tree", () => {
    const root = newRoot();
    const dir = join(root, "packages", "i18n", "messages");
    rmSync(join(dir, "uz", "bot.json"));
    rmSync(join(dir, "meta", "bot.json"));
    const catalog = readCatalog(root);
    expect(catalog.bot).toEqual({ uz: {}, ru: botFixture.ru, meta: {} });
  });

  it("returns an empty catalog when the messages folder does not exist", () => {
    expect(readCatalog(makeRoot({}))).toEqual({});
  });
});

describe("export", () => {
  const catalog = readCatalog(newRoot());

  it("builds Translations, a translator guide and the glossary, in this order", () => {
    const sheets = buildExportSheets(catalog, glossary);
    expect(sheets.map((s) => s.name)).toEqual([TRANSLATIONS_SHEET, "Памятка", "Glossary"]);
  });

  it("explains in the guide that a number may be written as {count} ta for a Russian plural, and which types stay strict", () => {
    const guide =
      buildExportSheets(catalog, glossary)[1]
        ?.rows.map((r) => String(r[0]))
        .join(" ") ?? "";
    expect(guide).toContain("{count} ta");
    expect(guide).toContain("{count, number}");
    expect(guide).toContain("selectordinal");
    expect(guide).not.toContain("импорт считает разными");
    expect(guide).toMatch(/date.*time.*select|дата.*время.*select/s);
  });

  it("writes the header and one row per key: namespace, key, context, limit, ru, uz, status, screenshot", () => {
    const sheet = buildExportSheets(catalog, glossary)[0];
    expect(sheet?.rows[0]).toEqual([...TRANSLATION_COLUMNS]);
    expect(TRANSLATION_COLUMNS).toEqual(["namespace", "key", "context", "maxLen", "ru", "uz", "status", "screenshot"]);
    expect(sheet?.rows).toHaveLength(1 + 3 + 1);
    expect(sheet?.rows[1]).toEqual(["bot", "start", "Button /start", 10, "Начать", "Boshlash", "draft", null]);
    expect(sheet?.rows).toContainEqual([
      "site",
      "hero.count",
      "Number of items",
      60,
      (siteFixture.ru as { hero: { count: string } }).hero.count,
      (siteFixture.uz as { hero: { count: string } }).hero.count,
      "reviewed",
      "shots/site-hero.png",
    ]);
  });

  it("orders namespaces alphabetically and keys as in the ru file", () => {
    const keys = buildExportSheets(catalog, glossary)[0]
      ?.rows.slice(1)
      .map((r) => `${r[0]}:${r[1]}`);
    expect(keys).toEqual(["bot:start", "site:hero.title", "site:hero.count", "site:hello"]);
  });

  it("exports an empty uz cell for a key that exists only in ru, and no limit for a key without meta", () => {
    const c = readCatalog(makeRoot({ x: { uz: {}, ru: { a: "A" }, meta: {} } }));
    expect(buildExportSheets(c, glossary)[0]?.rows[1]).toEqual(["x", "a", "", null, "A", "", "draft", null]);
  });

  it("puts all 116 glossary terms on the Glossary sheet", () => {
    const sheet = buildExportSheets(catalog, glossary)[2];
    expect(sheet?.rows).toHaveLength(1 + 116);
    expect(sheet?.rows[0]).toEqual(["no", "ru", "uz", "note"]);
    expect(sheet?.rows[9]).toEqual([
      9,
      "оперативная память",
      "operativ xotira",
      expect.stringContaining("tezkor xotira"),
    ]);
  });

  it("marks the uz column as the only editable one", () => {
    const sheet = buildExportSheets(catalog, glossary)[0];
    expect(sheet?.editableColumns).toEqual([TRANSLATION_COLUMNS.indexOf("uz"), TRANSLATION_COLUMNS.indexOf("status")]);
    expect(sheet?.freezeHeader).toBe(true);
  });

  it("the guide sheet explains the rules in Russian", () => {
    const guide = buildExportSheets(catalog, glossary)[1];
    const flat = guide?.rows.map((r) => r.join(" ")).join("\n") ?? "";
    expect(flat).toContain("uz");
    expect(flat).toContain("U+02BB");
    expect(flat).toContain("U+02BC");
    expect(flat).toContain("maxLen");
    expect(flat).toMatch(/[А-Яа-я]/);
  });

  it("exports to a valid workbook and is deterministic", () => {
    const root = newRoot();
    const a = exportTranslations(root);
    const b = exportTranslations(root);
    expect(a.equals(b)).toBe(true);
    expect(readXlsx(a).map((s) => s.name)).toEqual([TRANSLATIONS_SHEET, "Памятка", "Glossary"]);
  });

  it("can be limited to some namespaces", () => {
    const rows = open(exportTranslations(newRoot(), { namespaces: ["bot"] })).sheet.rows;
    expect(rows.slice(1).map((r) => r[0])).toEqual(["bot"]);
  });

  it("works without the glossary seed (no Glossary sheet)", () => {
    const root = makeRoot({ bot: botFixture }, { glossary: false });
    expect(readXlsx(exportTranslations(root)).map((s) => s.name)).toEqual([TRANSLATIONS_SHEET, "Памятка"]);
  });
});

describe("round trip without losses (acceptance: export and import back)", () => {
  it("export → import changes nothing and rewrites no files", () => {
    const root = newRoot();
    const before = { site: readText(root, "uz", "site"), bot: readText(root, "uz", "bot") };
    const report = importTranslations(root, exportTranslations(root));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.changes).toEqual([]);
    expect(report.unchanged).toBe(4);
    expect(report.written).toEqual([]);
    expect(readText(root, "uz", "site")).toBe(before.site);
    expect(readText(root, "uz", "bot")).toBe(before.bot);
  });

  it("survives a re-save of the workbook (read and written again by this module, not by a real spreadsheet program)", () => {
    const root = newRoot();
    const resaved = open(exportTranslations(root)).save();
    expect(importTranslations(root, resaved).changes).toEqual([]);
  });

  it("is lossless for hostile text in both languages", () => {
    const tricky = {
      uz: { a: `Oʻzbek "quotes" <b>tag</b> & {name}\nikkinchi qator`, b: "  bo'sh joy  ".replace("'", T) },
      ru: { a: `Русский "кавычки" <b>тег</b> & {name}\nвторая строка`, b: "  пробелы  " },
      meta: {
        a: { context: "Text with <>&\"' and newline\nsecond line", maxLen: 200, status: "draft" },
        b: { context: "Spaces", maxLen: 50, status: "draft" },
      },
    };
    const root = makeRoot({ tricky });
    const report = importTranslations(root, exportTranslations(root));
    expect(report.errors).toEqual([]);
    expect(report.changes).toEqual([]);
    expect(readJson(root, "uz", "tricky")).toEqual(tricky.uz);
  });

  it("export → edit uz → import → export shows the edited text and nothing else changed", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", "Assalom, {name}!");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.changes).toEqual([
      expect.objectContaining({ namespace: "site", key: "hello", uzChanged: true, statusChanged: false }),
    ]);
    expect(report.written).toEqual(["packages/i18n/messages/uz/site.json"]);
    const uz = readJson(root, "uz", "site") as { hello: string; hero: unknown };
    expect(uz.hello).toBe("Assalom, {name}!");
    expect(uz.hero).toEqual((siteFixture.uz as { hero: unknown }).hero);
    const again = open(exportTranslations(root));
    expect(again.sheet.rows[again.rowOf("site", "hello")]?.[again.col("uz")]).toBe("Assalom, {name}!");
    expect(importTranslations(root, again.save()).changes).toEqual([]);
  });

  it("keeps the key order, 2-space indentation and the final newline of the file", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hero.title", "uz", "Kompyuter va ish joyi");
    importTranslations(root, wb.save());
    const text = readText(root, "uz", "site");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "hero": {\n    "title": "Kompyuter va ish joyi",\n    "count"');
    expect(Object.keys(readJson(root, "uz", "site") as Record<string, unknown>)).toEqual(["hero", "hello"]);
  });
});

describe("import: what a translator may change", () => {
  it("applies the status column to meta (draft → reviewed) without touching context or limit", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "status", "reviewed");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.changes).toEqual([
      expect.objectContaining({ key: "hello", uzChanged: false, statusChanged: true, statusAfter: "reviewed" }),
    ]);
    const meta = readJson(root, "meta", "site") as Record<string, { status: string; context: string; maxLen: number }>;
    expect(meta.hello).toMatchObject({
      status: "reviewed",
      context: "Greeting, name is the customer's first name",
      maxLen: 20,
    });
    expect(report.written).toEqual(["packages/i18n/messages/meta/site.json"]);
  });

  it("adds a translation for a key that has Russian but no Uzbek yet", () => {
    const root = makeRoot({
      x: {
        uz: { a: "A" },
        ru: { a: "А", b: { c: "Б" } },
        meta: {
          a: { context: "c", maxLen: 20, status: "draft" },
          "b.c": { context: "c", maxLen: 20, status: "draft" },
        },
      },
    });
    const wb = open(exportTranslations(root));
    wb.set("x", "b.c", "uz", "Be");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(readJson(root, "uz", "x")).toEqual({ a: "A", b: { c: "Be" } });
  });

  it("accepts a partial file and counts the rows it does not contain", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.sheet.rows.splice(wb.rowOf("site", "hello"), 1);
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.missing).toBe(1);
    expect(report.unchanged).toBe(3);
  });

  it("converts Windows line breaks from the spreadsheet to \\n and keeps the change minimal", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", "Salom,\r\n{name}!");
    importTranslations(root, wb.save());
    expect((readJson(root, "uz", "site") as { hello: string }).hello).toBe("Salom,\n{name}!");
  });

  it("trims surrounding spaces the translator added and says so", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", "  Yangi, {name}!  ");
    const report = importTranslations(root, wb.save());
    expect(report.warnings).toEqual(["row 5: site:hello uz had leading or trailing spaces; trimmed"]);
    expect((readJson(root, "uz", "site") as { hello: string }).hello).toBe("Yangi, {name}!");
  });

  it("ignores edits to read-only columns and warns about each", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("bot", "start", "ru", "Другое");
    wb.set("bot", "start", "context", "My context");
    wb.set("bot", "start", "maxLen", 99);
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([
      "row 2: bot:start ru differs from the repository; the ru column is read-only and was ignored",
      "row 2: bot:start context differs from the repository; the context column is read-only and was ignored",
      "row 2: bot:start maxLen differs from the repository; the maxLen column is read-only and was ignored",
    ]);
    expect(report.changes).toEqual([]);
    expect(readJson(root, "ru", "bot")).toEqual(botFixture.ru);
    expect(readJson(root, "meta", "bot")).toEqual(botFixture.meta);
  });

  it("warns about Cyrillic letters in the Uzbek text", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("bot", "start", "uz", "Начать");
    const report = importTranslations(root, wb.save());
    expect(report.warnings).toContain("row 2: bot:start uz contains Cyrillic letters");
    expect(report.ok).toBe(true);
  });
});

describe("import: checks (keys, placeholders, limit, apostrophes, glossary)", () => {
  function run(mutate: (wb: ReturnType<typeof open>) => void, opts: Parameters<typeof importTranslations>[2] = {}) {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    mutate(wb);
    const uzBefore = readText(root, "uz", "site");
    const report = importTranslations(root, wb.save(), opts);
    return { report, root, uzBefore };
  }

  it.each(["constructor.name", "__proto__.constructor.name", "toString.name", "hasOwnProperty", "__proto__"])(
    "treats the inherited property %s as a key that does not exist",
    (key) => {
      const { report, root, uzBefore } = run((wb) => {
        wb.sheet.rows.push(["site", key, "", 10, "x", "Changed", "draft", null]);
      });
      expect(report.ok).toBe(false);
      expect(report.errors).toEqual([
        `row 6: key "${key}" does not exist in namespace "site" (new keys are added in code, not in the file)`,
      ]);
      expect(readText(root, "uz", "site")).toBe(uzBefore);
    },
  );

  it.each(["constructor", "__proto__", "toString"])(
    "treats the inherited property %s as an unknown namespace",
    (ns) => {
      const { report } = run((wb) => {
        wb.sheet.rows.push([ns, "a", "", 10, "x", "y", "draft", null]);
      });
      expect(report.errors).toEqual([`row 6: unknown namespace "${ns}"`]);
    },
  );

  it("does not echo control characters of a cell into the messages (terminal escape sequences)", () => {
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const { report } = run((wb) => {
      wb.sheet.rows.push(["site", `hero.nope${esc}[2J${esc}]0;owned${bel}`, "", 10, "x", "y", "draft", null]);
      wb.sheet.rows.push(["site", "hello", "", 10, "x", "Salom, {name}!", `bad${esc}[31mstatus`, null]);
    });
    expect(report.errors.length).toBeGreaterThanOrEqual(2);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the point of this check is that none are left
    for (const line of [...report.errors, ...report.warnings]) expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(report.errors.join("\n")).toContain("hero.nope");
  });

  it("keeps messages short when a cell holds thousands of characters", () => {
    const { report } = run((wb) => {
      wb.sheet.rows.push(["site", "k".repeat(20_000), "", 10, "x", "y", "draft", null]);
    });
    expect(report.errors).toHaveLength(1);
    expect((report.errors[0] as string).length).toBeLessThan(600);
  });

  it("rejects a key that does not exist and an unknown namespace", () => {
    const { report } = run((wb) => {
      wb.sheet.rows.push(["site", "hero.nope", "", 10, "x", "y", "draft", null]);
      wb.sheet.rows.push(["zzz", "a", "", 10, "x", "y", "draft", null]);
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain(
      'row 6: key "hero.nope" does not exist in namespace "site" (new keys are added in code, not in the file)',
    );
    expect(report.errors).toContain('row 7: unknown namespace "zzz"');
  });

  it("rejects duplicate rows for one key", () => {
    const { report } = run((wb) => {
      wb.sheet.rows.push([...(wb.sheet.rows[wb.rowOf("site", "hello")] as XlsxCell[])]);
    });
    expect(report.errors).toEqual(["row 6: duplicate row for site:hello (first seen in row 5)"]);
  });

  it("rejects an emptied or non-text uz cell", () => {
    const { report } = run((wb) => {
      wb.set("site", "hello", "uz", "");
      wb.set("bot", "start", "uz", 42);
    });
    expect(report.errors).toContain("row 5: site:hello uz is empty");
    expect(report.errors).toContain("row 2: bot:start uz must be text");
  });

  it("rejects ICU placeholders that differ from the Russian source", () => {
    const { report } = run((wb) => wb.set("site", "hello", "uz", "Salom, {ism}!"));
    expect(report.errors).toEqual([
      "row 5: site:hello placeholders differ from ru: ru {name:argument}, uz {ism:argument}",
    ]);
  });

  it("shows the types when only the type of a placeholder differs", () => {
    const { report } = run((wb) => wb.set("site", "hello", "uz", "Hi {name, date}"));
    expect(report.errors).toEqual([
      "row 5: site:hello placeholders differ from ru: ru {name:argument}, uz {name:date}",
    ]);
  });

  it("accepts a plain number for a Russian plural: {count} ta ... is the natural Uzbek", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hero.count", "uz", "{count} ta mahsulot");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.changes.map((c) => `${c.namespace}:${c.key}`)).toEqual(["site:hero.count"]);
    expect((readJson(root, "uz", "site") as { hero: { count: string } }).hero.count).toBe("{count} ta mahsulot");
  });

  it("accepts {count, number} and selectordinal for a Russian plural, and rejects a renamed or date-typed one", () => {
    for (const ok of ["{count, number} ta mahsulot", "{count, selectordinal, other {#-chi}}"]) {
      const { report } = run((wb) => wb.set("site", "hero.count", "uz", ok));
      expect(report.errors, ok).toEqual([]);
    }
    const renamed = run((wb) => wb.set("site", "hero.count", "uz", "{soni} ta mahsulot"));
    expect(renamed.report.errors).toEqual([
      "row 4: site:hero.count placeholders differ from ru: ru {count:plural}, uz {soni:argument}",
    ]);
    const date = run((wb) => wb.set("site", "hero.count", "uz", "{count, date} ta"));
    expect(date.report.errors).toEqual([
      "row 4: site:hero.count placeholders differ from ru: ru {count:plural}, uz {count:date}",
    ]);
  });

  it("rejects a placeholder that was dropped", () => {
    const { report } = run((wb) => wb.set("site", "hello", "uz", "Salom!"));
    expect(report.errors).toEqual(["row 5: site:hello placeholders differ from ru: ru {name:argument}, uz {}"]);
  });

  it("rejects text longer than the limit from meta and accepts text exactly at it", () => {
    const tooLong = run((wb) => wb.set("bot", "start", "uz", "Boshlaymiz!!"));
    expect(tooLong.report.errors).toEqual(["row 2: bot:start uz is 12 > maxLen 10"]);
    const exact = run((wb) => wb.set("bot", "start", "uz", "Boshlaymiz"));
    expect(exact.report.errors).toEqual([]);
    expect(exact.report.changes).toHaveLength(1);
  });

  it("rejects ASCII and typographic apostrophes inside Uzbek words, with the fix", () => {
    const { report } = run((wb) => wb.set("site", "hello", "uz", "o'zbek {name}!"));
    expect(report.errors).toEqual([`row 5: site:hello: "o'zbek" has U+0027 inside a word; use "o${O}zbek"`]);
    const t = run((wb) => wb.set("site", "hello", "uz", "Ma’lumot {name}"));
    expect(t.report.errors).toEqual([`row 5: site:hello: "Ma’lumot" has U+2019 inside a word; use "Ma${T}lumot"`]);
  });

  it("rejects dollars and broken ICU", () => {
    const usd = run((wb) => wb.set("site", "hello", "uz", "Narx 10 USD {name}"));
    expect(usd.report.errors).toEqual(["row 5: site:hello uz mentions dollars; prices are in sums only"]);
    const icu = run((wb) => wb.set("site", "hello", "uz", "Salom {name"));
    expect(icu.report.errors.join("\n")).toContain("row 5: site:hello uz is not valid ICU");
  });

  it("rejects a status other than draft or reviewed", () => {
    const { report } = run((wb) => wb.set("site", "hello", "status", "final"));
    expect(report.errors).toEqual(['row 5: site:hello status "final" must be draft or reviewed']);
  });

  it("enforces the glossary: a forbidden variant is an error", () => {
    const root = makeRoot({
      pc: {
        uz: { ram: "Operativ xotira" },
        ru: { ram: "Оперативная память" },
        meta: { ram: { context: "c", maxLen: 40, status: "draft" } },
      },
    });
    const wb = open(exportTranslations(root));
    wb.set("pc", "ram", "uz", "Tezkor xotira");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual(['row 2: pc:ram uz uses "tezkor xotira"; glossary term is "operativ xotira"']);
  });

  it("warns when a glossary term from the Russian text is missing in the Uzbek text", () => {
    const root = makeRoot({
      pc: {
        uz: { gpu: "Videokarta" },
        ru: { gpu: "Видеокарта" },
        meta: { gpu: { context: "c", maxLen: 40, status: "draft" } },
      },
    });
    const wb = open(exportTranslations(root));
    wb.set("pc", "gpu", "uz", "Grafik karta");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(['row 2: pc:gpu ru has "видеокарта" but uz lacks "videokarta" (glossary #6)']);
  });

  it("is atomic: one error means no file is written", () => {
    const { report, root, uzBefore } = run((wb) => {
      wb.set("site", "hello", "uz", "Yangi, {name}!");
      wb.set("bot", "start", "uz", "Bu juda uzun matn");
    });
    expect(report.ok).toBe(false);
    expect(report.written).toEqual([]);
    expect(readText(root, "uz", "site")).toBe(uzBefore);
    expect(readJson(root, "uz", "bot")).toEqual(botFixture.uz);
  });

  it("a dry run reports the changes and writes nothing", () => {
    const { report, root, uzBefore } = run((wb) => wb.set("site", "hello", "uz", "Yangi, {name}!"), { dryRun: true });
    expect(report.ok).toBe(true);
    expect(report.changes).toHaveLength(1);
    expect(report.written).toEqual([]);
    expect(readText(root, "uz", "site")).toBe(uzBefore);
  });

  it("validates only the rows that changed (old problems are check-messages' business)", () => {
    const root = makeRoot({
      x: { uz: { a: "Salom {x}" }, ru: { a: "Привет" }, meta: { a: { context: "c", maxLen: 20, status: "draft" } } },
    });
    const report = importTranslations(root, exportTranslations(root));
    expect(report.errors).toEqual([]);
  });
});

describe("import: normalization hook", () => {
  // Stand-in with the contract of ARCHITECTURE 4.12 for the hook tests; the real normalizeUz (WP-02) is used in the last two tests.
  const fake = (s: string) => s.replace(/([oOgG])['‘’`ʼ]/g, `$1${O}`).replace(/(?<=\p{L})['’]/gu, T);

  it("fixes apostrophes in changed rows before the checks and reports it", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", "o'zbek {name}!");
    const report = importTranslations(root, wb.save(), { normalize: fake });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(["row 5: site:hello uz apostrophes normalized"]);
    expect((readJson(root, "uz", "site") as { hello: string }).hello).toBe(`o${O}zbek {name}!`);
  });

  it("does not call the hook for unchanged rows", () => {
    const root = newRoot();
    let calls = 0;
    importTranslations(root, exportTranslations(root), {
      normalize: (s) => {
        calls++;
        return s;
      },
    });
    expect(calls).toBe(0);
  });

  it("runs the real normalizeUz from @nivel/domain (oʻ, gʻ to U+02BB, other apostrophes to U+02BC)", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", "g'oya, ma'no {name}");
    const report = importTranslations(root, wb.save(), { normalize: normalizeUz });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(["row 5: site:hello uz apostrophes normalized"]);
    expect((readJson(root, "uz", "site") as { hello: string }).hello).toBe(`g${O}oya, ma${T}no {name}`);
  });

  it("the real normalizeUz leaves a correct text unchanged: no warning, no change", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", `g${O}oya, ma${T}no {name}`);
    const report = importTranslations(root, wb.save(), { normalize: normalizeUz });
    expect(report.warnings).toEqual([]);
    expect(report.changes).toHaveLength(1);
  });
});

describe("import: broken input files", () => {
  it("rejects data that is not an xlsx", () => {
    const report = importTranslations(newRoot(), Buffer.from("not a workbook"));
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/not a ZIP/);
  });

  it("rejects a workbook without the Translations sheet", () => {
    const report = importTranslations(newRoot(), writeXlsx([{ name: "Other", rows: [["a"]] }]));
    expect(report.errors).toEqual(['sheet "Translations" not found']);
  });

  it("rejects a sheet with a missing column", () => {
    const wb = open(exportTranslations(newRoot()));
    wb.sheet.rows = wb.sheet.rows.map((r) => r.filter((_, i) => i !== wb.col("uz")));
    const report = importTranslations(newRoot(), wb.save());
    expect(report.errors).toEqual(['Translations: missing column "uz"']);
  });

  it("finds columns by header name, so a translator may reorder them", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    const order = [5, 4, 3, 2, 1, 0, 6, 7];
    wb.sheet.rows = wb.sheet.rows.map((r) => order.map((i) => r[i] ?? null));
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.changes).toEqual([]);
  });

  it("skips blank rows and trailing empty rows", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.sheet.rows.splice(2, 0, []);
    wb.sheet.rows.push([null, null, null]);
    expect(importTranslations(root, wb.save()).errors).toEqual([]);
  });

  it("limits the import to some namespaces when asked", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("site", "hello", "uz", "Yangi, {name}!");
    wb.set("bot", "start", "uz", "Boshlash!");
    const report = importTranslations(root, wb.save(), { namespaces: ["bot"] });
    expect(report.changes.map((c) => c.namespace)).toEqual(["bot"]);
    expect(readJson(root, "uz", "site")).toEqual(siteFixture.uz);
  });

  it("writes the new Uzbek text into a real file under the root", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.set("bot", "start", "uz", "Boshlash!");
    importTranslations(root, wb.save());
    expect(readFileSync(join(root, "packages", "i18n", "messages", "uz", "bot.json"), "utf8")).toBe(
      '{\n  "start": "Boshlash!"\n}\n',
    );
  });
});

describe("import: edge rows", () => {
  it("rejects a row that has text but no namespace or key", () => {
    const root = newRoot();
    const wb = open(exportTranslations(root));
    wb.sheet.rows.push(["", "orphan", "", 10, "x", "y", "draft", null]);
    wb.sheet.rows.push(["site", "", "", 10, "x", "y", "draft", null]);
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual(["row 6: namespace and key are required", "row 7: namespace and key are required"]);
  });

  it("ignores a status for a key that has no meta entry and says so", () => {
    const root = makeRoot({ lone: { uz: { a: "Matn" }, ru: { a: "Текст" }, meta: {} } });
    const wb = open(exportTranslations(root));
    wb.set("lone", "a", "status", "reviewed");
    const report = importTranslations(root, wb.save());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(["row 2: lone:a has no meta entry; status ignored"]);
    expect(report.changes).toEqual([]);
  });

  it("reports a text that already sits where a nested key would have to go", () => {
    const root = makeRoot({ clash: { uz: { b: "Matn" }, ru: { b: { c: "Вложенный" } }, meta: {} } });
    const wb = open(exportTranslations(root));
    wb.set("clash", "b.c", "uz", "Ichki");
    const report = importTranslations(root, wb.save());
    expect(report.ok).toBe(false);
    expect(report.errors).toContain("row 2: clash:b.c cannot be placed: a text already sits on its path in uz");
  });
});
