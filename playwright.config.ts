import { defineConfig, devices } from "@playwright/test";
import { loadRootEnv, portBase, slotFromEnv } from "./tools/lib/env.mjs";

// e2e runs against the standalone build of web (BUILD_PLAN 4.2 spike "image build"), started by tools/e2e.mjs.
loadRootEnv();
const port = portBase(slotFromEnv());
const baseURL = `http://127.0.0.1:${port}`;
// Bundled Chromium is used when installed; otherwise tools/e2e.mjs sets PW_CHANNEL=msedge (Windows Edge).
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  reporter: [["list"]],
  retries: 0,
  use: { baseURL, trace: "off" },
  projects: [
    { name: "pixel7", use: { ...devices["Pixel 7"], ...(channel ? { channel } : {}) } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) } },
  ],
  webServer: {
    command: "node apps/web/.next/standalone/apps/web/server.js",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(port), HOSTNAME: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
