import { expect, test } from "./fixtures.ts";

// WP-00 smoke: both locales render, uz first, CSP nonce on scripts, no console errors.
for (const [path, lang, lead] of [
  ["/uz", "uz-Latn", /yigʻib beramiz/],
  ["/ru", "ru", /Соберём компьютер/],
] as const) {
  test(`${path} renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nivel");
    await expect(page.locator("p.lead")).toHaveText(lead);
    expect(errors).toEqual([]);
  });
}

test("root redirects to /uz by default", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/uz$/);
});

test("language switch keeps the path neutral", async ({ page }) => {
  await page.goto("/uz");
  await page.getByRole("link", { name: "Русский" }).click();
  await expect(page).toHaveURL(/\/ru$/);
});
