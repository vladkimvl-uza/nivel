import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";

// WP-16: одностраничник и документы: uz первым, одинаковые пути uz и ru, плашка «черновик» на заглушках, hreflang, sitemap,
// внутренний маршрут сброса кэша с подписью.
const LANGS = [
  ["uz", "uz-Latn", /Vazifangizga mos ish joyi/, "Qanday ishlaymiz"],
  ["ru", "ru", /Рабочее место под вашу задачу/, "Как работаем"],
] as const;

for (const [locale, lang, headline, how] of LANGS) {
  test.describe(`/${locale}`, () => {
    test("страница на своём языке, ночная тема, один заголовок первого уровня", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const response = await page.goto(`/${locale}`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
      await expect(page.locator('.nav a[data-nav="#kak-rabotaem"]')).toHaveText(how);
      // порядок языков в переключателе: сначала узбекский
      const langs = await page.locator(".seg2.lang a").allTextContents();
      expect(langs).toEqual(["UZ", "RU"]);
      expect(errors).toEqual([]);
    });

    test("в разделах есть документы, прейскурант с датой, гарантия, возврат, заявка, реквизиты", async ({ page }) => {
      await page.goto(`/${locale}`);
      for (const id of ["kak-rabotaem", "pasport", "ceny", "garantiya", "vozvrat", "zayavka", "yakun"]) {
        await expect(page.locator(`#${id}`)).toHaveCount(1);
      }
      await expect(page.locator(".nv-tag").first()).toContainText(/\d{2}\.\d{2}\.\d{4}/);
      await expect(page.locator(".nv-badge--sample").first()).toBeVisible();
      await expect(page.locator(".ftr")).toContainText(locale === "uz" ? "roʻyxatdan oʻtgach" : "после регистрации");
      await expect(page.locator(".ftr")).toContainText("Pexels");
      // суммы целые: ни дробей, ни знака доллара
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/\$|USD/);
    });

    test("hreflang указывает на оба языка и x-default на узбекский", async ({ page }) => {
      await page.goto(`/${locale}`);
      const links = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((els) =>
          els.map((e) => [e.getAttribute("hreflang"), new URL((e as HTMLLinkElement).href).pathname]),
        );
      expect(Object.fromEntries(links)).toMatchObject({ uz: "/uz", ru: "/ru", "x-default": "/uz" });
    });
  });
}

test("корень ведёт на /uz, а переключатель языка сохраняет путь", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/uz$/);
  await page.goto("/uz/legal/offer");
  await page.getByRole("link", { name: "Русский" }).click();
  await expect(page).toHaveURL(/\/ru\/legal\/offer$/);
});

test.describe("юридические страницы", () => {
  for (const doc of ["offer", "privacy", "warranty", "returns", "consent-pd", "stage-tariff"]) {
    for (const locale of ["uz", "ru"] as const) {
      test(`/${locale}/legal/${doc}: плашка «черновик» на заглушке`, async ({ page }) => {
        const response = await page.goto(`/${locale}/legal/${doc}`);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator(".nv-badge--draft")).toHaveText(
          locale === "uz" ? "Yurist tekshirguncha qoralama" : "Черновик до проверки юристом",
        );
      });
    }
  }

  test("политика конфиденциальности называет получателя таблицы клиентов и страну", async ({ page }) => {
    await page.goto("/ru/legal/privacy");
    const body = page.locator(".legal-body");
    await expect(body).toContainText("Google Sheets");
    await expect(body).toContainText("Google LLC (США)");
    await expect(body).toContainText("ЗРУ-1125");
    await page.goto("/uz/legal/privacy");
    await expect(page.locator(".legal-body")).toContainText("Google LLC (AQSH)");
  });

  test("неизвестный документ — 404", async ({ page }) => {
    expect((await page.goto("/uz/legal/nope"))?.status()).toBe(404);
  });

  test("реквизиты — заглушки до регистрации ЯТТ", async ({ page }) => {
    await page.goto("/uz/requisites");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rekvizitlar");
    await expect(page.locator(".req-table")).toContainText("roʻyxatdan oʻtgach");
    await expect(page.locator(".nv-badge--draft")).toBeVisible();
  });
});

test("sitemap.xml и robots.txt", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/uz</loc>", "/ru</loc>", "/uz/legal/privacy</loc>", "/ru/requisites</loc>"]) {
    expect(sitemap).toContain(path);
  }
  expect(sitemap).toContain('hreflang="uz"');
  expect(sitemap).toContain('hreflang="ru"');
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap:");
  expect(robots).toContain("Disallow: /api/");
});

test.describe("/api/internal/revalidate", () => {
  const key = process.env.REVALIDATE_HMAC_KEY ?? "";
  const body = JSON.stringify({ tags: ["fee", "content"] });
  const sign = (timestamp: number, text = body) =>
    createHmac("sha256", key).update(`${timestamp}.${text}`).digest("hex");
  const send = (request: import("@playwright/test").APIRequestContext, timestamp: number, signature: string) =>
    request.post("/api/internal/revalidate", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-nivel-timestamp": String(timestamp),
        "x-nivel-signature": signature,
      },
    });

  test.skip(key.length < 32, "REVALIDATE_HMAC_KEY is not in .env.local (pnpm env:init)");

  test("принимает запрос с верной подписью", async ({ request }) => {
    const now = Date.now();
    const res = await send(request, now, sign(now));
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tags: ["fee", "content"] });
  });

  test("отказывает без подписи, с чужой подписью и после пяти минут", async ({ request }) => {
    const now = Date.now();
    expect((await request.post("/api/internal/revalidate", { data: body })).status()).toBe(401);
    expect((await send(request, now, "0".repeat(64))).status()).toBe(401);
    const old = now - 6 * 60_000;
    expect((await send(request, old, sign(old))).status()).toBe(401);
  });

  test("другие методы не принимаются", async ({ request }) => {
    expect((await request.get("/api/internal/revalidate")).status()).toBe(405);
  });
});

test.describe("медиа", () => {
  const poster = "/media/posters/step01-brand-1280.webp";
  const present = existsSync(
    join(process.cwd(), "docs", "design", "hero-video", "media", "posters", "step01-brand-1280.webp"),
  );
  test.skip(!present, "медиа лежат вне git (docs/design/hero-video/media); в этой копии их нет");

  test("постер отдаётся с Range и immutable", async ({ request }) => {
    const whole = await request.get(poster);
    expect(whole.status()).toBe(200);
    expect(whole.headers()["content-type"]).toBe("image/webp");
    expect(whole.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(whole.headers()["accept-ranges"]).toBe("bytes");
    const part = await request.get(poster, { headers: { range: "bytes=0-99" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await part.body()).length).toBe(100);
  });

  test("выход из папки медиа невозможен", async ({ request }) => {
    expect((await request.get("/media/..%2f..%2fpackage.json")).status()).toBe(404);
    expect((await request.get("/media/nope.mp4")).status()).toBe(404);
  });
});
