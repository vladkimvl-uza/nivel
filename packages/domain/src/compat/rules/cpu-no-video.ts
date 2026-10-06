import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/** A processor without integrated graphics needs a video card. */
export const cpuNoVideo = pcRule({
  id: "CPU_NO_VIDEO",
  applies: (b) => hasAll(b, "cpu"),
  run(b) {
    const cpu = firstOf(b, "cpu");
    if (!cpu || firstOf(b, "gpu")) return [];
    const p = new Probe("CPU_NO_VIDEO");
    const hasIgpu = p.need(cpu, "cpu", "hasIgpu");
    if (hasIgpu === undefined) return p.result([]);
    if (hasIgpu) return [];
    return [
      issue("CPU_NO_VIDEO", "block", [cpu.product.id], "compat.no_video_output", {}, { category: "gpu", filter: {} }),
    ];
  },
});
