// vitest setupFiles for unit and integration projects: network guard on by default (NETWORK_GUARD=1).
import { afterAll, afterEach } from "vitest";
import { createNetworkGuard, networkGuardEnabled } from "./network-guard.ts";

export const network = createNetworkGuard();

if (networkGuardEnabled()) {
  network.start();
  afterEach(() => {
    network.resetHandlers();
    const seen = network.takeViolations();
    if (seen.length > 0) {
      throw new Error(`NETWORK_GUARD: unmocked outgoing requests:\n  ${seen.join("\n  ")}`);
    }
  });
  afterAll(() => network.close());
}
