import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** Tower cooler height against the case: over the limit blocks, less than `coolerHeightWarnMarginMm` to spare warns. */
export const coolerCaseHeight = pcRule({
  id: "COOLER_CASE_HEIGHT",
  applies: (b) => hasAll(b, "cooler_air", "case"),
  run(b, { settings }) {
    const pcCase = firstOf(b, "case");
    if (!pcCase) return [];
    const p = new Probe("COOLER_CASE_HEIGHT");
    const caseMm = p.need(pcCase, "case", "coolerMaxHeightMm");
    const found: CompatIssue[] = [];
    for (const cooler of itemsOf(b, "cooler_air")) {
      const coolerMm = p.need(cooler, "cooler_air", "heightMm");
      if (coolerMm === undefined || caseMm === undefined) continue;
      const ids = [cooler.product.id, pcCase.product.id];
      const marginMm = caseMm - coolerMm;
      if (marginMm < 0) {
        found.push(
          issue(
            "COOLER_CASE_HEIGHT",
            "block",
            ids,
            "compat.cooler_too_tall",
            { coolerMm, caseMm },
            { category: "cooler_air", filter: { heightMmMax: caseMm } },
          ),
        );
      } else if (marginMm < settings.coolerHeightWarnMarginMm) {
        found.push(issue("COOLER_CASE_HEIGHT", "warn", ids, "compat.cooler_tight_fit", { coolerMm, caseMm, marginMm }));
      }
    }
    return p.result(found);
  },
});
