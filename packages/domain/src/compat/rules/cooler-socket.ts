import { firstOf, hasAny, itemsOf } from "../resolve.ts";
import { issue, Probe, pcRule } from "../rule-kit.ts";
import type { CompatIssue } from "../types.ts";

/** An air cooler or an AIO must support the processor socket. */
export const coolerSocket = pcRule({
  id: "COOLER_SOCKET",
  applies: (b) => hasAny(b, "cpu") && hasAny(b, "cooler_air", "aio"),
  run(b) {
    const cpu = firstOf(b, "cpu");
    if (!cpu) return [];
    const p = new Probe("COOLER_SOCKET");
    const cpuSocket = p.need(cpu, "cpu", "socket");
    const found: CompatIssue[] = [];
    for (const cooler of itemsOf(b, "cooler_air")) {
      const sockets = p.need(cooler, "cooler_air", "sockets");
      if (cpuSocket === undefined || sockets === undefined || sockets.includes(cpuSocket)) continue;
      found.push(
        issue(
          "COOLER_SOCKET",
          "block",
          [cooler.product.id, cpu.product.id],
          "compat.cooler_socket_unsupported",
          { cpuSocket, cooler: "air" },
          { category: "cooler_air", filter: { sockets: cpuSocket } },
        ),
      );
    }
    for (const aio of itemsOf(b, "aio")) {
      const sockets = p.need(aio, "aio", "sockets");
      if (cpuSocket === undefined || sockets === undefined || sockets.includes(cpuSocket)) continue;
      found.push(
        issue(
          "COOLER_SOCKET",
          "block",
          [aio.product.id, cpu.product.id],
          "compat.cooler_socket_unsupported",
          { cpuSocket, cooler: "aio" },
          { category: "aio", filter: { sockets: cpuSocket } },
        ),
      );
    }
    return p.result(found);
  },
});
