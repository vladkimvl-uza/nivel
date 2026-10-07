import { expect, fillSignIn, onlyDesktop, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

const WRONG = "не-тот-пароль-совсем";
const WAIT_TEXT = "Слишком много неудачных попыток. Повторите через 15 минут.";

// WP-10, BUILD_PLAN: 5 ошибок — блокировка на 15 минут. После состязательной проверки: пять ошибок закрывают вход
// с этого источника (адреса, для этого e-mail), а учётную запись по всем источникам вместе — двадцать; ответ не
// называет срок и одинаков для любого e-mail.
test.describe("блокировка после ошибок", () => {
  onlyDesktop();

  test("на пятой ошибке вход с этого источника закрыт на 15 минут, даже с верными данными", async ({ page, admin }) => {
    const user = await admin.createUser("owner");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await fillSignIn(page, admin, user.email, WRONG, user.code());
      await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
    }
    await fillSignIn(page, admin, user.email, WRONG, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText(WAIT_TEXT);

    // Верные данные с закрытого источника не помогают.
    await fillSignIn(page, admin, user.email, user.password, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText(WAIT_TEXT);
    await expect(page).toHaveURL(/\/sign-in$/);

    // Учётная запись не заблокирована: закрыт источник, а не владелец.
    const [row] = await admin.query<{ failed_logins: number; locked: boolean }>(
      "select failed_logins, locked_until is not null as locked from ops.admin_users where id = $1",
      [user.id],
    );
    expect(row?.failed_logins).toBe(5);
    expect(row?.locked).toBe(false);

    const journal = await admin.query<{ action: string }>("select action from ops.audit_log where actor = $1", [
      `admin:${user.id}`,
    ]);
    expect(journal.map((j) => j.action)).toContain("auth.login_throttled");
  });

  test("двадцать ошибок по всем источникам блокируют учётную запись на 15 минут; через 15 минут вход открывается и счёт начинается заново", async ({
    page,
    admin,
  }) => {
    const user = await admin.createUser("owner");
    // Девятнадцать ошибок «с разных адресов» набраны в базе: двадцатая приходит через форму.
    await admin.query("update ops.admin_users set failed_logins = 19 where id = $1", [user.id]);
    await fillSignIn(page, admin, user.email, WRONG, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText(WAIT_TEXT);

    await fillSignIn(page, admin, user.email, user.password, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText(WAIT_TEXT);
    const [row] = await admin.query<{ failed_logins: number; minutes: string }>(
      "select failed_logins, extract(epoch from locked_until - now()) / 60 as minutes from ops.admin_users where id = $1",
      [user.id],
    );
    expect(row?.failed_logins).toBe(20);
    expect(Number(row?.minutes)).toBeGreaterThan(14);
    expect(Number(row?.minutes)).toBeLessThanOrEqual(15);
    const journal = await admin.query<{ action: string }>("select action from ops.audit_log where actor = $1", [
      `admin:${user.id}`,
    ]);
    expect(journal.map((j) => j.action)).toContain("auth.locked");

    // 15 минут ждать не нужно: срок блокировки переносится в прошлое, остальное — как в жизни.
    await admin.query("update ops.admin_users set locked_until = now() - interval '1 minute' where id = $1", [user.id]);

    await fillSignIn(page, admin, user.email, WRONG, user.code());
    await expect(page.locator(".adm-flash--error")).toHaveText("Неверный e-mail, пароль или код.");
    const [again] = await admin.query<{ failed_logins: number }>(
      "select failed_logins from ops.admin_users where id = $1",
      [user.id],
    );
    expect(again?.failed_logins).toBe(1);

    await fillSignIn(page, admin, user.email, user.password, user.code());
    await expect(page.getByTestId("who")).toContainText(user.email);
  });
});
