import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// WP-16: заявка на сайте. Проверка полей — на сервере (форма без novalidate-подсказок браузера), согласие обязательно,
// ловушка для ботов молчит. Сквозная проверка с базой (заявка → тема в группе владельца через outbox) — в e2e/site-lead-flow.spec.ts
// после подключения сервисов (заявка интегратору в отчёте WP-16).
const COPY = {
  uz: {
    submit: "Arizani yuborish",
    consent: "Shaxsiy maʼlumotlarni qayta ishlashga roziman",
    phone: "Telefon",
    scope: "Nima kerak",
    contact: "Telefon yoki Telegramni kiriting.",
    phoneBad: "Telefon raqamiga oʻxshamaydi",
    consentNeeded: "rozilik boʻlmasa",
    unavailable: "ariza qabul qilish hozir ishlamayapti",
    ok: "Ariza qabul qilindi",
    scopeNeeded: "Nima kerakligini tanlang.",
  },
  ru: {
    submit: "Отправить заявку",
    consent: "Согласен на обработку персональных данных",
    phone: "Телефон",
    scope: "Что нужно",
    contact: "Укажите телефон или Telegram.",
    phoneBad: "Не похоже на номер телефона",
    consentNeeded: "Без согласия на обработку данных",
    unavailable: "Приём заявок на сайте сейчас недоступен",
    ok: "Заявка принята",
    scopeNeeded: "Выберите, что нужно.",
  },
} as const;

const OFF = { uz: "Ariza Telegram orqali qabul qilinadi", ru: "Заявки принимаем в Telegram" } as const;

/** Opens the request section; the checks of the form are skipped while the flag `feature.webLeadForm` keeps it switched off. */
async function openForm(page: Page, locale: "uz" | "ru", mode: "form" | "off" = "form") {
  await page.goto(`/${locale}#zayavka`);
  const shown = (await page.locator("form.lead-form").count()) > 0;
  test.skip(
    mode === "form" ? !shown : shown,
    mode === "form" ? "the form is switched off (feature.webLeadForm)" : "the form is on",
  );
}

for (const locale of ["uz", "ru"] as const) {
  const t = COPY[locale];
  test.describe(`заявка /${locale}`, () => {
    test("форма выключена флагом: вместо неё карточка с ботом, формы и полей нет", async ({ page }) => {
      await openForm(page, locale, "off");
      await expect(page.getByRole("heading", { name: OFF[locale] })).toBeVisible();
      await expect(page.locator("form.lead-form")).toHaveCount(0);
      await expect(page.locator("[data-lead-off] a[href^='https://t.me/']")).toBeVisible();
    });

    test("пустая форма: ответ сервера называет поля, согласие обязательно", async ({ page }) => {
      await openForm(page, locale);
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.getByText(t.contact)).toBeVisible();
      await expect(page.getByText(t.scopeNeeded)).toBeVisible();
      await expect(page.getByText(new RegExp(t.consentNeeded))).toBeVisible();
      await expect(page.locator(".lead-error")).toBeVisible();
    });

    test("плохой телефон: ошибка у поля, введённое остаётся в форме", async ({ page }) => {
      await openForm(page, locale);
      await page.getByLabel(t.phone, { exact: true }).fill("12345");
      await page.getByLabel(t.scope).selectOption("pc");
      await page.getByRole("checkbox", { name: t.consent }).check();
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.getByText(new RegExp(t.phoneBad))).toBeVisible();
      await expect(page.getByLabel(t.phone, { exact: true })).toHaveValue("12345");
    });

    test("ловушка для ботов: заполненное скрытое поле выглядит как успех", async ({ page }) => {
      await openForm(page, locale);
      await page.locator('input[name="website"]').evaluate((el) => {
        (el as HTMLInputElement).value = "http://spam.example";
      });
      await page.getByLabel(t.phone, { exact: true }).fill("+998 90 123 45 67");
      await page.getByLabel(t.scope).selectOption("pc");
      await page.getByRole("checkbox", { name: t.consent }).check();
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.getByRole("status")).toContainText(t.ok);
    });

    test("верная заявка без подключённых сервисов: честное сообщение и путь через бота, а не молчание", async ({
      page,
    }) => {
      await openForm(page, locale);
      await page.getByLabel(t.phone, { exact: true }).fill("+998 90 123 45 67");
      await page.getByLabel(t.scope).selectOption("setup");
      await page.getByRole("checkbox", { name: t.consent }).check();
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.locator(".lead-error")).toContainText(new RegExp(t.unavailable, "i"));
      await expect(page.getByLabel(t.phone, { exact: true })).toHaveValue("+998 90 123 45 67");
    });
  });
}

test("форма не отдаёт ловушку скринридеру и клавиатуре", async ({ page }) => {
  await openForm(page, "uz");
  const trap = page.locator(".hp");
  await expect(trap).toHaveAttribute("aria-hidden", "true");
  await expect(trap.locator("input")).toHaveAttribute("tabindex", "-1");
});
