import { firstOf, hasAll, totalQty } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import { classifySsds } from "../ssd-kit.ts";

/** NVMe drives must not outnumber the M.2 slots of the board. */
export const m2Slots = pcRule({
  id: "M2_SLOTS",
  applies: (b) => hasAll(b, "ssd", "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("M2_SLOTS");
    const { nvme } = classifySsds(b, p);
    const slots = p.need(mb, "mb", "m2");
    if (slots === undefined) return p.result([]);
    const count = totalQty(nvme);
    if (count <= slots.length) return p.result([]);
    return p.result([
      issue("M2_SLOTS", "block", [...nvme.map((i) => i.product.id), mb.product.id], "compat.m2_slots_exceeded", {
        nvme: count,
        slots: slots.length,
      }),
    ]);
  },
});
