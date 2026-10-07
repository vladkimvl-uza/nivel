import { expect, test } from "./fixtures.ts";

// WP-16, BUILD_PLAN: LCP ≤ 2,5 с на профиле Pixel 7 с замедлением процессора ×4; JS первой загрузки ≤ 150 КБ (сжатый,
// как он идёт по сети). Первая загрузка — всё, что запрошено до события load: скрипты прокрутки и фона грузятся позже, после простоя.
const LCP_BUDGET_MS = 2500;
const JS_BUDGET_BYTES = 150 * 1024;

// Замер идёт на общей машине, где параллельно работают другие тесты и чужие процессы: до двух повторов на случай, если шум съел запас.
test.describe.configure({ retries: 2 });

for (const locale of ["uz", "ru"] as const) {
  test.describe(`бюджеты /${locale}`, () => {
    test.beforeEach(({ browserName: _browser }, testInfo) => {
      test.skip(testInfo.project.name !== "pixel7", "бюджеты сняты на профиле Pixel 7");
    });

    test("LCP не больше 2,5 с при замедлении процессора ×4", async ({ page }) => {
      const client = await page.context().newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        const w = window as unknown as { __lcp: { t: number; tag: string } };
        w.__lcp = { t: 0, tag: "" };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__lcp = { t: e.startTime, tag: (e as unknown as { element?: Element }).element?.tagName ?? "" };
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      await page.goto(`/${locale}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      const lcp = await page.evaluate(() => (window as unknown as { __lcp: { t: number; tag: string } }).__lcp);
      expect(lcp.t, `LCP element: ${lcp.tag}`).toBeGreaterThan(0);
      expect(lcp.t).toBeLessThanOrEqual(LCP_BUDGET_MS);
    });

    test("JS первой загрузки не больше 150 КБ, а скрипты прокрутки и фона приходят позже", async ({ page }) => {
      const client = await page.context().newCDPSession(page);
      await client.send("Network.enable");
      const scripts = new Map<string, string>();
      const sizes = new Map<string, number>();
      client.on("Network.responseReceived", (e) => {
        if (e.type === "Script") scripts.set(e.requestId, e.response.url);
      });
      client.on("Network.loadingFinished", (e) => {
        if (scripts.has(e.requestId)) sizes.set(e.requestId, e.encodedDataLength);
      });
      let atLoad = 0;
      let countAtLoad = 0;
      page.on("load", () => {
        atLoad = [...sizes.values()].reduce((a, b) => a + b, 0);
        countAtLoad = sizes.size;
      });
      await page.goto(`/${locale}`, { waitUntil: "load" });
      expect(countAtLoad).toBeGreaterThan(0);
      expect(atLoad, `scripts at load: ${[...scripts.values()].join("\n")}`).toBeLessThanOrEqual(JS_BUDGET_BYTES);
      // после простоя приходят отдельные чанки: прокрутка первого экрана и фон
      await expect.poll(() => sizes.size, { timeout: 15_000 }).toBeGreaterThan(countAtLoad);
    });
  });
}
