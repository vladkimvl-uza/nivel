// Photos from a phone (receipts, parts, serial numbers) carry the place and the time they were taken in EXIF, XMP and
// IPTC; the owner's customers must not receive that and the site must never publish it (ARCHITECTURE 6.1, 10.2).
// This file removes it without decoding the picture: the container is read segment by segment (JPEG), chunk by chunk
// (PNG, WebP) and everything that is not needed to show the picture is left out; the pixel data is copied byte for byte.
//
// sharp (catalog, `allowBuilds`) re-encodes and also reads HEIC; it is wired by the integrator (request in the branch
// description). Until then `sanitizeImage` works alone, and `createSharpSanitizer(sharp)` plugs sharp in as a fallback for
// formats this file cannot read.

export type SanitizeResult =
  | { ok: true; data: Buffer; mime: string; ext: string; removed: string[] }
  | { ok: false; error: string };

export type FallbackSanitizer = (input: Buffer) => Promise<SanitizeResult>;

const UNSUPPORTED = "Нужен снимок в формате JPEG, PNG или WebP.";
const CORRUPT = "Файл повреждён.";

const fail = (error: string): SanitizeResult => ({ ok: false, error });

export async function sanitizeImage(
  input: Buffer,
  opts: { fallback?: FallbackSanitizer } = {},
): Promise<SanitizeResult> {
  if (input.length === 0) return fail("Файл пуст.");
  if (input[0] === 0xff && input[1] === 0xd8) return cleanJpeg(input);
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return cleanPng(input);
  if (input.subarray(0, 4).toString("latin1") === "RIFF" && input.subarray(8, 12).toString("latin1") === "WEBP") {
    return cleanWebp(input);
  }
  return opts.fallback ? opts.fallback(input) : fail(UNSUPPORTED);
}

// ---- JPEG ---------------------------------------------------------------------------------------------------------

interface Segment {
  marker: number;
  bytes: Buffer;
  payload: Buffer;
}

function readSegments(buf: Buffer): { segments: Segment[]; scan: Buffer } | null {
  const segments: Segment[] = [];
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    while (buf[pos] === 0xff && pos + 1 < buf.length && buf[pos + 1] === 0xff) pos += 1;
    const marker = buf[pos + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9) return null; // the image ended before any scan
    if (marker === 0xda) return { segments, scan: buf.subarray(pos) };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, bytes: buf.subarray(pos, pos + 2), payload: Buffer.alloc(0) });
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) return null;
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > buf.length) return null;
    segments.push({
      marker,
      bytes: buf.subarray(pos, pos + 2 + length),
      payload: buf.subarray(pos + 4, pos + 2 + length),
    });
    pos += 2 + length;
  }
  return null;
}

const startsWith = (payload: Buffer, text: string) => payload.subarray(0, text.length).toString("latin1") === text;

/** Orientation tag (1..8) of the EXIF of a JPEG, null when there is none or it is unreadable. */
export function readJpegOrientation(buf: Buffer): number | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parsed = readSegments(buf);
  if (!parsed) return null;
  for (const s of parsed.segments) {
    if (s.marker === 0xe1 && startsWith(s.payload, "Exif\0\0")) return orientationOfTiff(s.payload.subarray(6));
  }
  return null;
}

function orientationOfTiff(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = tiff.subarray(0, 2).toString("latin1");
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** An EXIF block that holds the orientation and nothing else: the picture then shows the right way up everywhere. */
function orientationOnlyExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  // 20..21 padding of the value field, 22..25: no next IFD
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function cleanJpeg(input: Buffer): SanitizeResult {
  const parsed = readSegments(input);
  if (!parsed) return fail(CORRUPT);
  const kept: Buffer[] = [];
  const removed = new Set<string>();
  let orientation: number | null = null;
  let afterJfif = 0;

  for (const s of parsed.segments) {
    const drop = (name: string) => void removed.add(name);
    switch (s.marker) {
      case 0xe0:
        if (startsWith(s.payload, "JFIF\0")) {
          kept.push(s.bytes);
          if (afterJfif === 0) afterJfif = kept.length;
        } else drop("thumbnail");
        break;
      case 0xe1:
        if (startsWith(s.payload, "Exif\0\0")) {
          orientation ??= orientationOfTiff(s.payload.subarray(6));
          drop("exif");
        } else if (
          startsWith(s.payload, "http://ns.adobe.com/xap/") ||
          startsWith(s.payload, "http://ns.adobe.com/xmp/")
        )
          drop("xmp");
        else drop("app1");
        break;
      case 0xe2:
        if (startsWith(s.payload, "ICC_PROFILE\0")) kept.push(s.bytes);
        else drop(startsWith(s.payload, "MPF\0") ? "mpf" : "app2");
        break;
      case 0xed:
        drop("iptc");
        break;
      case 0xee:
        // Adobe colour transform: without it a CMYK file shows wrong colours.
        kept.push(s.bytes);
        break;
      case 0xfe:
        drop("comment");
        break;
      default:
        if (s.marker >= 0xe3 && s.marker <= 0xef) drop("app");
        else kept.push(s.bytes);
    }
  }

  if (orientation !== null && orientation > 1) kept.splice(afterJfif, 0, orientationOnlyExif(orientation));
  const data = Buffer.concat([Buffer.from([0xff, 0xd8]), ...kept, parsed.scan]);
  return { ok: true, data, mime: "image/jpeg", ext: "jpg", removed: [...removed] };
}

// ---- PNG ----------------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks needed to show the picture (and its colours); text, time and EXIF are not among them. */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "bKGD",
  "pHYs",
]);

function cleanPng(input: Buffer): SanitizeResult {
  const out: Buffer[] = [PNG_SIGNATURE];
  const removed = new Set<string>();
  let pos = 8;
  let sawEnd = false;
  let first = true;
  while (pos < input.length) {
    if (pos + 12 > input.length) return fail(CORRUPT);
    const length = input.readUInt32BE(pos);
    const type = input.subarray(pos + 4, pos + 8).toString("latin1");
    const end = pos + 12 + length;
    if (end > input.length) return fail(CORRUPT);
    if (first && type !== "IHDR") return fail(CORRUPT);
    first = false;
    if (PNG_KEEP.has(type)) out.push(input.subarray(pos, end));
    else removed.add(type);
    pos = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) return fail(CORRUPT);
  return { ok: true, data: Buffer.concat(out), mime: "image/png", ext: "png", removed: [...removed] };
}

// ---- WebP ---------------------------------------------------------------------------------------------------------

function cleanWebp(input: Buffer): SanitizeResult {
  if (input.length < 20) return fail(CORRUPT);
  const riffSize = input.readUInt32LE(4);
  if (riffSize + 8 > input.length) return fail(CORRUPT);
  const chunks: Buffer[] = [];
  const removed = new Set<string>();
  let pos = 12;
  const limit = riffSize + 8;
  while (pos < limit) {
    if (pos + 8 > limit) return fail(CORRUPT);
    const type = input.subarray(pos, pos + 4).toString("latin1");
    const size = input.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (end > limit) return fail(CORRUPT);
    if (type === "EXIF" || type === "XMP ") removed.add(type.trim().toLowerCase());
    else {
      const chunk = Buffer.from(input.subarray(pos, end));
      if (type === "VP8X" && size >= 1) chunk[8] = (chunk[8] ?? 0) & ~(0x08 | 0x04);
      chunks.push(chunk);
    }
    pos = end;
  }
  if (chunks.length === 0) return fail(CORRUPT);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return { ok: true, data: Buffer.concat([head, body]), mime: "image/webp", ext: "webp", removed: [...removed] };
}

// ---- sharp (when the integrator wires it) ----------------------------------------------------------------------------

/** The part of sharp this file uses; `import sharp from "sharp"` fits it. */
export type SharpFactory = (input: Buffer) => {
  rotate(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { format: string } }> };
};

const SHARP_FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
};

/**
 * sharp turns the picture the right way up (`rotate()` reads the orientation) and re-encodes it; it writes no metadata
 * unless asked to. HEIC from an iPhone comes out as JPEG when the build of libvips has the codec.
 */
export function createSharpSanitizer(sharp: SharpFactory): FallbackSanitizer {
  return async (input) => {
    try {
      const { data, info } = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
      const format = SHARP_FORMATS[info.format === "heif" ? "jpeg" : info.format];
      if (!format) return fail(UNSUPPORTED);
      return { ok: true, data, mime: format.mime, ext: format.ext, removed: ["reencoded"] };
    } catch {
      return fail("Файл не удалось прочитать как снимок.");
    }
  };
}
