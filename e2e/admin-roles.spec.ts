import { expect, onlyDesktop, signIn, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

// WP-10, BUILD_PLAN: помощник не видит настройки денег. Роль проверяется на каждой странице и в каждом действии.
test.describe("роли", () => {
  onlyDesktop();

  test("помощник не видит настройки денег, флаги, журнал и людей; календарь только читает", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    await signIn(page, admin, helper);

    const menu = page.getByRole("navigation", { name: "Разделы" });
    await expect(menu.getByRole("link")).toHaveText(["Каталог", "Настройки", "Файлы", "Учётная запись"]);

    await page.goto(`${admin.baseURL}/settings`);
    await expect(page.getByTestId("settings-calendar")).toBeVisible();
    await expect(page.getByTestId("settings-money")).toHaveCount(0);
    await expect(page.getByTestId("settings-flags")).toHaveCount(0);
    await expect(page.getByText("Шкала платы")).toHaveCount(0);

    // Набранный вручную адрес закрыт так же, как ссылка в меню.
    for (const path of [
      "/settings/money",
      "/settings/flags",
      "/journal",
      "/users",
      "/catalog/new",
      "/catalog/import",
    ]) {
      await page.goto(`${admin.baseURL}${path}`);
      await expect(page, path).toHaveURL(/\/forbidden$/);
      await expect(page.getByTestId("forbidden")).toBeVisible();
      await expect(page.getByText("Шкала платы")).toHaveCount(0);
    }

    // Календарь помощник видит, но формы изменения у него нет.
    await page.goto(`${admin.baseURL}/settings/calendar`);
    await expect(page.getByTestId("calendar-readonly")).toContainText("10:00–19:00");
    await expect(page.getByTestId("calendar-form")).toHaveCount(0);

    // Каталог — для просмотра: без кнопок создания и импорта.
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page.getByRole("link", { name: "Новая позиция" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Импорт из файла" })).toHaveCount(0);
  });

  test("владелец видит всё, в том числе шкалу платы", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const menu = page.getByRole("navigation", { name: "Разделы" });
    await expect(menu.getByRole("link")).toHaveText([
      "Каталог",
      "Настройки",
      "Журнал",
      "Файлы",
      "Пользователи",
      "Учётная запись",
    ]);

    await page.goto(`${admin.baseURL}/settings`);
    await expect(page.getByTestId("settings-money")).toBeVisible();
    await expect(page.getByTestId("settings-calendar")).toBeVisible();
    await expect(page.getByTestId("settings-flags")).toBeVisible();

    await page.goto(`${admin.baseURL}/settings/money`);
    await expect(page.getByTestId("fee-version")).toContainText("2026-10-05");
    await expect(page.getByTestId("fee-form")).toBeVisible();
    await expect(page.getByLabel("Ставка ПК до порога, б. п.")).toHaveValue("1500");
  });

  test("переводчику открыта только своя учётная запись", async ({ page, admin }) => {
    const translator = await admin.createUser("translator");
    await signIn(page, admin, translator);
    await expect(page).toHaveURL(/\/account$/);
    const menu = page.getByRole("navigation", { name: "Разделы" });
    await expect(menu.getByRole("link")).toHaveText(["Учётная запись"]);
    for (const path of ["/catalog", "/settings", "/journal", "/files"]) {
      await page.goto(`${admin.baseURL}${path}`);
      await expect(page, path).toHaveURL(/\/forbidden$/);
    }
  });

  test("учётная запись показывает привязку Telegram, и она сохраняется", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/account`);
    await expect(page.getByTestId("account-telegram")).toHaveText("не привязан");

    const form = page.getByTestId("telegram-form");
    const submit = async (telegram: string, password: string, code: string) => {
      // После ответа React очищает поля формы: заполняем все заново.
      await form.getByLabel("Telegram id").fill(telegram);
      await form.getByLabel("Пароль").fill(password);
      await form.getByLabel("Код из приложения").fill(code);
      await form.getByRole("button", { name: "Сохранить" }).click();
    };
    // Привязка решает, кому бот поверит как владельцу: с чужим паролем (одного сеанса мало) она не меняется.
    await submit("123456789", "not-the-password-at-all", owner.code(1));
    await expect(form.locator(".adm-flash--error")).toContainText("Пароль или код неверные");
    expect(
      await admin.query("select 1 from ops.admin_users where id = $1 and telegram_user_id is not null", [owner.id]),
    ).toHaveLength(0);

    // Код при входе уже использован: нужен код следующего периода.
    await submit("123456789", owner.password, owner.code(1));
    await expect(form.locator(".adm-flash--ok")).toContainText("Telegram привязан");
    const [row] = await admin.query<{ telegram_user_id: string }>(
      "select telegram_user_id from ops.admin_users where id = $1",
      [owner.id],
    );
    expect(row?.telegram_user_id).toBe("123456789");

    await submit("не число", owner.password, owner.code(1));
    await expect(form.locator(".adm-flash--error")).toContainText("числовой Telegram id");
  });
});
