// Before `pnpm dev`: the slot's ports must be free and must not collide with other projects on this machine
// (ARCHITECTURE 2.3, 11.1). Usage: node tools/check-ports.mjs [--slot N]
import { connect, createServer } from "node:net";
import { parseArgs } from "node:util";
import { APP_PORT_OFFSETS, appPort, isMain, loadRootEnv, slotFromEnv } from "./lib/env.mjs";

/** Ports of other projects on the owner's machine: never used by Nivel (BUILD_PLAN 1.2). */
export const FOREIGN_PORTS = [8081, 8010, 8091, 8092, 8095, 8443, 8480, 5433];
/** Nivel infrastructure ports. */
export const INFRA_PORTS = { devPg: 54329, testPg: 54339, umami: 3110 };

export function slotPorts(slot) {
  return Object.keys(APP_PORT_OFFSETS).map((app) => ({ app, port: appPort(app, slot) }));
}

/** Resolves true when something accepts a TCP connection on host:port. */
function accepts(host, port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Resolves true when the wildcard bind (IPv4 and IPv6) succeeds. */
function canBindWildcard(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/**
 * Resolves true when nothing listens on the port. On Windows a wildcard bind succeeds even when another process
 * listens on 127.0.0.1 only (worker and bot /healthz do), so loopback connections are probed first.
 */
export async function isPortFree(port) {
  if ((await accepts("127.0.0.1", port)) || (await accepts("::1", port))) return false;
  return canBindWildcard(port);
}

export async function checkPorts(slot) {
  const problems = [];
  for (const { app, port } of slotPorts(slot)) {
    if (FOREIGN_PORTS.includes(port) || Object.values(INFRA_PORTS).includes(port)) {
      problems.push(`${app}: port ${port} is reserved`);
    } else if (!(await isPortFree(port))) {
      problems.push(`${app}: port ${port} is busy (another pnpm dev or a stale process?)`);
    }
  }
  return problems;
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const { values } = parseArgs({ options: { slot: { type: "string" } } });
  const slot = values.slot !== undefined ? Number.parseInt(values.slot, 10) : slotFromEnv();
  const problems = await checkPorts(slot);
  const list = slotPorts(slot)
    .map((p) => `${p.app} ${p.port}`)
    .join(", ");
  if (problems.length > 0) {
    console.error(`check-ports: slot ${slot} (${list}):\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`check-ports: slot ${slot} free (${list})`);
}
