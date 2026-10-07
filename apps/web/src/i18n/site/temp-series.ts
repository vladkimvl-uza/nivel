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

const f1 = (v: number): number => Number(v.toFixed(1));

/** The log under the points of the passport on the page: a 300 × 80 box, the processor curve as one path. */
export function logPath(values: readonly number[]): string {
  return values.map((v, i) => `${i ? "L" : "M"}${f1((i / 48) * 300)} ${f1(78 - ((v - 30) / 60) * 76)}`).join("");
}

export interface TempChart {
  width: number;
  height: number;
  /** Grid lines at 30, 60 and 90 °C; the lowest is the axis. */
  grid: { value: number; y: number; axis: boolean; labelX: number }[];
  hours: { x: number; hour: number }[];
  path: string;
  peak: { x: number; y: number };
}

/** The chart of one sensor in the passport: 300 × 120, eight hours across, 30 to 90 °C up. */
export function tempChart(values: readonly number[], peakAt: number): TempChart {
  const [width, height, left, right, top, bottom] = [300, 120, 26, 8, 10, 20];
  const X = (i: number) => f1(left + (i / 48) * (width - left - right));
  const Y = (v: number) => f1(top + (1 - (v - 30) / 60) * (height - top - bottom));
  return {
    width,
    height,
    grid: [30, 60, 90].map((value) => ({ value, y: Y(value), axis: value === 30, labelX: left - 5 })),
    hours: [0, 2, 4, 6, 8].map((hour) => ({ x: X(hour * 6), hour })),
    path: values.map((v, i) => `${i ? "L" : "M"}${X(i)} ${Y(v)}`).join(""),
    peak: { x: X(peakAt), y: Y(values[peakAt] ?? 0) },
  };
}
