import { isFrontOnly } from "../aio-mount.ts";
import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Card length against the case limit: over the limit blocks, less than `gpuLenWarnMarginMm` to spare warns.
 * When a selected AIO radiator fits only on the front panel, the shorter "with front radiator" limit applies.
 */
export const gpuCaseLength = pcRule({
  id: "GPU_CASE_LENGTH",
  applies: (b) => hasAll(b, "gpu", "case"),
  run(b, { settings }) {
    const pcCase = firstOf(b, "case");
    if (!pcCase) return [];
    const p = new Probe("GPU_CASE_LENGTH");
    let limit = p.need(pcCase, "case", "gpuMaxLenMm");
    let limitField = "gpuMaxLenMm";

    const aio = firstOf(b, "aio");
    if (aio) {
      const radMm = p.need(aio, "aio", "radMm");
      const mounts = p.need(pcCase, "case", "radiators");
      if (radMm !== undefined && mounts !== undefined && isFrontOnly(mounts, radMm)) {
        const withRad = p.need(pcCase, "case", "gpuMaxLenWithFrontRadMm");
        if (withRad !== undefined && limit !== undefined) {
          limit = Math.min(limit, withRad);
          limitField = "gpuMaxLenWithFrontRadMm";
        }
      }
    }

    const found: CompatIssue[] = [];
    for (const gpu of itemsOf(b, "gpu")) {
      const gpuMm = p.need(gpu, "gpu", "lengthMm");
      if (gpuMm === undefined || limit === undefined) continue;
      const ids = [gpu.product.id, pcCase.product.id];
      const marginMm = limit - gpuMm;
      if (marginMm < 0) {
        found.push(
          issue(
            "GPU_CASE_LENGTH",
            "block",
            ids,
            "compat.gpu_too_long",
            { gpuMm, caseMm: limit },
            { category: "case", filter: { [`${limitField}Min`]: gpuMm } },
          ),
        );
      } else if (marginMm < settings.gpuLenWarnMarginMm) {
        found.push(issue("GPU_CASE_LENGTH", "warn", ids, "compat.gpu_tight_fit", { gpuMm, caseMm: limit, marginMm }));
      }
    }
    return p.result(found);
  },
});
