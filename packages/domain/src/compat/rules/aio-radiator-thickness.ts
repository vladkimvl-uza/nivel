import { mountsFor } from "../aio-mount.ts";
import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Radiator thickness with fans against the thickest mount that takes its size. A mount without `maxThicknessMm`
 * states no limit. A radiator that fits no mount is AIO_RADIATOR_MOUNT's finding and is skipped here.
 */
export const aioRadiatorThickness = pcRule({
  id: "AIO_RADIATOR_THICKNESS",
  applies: (b) => hasAll(b, "aio", "case"),
  run(b) {
    const pcCase = firstOf(b, "case");
    if (!pcCase) return [];
    const p = new Probe("AIO_RADIATOR_THICKNESS");
    const mounts = p.need(pcCase, "case", "radiators");
    const found: CompatIssue[] = [];
    for (const aio of itemsOf(b, "aio")) {
      const radMm = p.need(aio, "aio", "radMm");
      const thicknessMm = p.need(aio, "aio", "radThicknessWithFansMm");
      if (radMm === undefined || thicknessMm === undefined || mounts === undefined) continue;
      const fit = mountsFor(mounts, radMm);
      if (fit.length === 0) continue;
      const limits = fit.map((m) => m.maxThicknessMm);
      if (limits.some((l) => l === undefined)) continue;
      const maxMm = Math.max(...(limits as number[]));
      if (thicknessMm > maxMm) {
        found.push(
          issue("AIO_RADIATOR_THICKNESS", "warn", [aio.product.id, pcCase.product.id], "compat.aio_too_thick", {
            thicknessMm,
            maxMm,
          }),
        );
      }
    }
    return p.result(found);
  },
});
