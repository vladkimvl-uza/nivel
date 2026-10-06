import { describe, expect, it } from "vitest";
import { cmapCodePoints } from "./font-cmap.ts";

/** Builds a minimal sfnt with a single `cmap` table made of the given subtables. */
function sfnt(subtables: { platform: number; encoding: number; body: number[] }[], scaler = 0x00010000): Uint8Array {
  const u16 = (n: number) => [(n >> 8) & 255, n & 255];
  const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const head = [...u16(0), ...u16(subtables.length)];
  let offset = 4 + subtables.length * 8;
  const records: number[] = [];
  const bodies: number[] = [];
  for (const s of subtables) {
    records.push(...u16(s.platform), ...u16(s.encoding), ...u32(offset));
    bodies.push(...s.body);
    offset += s.body.length;
  }
  const cmap = [...head, ...records, ...bodies];
  const tableOffset = 12 + 16;
  const dir = [...u32(scaler), ...u16(1), ...u16(16), ...u16(0), ...u16(0)];
  const tag = [0x63, 0x6d, 0x61, 0x70];
  return Uint8Array.from([...dir, ...tag, ...u32(0), ...u32(tableOffset), ...u32(cmap.length), ...cmap]);
}

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/** Format 4 with one segment 0x41..0x43 (idRangeOffset 0) plus the terminating 0xFFFF segment. */
const format4 = [
  ...u16(4),
  ...u16(32),
  ...u16(0),
  ...u16(4),
  ...u16(4),
  ...u16(1),
  ...u16(0),
  ...u16(0x43),
  ...u16(0xffff),
  ...u16(0),
  ...u16(0x41),
  ...u16(0xffff),
  ...u16(0),
  ...u16(1),
  ...u16(0),
  ...u16(0),
];

/** Format 12 with one group U+1F600..U+1F602. */
const format12 = [...u16(12), ...u16(0), ...u32(28), ...u32(0), ...u32(1), ...u32(0x1f600), ...u32(0x1f602), ...u32(5)];

describe("cmapCodePoints", () => {
  it("reads format 4 (BMP) subtables", () => {
    const cps = cmapCodePoints(sfnt([{ platform: 3, encoding: 1, body: format4 }]));
    expect([...cps].sort((a, b) => a - b)).toEqual([0x41, 0x42, 0x43]);
  });

  it("reads format 12 (full Unicode) subtables and merges with format 4", () => {
    const cps = cmapCodePoints(
      sfnt([
        { platform: 3, encoding: 1, body: format4 },
        { platform: 3, encoding: 10, body: format12 },
      ]),
    );
    expect(cps.has(0x42)).toBe(true);
    expect(cps.has(0x1f601)).toBe(true);
    expect(cps.has(0x1f603)).toBe(false);
  });

  it("ignores non-Unicode and unknown subtable formats", () => {
    const mac = [...u16(0), ...u16(262), ...u16(0), ...new Array(256).fill(1)];
    const cps = cmapCodePoints(
      sfnt([
        { platform: 1, encoding: 0, body: mac },
        { platform: 3, encoding: 1, body: format4 },
        { platform: 0, encoding: 3, body: [...u16(99), ...u16(4)] },
      ]),
    );
    expect(cps.size).toBe(3);
  });

  it("rejects a file without a cmap, with an unknown signature or too short", () => {
    const noCmap = sfnt([{ platform: 3, encoding: 1, body: format4 }]);
    noCmap[12] = 0x78; // corrupt the table tag
    expect(() => cmapCodePoints(noCmap)).toThrow(/cmap/);
    expect(() => cmapCodePoints(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/signature/);
    expect(() => cmapCodePoints(new Uint8Array(3))).toThrow(/short/);
  });

  it("rejects a woff2 whose payload is not brotli data", () => {
    const woff2 = new Uint8Array(64);
    woff2.set([0x77, 0x4f, 0x46, 0x32], 0);
    expect(() => cmapCodePoints(woff2)).toThrow();
  });
});
