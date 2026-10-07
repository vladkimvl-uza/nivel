// The QR code of the passport as vectors: the matrix of `qrcode` drawn by runs of dark modules (a few hundred rectangles
// instead of a picture, nothing to fetch). The level of correction is M: a smudge on the sticker does not kill the code.
/// <reference path="./qrcode.d.ts" />
import { Rect, Svg } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { createElement as h, type ReactElement } from "react";
import { palette } from "./theme.ts";

/** The matrix of the code, row by row: true is a dark module. */
export function qrMatrix(text: string): boolean[][] {
  if (text === "") throw new RangeError("a QR code needs a text");
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => modules.data[row * n + col] === 1),
  );
}

export interface QrRun {
  row: number;
  col: number;
  width: number;
}

/** Dark modules that touch in a row make one rectangle. */
export function qrRuns(matrix: readonly (readonly boolean[])[]): QrRun[] {
  const runs: QrRun[] = [];
  matrix.forEach((cells, row) => {
    let start = -1;
    for (let col = 0; col <= cells.length; col++) {
      const dark = cells[col] === true;
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        runs.push({ row, col: start, width: col - start });
        start = -1;
      }
    }
  });
  return runs;
}

/** The code on a square of `size` points with the quiet zone of four modules (the paper around it). */
export function qrCode(text: string, size = 74): ReactElement {
  const matrix = qrMatrix(text);
  const n = matrix.length;
  const quiet = 4;
  return h(
    Svg,
    { viewBox: `${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`, style: { width: size, height: size } },
    ...qrRuns(matrix).map((r, i) =>
      h(Rect, { key: i, x: r.col, y: r.row, width: r.width, height: 1, fill: palette.asphalt }),
    ),
  );
}
