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
    if (p.incomplete || slots === undefined) return p.result([]);
    if (modules <= slots) return [];
    const ids = [...itemsOf(b, "ram").map((r) => r.product.id), mb.product.id];
    return [issue("MEM_SLOTS", "block", ids, "compat.mem_slots_exceeded", { modules, slots })];
  },
});
