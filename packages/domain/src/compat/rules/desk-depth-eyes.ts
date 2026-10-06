import type { ProductId } from "../../catalog/types.ts";
import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, setupRule } from "../rule-kit.ts";
import { assignMonitors } from "../setup-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Distance to the eyes for monitors on stands (monitors on an arm can be pulled closer, so they are skipped).
 * Model: the stand stands at the back edge of the desk and takes its footprint depth; the eyes are at the front edge,
 * so eyes distance = desk depth - stand footprint depth, expected within `eyeDistanceMm` (50-76 cm, block 15).
 * When the footprint is unknown the typical stand depth range `standDepthMm` (15-25 cm) is used: only a breach that
 * holds for the whole range is reported, next to the missing-data issue.
 */
export const deskDepthEyes = setupRule({
  id: "DESK_DEPTH_EYES",
  applies: (b) => hasAll(b, "desk", "monitor"),
  run(b, { settings }) {
    const desk = firstOf(b, "desk");
    if (!desk) return [];
    const p = new Probe("DESK_DEPTH_EYES");
    const deskMm = p.need(desk, "desk", "topDmm");
    const { onStand } = assignMonitors(b, p);
    const [minMm, maxMm] = settings.eyeDistanceMm;
    const [standMin, standMax] = settings.standDepthMm;
    const found: CompatIssue[] = [];
    const short = (ids: ProductId[], eyeMm: number) =>
      issue("DESK_DEPTH_EYES", "warn", [desk.product.id, ...ids], "compat.eye_distance_short", { eyeMm, minMm });
    const long = (ids: ProductId[], eyeMm: number) =>
      issue("DESK_DEPTH_EYES", "warn", [desk.product.id, ...ids], "compat.eye_distance_long", { eyeMm, maxMm });
    for (const monitor of onStand) {
      if (deskMm === undefined) break;
      const footprint = p.need(monitor, "monitor", "standFootprintMm");
      const id = monitor.product.id;
      if (footprint === undefined) {
        // unknown stand: report only what holds for every stand in the typical range
        if (deskMm - standMin < minMm) found.push(short([id], deskMm - standMin));
        else if (deskMm - standMax > maxMm) found.push(long([id], deskMm - standMax));
        continue;
      }
      const eyeMm = deskMm - footprint.d;
      if (eyeMm < minMm) found.push(short([id], eyeMm));
      else if (eyeMm > maxMm) found.push(long([id], eyeMm));
    }
    return p.result(found);
  },
});
