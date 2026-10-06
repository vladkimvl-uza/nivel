import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/** All memory modules must fit the board slots. */
export const memSlots = pcRule({
  id: "MEM_SLOTS",
  applies: (b) => hasAll(b, "ram", "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("MEM_SLOTS");
    let modules = 0;
    for (const ram of itemsOf(b, "ram")) modules += (p.need(ram, "ram", "modules") ?? 0) * ram.qty;
    const slots = p.need(mb, "mb", "ramSlots");
    // unknown modules count as 0: the sum is a lower bound, so an excess is certain even then
    if (slots === undefined || modules <= slots) return p.result([]);
    const ids = [...itemsOf(b, "ram").map((r) => r.product.id), mb.product.id];
    return p.result([issue("MEM_SLOTS", "block", ids, "compat.mem_slots_exceeded", { modules, slots })]);
  },
});
