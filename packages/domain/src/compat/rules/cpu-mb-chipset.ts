import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

const norm = (s: string) => s.trim().toUpperCase();

/** The board chipset must be on the processor list. */
export const cpuMbChipset = pcRule({
  id: "CPU_MB_CHIPSET",
  applies: (b) => hasAll(b, "cpu", "mb"),
  run(b) {
    const cpu = firstOf(b, "cpu");
    const mb = firstOf(b, "mb");
    if (!cpu || !mb) return [];
    const p = new Probe("CPU_MB_CHIPSET");
    const supported = p.need(cpu, "cpu", "chipsets");
    const chipset = p.need(mb, "mb", "chipset");
    if (supported === undefined || chipset === undefined) return p.result([]);
    if (supported.some((c) => norm(c) === norm(chipset))) return [];
    return [
      issue("CPU_MB_CHIPSET", "block", [cpu.product.id, mb.product.id], "compat.chipset_unsupported", {
        chipset,
        supported: supported.join(", "),
      }),
    ];
  },
});
