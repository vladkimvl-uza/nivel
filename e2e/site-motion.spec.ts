import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// WP-16: движение. prefers-reduced-motion, saveData и переключатель «Без анимации» дают статичную страницу и ни одного видео;
// без них прокрутка двигает подписи первого экрана, а ниже играет фон «один заказ NV-0001».
const mediaPresent = existsSync(
  join(process.cwd(), "docs", "design", "hero-video", "media", "nivel-night-brand-1280.mp4"),
);

/** Прокручивает страницу до конца ступенями, чтобы отработали все наблюдатели и фон. */
async function scrollThrough(page: Page) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => innerHeight * 0.8);
  for (let y = 0; y <= total; y += step) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await page.waitForTimeout(120);
  }
}

function trackMedia(page: Page) {
  const seen = { video: [] as string[], poster: [] as string[], bg: [] as string[] };
  page.on("request", (r) => {
    const url = r.url();
    if (/\.mp4(\?|$)/.test(url)) seen.video.push(url);
    if (url.includes("/media/posters/")) seen.poster.push(url);
    if (url.includes("/media/bg/")) seen.bg.push(url);
  });
  return seen;
}

test.describe("prefers-reduced-motion: статика, ноль видео", () => {
  test.use({ reducedMotion: "reduce" });

  test("страница не закреплена, видео нет ни в запросах, ни в разметке", async ({ page }) => {
    const seen = trackMedia(page);
    await page.goto("/uz");
    await expect(page.locator("html")).toHaveClass(/is-reduced/);
    const heights = await page.evaluate(() => ({
      track: (document.querySelector("[data-hero-track]") as HTMLElement).offsetHeight,
      vh: innerHeight,
    }));
    expect(heights.track).toBeLessThan(heights.vh * 2);
    await expect(page.locator(".hero-list")).toBeVisible();
    await expect(page.locator('.cap[data-cap="1"]')).toBeHidden();
    await scrollThrough(page);
    await page.waitForTimeout(1500);
    expect(seen.video).toEqual([]);
    expect(await page.locator("video").count()).toBe(0);
    // постеры шагов — только четыре кадра списка
    expect(new Set(seen.poster.map((u) => u.split("?")[0])).size).toBeLessThanOrEqual(4);
  });

  test("все блоки видны сразу, штампы стоят, ничего не ждёт прокрутки", async ({ page }) => {
    await page.goto("/ru");
    await expect(page.locator(".rv").first()).toHaveCSS("opacity", "1");
    await expect(page.locator(".step").first()).toHaveClass(/is-in/);
  });
});

test.describe("saveData: статика, ноль видео", () => {
  test.use({ extraHTTPHeaders: { "save-data": "on" } });

  test("сервер отдаёт статичную страницу без постера под закрепление", async ({ page }) => {
    const seen = trackMedia(page);
    await page.goto("/uz");
    await expect(page.locator("html")).toHaveClass(/is-reduced/);
    await expect(page.locator("[data-hero-media]")).toHaveCount(0);
    await scrollThrough(page);
    expect(seen.video).toEqual([]);
    expect(await page.locator("video").count()).toBe(0);
  });
});

test.describe("переключатель «Без анимации»", () => {
  test("кнопка в подвале ставит cookie, страница перезагружается статичной, и кнопку можно отжать", async ({
    page,
    context,
  }) => {
    await page.goto("/ru");
    await page.locator('[data-motion-toggle][data-ready="1"]').waitFor({ state: "attached", timeout: 15_000 });
    await page.getByRole("button", { name: "Без анимации" }).click();
    await expect(page.locator("html")).toHaveClass(/is-reduced/);
    expect((await context.cookies()).find((c) => c.name === "nv-motion")?.value).toBe("off");
    await page.locator('[data-motion-toggle][data-ready="1"]').waitFor({ state: "attached", timeout: 15_000 });
    await page.getByRole("button", { name: "Включить анимацию" }).click();
    await expect(page.locator("html")).not.toHaveClass(/is-reduced/);
    expect((await context.cookies()).find((c) => c.name === "nv-motion")).toBeUndefined();
  });
});

test.describe("прокрутка и фон", () => {
  test.beforeEach(({ browserName: _browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "движение проверено на компьютере; телефон — снимками и бюджетами");
  });

  test("подписи первого экрана идут за прокруткой, смета-пример стоит рядом со вторым шагом", async ({ page }) => {
    await page.goto("/uz");
    await expect(page.locator('.cap[data-cap="0"]')).toHaveClass(/is-on/);
    const at = (p: number) =>
      page.evaluate((p) => {
        const tr = document.querySelector("[data-hero-track]") as HTMLElement;
        scrollTo(0, tr.getBoundingClientRect().top + scrollY + p * (tr.offsetHeight - innerHeight));
      }, p);
    await at(0.42);
    await expect(page.locator('.cap[data-cap="2"]')).toHaveClass(/is-on/, { timeout: 10_000 });
    await expect(page.locator("[data-hdoc]")).toHaveClass(/is-on/);
    await expect(page.locator('[data-steps] [data-step-i="1"]')).toHaveClass(/is-on/);
    await at(0.9);
    await expect(page.locator('.cap[data-cap="4"]')).toHaveClass(/is-on/);
    await at(0.2);
    await expect(page.locator('.cap[data-cap="1"]')).toHaveClass(/is-on/);
    await expect(page.locator('.cap[data-cap="4"]')).not.toHaveClass(/is-on/);
  });

  test("ниже первого экрана: линейка «Ход заказа», чеки ложатся на стол, подпись «Иллюстрация»", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/uz");
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector("#kak-rabotaem")?.scrollIntoView());
    await expect(page.locator(".ord")).toHaveClass(/is-on/, { timeout: 15_000 });
    const jump = (id: string, share: number) =>
      page.evaluate(
        ([id, share]) => {
          const el = document.getElementById(id as string) as HTMLElement;
          scrollTo(
            0,
            el.getBoundingClientRect().top +
              scrollY -
              innerHeight * 0.3 +
              (share as number) * (el.offsetHeight - innerHeight * 0.7),
          );
        },
        [id, share],
      );
    await jump("xarid", 0.5);
    await expect(page.locator(".ord-t li.is-cur")).toContainText("03");
    await expect(page.locator(".ob-il")).toHaveClass(/is-in/);
    const early = await page.locator(".rc.is-in").count();
    await jump("xarid", 1);
    await expect.poll(() => page.locator(".rc.is-in").count()).toBe(9);
    expect(early).toBeLessThan(9);
    await jump("sinov", 1);
    await expect(page.locator("[data-tclk]")).toHaveClass(/is-done/);
    await page.evaluate(() => document.querySelector("#ceny")?.scrollIntoView());
    await expect(page.locator(".ob-il")).not.toHaveClass(/is-in/);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator(".ord-st")).toHaveText(/Yopildi/, { timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  test("ролик первого экрана листается прокруткой и гасится в конце дорожки", async ({ page }) => {
    test.skip(!mediaPresent, "медиа лежат вне git; в этой копии их нет");
    await page.goto("/uz");
    await page.waitForTimeout(1000);
    await page.mouse.wheel(0, 300);
    await expect(page.locator("[data-hero-media] video.is-ready")).toHaveCount(1, { timeout: 20_000 });
  });
});
