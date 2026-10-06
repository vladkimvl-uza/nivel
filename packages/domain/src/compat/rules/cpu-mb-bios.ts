import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import { compareVersions } from "../versions.ts";

/**
 * The processor needs a BIOS newer than the one the board ships with.
 * `minBiosByChipset` absent means the processor has no BIOS floor; `null` means unknown; versions that cannot be
 * ordered (different notations) are reported as missing `shippedBios`. Always a warning:
 * with flashback the buyer can update without a processor, otherwise the seller must flash it.
 */
export const cpuMbBios = pcRule({
  id: "CPU_MB_BIOS",
  applies: (b) => hasAll(b, "cpu", "mb"),
  run(b) {
    const cpu = firstOf(b, "cpu");
    const mb = firstOf(b, "mb");
    if (!cpu || !mb) return [];
    const p = new Probe("CPU_MB_BIOS");
    const table = p.optional(cpu, "cpu", "minBiosByChipset");
    if (p.incomplete) return p.result([]);
    if (table === undefined) return [];
    const chipset = p.need(mb, "mb", "chipset");
    if (chipset === undefined) return p.result([]);
    const key = Object.keys(table).find((k) => k.trim().toUpperCase() === chipset.trim().toUpperCase());
    const minBios = key === undefined ? undefined : table[key];
    if (minBios === undefined) return [];
    const shippedBios = p.need(mb, "mb", "shippedBios");
    if (shippedBios === undefined) return p.result([]);
    const order = compareVersions(shippedBios, minBios);
    if (order === undefined) {
      // another notation than the floor: neither "new enough" nor "too old" can be said
      p.missing(mb, "shippedBios");
      return p.result([]);
    }
    if (order >= 0) return [];
    const flashback = p.need(mb, "mb", "biosFlashback");
    if (flashback === undefined) return p.result([]);
    return [
      issue(
        "CPU_MB_BIOS",
        "warn",
        [cpu.product.id, mb.product.id],
        flashback ? "compat.bios_update_flashback" : "compat.bios_update_seller",
        { chipset, minBios, shippedBios },
      ),
    ];
  },
});
