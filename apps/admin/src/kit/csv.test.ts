import { describe, expect, it } from "vitest";
import { detectDelimiter, MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsv, toCsv } from "./csv.ts";

describe("parseCsv", () => {
  it("reads a plain file with a header", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6\n")).toEqual({
      ok: true,
      delimiter: ",",
      header: ["a", "b", "c"],
      rows: [
        { line: 2, cells: ["1", "2", "3"] },
        { line: 3, cells: ["4", "5", "6"] },
      ],
    });
  });

  it("handles quotes, doubled quotes, delimiters and line breaks inside a cell", () => {
    const text = 'name,note\n"Kingston, Fury","он сказал ""да"""\n"two\nlines",x\n';
    const r = parseCsv(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((row) => row.cells)).toEqual([
      ["Kingston, Fury", 'он сказал "да"'],
      ["two\nlines", "x"],
    ]);
    // The line number of a row is the line where it starts in the file.
    expect(r.rows.map((row) => row.line)).toEqual([2, 3]);
  });

  it("accepts Windows line ends, a BOM, a missing final newline and blank lines", () => {
    const r = parseCsv("\uFEFFa;b\r\n1;2\r\n\r\n3;4");
    expect(r).toMatchObject({ ok: true, delimiter: ";", header: ["a", "b"] });
    if (r.ok)
      expect(r.rows.map((row) => row.cells)).toEqual([
        ["1", "2"],
        ["3", "4"],
      ]);
  });

  it("finds the delimiter of Russian Excel (semicolon) and of tab-separated files", () => {
    expect(detectDelimiter("a;b;c\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n")).toBe("\t");
    expect(detectDelimiter("a,b,c\n")).toBe(",");
    expect(detectDelimiter('"a;b",c,d\n')).toBe(",");
    expect(detectDelimiter("single\n")).toBe(",");
  });

  it("keeps rows of unequal length for the caller to report", () => {
    const r = parseCsv("a,b\n1\n1,2,3\n");
    expect(r.ok && r.rows.map((row) => row.cells.length)).toEqual([1, 3]);
  });

  it("refuses an empty file, an unclosed quote and a file with no data rows", () => {
    expect(parseCsv("")).toEqual({ ok: false, error: "Файл пуст." });
    expect(parseCsv("   \n\n")).toEqual({ ok: false, error: "Файл пуст." });
    expect(parseCsv('a,b\n"open,1\n')).toEqual({ ok: false, error: "Не закрыта кавычка: файл повреждён." });
    expect(parseCsv("a,b\n")).toEqual({ ok: false, error: "В файле нет строк с данными." });
  });

  it("refuses too many rows and too big files before parsing them", () => {
    const many = `a\n${Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => String(i)).join("\n")}\n`;
    expect(parseCsv(many)).toEqual({ ok: false, error: `Слишком много строк: не больше ${MAX_CSV_ROWS}.` });
    expect(parseCsv("x".repeat(MAX_CSV_BYTES + 1))).toEqual({ ok: false, error: "Файл больше 1 МБ." });
  });

  it("trims header names and refuses duplicate or empty ones", () => {
    expect(parseCsv(" a , b \n1,2\n")).toMatchObject({ ok: true, header: ["a", "b"] });
    expect(parseCsv("a,a\n1,2\n")).toEqual({ ok: false, error: "Повторяется заголовок столбца: a." });
    expect(parseCsv("a,,c\n1,2,3\n")).toEqual({ ok: false, error: "В заголовке есть пустое имя столбца." });
  });

  it("keeps a formula in a cell as plain text when reading", () => {
    const r = parseCsv("a\n=SUM(A1)\n");
    expect(r.ok && r.rows[0]?.cells[0]).toBe("=SUM(A1)");
  });
});

describe("toCsv", () => {
  it("quotes what needs quotes and ends every row with CRLF", () => {
    expect(
      toCsv([
        ["a", "b c"],
        ["x,y", 'say "hi"'],
        ["line\nbreak", "ok"],
      ]),
    ).toBe('a,b c\r\n"x,y","say ""hi"""\r\n"line\nbreak",ok\r\n');
  });

  it("defuses cells that a spreadsheet would run as a formula", () => {
    expect(toCsv([["=1+1", "+cmd", "-2", "@x", "\tTab", "fine"]])).toBe("'=1+1,'+cmd,'-2,'@x,'\tTab,fine\r\n");
    expect(toCsv([["-12"]], { allowNumbers: true })).toBe("-12\r\n");
  });

  it("writes with another delimiter and quotes the cells that contain it", () => {
    expect(
      toCsv(
        [
          ["a;b", "c"],
          ["d", "e"],
        ],
        { delimiter: ";" },
      ),
    ).toBe('"a;b";c\r\nd;e\r\n');
  });
});
