// Minimal XLSX reader and writer without dependencies (node:zlib only). It exists for the translator flow (Р-25): a flat
// table of text cells, round-trip safe for Uzbek letters, Cyrillic, emoji, line breaks and XML-hostile characters. It is
// not a spreadsheet library: no formulas, dates, merged cells or rich text on write.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export type XlsxCell = string | number | boolean | null;

export interface SheetData {
  /** At most 31 characters, none of []:*?/\ . */
  name: string;
  rows: readonly (readonly XlsxCell[])[];
  /** Column widths in characters, by column index. */
  columnWidths?: readonly number[];
  /** Bold first row, frozen under it, with a filter. */
  freezeHeader?: boolean;
  /** Zero-based columns the translator edits: highlighted. */
  editableColumns?: readonly number[];
}

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

// ---- ZIP ----------------------------------------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const DOS_DATE_1980 = (0 << 9) | (1 << 5) | 1; // 1980-01-01: fixed so that equal input gives equal bytes
const UTF8_FLAG = 0x0800;
const DEFAULT_ENTRY_LIMIT = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

/** Writes a ZIP archive. Deterministic: no clock, entries in the given order. */
export function writeZip(entries: readonly ZipEntry[], options: { compress?: boolean } = {}): Buffer {
  const compress = options.compress ?? true;
  if (entries.length > 0xffff) throw new RangeError("too many ZIP entries");
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = compress && entry.data.length > 0 ? deflateRawSync(entry.data, { level: 9 }) : null;
    const useDeflate = deflated !== null && deflated.length < entry.data.length;
    const body = useDeflate ? (deflated as Buffer) : entry.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(entry.data);
    if (body.length > 0xffffffff || offset > 0xffffffff) throw new RangeError("ZIP64 is not supported");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(SIG_CENTRAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(UTF8_FLAG, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(DOS_DATE_1980, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    chunks.push(local, name, body);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

/** Reads a ZIP archive into name → bytes. Verifies sizes and CRC; refuses encryption, ZIP64 and oversized entries. */
export function readZip(buf: Buffer, options: { maxEntryBytes?: number } = {}): Map<string, Buffer> {
  const limit = options.maxEntryBytes ?? DEFAULT_ENTRY_LIMIT;
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a ZIP archive: end of central directory not found");
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw new Error(`ZIP has ${count} entries, more than the limit ${MAX_ENTRIES}`);
  if (cdOffset + cdSize > end) throw new Error("corrupt ZIP: central directory is out of range");

  const files = new Map<string, Buffer>();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new Error("corrupt ZIP: bad central directory entry");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 1) throw new Error(`ZIP entry "${name}" is encrypted`);
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) throw new Error("ZIP64 is not supported");
    if (name.endsWith("/")) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL)
      throw new Error(`corrupt ZIP: bad local header of "${name}"`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) throw new Error(`corrupt ZIP: "${name}" is truncated`);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: limit });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
          throw new Error(`ZIP entry "${name}" is larger than the limit of ${limit} bytes`);
        }
        throw new Error(`corrupt ZIP: cannot inflate "${name}"`);
      }
    } else {
      throw new Error(`ZIP entry "${name}" uses unsupported compression method ${method}`);
    }
    if (data.length > limit) throw new Error(`ZIP entry "${name}" is larger than the limit of ${limit} bytes`);
    if (data.length !== usize) throw new Error(`corrupt ZIP: size of "${name}" does not match`);
    if (crc32(data) !== crc) throw new Error(`corrupt ZIP: CRC mismatch in "${name}"`);
    files.set(name, data);
  }
  return files;
}

// ---- XML text -----------------------------------------------------------------------------------------------------

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Not allowed in XML 1.0 text (Excel stores them as _xHHHH_): C0 controls except tab and newline, U+FFFE, U+FFFF.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point of this expression is to find control characters
const NOT_XML = /[\u0000-\u0008\u000B-\u001F￾￿]/g;
const MAX_CELL_CHARS = 32_767;

function encodeText(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new RangeError("text contains an unpaired surrogate and cannot be stored in XML");
  return s
    .replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1")
    .replace(NOT_XML, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodeAttr(s: string): string {
  return encodeText(s).replace(/"/g, "&quot;");
}

function decodeText(s: string): string {
  return s
    .replace(/&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g, (m, body: string) => {
      switch (body) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
      }
      const code = body[1] === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

// ---- writer -------------------------------------------------------------------------------------------------------

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// cellXfs: 0 plain, 1 header (bold, grey, wrap), 2 body (wrap, top), 3 editable body (wrap, top, light yellow)
const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function checkSheetName(name: string): void {
  if (name.length < 1 || name.length > 31 || /[[\]:*?/\\]/.test(name)) {
    throw new RangeError(`invalid sheet name "${name}": 1 to 31 characters, none of []:*?/\\`);
  }
}

function sheetXml(sheet: SheetData, strings: Map<string, number>): string {
  const rows = sheet.rows;
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (rows.length > 1_048_576 || maxCols > 16_384)
    throw new RangeError(`sheet "${sheet.name}" is larger than Excel allows`);
  const editable = new Set(sheet.editableColumns ?? []);
  const out: string[] = [`${XML_HEAD}<worksheet xmlns="${NS_MAIN}">`];
  if (rows.length > 0 && maxCols > 0) out.push(`<dimension ref="A1:${columnName(maxCols - 1)}${rows.length}"/>`);
  out.push(
    sheet.freezeHeader
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
  );
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sheet.columnWidths?.length) {
    out.push("<cols>");
    sheet.columnWidths.forEach((w, i) => {
      out.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
    });
    out.push("</cols>");
  }
  out.push("<sheetData>");
  rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((cell, c) => {
      if (cell === null) return;
      const style = r === 0 && sheet.freezeHeader ? 1 : editable.has(c) ? 3 : 2;
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof cell === "number") {
        if (!Number.isFinite(cell)) throw new RangeError(`cell ${ref}: number must be finite`);
        cells.push(`<c r="${ref}" s="${style}"><v>${cell}</v></c>`);
      } else if (typeof cell === "boolean") {
        cells.push(`<c r="${ref}" s="${style}" t="b"><v>${cell ? 1 : 0}</v></c>`);
      } else {
        if (cell.length > MAX_CELL_CHARS)
          throw new RangeError(`cell ${ref}: text is longer than Excel's limit of ${MAX_CELL_CHARS} characters`);
        let idx = strings.get(cell);
        if (idx === undefined) {
          idx = strings.size;
          strings.set(cell, idx);
        }
        cells.push(`<c r="${ref}" s="${style}" t="s"><v>${idx}</v></c>`);
      }
    });
    if (cells.length > 0) out.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  });
  out.push("</sheetData>");
  if (sheet.freezeHeader && maxCols > 0) out.push(`<autoFilter ref="A1:${columnName(maxCols - 1)}${rows.length}"/>`);
  out.push("</worksheet>");
  return out.join("");
}

/** Writes a workbook. Deterministic: the same sheets give the same bytes. */
export function writeXlsx(sheets: readonly SheetData[]): Buffer {
  if (sheets.length === 0) throw new RangeError("a workbook needs at least one sheet");
  const seen = new Set<string>();
  for (const s of sheets) {
    checkSheetName(s.name);
    const key = s.name.toLowerCase();
    if (seen.has(key)) throw new RangeError(`duplicate sheet name "${s.name}"`);
    seen.add(key);
  }
  const strings = new Map<string, number>();
  const sheetParts = sheets.map((s) => sheetXml(s, strings));
  const sst = `${XML_HEAD}<sst xmlns="${NS_MAIN}" count="${strings.size}" uniqueCount="${strings.size}">${[
    ...strings.keys(),
  ]
    .map((s) => `<si><t xml:space="preserve">${encodeText(s)}</t></si>`)
    .join("")}</sst>`;
  const n = sheets.length;
  const workbook = `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>${sheets
    .map((s, i) => `<sheet name="${encodeAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const rels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join(
      "",
    )}<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join(
      "",
    )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  const rootRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const text = (name: string, xml: string): ZipEntry => ({ name, data: Buffer.from(xml, "utf8") });
  return writeZip([
    text("[Content_Types].xml", contentTypes),
    text("_rels/.rels", rootRels),
    text("xl/workbook.xml", workbook),
    text("xl/_rels/workbook.xml.rels", rels),
    text("xl/styles.xml", STYLES),
    text("xl/sharedStrings.xml", sst),
    ...sheetParts.map((xml, i) => text(`xl/worksheets/sheet${i + 1}.xml`, xml)),
  ]);
}

// ---- reader -------------------------------------------------------------------------------------------------------

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(ATTR)) out[m[1] as string] = decodeText((m[2] ?? m[3]) as string);
  return out;
}

/** Text of an element body: all <t> runs, without phonetic (<rPh>) text. */
function collectText(inner: string): string {
  const plain = inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let out = "";
  for (const m of plain.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g))
    out += decodeText(m[1] ?? "");
  return out;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g))
    out.push(collectText(m[1] ?? ""));
  return out;
}

function parseSheet(xml: string, shared: readonly string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rowAttrs = attributes(rowMatch[1] ?? "");
    const rowIndex = rowAttrs.r ? Number.parseInt(rowAttrs.r, 10) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: XlsxCell[] = rows[rowIndex] ?? [];
    let nextCol = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = attributes(cellMatch[1] ?? "");
      const ref = attrs.r ? /^([A-Z]+)\d+$/.exec(attrs.r) : null;
      const col = ref ? columnIndex(ref[1] as string) : nextCol;
      nextCol = col + 1;
      const inner = cellMatch[2] ?? "";
      const v = /<(?:\w+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?v>)/.exec(inner);
      const raw = v ? decodeText(v[1] ?? "") : null;
      let value: XlsxCell = null;
      switch (attrs.t) {
        case "s":
          value = raw === null ? null : (shared[Number.parseInt(raw, 10)] ?? null);
          break;
        case "inlineStr": {
          const is = /<(?:\w+:)?is\b[^>]*?>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner);
          value = is ? collectText(is[1] ?? "") : null;
          break;
        }
        case "str":
        case "d":
          value = raw;
          break;
        case "b":
          value = raw === null ? null : raw === "1" || raw.toLowerCase() === "true";
          break;
        case "e":
          value = null;
          break;
        default: {
          const num = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
          value = Number.isNaN(num) ? null : num;
        }
      }
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    rows[rowIndex] = cells;
  }
  const dense: XlsxCell[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    while (row.length > 0 && row[row.length - 1] === null) row.pop();
    dense.push(row);
  }
  while (dense.length > 0 && dense[dense.length - 1]?.length === 0) dense.pop();
  return dense;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

/** Reads every sheet of a workbook into rows of cells (dates arrive as spreadsheet numbers; formulas as their cached text). */
export function readXlsx(buf: Buffer, options: { maxEntryBytes?: number } = {}): XlsxSheet[] {
  const files = readZip(buf, options);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (workbook === undefined) throw new Error("not an xlsx workbook: xl/workbook.xml is missing");
  const relTargets = new Map<string, { target: string; type: string }>();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const a = attributes(m[1] ?? "");
    if (a.Id && a.Target) relTargets.set(a.Id, { target: a.Target, type: a.Type ?? "" });
  }
  const sstRel = [...relTargets.values()].find((r) => r.type.endsWith("/sharedStrings"));
  const sstXml = text(sstRel ? resolveTarget(sstRel.target) : "xl/sharedStrings.xml");
  const shared = sstXml === undefined ? [] : parseSharedStrings(sstXml);

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const a = attributes(m[1] ?? "");
    const ridKey = Object.keys(a).find((k) => k === "id" || k.endsWith(":id"));
    const rid = ridKey ? a[ridKey] : undefined;
    const rel = rid ? relTargets.get(rid) : undefined;
    if (!rid || !rel)
      throw new Error(`relationship ${rid ?? "(none)"} of sheet "${a.name}" not found in xl/_rels/workbook.xml.rels`);
    const path = resolveTarget(rel.target);
    const xml = text(path);
    if (xml === undefined) throw new Error(`sheet part ${path} is missing`);
    sheets.push({ name: a.name ?? "", rows: parseSheet(xml, shared) });
  }
  return sheets;
}
