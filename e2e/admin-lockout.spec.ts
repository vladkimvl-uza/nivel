import { expect, fillSignIn, onlyDesktop, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

const WRONG = "не-тот-пароль-совсем";

// WP-10, BUILD_PLAN: 5 ошибок — блокировка на 15 минут.
test.describe("блокировка после пяти ошибок", () => {
  onlyDesktop();

  test("на пятой ошибке вход закрыт на 15 минут, даже с верными данными", async ({ page, admin }) => {
    const user = await admin.createUser("owner");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await fillSignIn(page, admin, user.email, WRONG, user.code());
      await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
    }
    await fillSignIn(page, admin, user.email, WRONG, user.code());
    await expect(page.locator(".adm-flash--error")).toContainText("Вход заблокирован до");
    await expect(page.locator(".adm-flash--error")).toContainText("(Ташкент)");

    // Верные данные во время блокировки не помогают.
    await fillSignIn(page, admin, user.email, user.password, user.code());
    await expect(page.locator(".adm-flash--error")).toContainText("Вход заблокирован до");
    await expect(page).toHaveURL(/\/sign-in$/);

    const [row] = await admin.query<{ failed_logins: number; minutes: string }>(
      "select failed_logins, extract(epoch from locked_until - now()) / 60 as minutes from ops.admin_users where id = $1",
      [user.id],
    );
    expect(row?.failed_logins).toBe(5);
    expect(Number(row?.minutes)).toBeGreaterThan(14);
    expect(Number(row?.minutes)).toBeLessThanOrEqual(15);

    const journal = await admin.query<{ action: string }>("select action from ops.audit_log where actor = $1", [
      `admin:${user.id}`,
    ]);
    expect(journal.map((j) => j.action)).toContain("auth.locked");
  });

  test("через 15 минут вход открывается и счёт ошибок начинается заново", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await fillSignIn(page, admin, user.email, WRONG, user.code());
    }
    await expect(page.locator(".adm-flash--error")).toContainText("Вход заблокирован до");

    // 15 минут ждать не нужно: срок блокировки переносится в прошлое, остальное — как в жизни.
    await admin.query("update ops.admin_users set locked_until = now() - interval '1 minute' where id = $1", [user.id]);

    await fillSignIn(page, admin, user.email, WRONG, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
    const [row] = await admin.query<{ failed_logins: number }>(
      "select failed_logins from ops.admin_users where id = $1",
      [user.id],
    );
    expect(row?.failed_logins).toBe(1);

    await fillSignIn(page, admin, user.email, user.password, user.code());
    await expect(page.getByTestId("who")).toContainText(user.email);
  });
});
