import { firstOf, hasAll } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";

/** Processor and board must share a socket. */
export const cpuMbSocket = pcRule({
  id: "CPU_MB_SOCKET",
  applies: (b) => hasAll(b, "cpu", "mb"),
  run(b) {
    const cpu = firstOf(b, "cpu");
    const mb = firstOf(b, "mb");
    if (!cpu || !mb) return [];
    const p = new Probe("CPU_MB_SOCKET");
    const cpuSocket = p.need(cpu, "cpu", "socket");
    const boardSocket = p.need(mb, "mb", "socket");
    if (cpuSocket === undefined || boardSocket === undefined) return p.result([]);
    if (cpuSocket === boardSocket) return [];
    return [
      issue(
        "CPU_MB_SOCKET",
        "block",
        [cpu.product.id, mb.product.id],
        "compat.socket_mismatch",
        { cpuSocket, boardSocket },
        { category: "mb", filter: { socket: cpuSocket } },
      ),
    ];
  },
});
