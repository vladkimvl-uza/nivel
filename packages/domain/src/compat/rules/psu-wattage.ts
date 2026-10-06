import { computePower } from "../power.ts";
import { firstOf, hasAny } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * PSU rating against the estimated peak (block 28, 3.4).
 * - rating below the peak: block;
 * - below the recommended wattage (peak x 1.3 rounded up to the series, or the card vendor figure): warn;
 * - otherwise, headroom (rating - peak) / rating under `psuHeadroomWarnBp`: warn.
 * Unknown inputs make the estimate a lower bound: the findings stay valid, and the missing values are reported too,
 * also when there is no PSU yet (then there is nothing to compare, only the gaps).
 *
 * Known contract quirk: the recommendation is peak x 1.3 (a 23 % headroom of the PSU), while the headroom warning
 * triggers below 30 % of the PSU rating. A PSU of exactly the recommended wattage can therefore still get
 * `compat.psu_low_headroom` (peak 410 W, PSU 550 W: 25 %). Pinned by a scenario; the integrator decides (ADR) whether
 * the multiplier or the threshold changes. Auto-assembly (WP-05) must not treat that warning as an error.
 */
export const psuWattage = pcRule({
  id: "PSU_WATTAGE",
  applies: (b) => hasAny(b, "cpu", "gpu"),
  run(b, { settings }) {
    const p = new Probe("PSU_WATTAGE");
    const power = computePower(b, settings);
    for (const m of power.missing) p.missing(m.item, m.field);
    // The PSU is usually chosen last. Without one only the unknown inputs of the estimate are reported: the figures
    // (and the recommended wattage the configurator filters PSUs by) are a lower bound and must not look final.
    const psu = firstOf(b, "psu");
    if (!psu) return p.result([]);
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
          headroomPct: Math.floor(headroomBp / 100),
          minPct: Math.floor(settings.psuHeadroomWarnBp / 100),
          peakW,
        }),
      );
    }
    return p.result(found);
  },
});
