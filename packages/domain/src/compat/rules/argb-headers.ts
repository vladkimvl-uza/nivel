import type { ProductId } from "../../catalog/types.ts";
import { firstOf, hasAll, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/**
 * Lit parts that plug into a board header: fans, AIO, tower cooler, case. Each product (a fan kit comes with its own
 * hub) takes one header per unit: 5 V for ARGB, 12 V for RGB. A fan flagged `argb` counts as ARGB whatever the
 * product `lighting` says. Memory and cards light up through their own connectors.
 */
export const argbHeaders = pcRule({
  id: "ARGB_HEADERS",
  applies: (b) => hasAll(b, "mb"),
  run(b) {
    const mb = firstOf(b, "mb");
    if (!mb) return [];
    const p = new Probe("ARGB_HEADERS");
    let argb = 0;
    let rgb = 0;
    const argbIds: ProductId[] = [];
    const rgbIds: ProductId[] = [];
    const count = (id: ProductId, qty: number, kind: "argb" | "rgb" | "none") => {
      if (kind === "argb") {
        argb += qty;
        argbIds.push(id);
      } else if (kind === "rgb") {
        rgb += qty;
        rgbIds.push(id);
      }
    };
    for (const fan of itemsOf(b, "fan")) {
      const isArgb = p.need(fan, "fan", "argb");
      if (isArgb === undefined) continue;
      const lighting = fan.product.lighting;
      count(fan.product.id, fan.qty, isArgb || lighting === "argb" ? "argb" : lighting === "rgb" ? "rgb" : "none");
    }
    for (const category of ["aio", "cooler_air", "case"] as const) {
      for (const item of itemsOf(b, category)) count(item.product.id, item.qty, item.product.lighting);
    }

    const found: CompatIssue[] = [];
    if (argb > 0) {
      const have = p.need(mb, "mb", "argb5vHeaders");
      if (have !== undefined && argb > have) {
        found.push(
          issue("ARGB_HEADERS", "warn", [mb.product.id, ...argbIds], "compat.argb_headers_short", { need: argb, have }),
        );
      }
    }
    if (rgb > 0) {
      const have = p.need(mb, "mb", "rgb12vHeaders");
      if (have !== undefined && rgb > have) {
        found.push(
          issue("ARGB_HEADERS", "warn", [mb.product.id, ...rgbIds], "compat.rgb_headers_short", { need: rgb, have }),
        );
      }
    }
    return p.result(found);
  },
});
