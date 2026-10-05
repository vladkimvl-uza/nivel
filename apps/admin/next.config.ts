import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Owner admin: separate app behind WireGuard (ARCHITECTURE 6.1); Russian UI only.
const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@nivel/config", "@nivel/db"],
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-frame-options", value: "DENY" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "no-referrer" },
          { key: "x-robots-tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default config;
