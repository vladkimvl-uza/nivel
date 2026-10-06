import { mountsFor } from "../aio-mount.ts";
import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** The case must have a mount for the radiator size. */
export const aioRadiatorMount = pcRule({
  id: "AIO_RADIATOR_MOUNT",
  applies: (b) => hasAll(b, "aio", "case"),
  run(b) {
    const pcCase = firstOf(b, "case");
    if (!pcCase) return [];
    const p = new Probe("AIO_RADIATOR_MOUNT");
    const mounts = p.need(pcCase, "case", "radiators");
    const found: CompatIssue[] = [];
    for (const aio of itemsOf(b, "aio")) {
      const radMm = p.need(aio, "aio", "radMm");
      if (radMm === undefined || mounts === undefined) continue;
      if (mountsFor(mounts, radMm).length > 0) continue;
      found.push(
        issue(
          "AIO_RADIATOR_MOUNT",
          "block",
          [aio.product.id, pcCase.product.id],
          "compat.aio_no_mount",
          { radMm },
          { category: "case", filter: { radiatorSizeMm: radMm } },
        ),
      );
    }
    return p.result(found);
  },
});
