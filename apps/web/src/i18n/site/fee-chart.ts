// The chart «fee on estimates from 5 to 60 million» of the price list (docs/design/hero-video/index.html, block «Prices»): the
// coordinates of the curve, the ticks and the dots, from the fee scale of the owner. The page draws them as an SVG on the server.
import { type FeeScale, feeChartPoints, noJumpUpTo, pcFee } from "./fee-scale.ts";

const MLN = 1_000_000;
const FROM = 5;
const TO = 60;

export interface FeeChart {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** The stretch of the estimate where the minimum fee applies. */
  band: { x: number; y: number; width: number; height: number };
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  /** The curve as an SVG path of straight pieces. */
  path: string;
  dots: { x: number; y: number; base: number; fee: number }[];
  /** Where the label of the minimum and the labels of the two rates stand. */
  minLabel: { x: number; y: number };
  lowLabel: { x: number; y: number };
  highLabel: { x: number; y: number };
}

const r1 = (v: number): number => Number(v.toFixed(1));

/** `narrow` is the geometry for a phone: the same chart, bigger type on a smaller canvas. */
export function feeChart(scale: Readonly<FeeScale>, narrow: boolean): FeeChart {
  const [width, height, left, right, top, bottom] = narrow ? [360, 250, 30, 8, 22, 34] : [640, 280, 44, 14, 16, 36];
  const points = feeChartPoints(scale);
  const topFee = Math.max(...points.map((p) => p.fee)) / MLN;
  const yMax = Math.max(6.5, Math.ceil(topFee * 2) / 2 + 0.5);
  const X = (mln: number) => r1(left + ((mln - FROM) / (TO - FROM)) * (width - left - right));
  const Y = (feeMln: number) => r1(top + (1 - feeMln / yMax) * (height - top - bottom));

  const from = scale.pcThreshold / MLN;
  const to = noJumpUpTo(scale) / MLN;
  const dotBases = [10 * MLN, scale.pcThreshold, 40 * MLN, 60 * MLN];
  return {
    width,
    height,
    plot: { left, right, top, bottom },
    band: { x: X(from), y: top, width: r1(X(to) - X(from)), height: height - top - bottom },
    xTicks: [5, 10, 20, 30, 40, 50, 60].map((v) => ({ x: X(v), label: String(v) })),
    yTicks: Array.from({ length: Math.floor(yMax - 0.5) + 1 }, (_, v) => ({ y: Y(v), label: String(v) })),
    path: points.map((p, i) => `${i ? "L" : "M"}${X(p.base / MLN)} ${Y(p.fee / MLN)}`).join(""),
    dots: dotBases.map((base) => {
      const fee = pcFee(base, scale);
      return { x: X(base / MLN), y: Y(fee / MLN), base, fee };
    }),
    minLabel: { x: r1((X(from) + X(to)) / 2), y: r1(Y(scale.pcHighMinFee / MLN) - 10) },
    lowLabel: { x: X(narrow ? 6 : 7), y: Y(narrow ? 2.6 : 2.4) },
    highLabel: { x: X(45), y: r1(Y(4.5) - 12) },
  };
}
