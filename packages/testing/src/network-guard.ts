// NETWORK_GUARD=1: any outgoing HTTP request that no MSW handler covers fails the test (ARCHITECTURE 11.3).
// External services (CBU, Telegram Bot API, Anthropic, Instagram) are always mocked; loopback is allowed.
import type { AnyHandler } from "msw";
import { type SetupServer, setupServer } from "msw/node";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface NetworkGuard extends SetupServer {
  /** Unmocked requests seen since the last takeViolations(); setup-unit fails the test when it is not empty. */
  readonly violations: string[];
  start(): void;
  takeViolations(): string[];
}

/** MSW server that turns every unhandled non-local request into a network error and records it. */
export function createNetworkGuard(...handlers: AnyHandler[]): NetworkGuard {
  const server = setupServer(...handlers);
  const violations: string[] = [];
  return Object.assign(server, {
    violations,
    start() {
      server.listen({
        onUnhandledFrame({ frame }) {
          if (frame.protocol === "http") {
            const { request } = frame.data as { request: Request };
            if (isLocalUrl(request.url)) return;
            violations.push(`${request.method} ${request.url}`);
            // A network error (fetch rejects with TypeError); the request never leaves the process.
            (frame as unknown as { respondWith(r: Response): void }).respondWith(Response.error());
            return;
          }
          violations.push(`${frame.protocol} connection`);
          frame.errorWith(new Error("NETWORK_GUARD: unmocked connection"));
        },
      });
    },
    takeViolations() {
      return violations.splice(0, violations.length);
    },
  });
}

export function networkGuardEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NETWORK_GUARD === "1";
}
