// admin kit: CSV in and out (RFC 4180 with the habits of Russian Excel: semicolons, a BOM, Windows line ends).
// Own reader because the catalog needs line numbers for error reports and no dependency can be added by a package.

export const MAX_CSV_BYTES = 1_048_576;
export const MAX_CSV_ROWS = 2_000;

export interface CsvRow {
  /** The line of the file where the row starts (the header is line 1). */
  line: number;
  cells: string[];
}

export type CsvParse = { ok: true; delimiter: string; header: string[]; rows: CsvRow[] } | { ok: false; error: string };

const DELIMITERS = [",", ";", "\t"] as const;

/** Looks at the first line outside quotes and picks the delimiter that occurs most; a comma when none occurs. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export function parseCsv(input: string): CsvParse {
  if (input.length > MAX_CSV_BYTES) return { ok: false, error: "Файл больше 1 МБ." };
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") return { ok: false, error: "Файл пуст." };
  const delimiter = detectDelimiter(text);

  const records: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let touched = false; // something was read on this record: a bare line break is not a record

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (touched && !(cells.length === 1 && (cells[0] ?? "").trim() === "")) records.push({ line: startLine, cells });
    cells = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      if (!touched) startLine = line;
      quoted = true;
      touched = true;
    } else if (ch === delimiter) {
      if (!touched) startLine = line;
      touched = true;
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      startLine = line;
    } else {
      if (!touched) startLine = line;
      touched = true;
      cell += ch;
    }
  }
  if (quoted) return { ok: false, error: "Не закрыта кавычка: файл повреждён." };
  if (touched || cell !== "" || cells.length > 0) endRecord();

  const [head, ...rows] = records;
  if (!head) return { ok: false, error: "Файл пуст." };
  const header = head.cells.map((h) => h.trim());
  if (header.some((h) => h === "")) return { ok: false, error: "В заголовке есть пустое имя столбца." };
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) return { ok: false, error: `Повторяется заголовок столбца: ${h}.` };
    seen.add(h);
  }
  if (rows.length === 0) return { ok: false, error: "В файле нет строк с данными." };
  if (rows.length > MAX_CSV_ROWS) return { ok: false, error: `Слишком много строк: не больше ${MAX_CSV_ROWS}.` };
  return { ok: true, delimiter, header, rows };
}

/**
 * CSV text for download. A cell that starts with = + - @ or a tab/CR would be run as a formula by a spreadsheet
 * (OWASP "CSV injection"): it is written with a leading apostrophe. Plain numbers may stay as they are.
 */
export function toCsv(rows: readonly (readonly string[])[], opts: { allowNumbers?: boolean } = {}): string {
  const guard = (cell: string): string => {
    if (!/^[=+\-@\t\r]/.test(cell)) return cell;
    if (opts.allowNumbers && /^-?\d+([.,]\d+)?$/.test(cell)) return cell;
    return `'${cell}`;
  };
  const quote = (cell: string): string => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return rows.map((row) => `${row.map((c) => quote(guard(c))).join(",")}\r\n`).join("");
}
