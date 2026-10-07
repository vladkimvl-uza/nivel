// sharp on real files: a small JPEG and a small AVIF (the HEIF family) with a position, a maker, an XMP creator and a
// Display P3 profile, uploaded the way the admin does it. The tests of the loader run everywhere; the tests on real
// bytes need the native build of sharp, and when it does not load on the machine they are marked as skipped WITH the
// reason (never skipped silently).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuditSink } from "../../auth/audit.ts";
import type { SessionUser } from "../../auth/service.ts";
import { createLazySharpSanitizer, createSharpSanitizer, sanitizeImage } from "./image.ts";
import { type FileRegistry, type FileSink, saveUpload } from "./save.ts";

type Sharp = typeof import("sharp").default;

const fixture = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name));

const loaded: { sharp: Sharp } | { reason: string } = await import("sharp").then(
  (m) => ({ sharp: m.default }),
  (error: unknown) => ({ reason: `sharp did not load in this environment: ${String(error)}` }),
);
const needSharp = (ctx: { skip(note?: string): never }): Sharp => {
  if ("reason" in loaded) ctx.skip(loaded.reason);
  return loaded.sharp;
};

const assistant: SessionUser = {
  id: "a1",
  email: "a@nivel.uz",
  role: "assistant",
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
};

function uploadDeps(sharp: Sharp) {
  const stored = new Map<string, Buffer>();
  const files: FileSink = { put: async (key, data) => void stored.set(key, data) };
  const registry: FileRegistry = { register: async () => ({ id: "f1", duplicate: false }) };
  const audit: AuditSink = { append: async () => {} };
  const fallback = createSharpSanitizer(sharp);
  return { stored, deps: { files, registry, audit, fallback } };
}

async function uploaded(sharp: Sharp, bytes: Buffer, kind = "receipt") {
  const { stored, deps } = uploadDeps(sharp);
  const result = await saveUpload(deps, { actor: assistant, bytes, kind });
  if (!result.ok) throw new Error(result.error);
  const [data] = [...stored.values()];
  if (!data) throw new Error("nothing stored");
  return { result, data };
}

/** What is left in a file, read back with sharp and with a plain search for the markers of the fixtures. */
async function leftovers(sharp: Sharp, data: Buffer) {
  const meta = await sharp(data).metadata();
  const text = data.toString("latin1");
  return {
    meta,
    markers: ["SECRET-MAKE", "SECRET-XMP", "SECRET-GPS", "Exif", "xmpmeta", "ICC_PROFILE"].filter((m) =>
      text.includes(m),
    ),
  };
}

const AVIF_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavif"), Buffer.alloc(16)]);

describe("createLazySharpSanitizer", () => {
  it("loads sharp on the first use only, and once", async () => {
    let loads = 0;
    const lazy = createLazySharpSanitizer(async () => {
      loads += 1;
      return () => {
        throw new Error("not a picture");
      };
    });
    expect(loads).toBe(0);
    expect(await lazy(AVIF_HEAD)).toMatchObject({ ok: false });
    expect(await lazy(AVIF_HEAD)).toMatchObject({ ok: false });
    expect(loads).toBe(1);
  });

  it("a sharp that does not load is a refusal with a plain message, not a crash", async () => {
    const lazy = createLazySharpSanitizer(async () => {
      throw new Error("Could not load the sharp module using the win32-x64 runtime");
    });
    expect(await lazy(AVIF_HEAD)).toEqual({ ok: false, error: "Нужен снимок в формате JPEG, PNG или WebP." });
  });
});

describe("photos from a phone through the real sharp", () => {
  it("a rotated JPEG with a position comes out upright and with no metadata at all", async (ctx) => {
    const sharp = needSharp(ctx);
    const original = fixture("phone-gps-rotated.jpg");
    const before = await leftovers(sharp, original);
    expect(before.markers).toEqual(expect.arrayContaining(["SECRET-MAKE", "SECRET-XMP", "SECRET-GPS", "Exif"]));
    expect(before.meta).toMatchObject({ orientation: 6, width: 24, height: 16 });

    const { result, data } = await uploaded(sharp, original);
    const after = await leftovers(sharp, data);
    expect(after.markers).toEqual([]);
    expect(after.meta.exif).toBeUndefined();
    expect(after.meta.xmp).toBeUndefined();
    expect(after.meta.icc).toBeUndefined();
    expect(after.meta.orientation).toBeUndefined();
    // The turn was applied to the pixels before the tag was dropped: 24 x 16 on the sensor, 16 x 24 as shown.
    expect(after.meta).toMatchObject({ format: "jpeg", width: 16, height: 24 });
    expect(result.mime).toBe("image/jpeg");
    expect(result.removed).toContain("reencoded");
  });

  it("an upright JPEG is cleaned without re-encoding: the picture data stay byte for byte", async (ctx) => {
    const sharp = needSharp(ctx);
    const original = fixture("phone-gps-upright.jpg");
    const { result, data } = await uploaded(sharp, original);
    const after = await leftovers(sharp, data);
    // The colour profile is not personal data and the picture needs it to show the colours right: it stays.
    expect(after.markers.filter((m) => m !== "ICC_PROFILE")).toEqual([]);
    expect(after.meta.exif).toBeUndefined();
    expect(after.meta.xmp).toBeUndefined();
    expect(result.removed).not.toContain("reencoded");
    const pixels = (b: Buffer) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda])));
    expect(pixels(data).equals(pixels(original))).toBe(true);
  });

  it("an AVIF of the HEIF family becomes a JPEG without a position, a maker, an XMP or a profile", async (ctx) => {
    const sharp = needSharp(ctx);
    const original = fixture("phone-gps.avif");
    const before = await leftovers(sharp, original);
    expect(before.markers).toEqual(expect.arrayContaining(["SECRET-MAKE", "SECRET-GPS"]));
    const { result, data } = await uploaded(sharp, original, "serial_photo");
    expect(result).toMatchObject({ mime: "image/jpeg", storageKey: expect.stringMatching(/\.jpg$/) });
    expect([...data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]); // really a JPEG, not the AVIF under another name
    const after = await leftovers(sharp, data);
    expect(after.markers).toEqual([]);
    expect(after.meta).toMatchObject({ format: "jpeg", width: 16, height: 24 });
    expect(after.meta.exif).toBeUndefined();
    expect(after.meta.icc).toBeUndefined();
  });

  it("a HEIC that sharp cannot decode (no HEVC in the prebuilt libvips) gets a message that says what to do", async (ctx) => {
    const sharp = needSharp(ctx);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
    const r = await sanitizeImage(heic, { fallback: createSharpSanitizer(sharp) });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("HEIC");
    expect(r.ok ? "" : r.error).toContain("JPEG");
  });

  it("refuses what is neither a JPEG nor a HEIF file, even when sharp could read it (SVG, TIFF)", async (ctx) => {
    const sharp = needSharp(ctx);
    const fallback = createSharpSanitizer(sharp);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
    );
    expect(await sanitizeImage(svg, { fallback })).toEqual({
      ok: false,
      error: "Нужен снимок в формате JPEG, PNG или WebP.",
    });
    const tiff = await sharp(Buffer.alloc(4 * 4 * 3), { raw: { width: 4, height: 4, channels: 3 } })
      .tiff()
      .toBuffer();
    expect(await sanitizeImage(tiff, { fallback })).toMatchObject({ ok: false });
  });

  it("refuses a picture with more pixels than a phone makes: a few KB of AVIF that held 49 megapixels (900 MB) is refused at the header", async (ctx) => {
    const sharp = needSharp(ctx);
    const big = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "#808080" } })
      .avif({ quality: 1, effort: 0 })
      .toBuffer();
    expect(big.length).toBeLessThan(64 * 1024);
    const before = process.memoryUsage().rss;
    const r = await sanitizeImage(big, { fallback: createSharpSanitizer(sharp) });
    expect(r.ok).toBe(false);
    expect(process.memoryUsage().rss - before).toBeLessThan(150 * 1024 * 1024);
  }, 90_000);

  it("refuses a small AVIF that holds more than 6 megapixels before decoding it (it took 900 MB at 49)", async (ctx) => {
    const sharp = needSharp(ctx);
    const wide = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: "#808080" } })
      .avif({ quality: 1, effort: 0 })
      .toBuffer();
    expect(wide.length).toBeLessThan(50 * 1024);
    const before = process.memoryUsage().rss;
    const r = await sanitizeImage(wide, { fallback: createSharpSanitizer(sharp) });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("мегапикселей");
    // Refused at the header: nothing like the 100 MB that decoding six megapixels takes was held.
    expect(process.memoryUsage().rss - before).toBeLessThan(60 * 1024 * 1024);
  });

  it("a turned JPEG of more than 12 megapixels is kept by the lossless cleaner, with the turn tag and nothing else", async (ctx) => {
    const sharp = needSharp(ctx);
    const base = await sharp({ create: { width: 4160, height: 3120, channels: 3, background: "#808080" } })
      .jpeg({ quality: 20 })
      .withExif({ IFD0: { Make: "SECRET-MAKE" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { result, data } = await uploaded(sharp, base);
    expect(result.removed).not.toContain("reencoded");
    expect(data.toString("latin1")).not.toContain("SECRET-MAKE");
    expect((await sharp(data).metadata()).orientation).toBe(6);
  });

  it("keeps real pictures of every kind that sharp makes whole: the strict shapes refuse nothing a real encoder writes", async (ctx) => {
    const sharp = needSharp(ctx);
    const noise = (width: number, height: number, channels: 3 | 4) => {
      const raw = Buffer.alloc(width * height * channels);
      for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 37 + (i >> 3) * 11) & 255;
      return sharp(raw, { raw: { width, height, channels } });
    };
    const rgb = () => noise(64, 48, 3);
    const rgba = () => noise(64, 48, 4);
    const files: Record<string, Promise<Buffer>> = {
      "jpeg baseline": rgb().jpeg({ quality: 80 }).toBuffer(),
      "jpeg progressive": rgb().jpeg({ progressive: true }).toBuffer(),
      "jpeg 4:4:4": rgb().jpeg({ chromaSubsampling: "4:4:4" }).toBuffer(),
      "jpeg grey": rgb().greyscale().jpeg().toBuffer(),
      "jpeg optimised": rgb().jpeg({ optimiseCoding: true, mozjpeg: true }).toBuffer(),
      "png rgb": rgb().png().toBuffer(),
      "png rgba": rgba().png().toBuffer(),
      "png grey": rgb().greyscale().png().toBuffer(),
      "png palette": rgb().png({ palette: true, colours: 16 }).toBuffer(),
      "png palette 4 bit": rgb().png({ palette: true, colours: 4 }).toBuffer(),
      "png interlaced": rgb().png({ progressive: true }).toBuffer(),
      "png 16 bit": rgb().toColourspace("rgb16").png().toBuffer(),
      "webp lossy": rgb().webp({ quality: 70 }).toBuffer(),
      "webp lossless": rgb().webp({ lossless: true }).toBuffer(),
      "webp alpha": rgba().webp().toBuffer(),
      "webp lossless alpha": rgba().webp({ lossless: true }).toBuffer(),
      "webp animated": sharp(
        Buffer.from(Array.from({ length: 32 * 32 * 3 * 3 }, (_, i) => (i * 7 + Math.floor(i / 3072) * 80) & 255)),
        {
          raw: { width: 32, height: 96, channels: 3, pageHeight: 32 },
        },
      )
        .webp({ loop: 0, delay: [100, 100, 100] })
        .toBuffer(),
    };
    for (const [name, made] of Object.entries(files)) {
      const original = await made;
      const r = await sanitizeImage(original);
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      const before = await sharp(original, { animated: true }).raw().toBuffer({ resolveWithObject: true });
      const after = await sharp(r.data, { animated: true }).raw().toBuffer({ resolveWithObject: true });
      expect(after.info, name).toEqual(before.info);
      expect(after.data.equals(before.data), name).toBe(true);
      if (name === "webp animated") expect(r.data.includes(Buffer.from("ANMF")), name).toBe(true);
    }
  });
});
