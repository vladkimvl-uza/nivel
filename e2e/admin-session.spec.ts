import { expect, onlyDesktop, signIn, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

// WP-10, BUILD_PLAN: сессия истекает (8 часов без действий, не дольше 7 суток).
test.describe("сеанс", () => {
  onlyDesktop();

  test("после истечения срока страница снова просит войти", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    await signIn(page, admin, user);
    await page.goto(`${admin.baseURL}/journal`);
    await expect(page.getByRole("heading", { level: 1, name: "Журнал" })).toBeVisible();

    // Срок действия (8 часов без действий) переносится в прошлое.
    await admin.query("update ops.admin_sessions set expires_at = now() - interval '1 second' where user_id = $1", [
      user.id,
    ]);

    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("каждое действие сдвигает срок на 8 часов вперёд", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    await signIn(page, admin, user);
    await admin.query("update ops.admin_sessions set expires_at = now() + interval '1 minute' where user_id = $1", [
      user.id,
    ]);
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page.getByRole("heading", { level: 1, name: "Каталог" })).toBeVisible();
    const [row] = await admin.query<{ hours: string }>(
      "select extract(epoch from expires_at - now()) / 3600 as hours from ops.admin_sessions where user_id = $1",
      [user.id],
    );
    expect(Number(row?.hours)).toBeGreaterThan(7.9);
    expect(Number(row?.hours)).toBeLessThanOrEqual(8);
  });

  test("сеанс старше 7 суток закрыт, как бы им ни пользовались", async ({ page, admin }) => {
    const user = await admin.createUser("owner");
    await signIn(page, admin, user);
    await admin.query("update ops.admin_sessions set created_at = now() - interval '8 days' where user_id = $1", [
      user.id,
    ]);
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("после выхода старый cookie не открывает ничего", async ({ page, admin, context }) => {
    const user = await admin.createUser("owner");
    await signIn(page, admin, user);
    const saved = await context.cookies();
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await context.addCookies(saved);
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("выключенная учётная запись теряет сеанс на следующем запросе", async ({ page, admin }) => {
    const user = await admin.createUser("assistant");
    await signIn(page, admin, user);
    await admin.query("update ops.admin_users set active = false where id = $1", [user.id]);
    await page.goto(`${admin.baseURL}/catalog`);
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
