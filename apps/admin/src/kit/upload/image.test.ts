import { describe, expect, it } from "vitest";
import { createSharpSanitizer, readJpegOrientation, type SharpFactory, sanitizeImage } from "./image.ts";

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const segment = (marker: number, payload: number[]) => [0xff, marker, ...u16(payload.length + 2), ...payload];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** TIFF block (big endian) with the Orientation tag and a GPS IFD that holds a coordinate and a marker string. */
function exifPayload(orientation: number): number[] {
  const gpsMarker = ascii("SECRET-GPS-41.2995N");
  const ifd0Count = 2;
  const ifd0Offset = 8;
  const gpsIfdOffset = ifd0Offset + 2 + ifd0Count * 12 + 4;
  const tiff: number[] = [
    ...ascii("MM"),
    ...u16(42),
    0,
    0,
    0,
    8,
    ...u16(ifd0Count),
    // Orientation, SHORT, 1, value
    ...u16(0x0112),
    ...u16(3),
    0,
    0,
    0,
    1,
    ...u16(orientation),
    0,
    0,
    // GPS IFD pointer, LONG, 1, offset
    ...u16(0x8825),
    ...u16(4),
    0,
    0,
    0,
    1,
    0,
    0,
    ...u16(gpsIfdOffset),
    0,
    0,
    0,
    0, // next IFD
    // GPS IFD: one ASCII entry pointing at the marker string
    ...u16(1),
    ...u16(0x0002),
    ...u16(2),
    0,
    0,
    0,
    gpsMarker.length,
    0,
    0,
    ...u16(gpsIfdOffset + 2 + 12 + 4),
    0,
    0,
    0,
    0,
    ...gpsMarker,
  ];
  return [...ascii("Exif"), 0, 0, ...tiff];
}

/** A 1x1 baseline JPEG (the well-known smallest one): SOI, DQT, SOF0, DHT, SOS, data, EOI. */
const TINY_BODY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
).subarray(2); // without SOI

function jpegWith(...segments: number[][]): Buffer {
  return Buffer.from([0xff, 0xd8, ...segments.flat(), ...TINY_BODY, 0xff, 0xd9]);
}

const JFIF = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

describe("sanitizeImage: JPEG", () => {
  it("removes EXIF with GPS, XMP, IPTC, comments and thumbnails, and keeps the picture data byte for byte", async () => {
    const original = jpegWith(
      JFIF,
      segment(0xe1, exifPayload(1)),
      segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<x:xmpmeta>SECRET-XMP</x:xmpmeta>")]),
      segment(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("SECRET-IPTC")]),
      segment(0xfe, ascii("SECRET-COMMENT shot at home")),
      segment(0xe2, [...ascii("MPF"), 0, ...ascii("SECRET-MPF-THUMB")]),
    );
    const r = await sanitizeImage(original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mime).toBe("image/jpeg");
    expect(r.ext).toBe("jpg");
    const text = r.data.toString("latin1");
    for (const secret of [
      "SECRET-GPS",
      "SECRET-XMP",
      "SECRET-IPTC",
      "SECRET-COMMENT",
      "SECRET-MPF",
      "Exif",
      "xmpmeta",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("JFIF");
    expect(r.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    // The scan (everything after the first SOS) is untouched.
    const sos = (b: Buffer) => b.indexOf(Buffer.from([0xff, 0xda]));
    expect(r.data.subarray(sos(r.data))).toEqual(original.subarray(sos(original)));
    expect(r.removed).toEqual(expect.arrayContaining(["exif", "xmp", "iptc", "comment", "mpf"]));
  });

  it("cuts everything after the end of the picture (a Motion Photo video, a second JPEG with its own EXIF)", async () => {
    const second = Buffer.from([0xff, 0xd8, ...segment(0xe1, exifPayload(1)), 0xff, 0xd9]);
    const video = Buffer.from([...u16(0), ...ascii("ftypmp42SECRET-VIDEO-TAIL-41.2995N")]);
    const original = Buffer.concat([jpegWith(JFIF), second, video]);
    const r = await sanitizeImage(original);
    if (!r.ok) throw new Error(r.error);
    const text = r.data.toString("latin1");
    expect(text).not.toContain("SECRET-GPS");
    expect(text).not.toContain("SECRET-VIDEO-TAIL");
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r.removed).toContain("trailer");
    expect(r.data.indexOf(Buffer.from([0xff, 0xd8]), 2)).toBe(-1);
  });

  it("does not take the bytes FF D9 inside a table of a later scan for the end of the picture", async () => {
    // A progressive-style file: scan, a quantisation table that holds FF D9 as two values, a second scan, EOI, junk.
    const scan = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0x00, 0x56];
    const table = segment(0xdb, [0, 0xff, 0xd9, 3, 4]);
    const comment = segment(0xfe, ascii("SECRET-COMMENT-BETWEEN-SCANS"));
    const head = jpegWith(JFIF).subarray(0, -2);
    const original = Buffer.concat([
      head,
      Buffer.from([...scan, ...table, ...comment, ...scan, 0xff, 0xd9]),
      Buffer.from("SECRET-AFTER-EOI"),
    ]);
    const r = await sanitizeImage(original);
    if (!r.ok) throw new Error(r.error);
    const text = r.data.toString("latin1");
    expect(text).not.toContain("SECRET-AFTER-EOI");
    expect(text).not.toContain("SECRET-COMMENT-BETWEEN-SCANS");
    expect(r.data.includes(Buffer.from(table))).toBe(true);
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r.data.length).toBeGreaterThan(head.length + scan.length * 2 + table.length);
  });

  it("closes a picture that is followed by a second one without an end marker of its own", async () => {
    const first = jpegWith(JFIF).subarray(0, -2);
    const second = Buffer.from([0xff, 0xd8, ...segment(0xe1, exifPayload(1)), 0xff, 0xd9]);
    const r = await sanitizeImage(Buffer.concat([first, second]));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain("SECRET-GPS");
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r.removed).toContain("trailer");
  });

  it("keeps a file that has no end marker as it is (a cut-off file is not made up)", async () => {
    const cut = jpegWith(JFIF).subarray(0, -2);
    const r = await sanitizeImage(cut);
    if (!r.ok) throw new Error(r.error);
    expect(r.removed).not.toContain("trailer");
    expect(r.data.subarray(-4)).toEqual(cut.subarray(-4));
  });

  it("keeps the orientation of a rotated phone photo and nothing else of the EXIF", async () => {
    const original = jpegWith(JFIF, segment(0xe1, exifPayload(6)));
    expect(readJpegOrientation(original)).toBe(6);
    const r = await sanitizeImage(original);
    if (!r.ok) throw new Error(r.error);
    expect(readJpegOrientation(r.data)).toBe(6);
    expect(r.data.toString("latin1")).not.toContain("SECRET-GPS");
    expect(r.data.length).toBeLessThan(original.length);
  });

  it("adds no EXIF at all when the orientation is the normal one or missing", async () => {
    const r = await sanitizeImage(jpegWith(JFIF, segment(0xe1, exifPayload(1))));
    if (!r.ok) throw new Error(r.error);
    expect(readJpegOrientation(r.data)).toBeNull();
    expect(r.data.toString("latin1")).not.toContain("Exif");
    const plain = await sanitizeImage(jpegWith(JFIF));
    expect(plain.ok && readJpegOrientation(plain.data)).toBeNull();
  });

  it("keeps the colour profile (needed to show the colours right) and drops other APP2 data", async () => {
    const icc = segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, ...ascii("PROFILEBYTES")]);
    const r = await sanitizeImage(jpegWith(JFIF, icc));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).toContain("PROFILEBYTES");
  });

  it("is idempotent: cleaning a clean file changes nothing", async () => {
    const once = await sanitizeImage(jpegWith(JFIF, segment(0xe1, exifPayload(8))));
    if (!once.ok) throw new Error(once.error);
    const twice = await sanitizeImage(once.data);
    expect(twice.ok && twice.data.equals(once.data)).toBe(true);
  });

  it("refuses a truncated file and a file whose segment length lies", async () => {
    const good = jpegWith(JFIF);
    expect(await sanitizeImage(good.subarray(0, 3))).toMatchObject({ ok: false });
    const lying = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x41, 0x42]);
    expect(await sanitizeImage(lying)).toMatchObject({ ok: false, error: "Файл повреждён." });
    const noScan = Buffer.from([0xff, 0xd8, ...JFIF, 0xff, 0xd9]);
    expect(await sanitizeImage(noScan)).toMatchObject({ ok: false, error: "Файл повреждён." });
  });
});

describe("sanitizeImage: PNG and WebP", () => {
  const crc = Buffer.alloc(4);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, crc]);
  };
  const png = (...chunks: Buffer[]) =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
  const ihdr = chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));

  it("drops text, time and EXIF chunks of a PNG and keeps the image chunks", async () => {
    const original = png(
      ihdr,
      chunk("tEXt", Buffer.from("Author\0SECRET-AUTHOR")),
      chunk("eXIf", Buffer.from("SECRET-PNG-EXIF")),
      chunk("tIME", Buffer.alloc(7)),
      chunk("pHYs", Buffer.alloc(9)),
      chunk("IDAT", Buffer.from("pixels")),
      chunk("IEND", Buffer.alloc(0)),
    );
    const r = await sanitizeImage(original);
    if (!r.ok) throw new Error(r.error);
    expect(r.mime).toBe("image/png");
    const text = r.data.toString("latin1");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("tEXt");
    expect(text).toContain("IDAT");
    expect(text).toContain("pHYs");
    expect(text.endsWith("IEND\0\0\0\0")).toBe(true);
    expect(r.removed).toEqual(expect.arrayContaining(["tEXt", "eXIf", "tIME"]));
  });

  it("refuses a PNG that stops in the middle of a chunk", async () => {
    const cut = png(ihdr).subarray(0, 20);
    expect(await sanitizeImage(cut)).toMatchObject({ ok: false, error: "Файл повреждён." });
  });

  it("drops the EXIF and XMP chunks of a WebP and fixes the size and the flags", async () => {
    const le = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const wchunk = (type: string, data: Buffer) =>
      Buffer.concat([
        Buffer.from(type, "latin1"),
        le(data.length),
        data,
        data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
      ]);
    const vp8x = Buffer.concat([Buffer.from([0x08 | 0x04 | 0x10]), Buffer.alloc(3), Buffer.from([0, 0, 0, 0, 0, 0])]);
    const body = Buffer.concat([
      Buffer.from("WEBP", "latin1"),
      wchunk("VP8X", vp8x),
      wchunk("VP8 ", Buffer.from("picturedata")),
      wchunk("EXIF", Buffer.from("SECRET-WEBP-EXIF")),
      wchunk("XMP ", Buffer.from("SECRET-WEBP-XMP")),
    ]);
    const original = Buffer.concat([Buffer.from("RIFF", "latin1"), le(body.length), body]);
    const r = await sanitizeImage(original);
    if (!r.ok) throw new Error(r.error);
    expect(r.mime).toBe("image/webp");
    expect(r.data.toString("latin1")).not.toContain("SECRET");
    expect(r.data.readUInt32LE(4)).toBe(r.data.length - 8);
    const flagsAt = r.data.indexOf("VP8X") + 8;
    expect(r.data[flagsAt]).toBe(0x10); // only the alpha bit is left of 0x08 | 0x04 | 0x10
    expect(r.data.toString("latin1")).toContain("picturedata");
  });
});

describe("sanitizeImage: what is not accepted", () => {
  it("refuses other formats, an empty file and files that only pretend", async () => {
    expect(await sanitizeImage(Buffer.alloc(0))).toEqual({ ok: false, error: "Файл пуст." });
    expect(await sanitizeImage(Buffer.from("GIF89a....."))).toMatchObject({
      ok: false,
      error: "Нужен снимок в формате JPEG, PNG или WebP.",
    });
    expect(await sanitizeImage(Buffer.from("%PDF-1.7 SECRET"))).toMatchObject({ ok: false });
    expect(await sanitizeImage(Buffer.from("<svg onload=alert(1)>"))).toMatchObject({ ok: false });
    expect(await sanitizeImage(Buffer.from("MZ\x90\x00 an executable"))).toMatchObject({ ok: false });
  });

  it("hands a format it cannot read (HEIC) to the sharp-based sanitizer when one is installed", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(await sanitizeImage(heic)).toMatchObject({ ok: false, error: "Нужен снимок в формате JPEG, PNG или WebP." });
    const calls: Buffer[] = [];
    const sharp: SharpFactory = (input) => {
      calls.push(input);
      return {
        rotate: () => ({
          toBuffer: async () => ({ data: Buffer.from("clean-jpeg"), info: { format: "jpeg" } }),
        }),
      };
    };
    const r = await sanitizeImage(heic, { fallback: createSharpSanitizer(sharp) });
    expect(r).toMatchObject({ ok: true, mime: "image/jpeg", ext: "jpg" });
    expect(calls).toHaveLength(1);
  });
});

describe("createSharpSanitizer", () => {
  it("re-encodes with the turn applied and no metadata; a failure of sharp is a refusal, not a crash", async () => {
    const ok = createSharpSanitizer(() => ({
      rotate: () => ({ toBuffer: async () => ({ data: Buffer.from("png-bytes"), info: { format: "png" } }) }),
    }));
    expect(await ok(Buffer.from("x"))).toMatchObject({ ok: true, mime: "image/png", ext: "png" });
    const broken = createSharpSanitizer(() => ({
      rotate: () => ({
        toBuffer: async () => {
          throw new Error("Input buffer contains unsupported image format");
        },
      }),
    }));
    expect(await broken(Buffer.from("x"))).toEqual({ ok: false, error: "Файл не удалось прочитать как снимок." });
    const odd = createSharpSanitizer(() => ({
      rotate: () => ({ toBuffer: async () => ({ data: Buffer.from("x"), info: { format: "svg" } }) }),
    }));
    expect(await odd(Buffer.from("x"))).toMatchObject({ ok: false });
  });
});
