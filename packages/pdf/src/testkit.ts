// Test helper: reads a PDF made by @react-pdf/renderer back without any PDF library (the catalog has none, and the tests
// may not use the network). It inflates the streams, follows /Pages -> /Page -> /Contents and the /Font resources, and maps the
// glyph ids of every text run to Unicode through the ToUnicode CMap of its font. A glyph the font does not have is glyph 0,
// which the CMap maps to U+0000: `text` containing "\u0000" is the sign of a missing glyph.
import { inflateSync } from "node:zlib";

interface PdfObject {
  id: number;
  dict: string;
  stream: Buffer | null;
}

export interface PdfFontInfo {
  /** BaseFont without the subset tag: "FiraSans-Regular". */
  name: string;
  /** The BaseFont carries a six-letter subset tag ("CZZZZZ+..."): only the glyphs used are embedded. */
  subset: boolean;
  /** Code points the ToUnicode map of the font knows (the glyphs used in the document, plus U+0000 for glyph 0). */
  codePoints: Set<number>;
}

export interface ParsedPdf {
  pages: string[][];
  /** Lines of all pages, one per text run, joined with "\n". */
  text: string;
  fonts: PdfFontInfo[];
  info: Record<string, string>;
}

function readObjects(pdf: Buffer): Map<number, PdfObject> {
  const s = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(?:^|\n)(\d+) 0 obj\n/g;
  let at = 0;
  for (;;) {
    header.lastIndex = at;
    const m = header.exec(s);
    if (m === null) break;
    const start = m.index + m[0].length;
    const streamAt = s.indexOf("stream\n", start);
    const endAt = s.indexOf("endobj", start);
    const id = Number(m[1]);
    if (streamAt !== -1 && (endAt === -1 || streamAt < endAt)) {
      const dict = s.slice(start, streamAt);
      const len = /\/Length (\d+)(?! 0 R)/.exec(dict);
      const from = streamAt + "stream\n".length;
      const to = len ? from + Number(len[1]) : s.indexOf("endstream", from);
      objects.set(id, { id, dict, stream: pdf.subarray(from, to) });
      at = to;
    } else {
      objects.set(id, { id, dict: s.slice(start, endAt === -1 ? s.length : endAt), stream: null });
      at = endAt === -1 ? s.length : endAt;
    }
  }
  return objects;
}

function streamText(o: PdfObject | undefined): string {
  if (o?.stream == null) return "";
  const raw = /FlateDecode/.test(o.dict) ? inflateSync(o.stream) : o.stream;
  return raw.toString("latin1");
}

function utf16(hex: string): string {
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  return out;
}

/** cid -> text, from the `bfchar` and `bfrange` sections of a ToUnicode CMap. */
export function parseCMap(source: string): Map<number, string> {
  // The writer puts a space inside the hex string of a ligature: <0066 0069>.
  const cmap = source.replace(/<([0-9a-fA-F\s]+)>/g, (_, hex: string) => `<${hex.replace(/\s+/g, "")}>`);
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g;
    for (const r of (block[1] ?? "").matchAll(re)) {
      const lo = Number.parseInt(r[1] as string, 16);
      const hi = Number.parseInt(r[2] as string, 16);
      const dst = r[3] as string;
      if (dst.startsWith("[")) {
        const items = [...dst.matchAll(/<([0-9a-fA-F]+)>/g)];
        for (let c = lo; c <= hi; c++) {
          const item = items[c - lo];
          if (item) map.set(c, utf16(item[1] as string));
        }
      } else {
        const base = utf16(dst.slice(1, -1));
        const first = base.codePointAt(0) ?? 0;
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCodePoint(first + (c - lo)));
      }
    }
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of (block[1] ?? "").matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(Number.parseInt(r[1] as string, 16), utf16(r[2] as string));
    }
  }
  return map;
}

function refs(dict: string, key: string): number[] {
  const m = new RegExp(`/${key}\\s*(\\[[^\\]]*\\]|\\d+ 0 R)`).exec(dict);
  return m ? [...(m[1] as string).matchAll(/(\d+) 0 R/g)].map((r) => Number(r[1])) : [];
}

function pageIds(objects: Map<number, PdfObject>): number[] {
  const root = [...objects.values()].find((o) => /\/Type \/Pages\b/.test(o.dict) && !/\/Parent/.test(o.dict));
  const walk = (id: number): number[] => {
    const o = objects.get(id);
    if (!o) return [];
    if (/\/Type \/Page\b(?!s)/.test(o.dict)) return [id];
    return refs(o.dict, "Kids").flatMap(walk);
  };
  return root ? walk(root.id) : [];
}

/** The font resources of a page: resource name ("F2") -> object id. The resources are inline or one object away. */
function fontResources(objects: Map<number, PdfObject>, page: PdfObject): Map<string, number> {
  let dict = page.dict;
  const viaRef = /\/Resources (\d+) 0 R/.exec(dict);
  if (viaRef) dict = objects.get(Number(viaRef[1]))?.dict ?? "";
  const fonts = /\/Font\s*<<([\s\S]*?)>>/.exec(dict);
  const out = new Map<string, number>();
  for (const f of (fonts?.[1] ?? "").matchAll(/\/(\w+) (\d+) 0 R/g)) out.set(f[1] as string, Number(f[2]));
  return out;
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` applied first, then `b` (PDF: a x b). */
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

interface FontData {
  cmap: Map<number, string>;
  /** Width of a glyph in 1/1000 of the font size. */
  widths: Map<number, number>;
  defaultWidth: number;
}

interface Run {
  x: number;
  y: number;
  width: number;
  text: string;
  /** Angle of the baseline in radians; a stamp or a watermark is turned, ordinary text is not. */
  angle: number;
}

/** `/W [0 [500 600] 10 12 700]`: single widths after a first cid, or one width for a range. */
function parseWidths(dict: string): Map<number, number> {
  const widths = new Map<number, number>();
  const body = /\/W\s*\[([\s\S]*)\]\s*(?:\/\w|>>)/.exec(dict)?.[1] ?? /\/W\s*\[([\s\S]*)\]/.exec(dict)?.[1] ?? "";
  const tokens = body.match(/\[[^\]]*\]|-?[\d.]+/g) ?? [];
  for (let i = 0; i < tokens.length; ) {
    const first = Number(tokens[i]);
    const next = tokens[i + 1];
    if (next?.startsWith("[")) {
      (next.match(/-?[\d.]+/g) ?? []).forEach((w, k) => {
        widths.set(first + k, Number(w));
      });
      i += 2;
    } else {
      const last = Number(next);
      const w = Number(tokens[i + 2]);
      for (let c = first; c <= last; c++) widths.set(c, w);
      i += 3;
    }
  }
  return widths;
}

export function runsOfContent(content: string, fonts: Map<string, FontData>): Run[] {
  const runs: Run[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let tm: Matrix = IDENTITY;
  let font: FontData | undefined;
  let size = 0;
  let cursor = 0;
  const show = (items: readonly (string | number)[]): void => {
    let text = "";
    let advance = 0;
    for (const item of items) {
      if (typeof item === "number") {
        advance -= (item / 1000) * size;
        continue;
      }
      for (let i = 0; i + 4 <= item.length; i += 4) {
        const cid = Number.parseInt(item.slice(i, i + 4), 16);
        text += font?.cmap.get(cid) ?? "\uFFFD";
        advance += (((font?.widths.get(cid) ?? font?.defaultWidth ?? 0) as number) / 1000) * size;
      }
    }
    const at = mul(tm, ctm);
    // The width is in text space: scale it by the horizontal scale of the whole matrix.
    const scale = Math.hypot(at[0], at[1]);
    runs.push({
      x: at[4] + cursor * scale,
      y: at[5],
      width: advance * scale,
      text,
      angle: Math.atan2(at[1], at[0]),
    });
    cursor += advance;
  };
  const token =
    /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(cm|Tm)\b|\/(\w+)\s+([\d.]+)\s+Tf|\[((?:<[0-9a-fA-F]*>|\s|-?[\d.]+)*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj|\bq\b|\bQ\b|\bBT\b/g;
  for (const m of content.matchAll(token)) {
    if (m[7] !== undefined) {
      const mat = [1, 2, 3, 4, 5, 6].map((k) => Number(m[k])) as unknown as Matrix;
      if (m[7] === "cm") ctm = mul(mat, ctm);
      else {
        tm = mat;
        cursor = 0;
      }
    } else if (m[8] !== undefined) {
      font = fonts.get(m[8]);
      size = Number(m[9]);
    } else if (m[10] !== undefined) {
      const items = [...m[10].matchAll(/<([0-9a-fA-F]*)>|(-?[\d.]+)/g)].map((x) =>
        x[1] !== undefined ? x[1] : Number(x[2]),
      );
      show(items);
    } else if (m[11] !== undefined) show([m[11]]);
    else if (m[0] === "q") stack.push(ctm);
    else if (m[0] === "Q") ctm = stack.pop() ?? IDENTITY;
    else if (m[0] === "BT") {
      tm = IDENTITY;
      cursor = 0;
    }
  }
  return runs;
}

const glue = (out: string, text: string): string =>
  out !== "" && !out.endsWith(" ") && !text.startsWith(" ") ? `${out} ${text}` : `${out}${text}`;

/**
 * Runs of one page in reading order: lines from the top, each line from the left, runs that touch are one text (react-pdf cuts a
 * text where the script changes: "NAMUNA / " and "ОБРАЗЕЦ" are two runs). Turned text (a stamp, the watermark) has no
 * horizontal line: its runs of one angle that follow each other in the stream make one line, put after the others.
 */
function linesOfRuns(runs: readonly Run[]): string[] {
  const upright = runs.filter((r) => r.text !== "" && Math.abs(r.angle) < 1e-3);
  const turned = runs.filter((r) => r.text !== "" && Math.abs(r.angle) >= 1e-3);
  const sorted = [...upright].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Run[][] = [];
  for (const run of sorted) {
    const line = lines.at(-1);
    if (line !== undefined && Math.abs((line[0] as Run).y - run.y) <= 2) line.push(run);
    else lines.push([run]);
  }
  const out = lines.map((line) => {
    const byX = [...line].sort((a, b) => a.x - b.x);
    let text = "";
    let end = Number.NEGATIVE_INFINITY;
    for (const run of byX) {
      text = run.x - end > 1.5 ? glue(text, run.text) : `${text}${run.text}`;
      end = run.x + run.width;
    }
    return text;
  });
  let group: Run[] = [];
  const flush = (): void => {
    if (group.length > 0) out.push(group.reduce((acc, r) => glue(acc, r.text), ""));
    group = [];
  };
  for (const run of turned) {
    if (group.length > 0 && Math.abs((group[0] as Run).angle - run.angle) >= 1e-3) flush();
    group.push(run);
  }
  flush();
  return out;
}

/** A text string of the info dictionary: UTF-16BE after the mark FE FF, or plain bytes. */
function pdfString(raw: string): string {
  if (!raw.startsWith("þÿ")) return raw;
  let out = "";
  for (let i = 2; i + 1 < raw.length; i += 2)
    out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
  return out;
}

function infoOf(objects: Map<number, PdfObject>): Record<string, string> {
  const info: Record<string, string> = {};
  for (const o of objects.values()) {
    if (!/\/Producer/.test(o.dict)) continue;
    for (const k of ["Title", "Author", "Subject", "Creator"]) {
      const ref = new RegExp(`/${k} (\\d+) 0 R`).exec(o.dict);
      const lit = ref ? /^\((.*)\)\s*$/s.exec((objects.get(Number(ref[1]))?.dict ?? "").trim()) : null;
      if (lit) info[k] = pdfString(lit[1] as string);
    }
  }
  return info;
}

export function parsePdf(pdf: Buffer): ParsedPdf {
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
  const objects = readObjects(pdf);
  const fontCache = new Map<number, FontData>();
  const fontInfos = new Map<number, PdfFontInfo>();
  const fontMap = (id: number): FontData => {
    const cached = fontCache.get(id);
    if (cached) return cached;
    const font = objects.get(id);
    const toUnicode = font ? refs(font.dict, "ToUnicode")[0] : undefined;
    const map = toUnicode === undefined ? new Map<number, string>() : parseCMap(streamText(objects.get(toUnicode)));
    const descendant = font ? refs(font.dict, "DescendantFonts")[0] : undefined;
    const data: FontData = {
      cmap: map,
      widths: parseWidths(descendant === undefined ? "" : (objects.get(descendant)?.dict ?? "")),
      defaultWidth: 0,
    };
    fontCache.set(id, data);
    const base = /\/BaseFont \/([^\s/]+)/.exec(font?.dict ?? "")?.[1] ?? "";
    fontInfos.set(id, {
      name: base.replace(/^[A-Z]{6}\+/, ""),
      subset: /^[A-Z]{6}\+/.test(base),
      codePoints: new Set([...map.values()].flatMap((t) => [...t].map((c) => c.codePointAt(0) as number))),
    });
    return data;
  };
  const pages: string[][] = [];
  for (const id of pageIds(objects)) {
    const page = objects.get(id) as PdfObject;
    const resources = fontResources(objects, page);
    const maps = new Map([...resources].map(([name, fid]) => [name, fontMap(fid)] as const));
    const runs = refs(page.dict, "Contents").flatMap((cid) => runsOfContent(streamText(objects.get(cid)), maps));
    pages.push(linesOfRuns(runs));
  }
  const text = pages.map((p) => p.join("\n")).join("\n");
  return { pages, text, fonts: [...fontInfos.values()], info: infoOf(objects) };
}

/** Text of the document in reading order, one text run per line. */
export const pdfText = (pdf: Buffer): string => parsePdf(pdf).text;

/** The text with every white space run (the non-breaking space too) folded into one plain space, for `toContain` checks. */
export const flat = (text: string): string => text.replace(/[\s\u00a0]+/g, " ");
