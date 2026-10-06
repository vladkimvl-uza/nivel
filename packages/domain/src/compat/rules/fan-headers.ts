import type { ProductId } from "../../catalog/types.ts";
import { firstOf, hasAny, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Fans (included with the case plus bought separately) against the case mounts and the board fan headers.
 * One header per fan: a hub or splitter is the owner's call, hence a warning. Limits are read only when there is
 * at least one fan, so a bare board does not become "incomplete".
 */
export const fanHeaders = pcRule({
  id: "FAN_HEADERS",
  applies: (b) => hasAny(b, "mb", "case"),
  run(b) {
    const mb = firstOf(b, "mb");
    const pcCase = firstOf(b, "case");
    const p = new Probe("FAN_HEADERS");
    let total = pcCase ? (p.need(pcCase, "case", "fansIncluded") ?? 0) : 0;
    const fanIds: ProductId[] = [];
    for (const fan of itemsOf(b, "fan")) {
      const count = p.need(fan, "fan", "count");
      if (count === undefined) continue;
      total += count * fan.qty;
      fanIds.push(fan.product.id);
    }
    const found: CompatIssue[] = [];
    if (total > 0 && pcCase) {
      const mounts = p.need(pcCase, "case", "fanMounts");
      if (mounts !== undefined && total > mounts) {
        found.push(
          issue("FAN_HEADERS", "warn", [pcCase.product.id, ...fanIds], "compat.fan_mounts_exceeded", {
            need: total,
            have: mounts,
          }),
        );
      }
    }
    if (total > 0 && mb) {
      const headers = p.need(mb, "mb", "fanHeaders");
      if (headers !== undefined && total > headers) {
        found.push(
          issue("FAN_HEADERS", "warn", [mb.product.id, ...fanIds], "compat.fan_headers_short", {
            need: total,
            have: headers,
          }),
        );
      }
    }
    return p.result(found);
  },
});
