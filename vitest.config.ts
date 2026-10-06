import { defineConfig } from "vitest/config";
import { loadRootEnv } from "./tools/lib/env.mjs";

// Root .env.local provides TEST_DATABASE_URL_* for the integration project.
loadRootEnv();

export default defineConfig({
  test: {
    env: { NETWORK_GUARD: "1" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
          setupFiles: ["packages/testing/src/setup-unit.ts"],
          // Several worktrees run tests at once on one machine: the 5 s default broke heavy tests under load.
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: "tools",
          environment: "node",
          include: ["tools/__tests__/**/*.test.mjs"],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/*/src/**/*.int.test.ts", "apps/*/src/**/*.int.test.ts"],
          globalSetup: ["packages/testing/src/global-setup-int.ts"],
          setupFiles: ["packages/testing/src/setup-unit.ts", "packages/testing/src/setup-int.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Each worker gets its own copy of the database in the shared tmpfs cluster (256 MB): 15 copies overflowed it.
          maxWorkers: 4,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/types.ts", "**/testkit.ts", "**/*.suite.ts", "**/test-support/**"],
    },
  },
});
