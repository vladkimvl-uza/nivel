import { assignM2 } from "../m2.ts";
import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import { classifySsds, m2Drives } from "../ssd-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Drive length against the M.2 slots. A drive counts here only when free slots remained but none was long enough;
 * too many drives is M2_SLOTS's finding.
 */
export const m2Length = pcRule({
  id: "M2_LENGTH",
  applies: (b) => hasAll(b, "ssd", "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("M2_LENGTH");
    const { nvme } = classifySsds(b, p);
    const drives = m2Drives(nvme, p);
    const slots = p.need(mb, "mb", "m2");
    if (slots === undefined) return p.result([]);
    const { tooLong } = assignM2(drives, slots);
    const slotMm = Math.max(0, ...slots.map((s) => s.maxLenMm));
    const reported = new Set<string>();
    const found: CompatIssue[] = [];
    for (const d of tooLong) {
      if (reported.has(d.tag.product.id)) continue;
      reported.add(d.tag.product.id);
      found.push(
        issue("M2_LENGTH", "block", [d.tag.product.id, mb.product.id], "compat.m2_too_long", {
          ssdMm: d.lenMm,
          slotMm,
        }),
      );
    }
    return p.result(found);
  },
});
