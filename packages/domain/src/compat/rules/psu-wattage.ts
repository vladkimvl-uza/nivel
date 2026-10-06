import { computePower } from "../power.ts";
import { firstOf, hasAny } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * PSU rating against the estimated peak (block 28, 3.4).
 * - rating below the peak: block;
 * - below the recommended wattage (peak x 1.3 rounded up to the series, or the card vendor figure): warn;
 * - otherwise, headroom (rating - peak) / rating under `psuHeadroomWarnBp`: warn.
 * Unknown inputs make the estimate a lower bound: the findings stay valid, and the missing values are reported too.
 */
export const psuWattage = pcRule({
  id: "PSU_WATTAGE",
  applies: (b) => hasAny(b, "psu") && hasAny(b, "cpu", "gpu"),
  run(b, { settings }) {
    const psu = firstOf(b, "psu");
    if (!psu) return [];
    const p = new Probe("PSU_WATTAGE");
    const power = computePower(b, settings);
    for (const m of power.missing) p.missing(m.item, m.field);
    const psuW = p.need(psu, "psu", "watts");
    if (psuW === undefined) return p.result([]);
    const { peakW, recommendedPsuW, headroomBp } = power.estimate;
    const ids = [psu.product.id];
    const found: CompatIssue[] = [];
    if (psuW < peakW) {
      found.push(
        issue(
          "PSU_WATTAGE",
          "block",
          ids,
          "compat.psu_below_peak",
          { psuW, peakW },
          { category: "psu", filter: { wattsMin: recommendedPsuW } },
        ),
      );
    } else if (psuW < recommendedPsuW) {
      found.push(
        issue(
          "PSU_WATTAGE",
          "warn",
          ids,
          "compat.psu_below_recommended",
          { psuW, recommendedW: recommendedPsuW, peakW },
          { category: "psu", filter: { wattsMin: recommendedPsuW } },
        ),
      );
    } else if (headroomBp !== undefined && headroomBp < settings.psuHeadroomWarnBp) {
      found.push(
        issue("PSU_WATTAGE", "warn", ids, "compat.psu_low_headroom", {
          headroomBp,
          minBp: settings.psuHeadroomWarnBp,
          peakW,
        }),
      );
    }
    return p.result(found);
  },
});
