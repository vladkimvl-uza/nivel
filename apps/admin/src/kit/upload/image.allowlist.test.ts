// What stays in a picture is what is on a list of allowed things (adversarial review of WP-10): a segment, a chunk or a
// tail that this cleaner does not know is dropped, however harmless its name looks, so that "the data of the shot are
// removed" does not hang on a list of the names that were thought of.
import { describe, expect, it } from "vitest";
import {
  createSharpSanitizer,
  MAX_HEIF_PIXELS,
  MAX_JPEG_PIXELS,
  type SharpFactory,
  type SharpPipeline,
  sanitizeImage,
} from "./image.ts";

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const segment = (marker: number, payload: number[]) => [0xff, marker, ...u16(payload.length + 2), ...payload];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const LEAK = "Exif\0\0SECRET-GPS-LEAK";
const leakBytes = ascii(LEAK);

const TINY_BODY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
).subarray(2);

const jpegWith = (...segments: number[][]): Buffer =>
  Buffer.from([0xff, 0xd8, ...segments.flat(), ...TINY_BODY, 0xff, 0xd9]);

const JFIF = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

/** A colour profile that is one: the size in the header is the size, the signature is in place. */
function iccProfile(extra = 0): Buffer {
  const profile = Buffer.alloc(128 + extra);
  profile.writeUInt32BE(profile.length, 0);
  profile.write("acsp", 36, "latin1");
  return profile;
}
const iccSegment = (profile: Buffer, seq = 1, count = 1) =>
  segment(0xe2, [...ascii("ICC_PROFILE"), 0, seq, count, ...profile]);

async function clean(data: Buffer) {
  const r = await sanitizeImage(data);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const textOf = (b: Buffer) => b.toString("latin1");

describe("JPEG: only what is on the list stays", () => {
  it.each([
    ["APP14 that is not Adobe", 0xee],
    ["APP14 Adobe with a tail", 0xee],
    ["JPG11", 0xfb],
    ["JPG0", 0xf0],
    ["a reserved marker", 0x02],
    ["a reserved marker below the frame headers", 0xbf],
    ["JPG (C8)", 0xc8],
    ["DNL before the first scan", 0xdc],
    ["a hierarchical table (DHP)", 0xde],
    ["EXP", 0xdf],
    ["APP15", 0xef],
    ["APP3", 0xe3],
  ])("drops %s with a payload", async (_name, marker) => {
    const payload = marker === 0xee && _name.includes("Adobe") ? [...ascii("Adobe"), ...leakBytes] : leakBytes;
    const r = await clean(jpegWith(JFIF, segment(marker, payload)));
    expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
  });

  it("keeps the frame header, the tables and the scan: the picture still decodes the same way", async () => {
    const original = jpegWith(JFIF);
    const r = await clean(original);
    expect(r.data.equals(original)).toBe(true);
  });

  it("keeps the JFIF header and not a byte of what follows it", async () => {
    const withTail = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, ...leakBytes]);
    const r = await clean(jpegWith(withTail));
    expect(textOf(r.data)).toContain("JFIF");
    expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
    // The header is its 14 bytes: marker, length 16, and the thumbnail size set to zero.
    const at = r.data.indexOf(Buffer.from([0xff, 0xe0]));
    expect(r.data.readUInt16BE(at + 2)).toBe(16);
    expect(r.data[at + 4 + 12]).toBe(0);
    expect(r.data[at + 4 + 13]).toBe(0);
    expect(r.removed).toContain("thumbnail");
  });

  it("drops a JFIF segment that is too short to be one, and a JFXX thumbnail", async () => {
    const r = await clean(
      jpegWith(segment(0xe0, ascii("JFIF\0abc")), segment(0xe0, [...ascii("JFXX"), 0, 0x10, ...leakBytes])),
    );
    expect(textOf(r.data)).not.toContain("JFIF");
    expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
  });

  it("keeps the Adobe colour transform of exactly twelve bytes and drops the same marker with a tail", async () => {
    const adobe = segment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 2]);
    expect(adobe).toHaveLength(16);
    const kept = await clean(jpegWith(JFIF, adobe));
    expect(kept.data.includes(Buffer.from(adobe))).toBe(true);
    const longer = await clean(jpegWith(JFIF, segment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 2, ...leakBytes])));
    expect(textOf(longer.data)).not.toContain("SECRET-GPS-LEAK");
    expect(longer.data.includes(Buffer.from(adobe))).toBe(false);
  });

  it("keeps a colour profile that is one, and drops one that only wears the name", async () => {
    const good = iccProfile();
    const kept = await clean(jpegWith(JFIF, iccSegment(good)));
    expect(kept.data.includes(good)).toBe(true);

    // A tail after the profile (the size in the header is shorter than the segment), a profile that is not one, a piece
    // of a long profile: none of them is kept.
    const tail = Buffer.concat([good, Buffer.from(LEAK, "latin1")]);
    for (const bad of [
      iccSegment(tail),
      segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, ...leakBytes]),
      iccSegment(good, 1, 2),
      iccSegment(good, 2, 2),
    ]) {
      const r = await clean(jpegWith(JFIF, bad));
      expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
      expect(r.data.includes(good)).toBe(false);
    }
  });

  it("drops what a later scan brings that is not a table: APPn, JPGn, reserved markers and comments", async () => {
    const scan = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0x00, 0x56];
    const table = segment(0xdb, [0, 1, 2, 3, 4]);
    const head = jpegWith(JFIF).subarray(0, -2);
    const between = [
      ...segment(0xf0, leakBytes),
      ...segment(0xfb, leakBytes),
      ...segment(0x02, leakBytes),
      ...segment(0xe1, leakBytes),
    ];
    const original = Buffer.concat([head, Buffer.from([...scan, ...table, ...between, ...scan, 0xff, 0xd9])]);
    const r = await clean(original);
    expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
    expect(r.data.includes(Buffer.from(table))).toBe(true);
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r.removed).toContain("other");
  });

  it("is still idempotent after the rules above", async () => {
    const once = await clean(
      jpegWith(JFIF, iccSegment(iccProfile()), segment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 2])),
    );
    const twice = await clean(once.data);
    expect(twice.data.equals(once.data)).toBe(true);
  });
});

const le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const wchunk = (type: string, data: Buffer, pad = 0) =>
  Buffer.concat([
    Buffer.from(type, "latin1"),
    le(data.length),
    data,
    data.length % 2 ? Buffer.alloc(1, pad) : Buffer.alloc(0),
  ]);
const webp = (...chunks: Buffer[]) => {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), le(body.length), body]);
};
const vp8x = (flags: number, reserved = [0, 0, 0]) =>
  Buffer.concat([Buffer.from([flags, ...reserved]), Buffer.from([0, 0, 0, 0, 0, 0])]);

describe("WebP: only what is on the list stays", () => {
  it.each(["GPS ", "Exif", "exif", "EXIF", "XMP ", "xmp ", "ABCD", "meta"])(
    "drops a chunk of type %j",
    async (type) => {
      const r = await clean(
        webp(wchunk("VP8 ", Buffer.from("picturedata")), wchunk(type, Buffer.from(LEAK, "latin1"))),
      );
      expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
      expect(textOf(r.data)).toContain("picturedata");
      expect(r.removed).toContain(type.trim().toLowerCase());
    },
  );

  it("names a dropped chunk with a type that is not plain text as 'other' in the journal", async () => {
    const r = await clean(webp(wchunk("VP8 ", Buffer.from("picturedata")), wchunk("\u0001\u0002ab", Buffer.from("x"))));
    expect(r.removed).toEqual(["other"]);
  });

  it("keeps the frames, the alpha plane and the lossless picture", async () => {
    const r = await clean(
      webp(wchunk("VP8X", vp8x(0x10)), wchunk("ALPH", Buffer.from("alpha")), wchunk("VP8 ", Buffer.from("lossy"))),
    );
    expect(textOf(r.data)).toContain("alpha");
    expect(textOf(r.data)).toContain("lossy");
    const lossless = await clean(webp(wchunk("VP8L", Buffer.from("lossless!"))));
    expect(textOf(lossless.data)).toContain("lossless!");
  });

  it("clears the reserved bytes and bits of the extended header and the filler byte after an odd chunk", async () => {
    const r = await clean(
      webp(
        wchunk("VP8X", vp8x(0xc1 | 0x10 | 0x08, [0x53, 0x45, 0x43])),
        wchunk("VP8 ", Buffer.from("odd"), 0x58 /* a filler byte that is not zero */),
      ),
    );
    const at = r.data.indexOf("VP8X") + 8;
    expect(r.data.subarray(at, at + 4)).toEqual(Buffer.from([0x10, 0, 0, 0]));
    expect(textOf(r.data)).not.toContain("SEC");
    expect(r.data[r.data.length - 1]).toBe(0);
    expect(r.data.readUInt32LE(4)).toBe(r.data.length - 8);
  });

  it("keeps a colour profile that is one and drops one that is not, with its flag", async () => {
    const good = iccProfile();
    const kept = await clean(
      webp(wchunk("VP8X", vp8x(0x20)), wchunk("ICCP", good), wchunk("VP8 ", Buffer.from("pic!"))),
    );
    expect(kept.data.includes(good)).toBe(true);
    expect(kept.data[kept.data.indexOf("VP8X") + 8]).toBe(0x20);

    const bad = await clean(
      webp(
        wchunk("VP8X", vp8x(0x20)),
        wchunk("ICCP", Buffer.from(LEAK, "latin1")),
        wchunk("VP8 ", Buffer.from("pic!")),
      ),
    );
    expect(textOf(bad.data)).not.toContain("SECRET-GPS-LEAK");
    expect(bad.data[bad.data.indexOf("VP8X") + 8]).toBe(0);
    expect(bad.removed).toContain("iccp");
  });

  it("keeps an animation with its frames, and drops what a frame carries besides the picture", async () => {
    const frameHead = Buffer.concat([Buffer.alloc(15), Buffer.from([0xff])]);
    const frame = wchunk(
      "ANMF",
      Buffer.concat([frameHead, wchunk("VP8 ", Buffer.from("frame")), wchunk("EXIF", Buffer.from(LEAK, "latin1"))]),
    );
    const anim = wchunk("ANIM", Buffer.concat([Buffer.alloc(6), Buffer.from(LEAK, "latin1")]));
    const r = await clean(webp(wchunk("VP8X", vp8x(0x02)), anim, frame));
    expect(textOf(r.data)).toContain("frame");
    expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
    const at = r.data.indexOf("ANMF") + 8;
    expect(r.data[at + 15]).toBe(0x03); // the reserved bits of the frame flags are clear
    expect(r.data.readUInt32LE(4)).toBe(r.data.length - 8);
  });

  it("refuses an animation frame that is cut short", async () => {
    const r = await sanitizeImage(webp(wchunk("ANMF", Buffer.from("short"))));
    expect(r.ok).toBe(false);
  });

  it("drops what lies after the RIFF size", async () => {
    const original = Buffer.concat([webp(wchunk("VP8 ", Buffer.from("pic!"))), Buffer.from(LEAK, "latin1")]);
    const r = await clean(original);
    expect(textOf(r.data)).not.toContain("SECRET-GPS-LEAK");
  });
});

/** A stand-in for sharp that records the limit it was given and how many pipelines run at the same time. */
function recordingSharp(state: { limits: number[]; running: number; peak: number }, fail?: string): SharpFactory {
  return (_input, options) => {
    state.limits.push(options.limitInputPixels);
    const pipeline: SharpPipeline = {
      rotate: () => pipeline,
      flatten: () => pipeline,
      jpeg: () => pipeline,
      toBuffer: async () => {
        state.running += 1;
        state.peak = Math.max(state.peak, state.running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.running -= 1;
        if (fail) throw new Error(fail);
        return { data: Buffer.from("clean-jpeg"), info: { format: "jpeg" } };
      },
    };
    return pipeline;
  };
}

const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypavif"), Buffer.alloc(16)]);
const turnedJpeg = () => {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  return jpegWith(JFIF, segment(0xe1, [...ascii("Exif"), 0, 0, ...tiff]));
};

describe("sharp: pixel limits that fit the memory of the container, one picture at a time", () => {
  it("limits a HEIF to 6 megapixels and a JPEG to 12, far under the 50 that took 900 MB", async () => {
    expect(MAX_HEIF_PIXELS).toBe(6_000_000);
    expect(MAX_JPEG_PIXELS).toBe(12_000_000);
    const state = { limits: [] as number[], running: 0, peak: 0 };
    const sharp = createSharpSanitizer(recordingSharp(state));
    await sharp(avif);
    await sharp(turnedJpeg());
    expect(state.limits).toEqual([MAX_HEIF_PIXELS, MAX_JPEG_PIXELS]);
  });

  it("answers a HEIF over the limit with a message that says what to do", async () => {
    const state = { limits: [] as number[], running: 0, peak: 0 };
    const r = await createSharpSanitizer(recordingSharp(state, "Input image exceeds pixel limit"))(avif);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toContain("мегапикселей");
    expect(r.ok ? "" : r.error).toContain("JPEG");
  });

  it("keeps a turned JPEG over the limit by the lossless cleaner (turn tag only) instead of refusing it", async () => {
    const state = { limits: [] as number[], running: 0, peak: 0 };
    const fallback = createSharpSanitizer(recordingSharp(state, "Input image exceeds pixel limit"));
    const r = await sanitizeImage(turnedJpeg(), { fallback });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.toString("latin1")).not.toContain("clean-jpeg");
    expect(r.removed).not.toContain("reencoded");
  });

  it("runs one sharp job at a time, however many pictures arrive together", async () => {
    const state = { limits: [] as number[], running: 0, peak: 0 };
    const sharp = createSharpSanitizer(recordingSharp(state));
    const results = await Promise.all(Array.from({ length: 6 }, () => sharp(avif)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(state.peak).toBe(1);
  });

  it("goes on after a job that failed", async () => {
    const state = { limits: [] as number[], running: 0, peak: 0 };
    const failing = createSharpSanitizer(recordingSharp(state, "boom"));
    const fine = createSharpSanitizer(recordingSharp(state));
    const [bad, good] = await Promise.all([failing(avif), fine(avif)]);
    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
  });
});
