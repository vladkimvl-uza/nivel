import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@nivel/config", "@nivel/db", "@nivel/i18n", "@nivel/ui"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Next 16.3 writes AGENTS.md/CLAUDE.md into the app on `next dev`; project rules live in the root CLAUDE.md.
  agentRules: false,
};

export default withNextIntl(config);
