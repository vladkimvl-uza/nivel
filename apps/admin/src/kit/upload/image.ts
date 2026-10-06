// Photos from a phone (receipts, parts, serial numbers) carry the place and the time they were taken in EXIF, XMP and
// IPTC; the owner's customers must not receive that and the site must never publish it (ARCHITECTURE 6.1, 10.2).
// This file removes it without decoding the picture: the container is read segment by segment (JPEG), chunk by chunk
// (PNG, WebP) and everything that is not needed to show the picture is left out; the pixel data is copied byte for byte.
// What stays is decided by a list of what is allowed (tables, frame headers, a colour profile that is a profile and
// nothing more), never by a list of what is known to be bad: a marker or a chunk that this file does not know is dropped.
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

/** Between scans only these stay: the tables (DHT, DAC, DQT, DRI), the number of lines (DNL) and the next scan (SOS). */
const SCAN_KEEP = new Set([0xc4, 0xcc, 0xdb, 0xdd, 0xdc, 0xda]);

/**
 * The picture data from the first scan to the end-of-image marker. Entropy-coded data never holds FF followed by
 * anything but 00 or RSTn, so the first real marker after a scan is read as such; the tables between scans are kept
 * (they may hold the bytes FF D9), every other segment between scans (APPn, comments, JPGn, reserved markers) is dropped. Whatever follows the end-of-image
 * marker (the video of a Motion Photo, a second JPEG with its own EXIF, a gain map) is cut off. A file with no end
 * marker is kept to its last byte, but a marker that cannot be read (a length that is zero or runs past the end, a
 * marker cut off at the end) ends the picture there: what follows is not understood, so it is not kept (it may be a
 * metadata block with a length that no reader would accept but a lenient one would). Null when the file holds more
 * metadata segments between scans than any picture does.
 */
function readScanData(buf: Buffer, start: number): { data: Buffer; trailer: boolean; dropped: Set<string> } | null {
  // One buffer, written once: the result is never longer than the input (plus the closing marker).
  const out = Buffer.allocUnsafe(buf.length + 2);
  let written = 0;
  const dropped = new Set<string>();
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
    if (!SCAN_KEEP.has(marker)) {
      droppedCount += 1;
      if (droppedCount > MAX_DROPPED_BETWEEN_SCANS) return null;
      flush(pos);
      chunkStart = end;
      dropped.add(marker >= 0xe0 && marker <= 0xef ? "app" : marker === 0xfe ? "comment" : "other");
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

/** A colour profile that is one: the size in its header is its size, and the signature of the format is in place. */
function isPlausibleIccProfile(profile: Buffer): boolean {
  return (
    profile.length >= 128 && profile.readUInt32BE(0) === profile.length && profile.toString("latin1", 36, 40) === "acsp"
  );
}

/** Frame headers (SOF0..SOF15 but DHT, JPG, DAC) and the tables that a decoder needs before the first scan. */
const isFrameHeader = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
const HEADER_TABLES = new Set([0xc4, 0xcc, 0xdb, 0xdd]);

/** The 14 bytes of the JFIF header with no thumbnail; null when the segment is not a JFIF header. */
function jfifHeader(payload: Buffer): { bytes: Buffer; hadThumbnail: boolean } | null {
  if (!startsWith(payload, "JFIF\0") || payload.length < 14) return null;
  const body = Buffer.from(payload.subarray(0, 14));
  const hadThumbnail = payload.length > 14 || (body[12] ?? 0) !== 0 || (body[13] ?? 0) !== 0;
  body[12] = 0;
  body[13] = 0;
  return { bytes: Buffer.concat([Buffer.from([0xff, 0xe0, 0, 16]), body]), hadThumbnail };
}

function cleanJpeg(input: Buffer): SanitizeResult {
  const parsed = readSegments(input);
  if (!parsed) return fail(CORRUPT);
  const kept: Buffer[] = [];
  const removed = new Set<string>();
  let orientation: number | null = null;
  let afterJfif = 0;

  // Allow-list: what is kept is named here; every other segment (a marker this file does not know, an APPn that is not
  // one of the three below, anything with a payload of an unexpected shape) is dropped.
  for (const s of parsed.segments) {
    const drop = (name: string) => void removed.add(name);
    const marker = s.marker;
    if (isFrameHeader(marker) || HEADER_TABLES.has(marker)) {
      kept.push(s.bytes);
    } else if (marker === 0xe0) {
      // JFIF: the header only (14 bytes), never what follows it (a thumbnail or anything else).
      const jfif = jfifHeader(s.payload);
      if (jfif) {
        kept.push(jfif.bytes);
        if (afterJfif === 0) afterJfif = kept.length;
        if (jfif.hadThumbnail) drop("thumbnail");
      } else drop(startsWith(s.payload, "JFXX\0") ? "thumbnail" : "app");
    } else if (marker === 0xe1) {
      if (startsWith(s.payload, "Exif\0\0")) {
        orientation ??= orientationOfTiff(s.payload.subarray(6));
        drop("exif");
      } else if (
        startsWith(s.payload, "http://ns.adobe.com/xap/") ||
        startsWith(s.payload, "http://ns.adobe.com/xmp/")
      ) {
        drop("xmp");
      } else drop("app1");
    } else if (marker === 0xe2) {
      // ICC: a profile that fits in one segment and is a profile (what a camera writes); the pieces of a long one and
      // anything that only carries the name are dropped, the colours are then read as sRGB.
      const isIcc =
        startsWith(s.payload, "ICC_PROFILE\0") &&
        s.payload[12] === 1 &&
        s.payload[13] === 1 &&
        isPlausibleIccProfile(s.payload.subarray(14));
      if (isIcc) kept.push(s.bytes);
      else drop(startsWith(s.payload, "MPF\0") ? "mpf" : "app2");
    } else if (marker === 0xed) {
      drop("iptc");
    } else if (marker === 0xee) {
      // Adobe colour transform, exactly its 12 bytes: without it a CMYK file shows wrong colours.
      if (startsWith(s.payload, "Adobe") && s.payload.length === 12) kept.push(s.bytes);
      else drop("app");
    } else if (marker === 0xfe) {
      drop("comment");
    } else if (marker >= 0xe3 && marker <= 0xef) {
      drop("app");
    } else {
      drop("other");
    }
  }

  if (orientation !== null && orientation > 1) kept.splice(afterJfif, 0, orientationOnlyExif(orientation));
  const scan = readScanData(input, parsed.scanStart);
  if (!scan) return fail(CORRUPT);
  if (scan.trailer) removed.add("trailer");
  for (const name of scan.dropped) removed.add(name);
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

interface RiffChunk {
  type: string;
  payload: Buffer;
}

/** The chunks of a RIFF body from `from` to `limit`; null when the sizes do not fit (or there are too many). */
function readRiffChunks(buf: Buffer, from: number, limit: number): RiffChunk[] | null {
  const chunks: RiffChunk[] = [];
  let pos = from;
  while (pos < limit) {
    if (chunks.length >= MAX_CHUNKS) return null;
    if (pos + 8 > limit) return null;
    const size = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (end > limit) return null;
    chunks.push({ type: buf.toString("latin1", pos, pos + 4), payload: buf.subarray(pos + 8, pos + 8 + size) });
    pos = end;
  }
  return chunks;
}

/** A chunk written afresh: its own padding byte is zero, whatever the file had there. */
function riffChunk(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload, Buffer.alloc(payload.length % 2)]);
}

/** The type of a dropped chunk for the journal: four letters, or "other" for anything that is not plain text. */
const chunkName = (type: string) => (/^[A-Za-z0-9 ]{4}$/.test(type) ? type.trim().toLowerCase() : "other");

/** Chunks that show the picture: lossy and lossless frames, the alpha plane, the colour profile, the animation. */
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"]);
/** Inside an animation frame only the picture of the frame. */
const WEBP_FRAME_KEEP = new Set(["VP8 ", "VP8L", "ALPH"]);
const WEBP_FLAG_ICC = 0x20;
const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_XMP = 0x04;
/** The flags that exist: ICC, alpha, EXIF, XMP, animation (bit 0 and the two high bits are reserved). */
const WEBP_FLAGS_MASK = 0x3e;

function cleanWebp(input: Buffer): SanitizeResult {
  if (input.length < 20) return fail(CORRUPT);
  const riffSize = input.readUInt32LE(4);
  if (riffSize + 8 > input.length) return fail(CORRUPT);
  const chunks = readRiffChunks(input, 12, riffSize + 8);
  if (!chunks) return fail(CORRUPT);
  const kept: Buffer[] = [];
  const removed = new Set<string>();
  let headerAt = -1;
  let dropIccFlag = false;
  for (const { type, payload } of chunks) {
    if (!WEBP_KEEP.has(type)) {
      removed.add(chunkName(type));
    } else if (type === "VP8X") {
      // Ten bytes: the flags (without EXIF and XMP), three reserved bytes (zero), the size of the canvas.
      if (payload.length < 10) return fail(CORRUPT);
      const head = Buffer.alloc(10);
      head[0] = (payload[0] ?? 0) & WEBP_FLAGS_MASK & ~(WEBP_FLAG_EXIF | WEBP_FLAG_XMP);
      payload.copy(head, 4, 4, 10);
      headerAt = kept.push(riffChunk(type, head)) - 1;
    } else if (type === "ICCP") {
      if (isPlausibleIccProfile(payload)) kept.push(riffChunk(type, payload));
      else {
        removed.add("iccp");
        dropIccFlag = true;
      }
    } else if (type === "ANIM") {
      kept.push(riffChunk(type, payload.subarray(0, 6)));
    } else if (type === "ANMF") {
      // The position, size and time of the frame (16 bytes, reserved bits clear) and the picture of the frame.
      const nested = payload.length >= 16 ? readRiffChunks(payload, 16, payload.length) : null;
      if (!nested) return fail(CORRUPT);
      const head = Buffer.from(payload.subarray(0, 16));
      head[15] = (head[15] ?? 0) & 0x03;
      const frame: Buffer[] = [head];
      for (const inner of nested) {
        if (WEBP_FRAME_KEEP.has(inner.type)) frame.push(riffChunk(inner.type, inner.payload));
        else removed.add(chunkName(inner.type));
      }
      kept.push(riffChunk(type, Buffer.concat(frame)));
    } else {
      kept.push(riffChunk(type, payload));
    }
  }
  if (kept.length === 0) return fail(CORRUPT);
  if (dropIccFlag && headerAt >= 0) {
    const header = kept[headerAt];
    if (header) header[8] = (header[8] ?? 0) & ~WEBP_FLAG_ICC;
  }
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...kept]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return { ok: true, data: Buffer.concat([head, body]), mime: "image/webp", ext: "webp", removed: [...removed] };
}

// ---- sharp ------------------------------------------------------------------------------------------------------------

/** The part of sharp this file uses; `import sharp from "sharp"` fits it. */
export interface SharpPipeline {
  rotate(): SharpPipeline;
  flatten(options: { background: { r: number; g: number; b: number } }): SharpPipeline;
  jpeg(options: { quality: number }): SharpPipeline;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { format: string } }>;
}
export type SharpFactory = (input: Buffer, options: { limitInputPixels: number }) => SharpPipeline;

/**
 * What sharp may decode, in pixels: the picture is held whole in memory and the admin container has 384 MB. Measured
 * here (sharp.cache(false), the pipeline of this file, maximum resident set above the 54 MB of the bare process): a
 * progressive 4:4:4 JPEG of 12 megapixels takes about 110 MB, an AVIF of 6 megapixels about 115 MB and of 12 about 220 MB
 * (a file of 1.6 KB can hold 49 megapixels and then took 870 MB). More than the limit is refused before decoding. A JPEG
 * above the limit is not lost: the lossless cleaner keeps it, with a tag of the turn only (`sanitizeImage`). A HEIF
 * above its limit has no other way and is refused with a message.
 */
export const MAX_JPEG_PIXELS = 12_000_000;
export const MAX_HEIF_PIXELS = 6_000_000;
const JPEG_QUALITY = 90;
const TOO_MANY_PIXELS =
  "Снимок слишком большой для обработки на сервере (не более 6 мегапикселей). Отправьте его как JPEG или уменьшите размер.";

/** One sharp job at a time in the whole process, however many uploads are being read: memory is the limit, not time. */
let sharpTail: Promise<void> = Promise.resolve();
function exclusively<T>(job: () => Promise<T>): Promise<T> {
  const run = sharpTail.then(job, job);
  sharpTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
 * always writes a JPEG: the output format is set, never the format of the input. One picture at a time, and not above
 * the pixel limits (`MAX_JPEG_PIXELS`, `MAX_HEIF_PIXELS`).
 */
export function createSharpSanitizer(sharp: SharpFactory): FallbackSanitizer {
  return async (input) => {
    const isJpeg = input[0] === 0xff && input[1] === 0xd8;
    const brand = heifBrand(input);
    if (!isJpeg && !brand) return fail(UNSUPPORTED);
    try {
      const { data, info } = await exclusively(() =>
        sharp(input, { limitInputPixels: isJpeg ? MAX_JPEG_PIXELS : MAX_HEIF_PIXELS })
          .rotate()
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer({ resolveWithObject: true }),
      );
      if (info.format !== "jpeg") return fail(UNSUPPORTED);
      return { ok: true, data, mime: "image/jpeg", ext: "jpg", removed: ["reencoded"] };
    } catch (error) {
      if (error instanceof Error && /pixel limit/i.test(error.message)) return fail(TOO_MANY_PIXELS);
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
