import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/** PSU length against the case limit (a warning: cables and drive cages may still leave room). */
export const psuCaseLength = pcRule({
  id: "PSU_CASE_LENGTH",
  applies: (b) => hasAll(b, "psu", "case"),
  run(b) {
    const psu = firstOf(b, "psu");
    const pcCase = firstOf(b, "case");
    if (!psu || !pcCase) return [];
    const p = new Probe("PSU_CASE_LENGTH");
    const psuMm = p.need(psu, "psu", "lengthMm");
    const caseMm = p.need(pcCase, "case", "psuMaxLenMm");
    if (psuMm === undefined || caseMm === undefined) return p.result([]);
    if (psuMm <= caseMm) return [];
    return [
      issue("PSU_CASE_LENGTH", "warn", [psu.product.id, pcCase.product.id], "compat.psu_too_long", { psuMm, caseMm }),
    ];
  },
});
