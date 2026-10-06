import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** Card thickness in slots against the expansion slots of the case. */
export const gpuSlotWidth = pcRule({
  id: "GPU_SLOT_WIDTH",
  applies: (b) => hasAll(b, "gpu", "case"),
  run(b) {
    const pcCase = firstOf(b, "case");
    if (!pcCase) return [];
    const p = new Probe("GPU_SLOT_WIDTH");
    const caseSlots = p.need(pcCase, "case", "expansionSlots");
    const found: CompatIssue[] = [];
    for (const gpu of itemsOf(b, "gpu")) {
      const gpuSlots = p.need(gpu, "gpu", "slots");
      if (gpuSlots === undefined || caseSlots === undefined) continue;
      if (gpuSlots > caseSlots) {
        found.push(
          issue("GPU_SLOT_WIDTH", "warn", [gpu.product.id, pcCase.product.id], "compat.gpu_slots_exceeded", {
            gpuSlots,
            caseSlots,
          }),
        );
      }
    }
    return p.result(found);
  },
});
