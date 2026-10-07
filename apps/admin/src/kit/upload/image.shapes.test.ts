// Second adversarial round on the cleaners of pictures: what is kept must have the shape of what it claims to be. A
// segment or a chunk that is on the list of allowed names but is longer than its structure, comes twice, stands in the
// wrong place or carries a colour profile is not a way to carry data through. (What cannot be seen without decoding the
// picture, the bytes inside the entropy-coded data and the tail of the last partition of a frame, is left as it is, and
// said so in image.ts.)
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sanitizeImage } from "./image.ts";

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const segment = (marker: number, payload: number[]) => [0xff, marker, ...u16(payload.length + 2), ...payload];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const SECRET = "GPSLatitude=41.311081 GPSLongitude=69.240562 SECRET";
const secret = ascii(SECRET);
const textOf = (b: Buffer) => b.toString("latin1");

/** The result carries no trace of the secret, whether the file was cleaned or refused. */
async function leaks(data: Buffer): Promise<boolean> {
  const r = await sanitizeImage(data);
  return r.ok && textOf(r.data).includes("SECRET");
}
async function clean(data: Buffer) {
  const r = await sanitizeImage(data);
  if (!r.ok) throw new Error(r.error);
  return r;
}

// ---- JPEG -----------------------------------------------------------------------------------------------------------

// SOI is not in it; DQT, SOF2, DHT and the scan header are, each of exactly the shape of its structure.
const TINY_BODY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
).subarray(2);
const JFIF = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
/** The picture of the tests with `head` before its frame and `beforeEoi` between its scan and the closing marker. */
const jpegWithTail = (head: number[][], beforeEoi: number[]) =>
  Buffer.from([0xff, 0xd8, ...head.flat(), ...TINY_BODY, ...beforeEoi, 0xff, 0xd9]);

describe("JPEG: a kept segment has the shape of its structure and nothing more", () => {
  it("keeps the picture of the tests as it is (the shapes below are what such a file has)", async () => {
    const original = jpegWithTail([JFIF], []);
    expect((await clean(original)).data.equals(original)).toBe(true);
  });

  it("keeps a number of lines (DNL) of its four bytes between the scan and the end, and nothing that is longer", async () => {
    const dnl = segment(0xdc, [0, 1]);
    const kept = await clean(jpegWithTail([JFIF], dnl));
    expect(kept.data.includes(Buffer.from(dnl))).toBe(true);
    expect(await leaks(jpegWithTail([JFIF], segment(0xdc, secret)))).toBe(false);
    expect(await leaks(jpegWithTail([JFIF], segment(0xdc, [0, 1, ...secret])))).toBe(false);
  });

  it("does not let an arithmetic-coding table (DAC) carry text, in the header or between scans", async () => {
    expect(await leaks(jpegWithTail([JFIF, segment(0xcc, secret)], []))).toBe(false);
    expect(await leaks(jpegWithTail([JFIF], segment(0xcc, secret)))).toBe(false);
    const ok = segment(0xcc, [0x00, 0x10, 0x10, 0x05]);
    expect((await clean(jpegWithTail([JFIF, ok], []))).data.includes(Buffer.from(ok))).toBe(true);
  });

  it("does not let a restart interval (DRI) carry more than its two bytes", async () => {
    expect(await leaks(jpegWithTail([JFIF, segment(0xdd, [0, 8, ...secret])], []))).toBe(false);
    const ok = segment(0xdd, [0, 8]);
    expect((await clean(jpegWithTail([JFIF, ok], []))).data.includes(Buffer.from(ok))).toBe(true);
  });

  it("refuses quantization and Huffman tables, a frame header and a scan header that have a tail", async () => {
    expect(await leaks(jpegWithTail([JFIF, segment(0xdb, [0, ...new Array(64).fill(1), ...secret])], []))).toBe(false);
    expect(
      await leaks(jpegWithTail([JFIF, segment(0xc4, [0x00, 1, ...new Array(15).fill(0), 7, ...secret])], [])),
    ).toBe(false);
    expect(await leaks(jpegWithTail([JFIF, segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0, ...secret])], []))).toBe(false);
    // A table between scans.
    expect(await leaks(jpegWithTail([JFIF], segment(0xdb, [0, ...new Array(64).fill(1), ...secret])))).toBe(false);
    // The scan header of the first scan: the tiny picture has its own, here one is made with a tail.
    const head = Buffer.from([
      0xff,
      0xd8,
      ...JFIF,
      ...TINY_BODY.subarray(0, TINY_BODY.indexOf(Buffer.from([0xff, 0xda]))),
    ]);
    const tailed = Buffer.concat([
      head,
      Buffer.from([...segment(0xda, [1, 1, 0, 1, 0x3f, 0x10, ...secret]), 0x12, 0xff, 0xd9]),
    ]);
    expect(await leaks(tailed)).toBe(false);
  });

  it("keeps one JFIF header and one Adobe segment, and drops the repeats (each repeat had room for seven bytes)", async () => {
    const many = Array.from({ length: 50 }, (_, i) => segment(0xe0, [...ascii("JFIF"), 0, 1, 2, 0, i, 0, 9, 0, 0]));
    const r = await clean(jpegWithTail([JFIF, ...many], []));
    expect(textOf(r.data).split("JFIF").length - 1).toBe(1);
    const adobe = (n: number) => segment(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, n, 2]);
    const adobes = await clean(jpegWithTail([JFIF, adobe(1), adobe(2), adobe(3)], []));
    expect(textOf(adobes.data).split("Adobe").length - 1).toBe(1);
  });

  it("drops a colour profile: the profile is a block of tags and text that no list can tell from data", async () => {
    // A profile that is one by its header, with a private tag that holds the text.
    const profile = Buffer.alloc(128 + 4 + 12 + 80);
    profile.writeUInt32BE(profile.length, 0);
    profile.write("acsp", 36, "latin1");
    profile.writeUInt32BE(1, 128);
    profile.write("priv", 132, "latin1");
    profile.writeUInt32BE(128 + 4 + 12, 136);
    profile.writeUInt32BE(80, 140);
    profile.write(SECRET, 128 + 4 + 12, "latin1");
    const icc = segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, ...profile]);
    const r = await clean(jpegWithTail([JFIF, icc], []));
    expect(textOf(r.data)).not.toContain("SECRET");
    expect(r.removed).toContain("icc");
  });
});

// ---- PNG ------------------------------------------------------------------------------------------------------------

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type: string, data: Buffer, badCrc = false): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((crc32(body) ^ (badCrc ? 1 : 0)) >>> 0);
  return Buffer.concat([head, body, crc]);
}
function ihdr(colour = 2, depth = 8): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(1, 0);
  data.writeUInt32BE(1, 4);
  data[8] = depth;
  data[9] = colour;
  return chunk("IHDR", data);
}
const idat = (colour = 2) => {
  const samples = colour === 2 ? 3 : colour === 6 ? 4 : colour === 4 ? 2 : 1;
  return chunk("IDAT", deflateSync(Buffer.alloc(1 + samples)));
};
const iend = chunk("IEND", Buffer.alloc(0));
const png = (...chunks: Buffer[]) => Buffer.concat([SIGNATURE, ...chunks]);
const padded = (size: number) => Buffer.concat([Buffer.from(SECRET, "latin1"), Buffer.alloc(100)]).subarray(0, size);

describe("PNG: a kept chunk has the length and the place of its kind, and a right checksum", () => {
  it("keeps the service chunks of the right length and in their place", async () => {
    const chunks = [
      chunk("gAMA", Buffer.alloc(4, 1)),
      chunk("cHRM", Buffer.alloc(32, 2)),
      chunk("sRGB", Buffer.from([0])),
      chunk("sBIT", Buffer.from([8, 8, 8])),
      chunk("bKGD", Buffer.alloc(6, 0)),
      chunk("pHYs", Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
      chunk("tRNS", Buffer.alloc(6, 0)),
    ];
    const original = png(ihdr(), ...chunks, idat(), iend);
    const r = await clean(original);
    expect(r.data.equals(original)).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it.each([
    ["gAMA", 4],
    ["cHRM", 32],
    ["sRGB", 1],
    ["sBIT", 3],
    ["bKGD", 6],
    ["pHYs", 9],
    ["tRNS", 6],
  ])("drops %s that is longer than its structure, with text in the rest", async (type, size) => {
    const data = padded(size + 60);
    const r = await clean(png(ihdr(), chunk(type, data), idat(), iend));
    expect(textOf(r.data)).not.toContain("SECRET");
    expect(r.removed).toContain(type);
  });

  it("drops the service chunks that are shorter than their structure", async () => {
    const r = await clean(png(ihdr(), chunk("gAMA", Buffer.alloc(3)), chunk("pHYs", Buffer.alloc(8)), idat(), iend));
    expect(r.removed).toEqual(expect.arrayContaining(["gAMA", "pHYs"]));
  });

  it("keeps the first of two chunks of one kind and drops the second (no kind comes twice)", async () => {
    const r = await clean(
      png(
        ihdr(),
        chunk("gAMA", Buffer.alloc(4, 1)),
        chunk("gAMA", padded(4)),
        chunk("pHYs", Buffer.alloc(9)),
        chunk("pHYs", padded(9)),
        idat(),
        iend,
      ),
    );
    expect(textOf(r.data).split("gAMA").length - 1).toBe(1);
    expect(textOf(r.data).split("pHYs").length - 1).toBe(1);
    expect(textOf(r.data)).not.toContain("SECRET");
  });

  it("drops the service chunks that stand after the picture data, or that need a palette that is not there", async () => {
    const after = await clean(png(ihdr(), idat(), chunk("gAMA", padded(4)), chunk("pHYs", padded(9)), iend));
    expect(textOf(after.data)).not.toContain("SECRET");
    expect(after.removed).toEqual(expect.arrayContaining(["gAMA", "pHYs"]));

    // Colour type 3 (palette): tRNS and bKGD without a palette before them, and sBIT after it, are out of place.
    const palette = chunk("PLTE", Buffer.alloc(6));
    const indexed = await clean(
      png(
        ihdr(3),
        chunk("tRNS", Buffer.from([255])),
        palette,
        chunk("sBIT", Buffer.from([8, 8, 8])),
        chunk("bKGD", Buffer.from([1])),
        chunk("tRNS", Buffer.from([255, 128])),
        idat(3),
        iend,
      ),
    );
    expect(indexed.removed).toEqual(expect.arrayContaining(["tRNS", "sBIT"]));
    expect(textOf(indexed.data).split("bKGD").length - 1).toBe(1);
    expect(textOf(indexed.data).split("tRNS").length - 1).toBe(1);
  });

  it("drops a tRNS of more entries than the palette has, and a palette that is not a palette", async () => {
    const r = await clean(png(ihdr(3), chunk("PLTE", Buffer.alloc(6)), chunk("tRNS", padded(40)), idat(3), iend));
    expect(textOf(r.data)).not.toContain("SECRET");
    const odd = await sanitizeImage(png(ihdr(3), chunk("PLTE", padded(7)), idat(3), iend));
    expect(odd.ok ? textOf(odd.data) : "").not.toContain("SECRET");
  });

  it("drops a chunk whose checksum is wrong, and refuses a picture whose data does not match its checksum", async () => {
    const r = await clean(png(ihdr(), chunk("gAMA", Buffer.alloc(4, 1), true), idat(), iend));
    expect(r.removed).toContain("gAMA");
    expect((await sanitizeImage(png(ihdr(), chunk("IDAT", deflateSync(Buffer.alloc(4)), true), iend))).ok).toBe(false);
  });

  it("drops every colour profile (iCCP), whatever is inside", async () => {
    const profile = Buffer.alloc(128);
    profile.writeUInt32BE(128, 0);
    profile.write("acsp", 36, "latin1");
    const iccp = chunk(
      "iCCP",
      Buffer.concat([Buffer.from("name\0\0", "latin1"), deflateSync(Buffer.concat([profile, Buffer.from(SECRET)]))]),
    );
    const r = await clean(png(ihdr(), iccp, idat(), iend));
    expect(r.removed).toContain("iCCP");
    expect(r.data.includes(Buffer.from("iCCP"))).toBe(false);
  });

  it("refuses a header that is not 13 bytes", async () => {
    expect((await sanitizeImage(png(chunk("IHDR", padded(40)), idat(), iend))).ok).toBe(false);
  });
});

// ---- WebP -----------------------------------------------------------------------------------------------------------

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
const webp = (...chunks: Buffer[]) => {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), le(body.length), body]);
};
const vp8x = (flags: number) => Buffer.concat([Buffer.from([flags, 0, 0, 0]), Buffer.alloc(6)]);
const hidden = Buffer.from(SECRET, "latin1");
const count = (data: Buffer, type: string) => textOf(data).split(type).length - 1;

describe("WebP: one picture, in its place, and no colour profile", () => {
  it("keeps the first picture of a simple file and drops a second one, of either kind, with whatever it carries", async () => {
    for (const extra of ["VP8 ", "VP8L"]) {
      const r = await clean(webp(wchunk("VP8 ", Buffer.from("picture")), wchunk(extra, hidden)));
      expect(textOf(r.data)).not.toContain("SECRET");
      expect(textOf(r.data)).toContain("picture");
    }
    const lossless = await clean(webp(wchunk("VP8L", Buffer.from("lossless")), wchunk("VP8L", hidden)));
    expect(textOf(lossless.data)).not.toContain("SECRET");
  });

  it("keeps an alpha plane only once, before a lossy picture", async () => {
    const good = await clean(
      webp(wchunk("VP8X", vp8x(0x10)), wchunk("ALPH", Buffer.from("alpha")), wchunk("VP8 ", Buffer.from("lossy"))),
    );
    expect(textOf(good.data)).toContain("alpha");
    for (const order of [
      [wchunk("ALPH", Buffer.from("alpha")), wchunk("ALPH", hidden), wchunk("VP8 ", Buffer.from("lossy"))],
      [wchunk("VP8 ", Buffer.from("lossy")), wchunk("ALPH", hidden)],
      [wchunk("ALPH", hidden), wchunk("VP8L", Buffer.from("lossless"))],
    ]) {
      const r = await clean(webp(wchunk("VP8X", vp8x(0x10)), ...order));
      expect(textOf(r.data)).not.toContain("SECRET");
    }
  });

  it("keeps the extended header once, and only first", async () => {
    const r = await clean(
      webp(wchunk("VP8X", vp8x(0x10)), wchunk("VP8 ", Buffer.from("pic!")), wchunk("VP8X", vp8x(0x10))),
    );
    expect(count(r.data, "VP8X")).toBe(1);
    const late = await clean(webp(wchunk("VP8 ", Buffer.from("pic!")), wchunk("VP8X", hidden)));
    expect(count(late.data, "VP8X")).toBe(0);
    expect(textOf(late.data)).not.toContain("SECRET");
  });

  it("keeps one animation header and the frames, one picture in each, and drops the rest", async () => {
    const head = Buffer.concat([Buffer.alloc(15), Buffer.from([0xff])]);
    const frame = (...inner: Buffer[]) => wchunk("ANMF", Buffer.concat([head, ...inner]));
    const r = await clean(
      webp(
        wchunk("VP8X", vp8x(0x02)),
        wchunk("ANIM", Buffer.alloc(6)),
        wchunk("ANIM", Buffer.concat([Buffer.alloc(6, 1), hidden])),
        frame(wchunk("VP8 ", Buffer.from("frame1")), wchunk("VP8 ", hidden), wchunk("VP8L", hidden)),
        frame(wchunk("ALPH", Buffer.from("a2")), wchunk("VP8 ", Buffer.from("frame2")), wchunk("ALPH", hidden)),
        wchunk("VP8 ", hidden),
      ),
    );
    expect(textOf(r.data)).not.toContain("SECRET");
    expect(count(r.data, "ANIM")).toBe(1);
    expect(count(r.data, "ANMF")).toBe(2);
    expect(textOf(r.data)).toContain("frame1");
    expect(textOf(r.data)).toContain("frame2");
  });

  it("drops a picture that stands beside frames, and frames that stand beside a picture", async () => {
    const head = Buffer.concat([Buffer.alloc(15), Buffer.from([0xff])]);
    const r = await clean(
      webp(
        wchunk("VP8X", vp8x(0x02)),
        wchunk("VP8 ", Buffer.from("still")),
        wchunk("ANMF", Buffer.concat([head, wchunk("VP8 ", hidden)])),
      ),
    );
    expect(textOf(r.data)).not.toContain("SECRET");
  });

  it("drops every colour profile, with its flag, whatever it holds", async () => {
    const profile = Buffer.alloc(128 + 80);
    profile.writeUInt32BE(profile.length, 0);
    profile.write("acsp", 36, "latin1");
    profile.write(SECRET, 128, "latin1");
    const r = await clean(
      webp(wchunk("VP8X", vp8x(0x20)), wchunk("ICCP", profile), wchunk("VP8 ", Buffer.from("pic!"))),
    );
    expect(textOf(r.data)).not.toContain("SECRET");
    expect(r.data[r.data.indexOf("VP8X") + 8]).toBe(0);
    expect(r.removed).toContain("iccp");
  });
});
