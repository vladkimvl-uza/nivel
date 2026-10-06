import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";

/** The row of monitors (panel widths added up, no gaps) must fit the width of the desktop. */
export const deskWidthMonitors = setupRule({
  id: "DESK_WIDTH_MONITORS",
  applies: (b) => hasAll(b, "desk", "monitor"),
  run(b) {
    const desk = firstOf(b, "desk");
    if (!desk) return [];
    const p = new Probe("DESK_WIDTH_MONITORS");
    let monitorsMm = 0;
    for (const m of itemsOf(b, "monitor")) monitorsMm += (p.need(m, "monitor", "panelWmm") ?? 0) * m.qty;
    const deskMm = p.need(desk, "desk", "topWmm");
    // unknown widths count as 0: the sum is a lower bound, so an excess is certain even then
    if (deskMm === undefined || monitorsMm <= deskMm) return p.result([]);
    return p.result([
      issue(
        "DESK_WIDTH_MONITORS",
        "block",
        [desk.product.id, ...itemsOf(b, "monitor").map((m) => m.product.id)],
        "compat.monitors_wider_than_desk",
        { monitorsMm, deskMm },
        { category: "desk", filter: { topWmmMin: monitorsMm } },
      ),
    ]);
  },
});
