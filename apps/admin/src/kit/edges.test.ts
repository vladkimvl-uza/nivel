// Edge cases of the small helpers: what a damaged, odd or hostile input does.
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openSecret, parseDataKey, parseRecoveryInput, sealSecret } from "../auth/secrets.ts";
import { base32Decode, findTotpStep, generateTotp, otpauthUri, verifyTotp } from "../auth/totp.ts";
import { createCatalogResource } from "./catalog/resource.ts";
import { describeSchema, findNode } from "./schema.ts";
import { MemoryCatalogStore } from "./test-support/fake-app.ts";
import { readJpegOrientation, sanitizeImage } from "./upload/image.ts";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const seg = (marker: number, payload: number[]) => [0xff, marker, ...u16(payload.length + 2), ...payload];
const TINY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const jpeg = (...parts: number[][]) => Buffer.from([0xff, 0xd8, ...parts.flat(), ...TINY.subarray(2), 0xff, 0xd9]);

describe("jpeg odd shapes", () => {
  it("reads a little-endian EXIF and refuses a broken one without failing the whole file", () => {
    const le = [
      ...ascii("Exif"),
      0,
      0,
      ...ascii("II"),
      42,
      0,
      8,
      0,
      0,
      0,
      1,
      0,
      0x12,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      8,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    expect(readJpegOrientation(jpeg(seg(0xe1, le)))).toBe(8);
    const badMagic = [...ascii("Exif"), 0, 0, ...ascii("II"), 43, 0, 8, 0, 0, 0];
    expect(readJpegOrientation(jpeg(seg(0xe1, badMagic)))).toBeNull();
    const badOrder = [...ascii("Exif"), 0, 0, ...ascii("XX"), 0, 42, 0, 0, 0, 8];
    expect(readJpegOrientation(jpeg(seg(0xe1, badOrder)))).toBeNull();
    const short = [...ascii("Exif"), 0, 0, ...ascii("MM"), 0, 42];
    expect(readJpegOrientation(jpeg(seg(0xe1, short)))).toBeNull();
    const outside = [...ascii("Exif"), 0, 0, ...ascii("MM"), 0, 42, 0, 0, 255, 255];
    expect(readJpegOrientation(jpeg(seg(0xe1, outside)))).toBeNull();
    const weird = [
      ...ascii("Exif"),
      0,
      0,
      ...ascii("MM"),
      0,
      42,
      0,
      0,
      0,
      8,
      0,
      1,
      0x01,
      0x12,
      0,
      3,
      0,
      0,
      0,
      1,
      0,
      9,
      0,
      0,
      0,
      0,
      0,
      0,
    ];
    expect(readJpegOrientation(jpeg(seg(0xe1, weird)))).toBeNull(); // 9 is not an orientation
    expect(readJpegOrientation(Buffer.from("not a jpeg"))).toBeNull();
    expect(readJpegOrientation(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("keeps the Adobe segment, drops thumbnails of JFXX, odd APPs and an APP1 that is neither EXIF nor XMP", async () => {
    const r = await sanitizeImage(
      jpeg(
        seg(0xe0, [...ascii("JFXX"), 0, 0x10, ...ascii("THUMBNAIL-BYTES")]),
        seg(0xe1, ascii("something else")),
        seg(0xe2, ascii("FPXR-thing")),
        seg(0xe3, ascii("APP3-data")),
        seg(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 1]),
        seg(0xef, ascii("APP15")),
      ),
    );
    if (!r.ok) throw new Error(r.error);
    const text = r.data.toString("latin1");
    expect(text).toContain("Adobe");
    for (const gone of ["THUMBNAIL", "something else", "FPXR", "APP3-data", "APP15"]) expect(text).not.toContain(gone);
    expect(r.removed).toEqual(expect.arrayContaining(["thumbnail", "app1", "app2", "app"]));
  });

  it("copes with fill bytes and standalone markers before the scan, and refuses an image that ends before it", async () => {
    const withFill = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xff,
      0xfe,
      0,
      4,
      65,
      66,
      0xff,
      0x01,
      ...TINY.subarray(2),
      0xff,
      0xd9,
    ]);
    const r = await sanitizeImage(withFill);
    expect(r.ok).toBe(true);
    expect(await sanitizeImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toMatchObject({ ok: false });
    expect(await sanitizeImage(Buffer.from([0xff, 0xd8, 0x12, 0x34]))).toMatchObject({ ok: false });
    expect(await sanitizeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01]))).toMatchObject({ ok: false });
  });
});

describe("png and webp that are damaged", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data = Buffer.alloc(0)) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };

  it("a PNG must start with IHDR and end with IEND", async () => {
    expect(await sanitizeImage(Buffer.concat([sig, chunk("IDAT")]))).toMatchObject({
      ok: false,
      error: "Файл повреждён.",
    });
    expect(await sanitizeImage(Buffer.concat([sig, chunk("IHDR", Buffer.alloc(13)), chunk("IDAT")]))).toMatchObject({
      ok: false,
    });
    expect(await sanitizeImage(sig)).toMatchObject({ ok: false });
  });

  it("a WebP with a wrong size or without chunks is refused", async () => {
    const riff = (size: number, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.write("RIFF", 0, "latin1");
      head.writeUInt32LE(size, 4);
      return Buffer.concat([head, Buffer.from("WEBP", "latin1"), body]);
    };
    expect(await sanitizeImage(riff(9999, Buffer.alloc(8)))).toMatchObject({ ok: false });
    expect(await sanitizeImage(riff(4, Buffer.alloc(0)))).toMatchObject({ ok: false });
    const chunkHead = Buffer.alloc(8);
    chunkHead.write("VP8 ", 0, "latin1");
    chunkHead.writeUInt32LE(100, 4); // longer than the file
    expect(await sanitizeImage(riff(12, chunkHead))).toMatchObject({ ok: false });
    expect(await sanitizeImage(riff(7, Buffer.alloc(3)))).toMatchObject({ ok: false });
  });
});

describe("sealed secrets that are damaged", () => {
  const key = parseDataKey(randomBytes(32).toString("base64"));

  it("refuses a value that decrypts to something that is not a bundle", () => {
    const seal = (plain: string, id: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(id));
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        body.toString("base64url"),
      ].join(".");
    };
    expect(openSecret(seal("not json", "a"), key, "a")).toBeNull();
    expect(openSecret(seal("null", "a"), key, "a")).toBeNull();
    expect(openSecret(seal(JSON.stringify({ v: 2, secret: "x", recovery: [] }), "a"), key, "a")).toBeNull();
    expect(openSecret(seal(JSON.stringify({ v: 1, secret: "x", recovery: [1] }), "a"), key, "a")).toBeNull();
    expect(
      openSecret(seal(JSON.stringify({ v: 1, secret: "x", recovery: [], lastStep: "5" }), "a"), key, "a"),
    ).toBeNull();
    expect(openSecret(seal(JSON.stringify({ v: 1, secret: "x", recovery: [], lastStep: 5 }), "a"), key, "a")).toEqual({
      v: 1,
      secret: "x",
      recovery: [],
      lastStep: 5,
    });
    expect(openSecret(sealSecret({ v: 1, secret: "x", recovery: [] }, key, "a"), key, "a")).toMatchObject({
      secret: "x",
    });
  });

  it("knows a recovery code by its shape only", () => {
    expect(parseRecoveryInput("ABCDE FGHJK")).toBe("abcde-fghjk");
    expect(parseRecoveryInput("abcde-fghj0")).toBeNull(); // 0 is not in the alphabet
    expect(parseRecoveryInput("123456")).toBeNull();
    expect(parseRecoveryInput("")).toBeNull();
  });
});

describe("totp edges", () => {
  const key = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  it("works with other periods and digits, and finds the step it matched", () => {
    const at = new Date(1_800_000_000_000);
    const code = generateTotp(key, at, { period: 60, digits: 8 });
    expect(code).toHaveLength(8);
    expect(findTotpStep(key, code, at, { period: 60, digits: 8 })).toBe(Math.floor(1_800_000_000 / 60));
    expect(findTotpStep(key, "00000000", at, { period: 60, digits: 8 })).toBeNull();
    expect(verifyTotp(key, generateTotp(key, at), new Date(at.getTime() + 30_000), { window: 0 })).toBe(false);
    expect(otpauthUri({ secret: key, account: "a b@c", issuer: "N" })).toContain("a%20b%40c");
  });
});

describe("catalog form conditions", () => {
  const catalog = createCatalogResource(new MemoryCatalogStore(), { append: async () => {} });

  it("an SSD: the PCIe generation unless it is SATA, the heatsink only for M.2 or an unknown form", () => {
    const ssd = (spec: Record<string, unknown>) => ({ category: "ssd", spec });
    expect(catalog.visible(["spec", "pcieGen"], ssd({ iface: "nvme" }))).toBe(true);
    expect(catalog.visible(["spec", "pcieGen"], ssd({ iface: null }))).toBe(true);
    expect(catalog.visible(["spec", "pcieGen"], ssd({ iface: "sata" }))).toBe(false);
    expect(catalog.visible(["spec", "heatsinkHeightMm"], ssd({ formFactor: "M.2-2280" }))).toBe(true);
    expect(catalog.visible(["spec", "heatsinkHeightMm"], ssd({ formFactor: null }))).toBe(true);
    expect(catalog.visible(["spec", "heatsinkHeightMm"], ssd({ formFactor: "2.5" }))).toBe(false);
    expect(catalog.visible(["spec", "heatsinkHeightMm"], { category: "cpu", spec: {} })).toBe(true);
    expect(catalog.hiddenNames(ssd({ iface: "sata", formFactor: "2.5" }))).toEqual(
      expect.arrayContaining(["status", "isDemo", "spec.pcieGen", "spec.heatsinkHeightMm"]),
    );
  });
});

describe("schema walk edges", () => {
  it("a lazy or custom schema is JSON; a nullable array of selects stays a list; a union of mixed things is JSON", () => {
    const node = describeSchema(
      z.object({
        custom: z.custom<string>(() => true),
        picks: z.array(z.enum(["a", "b"]).nullable()),
        bad: z.union([z.object({ a: z.string() }), z.string()]),
        list: z.array(z.array(z.string())),
        n: z.number().int().lt(10).gt(0),
      }),
    );
    const kinds = Object.fromEntries((node.children ?? []).map((c) => [c.key, c.kind]));
    expect(kinds).toMatchObject({ custom: "json", picks: "json", bad: "json", list: "json", n: "integer" });
    expect((node.children ?? []).find((c) => c.key === "n")).toMatchObject({ min: 1, max: 9 });
    expect(findNode(node, ["nope"])).toBeNull();
    expect(findNode(node, ["n", "deeper"])).toBeNull();
  });

  it("describes a transform pipe by its input or output, and a default value as optional", () => {
    const node = describeSchema(
      z.object({
        a: z.string().transform((s) => s.length),
        b: z.string().default("x"),
        c: z.string().describe("hint"),
      }),
    );
    expect(node.children?.map((c) => [c.key, c.kind, c.optional])).toEqual([
      ["a", "text", false],
      ["b", "text", true],
      ["c", "text", false],
    ]);
    expect(node.children?.[2]?.description).toBe("hint");
  });
});
