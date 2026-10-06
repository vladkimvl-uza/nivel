// First-load JS budgets per route (ARCHITECTURE 5.8): home ≤ 150 KB gzip, configurator ≤ 180 KB.
// WP-00 stub: there are no product routes yet; WP-16 and WP-19 add measurement from the `next build` output.
import { isMain } from "./lib/env.mjs";

export const BUDGETS_KB = { "/[locale]": 150, "/[locale]/pc": 180 };

if (isMain(import.meta.url)) {
  console.log(
    `check-bundle-budget: stub until WP-16 (budgets: ${Object.entries(BUDGETS_KB)
      .map(([r, kb]) => `${r} ${kb} KB`)
      .join(", ")})`,
  );
}
