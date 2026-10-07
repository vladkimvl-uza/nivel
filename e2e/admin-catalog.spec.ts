import { expect, onlyDesktop, signIn, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

// WP-10, BUILD_PLAN: позиция GPU создаётся из CSV и правится формой (общая форма по категории, поля из схем контракта).
const HEADER =
  "category,brand,model,mpn,color,lighting,spec.chip,spec.vramGb,spec.lengthMm,spec.heightMm,spec.slots,spec.power.0.conn,spec.power.0.count,spec.adapterInBox,spec.tgpW,spec.hwEncoders";

// Все тесты одного процесса делят одну базу: у каждого теста свой артикул.
const gpuRow = (mpn: string, vram = 12) =>
  `gpu,ASUS,Dual GeForce RTX 5070 OC,${mpn},black,rgb,GeForce RTX 5070,${vram},304,126,2.5,12V-2x6,1,да,250,NVENC|AV1`;
const gpuCsv = (mpn: string, vram = 12) => [HEADER, gpuRow(mpn, vram)].join("\n");

const csvFile = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });

test.describe("каталог R0: импорт CSV и форма позиции", () => {
  onlyDesktop();

  test("позиция GPU создаётся из CSV с предпросмотром и правится формой", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const mpn = "DUAL-RTX5070-A";

    await page.goto(`${admin.baseURL}/catalog/import`);
    await page.setInputFiles("#import-file", csvFile("gpu.csv", gpuCsv(mpn)));
    await page.getByRole("button", { name: "Проверить файл" }).click();

    const preview = page.getByTestId("import-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("count-new")).toHaveText("1");
    await expect(page.getByTestId("count-update")).toHaveText("0");
    await expect(page.getByTestId("count-error")).toHaveText("0");
    await expect(preview).toContainText("ASUS Dual GeForce RTX 5070 OC");
    // До подтверждения в каталоге ничего нет.
    expect(await admin.query("select 1 from catalog.products where mpn = $1", [mpn])).toHaveLength(0);

    await page.getByRole("button", { name: /Загрузить 1/ }).click();
    await expect(page.getByTestId("import-result")).toContainText("создано 1");

    await page.goto(`${admin.baseURL}/catalog?q=${mpn}`);
    const row = page.getByTestId("catalog-row").filter({ hasText: mpn });
    await expect(row).toContainText("Видеокарта");
    await expect(row).toContainText("Черновик");
    await row.getByRole("link", { name: "Dual GeForce RTX 5070 OC" }).click();

    // Форма построена из схемы характеристик видеокарты: поля, подписи, значения из файла.
    const form = page.getByTestId("catalog-form");
    await expect(form.getByLabel("Видеопамять, ГБ")).toHaveValue("12");
    await expect(form.getByLabel("Длина, мм").first()).toHaveValue("304");
    await expect(form.getByLabel("Чип")).toHaveValue("GeForce RTX 5070");
    await expect(form.getByLabel("Аппаратные кодеки (по одному в строке)")).toHaveValue("NVENC\nAV1");
    await expect(form.getByLabel("TGP, Вт")).toHaveValue("250");
    await expect(form.getByLabel("БП по рекомендации производителя, Вт")).toHaveValue("");
    await expect(form.getByLabel("Переходник в комплекте")).toHaveValue("true");

    await form.getByLabel("Видеопамять, ГБ").fill("16");
    await form.getByLabel("БП по рекомендации производителя, Вт").fill("650");
    await form.getByRole("button", { name: "Сохранить" }).click();
    await expect(form.locator(".adm-flash--ok")).toHaveText("Сохранено.");

    await page.reload();
    await expect(page.getByTestId("catalog-form").getByLabel("Видеопамять, ГБ")).toHaveValue("16");
    await expect(page.getByTestId("catalog-form").getByLabel("БП по рекомендации производителя, Вт")).toHaveValue(
      "650",
    );
    await expect(page.getByTestId("history")).toContainText("Изменение позиции");
    await expect(page.getByTestId("history")).toContainText("spec.vramGb");

    const [stored] = await admin.query<{ specs: { vramGb: number; vendorRecommendedPsuW: number }; status: string }>(
      "select specs, status from catalog.products where mpn = $1",
      [mpn],
    );
    expect(stored?.specs.vramGb).toBe(16);
    expect(stored?.specs.vendorRecommendedPsuW).toBe(650);
    expect(stored?.status).toBe("draft");
  });

  test("ошибки файла показаны построчно, верные строки загружаются, неверные пропускаются", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const csv = [
      gpuCsv("DUAL-RTX5070-B"),
      "gpu,MSI,Ventus Broken,MSI-BAD,black,none,GeForce RTX 5060,-8,abc,,,,,,,",
      "toaster,Acme,Hot,,black,none,,,,,,,,,,",
    ].join("\n");

    await page.goto(`${admin.baseURL}/catalog/import`);
    await page.setInputFiles("#import-file", csvFile("mixed.csv", csv));
    await page.getByRole("button", { name: "Проверить файл" }).click();

    await expect(page.getByTestId("count-new")).toHaveText("1");
    await expect(page.getByTestId("count-error")).toHaveText("2");
    const bad = page.locator('tr[data-status="error"]');
    await expect(bad).toHaveCount(2);
    await expect(bad.first()).toContainText("3");
    await expect(bad.first()).toContainText("spec.vramGb: Должно быть больше 0.");
    await expect(bad.first()).toContainText("spec.lengthMm: Нужно число.");
    await expect(bad.nth(1)).toContainText("category: Выберите значение.");

    await page.getByRole("button", { name: /Загрузить 1/ }).click();
    await expect(page.getByTestId("import-result")).toContainText("создано 1");
    expect(await admin.query("select 1 from catalog.products where mpn = 'DUAL-RTX5070-B'")).toHaveLength(1);
    expect(await admin.query("select 1 from catalog.products where mpn = 'MSI-BAD'")).toHaveLength(0);
  });

  test("повторная загрузка того же файла обновляет позицию, а не плодит двойник", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    for (const vram of [12, 24]) {
      await page.goto(`${admin.baseURL}/catalog/import`);
      await page.setInputFiles("#import-file", csvFile("gpu.csv", gpuCsv("DUAL-RTX5070-C", vram)));
      await page.getByRole("button", { name: "Проверить файл" }).click();
      await expect(page.getByTestId(vram === 12 ? "count-new" : "count-update")).toHaveText("1");
      await page.getByRole("button", { name: /Загрузить 1/ }).click();
      await expect(page.getByTestId("import-result")).toBeVisible();
    }
    const rows = await admin.query<{ n: number; vram: number }>(
      "select count(*)::int as n, max((specs->>'vramGb')::int) as vram from catalog.products where mpn = 'DUAL-RTX5070-C'",
    );
    expect(rows[0]).toEqual({ n: 1, vram: 24 });
  });

  test("новая позиция вручную: категория, форма по её схеме, ошибки по полям", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/catalog/new`);
    await page.getByLabel("Категория").selectOption("gpu");
    await page.getByRole("button", { name: "Дальше" }).click();
    await expect(page).toHaveURL(/category=gpu/);

    const form = page.getByTestId("catalog-form");
    await form.getByLabel("Бренд").fill("Gigabyte");
    // модель не заполнена: форма скажет об этом у поля и сохранит то, что уже набрано
    await form.getByLabel("Чип").fill("GeForce RTX 5060");
    await form.getByRole("button", { name: "Создать позицию" }).click();
    await expect(form.locator(".nv-field__error").first()).toHaveText("Обязательное поле.");
    await expect(form.getByLabel("Бренд")).toHaveValue("Gigabyte");
    await expect(form.getByLabel("Чип")).toHaveValue("GeForce RTX 5060");

    await form.getByLabel("Модель").fill("Eagle OC");
    await form.getByRole("button", { name: "Создать позицию" }).click();
    await expect(page).toHaveURL(/\/catalog\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByTestId("created-flash")).toBeVisible();
    await expect(page.getByTestId("catalog-form").getByLabel("Бренд")).toHaveValue("Gigabyte");

    // Подтвердить позицию с неизвестными ключевыми характеристиками база не даёт: форма называет, чего не хватает.
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(page.getByTestId("status-controls").locator(".adm-flash--error")).toContainText(
      "не заполнены ключевые характеристики",
    );
    await expect(page.getByTestId("status-name")).toHaveText("Черновик");
  });

  test("шаблон CSV по категории скачивается и содержит столбцы формы", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const answer = await page.evaluate(async (base) => {
      const response = await fetch(`${base}/catalog/template?category=gpu`);
      const unknown = await fetch(`${base}/catalog/template?category=toaster`);
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        disposition: response.headers.get("content-disposition"),
        text: await response.text(),
        bom: Array.from(bytes.slice(0, 3)),
        unknown: unknown.status,
      };
    }, admin.baseURL);
    expect(answer.status).toBe(200);
    expect(answer.type).toContain("text/csv");
    expect(answer.disposition).toContain("catalog-gpu.csv");
    expect(answer.bom).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel reads the file as UTF-8 only with it
    expect(answer.text).toContain("category;brand;model;mpn;color;lighting");
    expect(answer.text).toContain("spec.vramGb");
    expect(answer.text).not.toContain("status");
    expect(answer.unknown).toBe(404);
  });

  test("помощник не получает шаблон: импорт закрыт", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    await signIn(page, admin, helper);
    const status = await page.evaluate(
      async (base) => (await fetch(`${base}/catalog/template?category=gpu`)).status,
      admin.baseURL,
    );
    expect(status).toBe(403);
  });
});
