import { specOf } from "../../catalog/specs.ts";
import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/**
 * Streaming and office PCs need a wireless module. Warns when the board has neither Wi-Fi nor Bluetooth; a known `true`
 * settles the question, a `null` next to a `false` is unknown data.
 */
export const wifiForTask = pcRule({
  id: "WIFI_FOR_TASK",
  applies: (b, { tasks }) => hasAll(b, "mb") && tasks.some((t) => t === "streaming" || t === "office"),
  run(b, { tasks }) {
    const mb = firstOf(b, "mb");
    const task = tasks.find((t) => t === "streaming" || t === "office");
    const spec = mb ? specOf(mb.product, "mb") : undefined;
    if (!mb || !task || !spec) return [];
    if (spec.wifi === true || spec.bluetooth === true) return [];
    const p = new Probe("WIFI_FOR_TASK");
    if (spec.wifi === null || spec.wifi === undefined) p.missing(mb, "wifi");
    if (spec.bluetooth === null || spec.bluetooth === undefined) p.missing(mb, "bluetooth");
    if (p.incomplete) return p.result([]);
    return [issue("WIFI_FOR_TASK", "warn", [mb.product.id], "compat.no_wireless", { task })];
  },
});
