// The sensor log of the sample build passport: temperatures of the processor and the video card over the eight hours of the
// test, a point every ten minutes. Not measured: a fixed generator, so that the page is the same on every render (the document
// is a sample and says so).

const POINTS = 49;

/** `base` at the start, the load temperature `peak` in twenty minutes, then a small even wave around it. */
export function series(base: number, peak: number, seed: number): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < POINTS; i++) {
    s = (s * 9301 + 49297) % 233280;
    const noise = s / 233280 - 0.5;
    const v =
      i === 0 ? base : i < 2 ? base + (peak - base) * (i / 2) : peak - 1.5 + noise * 2.6 + Math.sin(i / 6) * 0.6;
    out.push(Math.round(v * 10) / 10);
  }
  return out;
}

export interface PassportSeries {
  id: "cpu" | "gpu";
  values: number[];
  /** The peak as written in the table, whole degrees. */
  max: number;
  /** Index of the peak point, for the marker. */
  peakAt: number;
}

function describe(id: PassportSeries["id"], values: number[]): PassportSeries {
  const top = Math.max(...values);
  return { id, values, max: Math.round(top), peakAt: values.indexOf(top) };
}

export const PASSPORT_SERIES: readonly PassportSeries[] = [
  describe("cpu", series(39, 76.5, 7)),
  describe("gpu", series(36, 70.5, 3)),
];
