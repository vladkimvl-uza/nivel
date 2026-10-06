import { test as base, expect } from "@playwright/test";

// Network guard for e2e (ARCHITECTURE 11.3): everything except localhost is blocked.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort("blockedbyclient");
    });
    await use(page);
  },
});
export { expect };
