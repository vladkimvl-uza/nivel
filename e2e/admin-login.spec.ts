import { expect, fillSignIn, onlyDesktop, signIn, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

// WP-10, BUILD_PLAN: вход с TOTP; код восстановления; выход. Админка — отдельное приложение со своей базой.
test.describe("вход в админку", () => {
  onlyDesktop();

  test("страницы закрыты, вход по e-mail, паролю и коду из приложения", async ({ page, admin, context }) => {
    const owner = await admin.createUser("owner");

    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    await signIn(page, admin, owner);
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole("heading", { level: 1, name: "Каталог" })).toBeVisible();

    const cookie = (await context.cookies()).find((c) => c.name === "__Host-nv_admin");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    expect(cookie?.path).toBe("/");

    // В базе только хэш токена сеанса, не сам токен.
    const sessions = await admin.query<{ token_sha256: string }>(
      "select token_sha256 from ops.admin_sessions where user_id = $1",
      [owner.id],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]?.token_sha256).not.toBe(cookie?.value);

    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("неверный код из приложения не пускает, и сообщение не говорит, что именно не так", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    await fillSignIn(page, admin, user.email, user.password, "000000");
    await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
    await expect(page).toHaveURL(/\/sign-in$/);

    await fillSignIn(page, admin, "nobody@nivel.test", user.password, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
  });

  test("код восстановления заменяет код из приложения один раз", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    const [recovery] = user.recoveryCodes;
    await fillSignIn(page, admin, user.email, user.password, (recovery ?? "").toUpperCase());
    await expect(page.getByTestId("who")).toContainText(user.email);
    await page.getByRole("button", { name: "Выйти" }).click();

    await fillSignIn(page, admin, user.email, user.password, recovery ?? "");
    await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
  });

  test("вход записан в журнал, пароль и код в него не попадают", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    await signIn(page, admin, user);
    const rows = await admin.query<{ action: string }>(
      "select action, after from ops.audit_log where actor = $1 order by at",
      [`admin:${user.id}`],
    );
    expect(rows.map((r) => r.action)).toContain("auth.login");
    expect(JSON.stringify(rows)).not.toContain(user.password);
  });
});
