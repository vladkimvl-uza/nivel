import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createSharpSanitizer,
  readJpegOrientation,
  type SharpFactory,
  type SharpPipeline,
  sanitizeImage,
} from "./image.ts";

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
    const table = segment(0xdb, [0, 0xff, 0xd9, ...new Array(62).fill(3)]);
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

  it("drops the colour profile (a block of tags and text that no list can tell from data) and other APP2 data", async () => {
    // A profile as a camera writes it: the size in its header is its size, the signature `acsp` is at byte 36.
    const profile = Buffer.alloc(128);
    profile.writeUInt32BE(profile.length, 0);
    profile.write("acsp", 36, "latin1");
    profile.write("PROFILEBYTES", 100, "latin1");
    const icc = segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, ...profile]);
    const r = await sanitizeImage(jpegWith(JFIF, icc));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain("PROFILEBYTES");
    expect(r.removed).toContain("icc");
    const other = await sanitizeImage(
      jpegWith(JFIF, segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, ...ascii("NOT-A-PROFILE")])),
    );
    if (!other.ok) throw new Error(other.error);
    expect(other.data.toString("latin1")).not.toContain("NOT-A-PROFILE");
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
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
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
    expect(r.data.subarray(-8).toString("hex")).toBe("49454e44ae426082");
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

  it("hands a HEIF file (the brand in `ftyp`) to the sharp-based sanitizer when one is installed", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(await sanitizeImage(heic)).toMatchObject({ ok: false, error: "Нужен снимок в формате JPEG, PNG или WebP." });
    const calls: Buffer[] = [];
    const r = await sanitizeImage(heic, { fallback: createSharpSanitizer(fakeSharp({ calls })) });
    expect(r).toMatchObject({ ok: true, mime: "image/jpeg", ext: "jpg" });
    expect(calls).toHaveLength(1);
  });

  it("sends a JPEG that carries a turn through sharp, so that the file keeps no tag at all", async () => {
    const calls: Buffer[] = [];
    const fallback = createSharpSanitizer(fakeSharp({ calls }));
    const turned = jpegWith(JFIF, segment(0xe1, exifPayload(6)));
    const r = await sanitizeImage(turned, { fallback });
    expect(r).toMatchObject({ ok: true, data: Buffer.from("clean-jpeg") });
    expect(r.ok && r.removed).toEqual(expect.arrayContaining(["exif", "reencoded"]));
    // An upright one stays on the lossless path and does not wake sharp.
    const upright = await sanitizeImage(jpegWith(JFIF, segment(0xe1, exifPayload(1))), { fallback });
    expect(upright.ok && upright.data.equals(Buffer.from("clean-jpeg"))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("keeps the lossless result of a turned JPEG when sharp fails", async () => {
    const fallback = createSharpSanitizer(fakeSharp({ fail: true }));
    const r = await sanitizeImage(jpegWith(JFIF, segment(0xe1, exifPayload(6))), { fallback });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain("SECRET-GPS");
    expect(readJpegOrientation(r.data)).toBe(6);
  });
});

/** A stand-in for sharp that records what it was given and says what the pipeline was asked to do. */
function fakeSharp(opts: { calls?: Buffer[]; fail?: boolean; format?: string; steps?: string[] }): SharpFactory {
  return (input) => {
    opts.calls?.push(input);
    const step = (name: string) => {
      opts.steps?.push(name);
      return pipeline;
    };
    const pipeline: SharpPipeline = {
      rotate: () => step("rotate"),
      flatten: () => step("flatten"),
      jpeg: () => step("jpeg"),
      toBuffer: async () => {
        if (opts.fail) throw new Error("Input buffer contains unsupported image format");
        return { data: Buffer.from("clean-jpeg"), info: { format: opts.format ?? "jpeg" } };
      },
    };
    return pipeline;
  };
}

describe("createSharpSanitizer", () => {
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
  const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypavif"), Buffer.alloc(16)]);

  it("turns, flattens and writes a JPEG in this order, whatever the format of the input was", async () => {
    const steps: string[] = [];
    expect(await createSharpSanitizer(fakeSharp({ steps }))(heic)).toMatchObject({
      ok: true,
      mime: "image/jpeg",
      ext: "jpg",
      removed: ["reencoded"],
    });
    expect(steps).toEqual(["rotate", "flatten", "jpeg"]);
  });

  it("refuses a failure of sharp, a result that is not a JPEG, and files of other kinds, without crashing", async () => {
    expect(await createSharpSanitizer(fakeSharp({ fail: true }))(avif)).toEqual({
      ok: false,
      error: "Файл не удалось прочитать как снимок.",
    });
    const hevc = await createSharpSanitizer(fakeSharp({ fail: true }))(heic);
    expect(hevc.ok ? "" : hevc.error).toContain("JPEG");
    expect(await createSharpSanitizer(fakeSharp({ format: "heif" }))(heic)).toMatchObject({ ok: false });
    for (const other of ["GIF89a....", "<svg/>", "II*\0....", "%PDF-1.7"]) {
      expect(await createSharpSanitizer(fakeSharp({}))(Buffer.from(other, "latin1"))).toEqual({
        ok: false,
        error: "Нужен снимок в формате JPEG, PNG или WebP.",
      });
    }
  });
});

describe("sanitizeImage: files built to hurt (broken structure, millions of tiny parts)", () => {
  const SECRET = "SECRET-GPS-41.2995N";

  it("does not keep a metadata tail behind a segment with a broken length (zero)", async () => {
    const hostile = Buffer.from([
      0xff,
      0xd8,
      ...JFIF,
      ...TINY_BODY,
      0xff,
      0xe1,
      0,
      0,
      ...exifPayload(1),
      ...ascii(SECRET),
    ]);
    const r = await sanitizeImage(hostile);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain(SECRET);
    expect(r.data.toString("latin1")).not.toContain("Exif");
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r.removed).toContain("trailer");
  });

  it("does not keep a metadata tail behind a segment whose length runs past the end of the file", async () => {
    const hostile = Buffer.from([
      0xff,
      0xd8,
      ...JFIF,
      ...TINY_BODY,
      0xff,
      0xe1,
      0xff,
      0xff,
      ...exifPayload(1),
      ...ascii(SECRET),
    ]);
    const r = await sanitizeImage(hostile);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain(SECRET);
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("does not keep a marker that is cut off at the very end", async () => {
    const hostile = Buffer.from([0xff, 0xd8, ...JFIF, ...TINY_BODY, 0xff, 0xe1, 0x00]);
    const r = await sanitizeImage(hostile);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain("\xff\xe1");
  });

  it("refuses a JPEG with hundreds of segments before the picture (a real one has a few dozen)", async () => {
    const comments = Array.from({ length: 300 }, () => segment(0xfe, [0x41]));
    expect(await sanitizeImage(jpegWith(JFIF, ...comments))).toEqual({ ok: false, error: "Файл повреждён." });
  });

  it("refuses a JPEG that cuts thousands of metadata segments out of its scan data", async () => {
    const piece = [0x00, 0xff, 0xfe, 0x00, 0x02];
    const many = Buffer.from(Array.from({ length: 6000 }, () => piece).flat());
    const hostile = Buffer.concat([Buffer.from([0xff, 0xd8, ...JFIF]), TINY_BODY, many, Buffer.from([0xff, 0xd9])]);
    expect(await sanitizeImage(hostile)).toEqual({ ok: false, error: "Файл повреждён." });
  });

  it("refuses a PNG and a WebP made of tens of thousands of empty chunks", async () => {
    const crc = Buffer.alloc(4);
    const pngChunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, "latin1"), data, crc]);
    };
    const ihdr = pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
    const idat = pngChunk("IDAT", Buffer.alloc(0));
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr,
      ...Array.from({ length: 30_000 }, () => idat),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(await sanitizeImage(png)).toEqual({ ok: false, error: "Файл повреждён." });

    const wchunk = Buffer.concat([Buffer.from("JUNK", "latin1"), Buffer.alloc(4)]);
    const inner = Buffer.concat([Buffer.from("WEBP", "latin1"), ...Array.from({ length: 30_000 }, () => wchunk)]);
    const head = Buffer.alloc(8);
    head.write("RIFF", 0, "latin1");
    head.writeUInt32LE(inner.length, 4);
    expect(await sanitizeImage(Buffer.concat([head, inner]))).toEqual({ ok: false, error: "Файл повреждён." });
  });
});
