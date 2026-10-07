import { expect, onlyDesktop, signIn, tashkentToday, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

// WP-10, BUILD_PLAN: настройки денег с версией и датой, календарь и часы ответа, флаги;
// изменение настроек перевыпускает тег settings сайта.
test.describe("настройки", () => {
  onlyDesktop();

  test("часы ответа: сохраняются, журналируются, а сайту уходит сигнал сбросить тег settings (HMAC)", async ({
    page,
    admin,
  }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/settings/calendar`);
    const form = page.getByTestId("calendar-form");

    const before = admin.webCalls.length;
    const [was] = await admin.query<{ version: number }>(
      "select version from ops.settings where key = 'calendar.work'",
    );
    await form.getByLabel("Часы ответа: с").fill("09:00");
    await form.getByLabel("Часы ответа: до").fill("20:00");
    await form.getByLabel("Праздничные и нерабочие дни").fill("31.12.2026\n2027-01-01");
    await form.getByRole("button", { name: "Сохранить календарь" }).click();
    await expect(form.locator(".adm-flash--ok")).toContainText("Сохранено.");

    const [stored] = await admin.query<{ value: { from: string; to: string; holidays: string[] }; version: number }>(
      "select value, version from ops.settings where key = 'calendar.work'",
    );
    expect(stored?.value).toMatchObject({ from: "09:00", to: "20:00", holidays: ["2026-12-31", "2027-01-01"] });
    expect(stored?.version).toBe((was?.version ?? 0) + 1);

    // Сайт получил один подписанный вызов с тегом settings.
    expect(admin.webCalls.slice(before)).toEqual([{ tags: ["settings"], valid: true }]);

    const journal = await admin.query<{ actor: string; entity_id: string }>(
      "select actor, entity_id from ops.audit_log where action = 'setting.set' and entity_id = 'calendar.work'",
    );
    expect(journal).toEqual([{ actor: `admin:${owner.id}`, entity_id: "calendar.work" }]);

    // После перезагрузки — то, что сохранено.
    await page.reload();
    await expect(page.getByTestId("calendar-form").getByLabel("Часы ответа: с")).toHaveValue("09:00");
  });

  test("календарь: ошибки названы у полей, ничего не записано", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/settings/calendar`);
    const form = page.getByTestId("calendar-form");
    const before = admin.webCalls.length;
    const [was] = await admin.query<{ version: number }>(
      "select version from ops.settings where key = 'calendar.work'",
    );
    await form.getByLabel("Часы ответа: с").fill("21:00");
    await form.getByLabel("Праздничные и нерабочие дни").fill("31.02.2026");
    await form.getByRole("button", { name: "Сохранить календарь" }).click();
    await expect(form.locator("#f-holidays-error")).toContainText("Не дата: 31.02.2026.");
    await expect(form.getByLabel("Часы ответа: с")).toHaveValue("21:00");
    expect(admin.webCalls.length).toBe(before);
    const [row] = await admin.query<{ version: number }>(
      "select version from ops.settings where key = 'calendar.work'",
    );
    expect(row?.version).toBe(was?.version);
  });

  test("шкала платы: версия по дате, прошлая дата не принимается, будущая ждёт своего дня", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/settings/money`);
    const form = page.getByTestId("fee-form");
    await expect(page.getByTestId("fee-version")).toContainText("2026-10-05");

    // Дата в прошлом
    await form.getByLabel("Ставка ПК до порога, б. п.").fill("1400");
    await form.getByLabel("Дата вступления в силу").fill("2020-01-01");
    await form.getByRole("button", { name: "Сохранить шкалу" }).click();
    await expect(form.locator(".nv-field__error").first()).toHaveText("Дата вступления не может быть в прошлом.");

    // Сегодня: действует сразу, сайту уходит сигнал (теги settings и fee)
    const today = tashkentToday();
    const before = admin.webCalls.length;
    const [was] = await admin.query<{ version: number }>(
      "select version from ops.settings where key = 'money.fee_settings'",
    );
    await form.getByLabel("Дата вступления в силу").fill(today);
    await form.getByRole("button", { name: "Сохранить шкалу" }).click();
    await expect(form.locator(".adm-flash--ok")).toContainText("новая версия шкалы действует");
    expect(admin.webCalls.slice(before)).toEqual([{ tags: ["settings", "fee"], valid: true }]);
    const [live] = await admin.query<{ value: { version: string; pcLowRateBp: number }; version: number }>(
      "select value, version from ops.settings where key = 'money.fee_settings'",
    );
    expect(live?.value.version).toBe(today);
    expect(live?.value.pcLowRateBp).toBe(1400);
    expect(live?.version).toBe((was?.version ?? 0) + 1);

    // Дата в будущем: запланировано, действующая шкала не меняется
    await page.reload();
    const future = new Date(Date.now() + 5 * 3_600_000 + 40 * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId("fee-form").getByLabel("Ставка ПК до порога, б. п.").fill("1300");
    await page.getByTestId("fee-form").getByLabel("Дата вступления в силу").fill(future);
    await page.getByTestId("fee-form").getByRole("button", { name: "Сохранить шкалу" }).click();
    await expect(page.getByTestId("fee-form").locator(".adm-flash--ok")).toContainText("Сохранено как запланированное");
    await page.reload();
    await expect(page.getByTestId("fee-scheduled")).toContainText(future.split("-").reverse().join("."));
    const [still] = await admin.query<{ value: { pcLowRateBp: number } }>(
      "select value from ops.settings where key = 'money.fee_settings'",
    );
    expect(still?.value.pcLowRateBp).toBe(1400);

    await page.getByRole("button", { name: "Отменить запланированное изменение" }).click();
    await expect(page.getByTestId("fee-scheduled")).toHaveCount(0);
  });

  test("флаги: включение сохраняется и сбрасывает тег settings", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/settings/flags`);
    const form = page.getByTestId("flags-form");
    const before = admin.webCalls.length;
    await expect(form.getByLabel("ИИ-консультант (пилот)")).toHaveValue("false");
    await form.getByLabel("ИИ-консультант (пилот)").selectOption("true");
    await form.getByRole("button", { name: "Сохранить флаги" }).click();
    await expect(form.locator(".adm-flash--ok")).toContainText("Сохранено.");
    const [flag] = await admin.query<{ value: boolean }>("select value from ops.settings where key = 'feature.ai'");
    expect(flag?.value).toBe(true);
    expect(admin.webCalls.slice(before)).toEqual([{ tags: ["settings"], valid: true }]);
  });

  test("журнал: владелец видит изменения настроек, с фильтром по объекту", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/settings/flags`);
    await page.getByTestId("flags-form").getByLabel("Сцена на прокрутке").selectOption("true");
    await page.getByTestId("flags-form").getByRole("button", { name: "Сохранить флаги" }).click();
    await expect(page.getByTestId("flags-form").locator(".adm-flash--ok")).toBeVisible();

    await page.goto(`${admin.baseURL}/journal?entity=ops.settings`);
    const rows = page.getByTestId("journal-table").locator("tr[data-action]");
    await expect(rows.first()).toContainText("Изменение настройки");
    await expect(rows.first()).toContainText("feature.scene");
    await page.goto(`${admin.baseURL}/journal?action=auth.&actor=admin:${owner.id}`);
    await expect(page.getByTestId("journal-table").locator('tr[data-action="auth.login"]')).toHaveCount(1);
  });
});
