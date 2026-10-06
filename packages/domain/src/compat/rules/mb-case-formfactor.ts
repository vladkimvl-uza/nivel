import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/** The case must list the board form factor as supported. */
export const mbCaseFormfactor = pcRule({
  id: "MB_CASE_FORMFACTOR",
  applies: (b) => hasAll(b, "mb", "case"),
  run(b) {
    const mb = firstOf(b, "mb");
    const pcCase = firstOf(b, "case");
    if (!mb || !pcCase) return [];
    const p = new Probe("MB_CASE_FORMFACTOR");
    const board = p.need(mb, "mb", "formFactor");
    const supported = p.need(pcCase, "case", "boards");
    if (board === undefined || supported === undefined) return p.result([]);
    if (supported.includes(board)) return [];
    return [
      issue(
        "MB_CASE_FORMFACTOR",
        "block",
        [mb.product.id, pcCase.product.id],
        "compat.board_not_supported",
        { board, supported: supported.join(", ") },
        { category: "case", filter: { boards: board } },
      ),
    ];
  },
});
