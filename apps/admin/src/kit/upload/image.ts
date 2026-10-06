// Photos from a phone (receipts, parts, serial numbers) carry the place and the time they were taken in EXIF, XMP and
// IPTC; the owner's customers must not receive that and the site must never publish it (ARCHITECTURE 6.1, 10.2).
// This file removes it without decoding the picture: the container is read segment by segment (JPEG), chunk by chunk
// (PNG, WebP) and everything that is not needed to show the picture is left out; the pixel data is copied byte for byte.
//
// sharp (catalog, `allowBuilds`) re-encodes: it reads the HEIF family (an iPhone HEIC when the build of libvips has the
// HEVC codec, an AVIF always), applies the EXIF turn to the pixels and writes a JPEG with no metadata at all.
// `createSharpSanitizer(sharp)` is the fallback of `sanitizeImage`: it takes what this file cannot read, and a JPEG that
// carries a turn (the plain cleaner would keep a tag with the turn; sharp turns the pixels and keeps nothing).
// Without sharp `sanitizeImage` works alone.

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
  if (input[0] === 0xff && input[1] === 0xd8) {
    const clean = cleanJpeg(input);
    // A phone held upright writes the turn into EXIF. The lossless cleaner keeps a tag that holds only the turn; with
    // sharp at hand the pixels are turned and the file keeps no metadata at all. When sharp cannot do it, the lossless
    // result stands.
    if (!clean.ok || !opts.fallback || (readJpegOrientation(input) ?? 1) <= 1) return clean;
    const turned = await opts.fallback(input).catch(() => null);
    if (!turned?.ok) return clean;
    return { ...turned, removed: [...new Set([...clean.removed, ...turned.removed])] };
  }
  if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return cleanPng(input);
  if (input.subarray(0, 4).toString("latin1") === "RIFF" && input.subarray(8, 12).toString("latin1") === "WEBP") {
    return cleanWebp(input);
  }
  return opts.fallback ? opts.fallback(input) : fail(UNSUPPORTED);
}

// ---- JPEG ---------------------------------------------------------------------------------------------------------

/**
 * A real picture has a few dozen segments before the first scan and a few metadata segments between scans. A file of
 * millions of 4-byte segments is not a picture but a way to make the server hold millions of small objects, so the
 * counts are limited (a file over a limit is refused as damaged).
 */
const MAX_HEADER_SEGMENTS = 256;
const MAX_DROPPED_BETWEEN_SCANS = 4096;
const MAX_CHUNKS = 20_000;

interface Segment {
  marker: number;
  bytes: Buffer;
  payload: Buffer;
}

function readSegments(buf: Buffer): { segments: Segment[]; scanStart: number } | null {
  const segments: Segment[] = [];
  let pos = 2;
  while (pos < buf.length) {
    if (segments.length >= MAX_HEADER_SEGMENTS) return null;
    if (buf[pos] !== 0xff) return null;
    while (buf[pos] === 0xff && pos + 1 < buf.length && buf[pos + 1] === 0xff) pos += 1;
    const marker = buf[pos + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9) return null; // the image ended before any scan
    if (marker === 0xda) return { segments, scanStart: pos };
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

/**
 * The picture data from the first scan to the end-of-image marker. Entropy-coded data never holds FF followed by
 * anything but 00 or RSTn, so the first real marker after a scan is read as such; the tables between scans are kept
 * (they may hold the bytes FF D9), comments and APPn between scans are dropped. Whatever follows the end-of-image
 * marker (the video of a Motion Photo, a second JPEG with its own EXIF, a gain map) is cut off. A file with no end
 * marker is kept to its last byte, but a marker that cannot be read (a length that is zero or runs past the end, a
 * marker cut off at the end) ends the picture there: what follows is not understood, so it is not kept (it may be a
 * metadata block with a length that no reader would accept but a lenient one would). Null when the file holds more
 * metadata segments between scans than any picture does.
 */
function readScanData(buf: Buffer, start: number): { data: Buffer; trailer: boolean; dropped: boolean } | null {
  // One buffer, written once: the result is never longer than the input (plus the closing marker).
  const out = Buffer.allocUnsafe(buf.length + 2);
  let written = 0;
  let dropped = false;
  let droppedCount = 0;
  let pos = start;
  let chunkStart = start;
  const flush = (end: number) => {
    if (end > chunkStart) written += buf.copy(out, written, chunkStart, end);
  };
  const result = (trailer: boolean) => ({ data: Buffer.from(out.subarray(0, written)), trailer, dropped });
  const closeAt = (end: number) => {
    flush(end);
    out[written] = 0xff;
    out[written + 1] = 0xd9;
    written += 2;
    return result(true);
  };
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    // Skip fill bytes: FF FF ... FF xx.
    let m = pos + 1;
    while (buf[m] === 0xff) m += 1;
    const marker = buf[m];
    if (marker === undefined) return closeAt(pos);
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos = m + 1;
      continue;
    }
    if (marker === 0xd9) {
      flush(m + 1);
      return result(m + 1 < buf.length);
    }
    if (marker === 0xd8) {
      // A second image starts before the first one ended: keep the first, close it, drop the rest.
      return closeAt(pos);
    }
    if (marker === 0x01) {
      pos = m + 1;
      continue;
    }
    if (m + 3 >= buf.length) return closeAt(pos);
    const length = buf.readUInt16BE(m + 1);
    if (length < 2 || m + 1 + length > buf.length) return closeAt(pos);
    const end = m + 1 + length;
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (isMetadata) {
      droppedCount += 1;
      if (droppedCount > MAX_DROPPED_BETWEEN_SCANS) return null;
      flush(pos);
      chunkStart = end;
      dropped = true;
    }
    pos = end;
  }
  flush(buf.length);
  return result(false);
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
  const scan = readScanData(input, parsed.scanStart);
  if (!scan) return fail(CORRUPT);
  if (scan.trailer) removed.add("trailer");
  if (scan.dropped) removed.add("app");
  const data = Buffer.concat([Buffer.from([0xff, 0xd8]), ...kept, scan.data]);
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
  let count = 0;
  while (pos < input.length) {
    count += 1;
    if (count > MAX_CHUNKS) return fail(CORRUPT);
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
  let count = 0;
  while (pos < limit) {
    count += 1;
    if (count > MAX_CHUNKS) return fail(CORRUPT);
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

// ---- sharp ------------------------------------------------------------------------------------------------------------

/** The part of sharp this file uses; `import sharp from "sharp"` fits it. */
export interface SharpPipeline {
  rotate(): SharpPipeline;
  flatten(options: { background: string }): SharpPipeline;
  jpeg(options: { quality: number }): SharpPipeline;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { format: string } }>;
}
export type SharpFactory = (input: Buffer, options: { limitInputPixels: number }) => SharpPipeline;

/** A phone camera makes up to 48 megapixels; more is refused before it is decoded (a picture is held whole in memory). */
const MAX_INPUT_PIXELS = 50_000_000;
const JPEG_QUALITY = 90;

/** Brands of the ISO base media file (`ftyp`) that sharp reads as images; HEVC ones need a codec the prebuilt libvips lacks. */
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);
const HEIC_HELP =
  "Снимок HEIC этот сервер прочитать не может. Отправьте его как JPEG: на iPhone — Настройки, Камера, Форматы, «Наиболее совместимый».";

function heifBrand(input: Buffer): string | null {
  if (input.length < 12 || input.subarray(4, 8).toString("latin1") !== "ftyp") return null;
  const brand = input.subarray(8, 12).toString("latin1");
  return HEIF_BRANDS.has(brand) ? brand : null;
}

/**
 * sharp turns the picture the right way up (`rotate()` reads the orientation) and writes a JPEG with no metadata: EXIF,
 * XMP and IPTC are not carried over unless asked for, and a profile other than sRGB is converted to sRGB and dropped. It
 * takes a JPEG and the HEIF family only (GIF, TIFF, SVG and the rest are refused though sharp could read them), and
 * always writes a JPEG: the output format is set, never the format of the input.
 */
export function createSharpSanitizer(sharp: SharpFactory): FallbackSanitizer {
  return async (input) => {
    const isJpeg = input[0] === 0xff && input[1] === 0xd8;
    const brand = heifBrand(input);
    if (!isJpeg && !brand) return fail(UNSUPPORTED);
    try {
      const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });
      if (info.format !== "jpeg") return fail(UNSUPPORTED);
      return { ok: true, data, mime: "image/jpeg", ext: "jpg", removed: ["reencoded"] };
    } catch {
      return fail(brand && brand !== "avif" && brand !== "avis" ? HEIC_HELP : "Файл не удалось прочитать как снимок.");
    }
  };
}

/**
 * sharp is a native module: it is loaded on the first picture that needs it (not when the admin starts, so that a build
 * without the binary still runs everything else), once. When it does not load, the picture is refused as an unsupported
 * format and the reason goes to the log of the server.
 */
export function createLazySharpSanitizer(load: () => Promise<SharpFactory>): FallbackSanitizer {
  let ready: Promise<FallbackSanitizer | null> | undefined;
  return async (input) => {
    ready ??= load().then(createSharpSanitizer, (error: unknown) => {
      console.error("[admin] sharp did not load, HEIF photos are refused:", error);
      return null;
    });
    const sanitizer = await ready;
    return sanitizer ? sanitizer(input) : fail(UNSUPPORTED);
  };
}
