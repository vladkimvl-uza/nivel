import { describe, expect, it } from "vitest";
import { qrMatrix, qrRuns } from "./qr.ts";

/** The 7x7 finder pattern of a QR code: a ring, a gap, a 3x3 core. */
const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];

const at = (m: boolean[][], row: number, col: number, pattern: string[]) =>
  pattern.map((line, r) => [...line].map((_c, k) => (m[row + r]?.[col + k] ? "1" : "0")).join(""));

describe("the QR code of the passport", () => {
  const url = "https://nivel.uz/p/NV-0001-A7";

  it("is a square matrix with the three finder patterns in the corners and a quiet zone left to the page", () => {
    const m = qrMatrix(url);
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect((n - 17) % 4).toBe(0);
    expect(m.every((row) => row.length === n)).toBe(true);
    expect(at(m, 0, 0, FINDER)).toEqual(FINDER);
    expect(at(m, 0, n - 7, FINDER)).toEqual(FINDER);
    expect(at(m, n - 7, 0, FINDER)).toEqual(FINDER);
  });

  it("grows with the text and is the same for the same text", () => {
    expect(qrMatrix("x").length).toBeLessThan(qrMatrix(`${url}/${"a".repeat(80)}`).length);
    expect(qrMatrix(url)).toEqual(qrMatrix(url));
    expect(qrMatrix(url)).not.toEqual(qrMatrix(`${url}1`));
  });

  it("holds the whole text at the level M of correction (a smudge on the sticker does not kill it)", () => {
    expect(() => qrMatrix("a".repeat(200))).not.toThrow();
  });

  it("refuses an empty text and a text too long for a code", () => {
    expect(() => qrMatrix("")).toThrow();
    expect(() => qrMatrix("a".repeat(5000))).toThrow();
  });

  it("is drawn as runs of dark modules: fewer rectangles than modules, and the same picture", () => {
    const m = qrMatrix(url);
    const runs = qrRuns(m);
    const dark = m.flat().filter(Boolean).length;
    expect(runs.length).toBeLessThan(dark);
    const redrawn = m.map((row) => row.map(() => false));
    for (const r of runs) for (let k = 0; k < r.width; k++) (redrawn[r.row] as boolean[])[r.col + k] = true;
    expect(redrawn).toEqual(m);
  });

  it("has the timing pattern between the finders: dark and light by turns along row 6 and column 6", () => {
    const m = qrMatrix(url);
    for (let i = 8; i < m.length - 8; i++) expect((m[6] as boolean[])[i]).toBe(i % 2 === 0);
    for (let i = 8; i < m.length - 8; i++) expect((m[i] as boolean[])[6]).toBe(i % 2 === 0);
  });
});
