import { describe, expect, it } from "vitest";
import { readXlsx, readZip, type SheetData, writeXlsx, writeZip } from "./xlsx.ts";

/** Small deterministic PRNG (mulberry32) for property-style round-trip tests. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const text = (s: string) => Buffer.from(s, "utf8");

describe("writeZip / readZip", () => {
  it("round-trips entries with deflate and keeps names and bytes", () => {
    const zip = writeZip([
      { name: "a.txt", data: text("hello hello hello hello") },
      { name: "dir/b.bin", data: Buffer.from([0, 1, 2, 255]) },
      { name: "empty", data: Buffer.alloc(0) },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["a.txt", "dir/b.bin", "empty"]);
    expect(files.get("a.txt")?.toString("utf8")).toBe("hello hello hello hello");
    expect([...(files.get("dir/b.bin") ?? [])]).toEqual([0, 1, 2, 255]);
    expect(files.get("empty")?.length).toBe(0);
  });

  it("is deterministic: same input, same bytes", () => {
    const entries = [{ name: "x", data: text("abc") }];
    expect(writeZip(entries).equals(writeZip(entries))).toBe(true);
  });

  it("starts with the PK signature", () => {
    expect(
      writeZip([{ name: "x", data: text("abc") }])
        .subarray(0, 2)
        .toString("latin1"),
    ).toBe("PK");
  });

  it("reads stored (uncompressed) entries as written by other tools", () => {
    const zip = buildStoredZip("s.txt", text("stored data"));
    expect(readZip(zip).get("s.txt")?.toString()).toBe("stored data");
  });

  it("round-trips non-ASCII names (UTF-8 flag)", () => {
    const files = readZip(writeZip([{ name: "папка/файл.txt", data: text("x") }]));
    expect(files.has("папка/файл.txt")).toBe(true);
  });

  it("rejects data that is not a ZIP", () => {
    expect(() => readZip(text("this is not a zip file at all"))).toThrow(/not a ZIP/);
    expect(() => readZip(Buffer.alloc(0))).toThrow(/not a ZIP/);
  });

  it("rejects a truncated archive", () => {
    const zip = writeZip([{ name: "a", data: text("x".repeat(500)) }]);
    expect(() => readZip(zip.subarray(0, zip.length - 30))).toThrow();
  });

  it("detects a corrupted entry by CRC", () => {
    const zip = writeZip([{ name: "a", data: text("some content that is stored") }], { compress: false });
    const idx = zip.indexOf("some content");
    zip[idx] = zip[idx] === 0x58 ? 0x59 : 0x58;
    expect(() => readZip(zip)).toThrow(/CRC/);
  });

  it("refuses an entry that inflates beyond the limit (zip bomb)", () => {
    const zip = writeZip([{ name: "big", data: Buffer.alloc(100_000, 0x61) }]);
    expect(() => readZip(zip, { maxEntryBytes: 10_000 })).toThrow(/limit/);
  });

  it("rejects encrypted entries and unknown compression methods", () => {
    const encrypted = buildStoredZip("e.txt", text("x"), { flags: 1 });
    expect(() => readZip(encrypted)).toThrow(/encrypted/);
    const weird = buildStoredZip("e.txt", text("x"), { method: 99 });
    expect(() => readZip(weird)).toThrow(/method 99/);
  });
});

describe("writeXlsx / readXlsx", () => {
  const sheet = (name: string, rows: SheetData["rows"]): SheetData => ({ name, rows });

  it("round-trips strings, numbers, empty strings and gaps", () => {
    const rows = [["key", "ru", 12, ""], [null, "x", null, "y"], [], ["last"]];
    const out = readXlsx(writeXlsx([sheet("Data", rows)]));
    expect(out).toEqual([{ name: "Data", rows: [["key", "ru", 12, ""], [null, "x", null, "y"], [], ["last"]] }]);
  });

  it("keeps several sheets in order", () => {
    const out = readXlsx(writeXlsx([sheet("One", [["1"]]), sheet("Two", [["2"]]), sheet("Три", [["3"]])]));
    expect(out.map((s) => s.name)).toEqual(["One", "Two", "Три"]);
    expect(out.map((s) => s.rows[0]?.[0])).toEqual(["1", "2", "3"]);
  });

  it("round-trips text that is hostile to XML and spreadsheets", () => {
    const hostile = [
      "<b>bold</b> & \"quoted\" 'single'",
      "  leading and trailing  ",
      "line1\nline2\n\nline4",
      "tab\there",
      "carriage\r\nreturn\r",
      "=SUM(A1:A2)",
      "+1 @user -x",
      `Oʻzbek gʻisht maʼlumot`,
      "Привет, мир — «ёлка»",
      "emoji 🙂👍🏽 and astral 𝒳",
      "ICU {count, plural, one {# kun} other {# kun}} {name}",
      "_x000D_ literal escape-looking text _x0041_",
      "control \u0001\u0008\u001f chars",
      " nbsp  and  narrow",
      "]]> cdata end",
      "0123", // leading zero must stay a string
      "1e5",
    ];
    const out = readXlsx(writeXlsx([sheet("S", [hostile])]));
    expect(out[0]?.rows[0]).toEqual(hostile);
  });

  it("property: 300 random strings survive the round trip (random BMP, astral and control chars)", () => {
    const rnd = prng(13102026);
    const pool = [..."abcXYZ <>&\"'\n\t _x0-9{}#", "ʻ", "ʼ", "я", "Ж", "🙂", "\u0001", "\r", " ", "—"];
    const strings: string[] = [];
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rnd() * 40);
      let s = "";
      for (let j = 0; j < len; j++) s += pool[Math.floor(rnd() * pool.length)];
      strings.push(s);
    }
    const out = readXlsx(
      writeXlsx([
        sheet(
          "P",
          strings.map((s) => [s]),
        ),
      ]),
    );
    expect(out[0]?.rows.map((r) => r[0])).toEqual(strings);
  });

  it("round-trips numbers including big integers and fractions", () => {
    const nums = [0, 1, -5, 12_500_000, Number.MAX_SAFE_INTEGER, 0.5, -0.25];
    expect(readXlsx(writeXlsx([sheet("N", [nums])]))[0]?.rows[0]).toEqual(nums);
  });

  it("handles 10 000 rows quickly", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => [`common`, `key.${i}`, `Matn ${i} oʻ`, i]);
    const started = Date.now();
    const out = readXlsx(writeXlsx([sheet("Big", rows)]));
    expect(out[0]?.rows).toHaveLength(10_000);
    expect(out[0]?.rows[9999]).toEqual(["common", "key.9999", "Matn 9999 oʻ", 9999]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("is deterministic (same bytes on every export)", () => {
    const data = [
      sheet("S", [
        ["a", "b"],
        ["c", 1],
      ]),
    ];
    expect(writeXlsx(data).equals(writeXlsx(data))).toBe(true);
  });

  it("produces the parts Excel and LibreOffice expect", () => {
    const files = readZip(
      writeXlsx([
        {
          name: "T",
          rows: [
            ["h1", "h2"],
            ["a", "b"],
          ],
          columnWidths: [10, 40],
          freezeHeader: true,
          editableColumns: [1],
        },
      ]),
    );
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/sharedStrings.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(files.has(part), part).toBe(true);
    }
    const sheetXml = files.get("xl/worksheets/sheet1.xml")?.toString("utf8") ?? "";
    expect(sheetXml).toContain("<pane");
    expect(sheetXml).toContain("<autoFilter");
    expect(sheetXml).toContain('<col min="2" max="2" width="40"');
    expect(files.get("[Content_Types].xml")?.toString("utf8")).toContain("spreadsheetml.sheet.main+xml");
  });

  it("rejects what Excel cannot hold", () => {
    expect(() => writeXlsx([sheet("S", [["x".repeat(32_768)]])])).toThrow(/32767/);
    expect(() => writeXlsx([sheet("S", [[Number.NaN]])])).toThrow(RangeError);
    expect(() => writeXlsx([sheet("S", [["\uD800"]])])).toThrow(/surrogate/);
    expect(() => writeXlsx([sheet("a/b", [])])).toThrow(/sheet name/);
    expect(() => writeXlsx([sheet("x".repeat(32), [])])).toThrow(/sheet name/);
    expect(() => writeXlsx([sheet("", [])])).toThrow(/sheet name/);
    expect(() => writeXlsx([sheet("Dup", []), sheet("dup", [])])).toThrow(/duplicate/);
    expect(() => writeXlsx([])).toThrow(/at least one sheet/);
  });

  it("accepts text exactly at the 32767-character cell limit", () => {
    const s = "я".repeat(32_767);
    expect(readXlsx(writeXlsx([sheet("S", [[s]])]))[0]?.rows[0]?.[0]).toBe(s);
  });
});

describe("readXlsx on files written by other programs", () => {
  it("reads shared strings with rich text runs, phonetic text and entities", () => {
    const sst =
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">' +
      "<si><t>plain</t></si>" +
      '<si><r><rPr><b/></rPr><t xml:space="preserve">rich </t></r><r><t>text</t></r></si>' +
      '<si><t>ph</t><rPh sb="0" eb="2"><t>IGNORED</t></rPh><phoneticPr fontId="1"/></si>' +
      "<si><t>A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos; &#1103; &#x1F642; x_x000D_y</t></si>" +
      "</sst>";
    const sheetXml =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      "</sheetData></worksheet>";
    const out = readXlsx(excelLikeBook([{ name: "Translations", xml: sheetXml }], sst));
    expect(out[0]?.rows[0]).toEqual(["plain", "rich text", "ph", "A & B <c> \"d\" 'e' я 🙂 x\ry"]);
  });

  it("reads inline strings, formula strings, booleans, errors, numbers and skipped cells", () => {
    const sheetXml =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>inline</t></is></c><c r="C2" t="str"><f>A1</f><v>formula text</v></c>' +
      '<c r="D2" t="b"><v>1</v></c><c r="E2" t="e"><v>#REF!</v></c><c r="F2" s="3"><v>42.5</v></c><c r="G2" t="n"><v>7</v></c>' +
      '<c r="H2" s="1"/></row>' +
      '<row r="4"><c r="B4" t="inlineStr"><is><r><t>a</t></r><r><t>b</t></r></is></c></row>' +
      "</sheetData></worksheet>";
    const out = readXlsx(excelLikeBook([{ name: "Translations", xml: sheetXml }]));
    expect(out[0]?.rows[1]).toEqual(["inline", null, "formula text", true, null, 42.5, 7]);
    expect(out[0]?.rows[0]).toEqual([]);
    expect(out[0]?.rows[2]).toEqual([]);
    expect(out[0]?.rows[3]).toEqual([null, "ab"]);
  });

  it("finds sheets through workbook.xml and its relationships, in any file order", () => {
    const mk = (v: string) =>
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${v}</t></is></c></row></sheetData></worksheet>`;
    const out = readXlsx(
      excelLikeBook(
        [
          { name: "Second", xml: mk("two"), file: "sheet1.xml", rid: "rId7" },
          { name: "First", xml: mk("one"), file: "sheet2.xml", rid: "rId3" },
        ],
        undefined,
        ["rId3", "rId7"],
      ),
    );
    expect(out.map((s) => [s.name, s.rows[0]?.[0]])).toEqual([
      ["First", "one"],
      ["Second", "two"],
    ]);
  });

  it("decodes XML names with a namespace prefix and attribute order differences", () => {
    const sheetXml =
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
      '<x:row r="1"><x:c t="inlineStr" r="A1"><x:is><x:t>pref</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>';
    expect(readXlsx(excelLikeBook([{ name: "P", xml: sheetXml }]))[0]?.rows[0]).toEqual(["pref"]);
  });

  it("rejects files that are not a workbook", () => {
    expect(() => readXlsx(text("garbage"))).toThrow(/not a ZIP/);
    expect(() => readXlsx(writeZip([{ name: "a.txt", data: text("x") }]))).toThrow(/xl\/workbook\.xml/);
    const noSheet = writeZip([
      {
        name: "xl/workbook.xml",
        data: text('<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      },
      { name: "xl/_rels/workbook.xml.rels", data: text("<Relationships/>") },
    ]);
    expect(() => readXlsx(noSheet)).toThrow(/rId1/);
  });
});

// ---- helpers for hand-made archives -------------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A one-entry archive in the layout of other ZIP writers: stored data, optional flags/method override. */
function buildStoredZip(name: string, data: Buffer, over: { flags?: number; method?: number } = {}): Buffer {
  const n = Buffer.from(name);
  const method = over.method ?? 0;
  const flags = over.flags ?? 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, n, data]);
  const cd = Buffer.concat([central, n]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, end]);
}

interface FakeSheet {
  name: string;
  xml: string;
  file?: string;
  rid?: string;
}

/** A workbook shaped like the ones Excel saves (separate rels, sharedStrings optional), built through writeZip. */
function excelLikeBook(sheets: FakeSheet[], sharedStrings?: string, order?: string[]): Buffer {
  const withIds = sheets.map((s, i) => ({ ...s, file: s.file ?? `sheet${i + 1}.xml`, rid: s.rid ?? `rId${i + 1}` }));
  const ordered = order ? order.map((rid) => withIds.find((s) => s.rid === rid) as (typeof withIds)[number]) : withIds;
  const wb =
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    ordered.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="${s.rid}"/>`).join("") +
    "</sheets></workbook>";
  const rels =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    withIds.map((s) => `<Relationship Id="${s.rid}" Type="x/worksheet" Target="worksheets/${s.file}"/>`).join("") +
    "</Relationships>";
  const entries = [
    { name: "xl/workbook.xml", data: text(wb) },
    { name: "xl/_rels/workbook.xml.rels", data: text(rels) },
    ...withIds.map((s) => ({ name: `xl/worksheets/${s.file}`, data: text(s.xml) })),
  ];
  if (sharedStrings) entries.push({ name: "xl/sharedStrings.xml", data: text(sharedStrings) });
  return writeZip(entries);
}
