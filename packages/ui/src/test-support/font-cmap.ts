// Reads the set of code points a font maps, from a TTF/OTF (sfnt) or a WOFF2 file. Test support: there is no font
// parser among the dependencies, and `cmap` is the one table that WOFF2 stores untransformed.
import { brotliDecompressSync } from "node:zlib";

/** Known WOFF2 table tags by index (W3C WOFF2, 5.1); 63 means "a four-byte tag follows". */
const WOFF2_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX " +
  "vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc bsln cvar fdsc feat " +
  "fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .split(" ")
  .map((t) => t.padEnd(4));

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The bytes of the `cmap` table of an sfnt font. */
function sfntCmap(bytes: Uint8Array): Uint8Array {
  const v = viewOf(bytes);
  const count = v.getUint16(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    if (ascii(bytes, rec, 4) === "cmap") {
      const offset = v.getUint32(rec + 8);
      return bytes.subarray(offset, offset + v.getUint32(rec + 12));
    }
  }
  throw new Error("font has no cmap table");
}

/** The bytes of the `cmap` table of a WOFF2 font (the table is stored as is, inside one brotli stream). */
function woff2Cmap(bytes: Uint8Array): Uint8Array {
  const v = viewOf(bytes);
  const count = v.getUint16(12);
  const compressedSize = v.getUint32(20);
  let at = 48;
  const base128 = () => {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[at++] as number;
      n = n * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return n;
    }
    throw new Error("bad UIntBase128 in the woff2 table directory");
  };
  let offset = 0;
  let cmap: { start: number; length: number } | null = null;
  for (let i = 0; i < count; i++) {
    const flags = bytes[at++] as number;
    const idx = flags & 0x3f;
    let tag: string;
    if (idx === 63) {
      tag = ascii(bytes, at, 4);
      at += 4;
    } else {
      tag = WOFF2_TAGS[idx] as string;
    }
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const stored = transformed ? base128() : origLength;
    if (tag === "cmap") cmap = { start: offset, length: stored };
    offset += stored;
  }
  if (!cmap) throw new Error("font has no cmap table");
  const raw = brotliDecompressSync(bytes.subarray(at, at + compressedSize));
  return new Uint8Array(raw.buffer, raw.byteOffset + cmap.start, cmap.length);
}

function format4(v: DataView, at: number, out: Set<number>): void {
  const segs = v.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  for (let s = 0; s < segs; s++) {
    const end = v.getUint16(ends + s * 2);
    const start = v.getUint16(starts + s * 2);
    const delta = v.getInt16(deltas + s * 2);
    const rangeOffset = v.getUint16(ranges + s * 2);
    for (let cp = start; cp <= end && cp < 0xffff; cp++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        const g = v.getUint16(ranges + s * 2 + rangeOffset + (cp - start) * 2);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(cp);
    }
  }
}

function format12(v: DataView, at: number, out: Set<number>): void {
  const groups = v.getUint32(at + 12);
  for (let g = 0; g < groups; g++) {
    const rec = at + 16 + g * 12;
    const start = v.getUint32(rec);
    const end = v.getUint32(rec + 4);
    const glyph = v.getUint32(rec + 8);
    for (let cp = start; cp <= end; cp++) if (glyph + (cp - start) !== 0) out.add(cp);
  }
}

/** All code points mapped by the Unicode subtables (formats 4 and 12) of a TTF/OTF or WOFF2 file. */
export function cmapCodePoints(bytes: Uint8Array): Set<number> {
  if (bytes.length < 12) throw new Error("font file is too short");
  const sig = ascii(bytes, 0, 4);
  const v0 = viewOf(bytes).getUint32(0);
  let table: Uint8Array;
  if (sig === "wOF2") table = woff2Cmap(bytes);
  else if (v0 === 0x00010000 || sig === "true" || sig === "OTTO") table = sfntCmap(bytes);
  else throw new Error(`unknown font signature ${JSON.stringify(sig)}`);

  const v = viewOf(table);
  const out = new Set<number>();
  const subtables = v.getUint16(2);
  for (let i = 0; i < subtables; i++) {
    const rec = 4 + i * 8;
    const platform = v.getUint16(rec);
    const encoding = v.getUint16(rec + 2);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const at = v.getUint32(rec + 4);
    const format = v.getUint16(at);
    if (format === 4) format4(v, at, out);
    else if (format === 12) format12(v, at, out);
  }
  return out;
}
