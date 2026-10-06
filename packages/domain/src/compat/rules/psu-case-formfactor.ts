import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/** The case must list the PSU form factor as supported. */
export const psuCaseFormfactor = pcRule({
  id: "PSU_CASE_FORMFACTOR",
  applies: (b) => hasAll(b, "psu", "case"),
  run(b) {
    const psu = firstOf(b, "psu");
    const pcCase = firstOf(b, "case");
    if (!psu || !pcCase) return [];
    const p = new Probe("PSU_CASE_FORMFACTOR");
    const psuFF = p.need(psu, "psu", "formFactor");
    const supported = p.need(pcCase, "case", "psuFF");
    if (psuFF === undefined || supported === undefined) return p.result([]);
    if (supported.includes(psuFF)) return [];
    return [
      issue(
        "PSU_CASE_FORMFACTOR",
        "block",
        [psu.product.id, pcCase.product.id],
        "compat.psu_form_factor_unsupported",
        { psuFF, supported: supported.join(", ") },
        { category: "case", filter: { psuFF } },
      ),
    ];
  },
});
