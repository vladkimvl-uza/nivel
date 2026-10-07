import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onlyPhone, signIn, test } from "../apps/admin/src/auth/e2e/fixtures.ts";

// WP-10, BUILD_PLAN: загрузка файла с телефона со снятием EXIF (профиль Pixel 7, камера — через capture).
const TINY_JPEG = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

/** A phone photo: JPEG with an EXIF block that names the place (and the turn of the phone), as a camera writes it. */
function phonePhoto(): Buffer {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const tiff = [
    ...ascii("MM"),
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    6,
    0,
    0, // Orientation = 6
    0,
    0,
    0,
    0,
    ...ascii("GPS-41.2995N-69.2401E"),
  ];
  const exif = [...ascii("Exif"), 0, 0, ...tiff];
  const head = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255];
  return Buffer.from([0xff, 0xd8, ...head, ...exif, ...TINY_JPEG.subarray(2), 0xff, 0xd9]);
}

test.describe("загрузка файла с телефона", () => {
  onlyPhone();

  test("снимок с геопозицией сохраняется без неё, камера открывается из поля выбора файла", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/files`);

    const input = page.locator("#upload-photo");
    await expect(input).toHaveAttribute("accept", "image/*");
    await expect(input).toHaveAttribute("capture", "environment");

    await page.getByLabel("Что это").selectOption("receipt");
    await input.setInputFiles({ name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: phonePhoto() });
    await page.getByRole("button", { name: "Загрузить" }).click();
    await expect(page.getByTestId("upload-form").locator(".adm-flash--ok")).toContainText(
      "Координаты и данные съёмки из него удалены",
    );
    await expect(page.getByTestId("upload-result")).toContainText("exif");

    const [file] = await admin.query<{
      storage_key: string;
      mime: string;
      kind: string;
      is_public: boolean;
      contains_pd: boolean;
      retention_class: string;
    }>("select storage_key, mime, kind, is_public, contains_pd, retention_class from ops.files where created_by = $1", [
      `admin:${helper.id}`,
    ]);
    expect(file).toMatchObject({
      mime: "image/jpeg",
      kind: "receipt",
      is_public: false,
      contains_pd: true,
      retention_class: "tax_5y",
    });
    const saved = readFileSync(join(admin.filesDir, file?.storage_key ?? ""));
    expect(saved.toString("latin1")).not.toContain("GPS-41.2995N");
    expect(saved.toString("latin1")).not.toContain("69.2401E");
    // Поворот телефона остался: иначе чек ляжет набок. Другого в EXIF нет.
    expect(saved.toString("latin1")).toContain("Exif");
    expect(saved.length).toBeLessThan(phonePhoto().length);

    // Тот же снимок ещё раз — тот же файл.
    await input.setInputFiles({ name: "IMG_0043.jpg", mimeType: "image/jpeg", buffer: phonePhoto() });
    await page.getByRole("button", { name: "Загрузить" }).click();
    await expect(page.getByTestId("upload-form").locator(".adm-flash--ok")).toContainText("Такой файл уже загружен");
    expect(await admin.query("select 1 from ops.files where created_by = $1", [`admin:${helper.id}`])).toHaveLength(1);
  });

  test("снимок на 3 МБ проходит: лимит тела действия Next (1 МБ) загрузке не мешает", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/files`);
    // Реальный кадр весит 2-8 МБ: добавляем нули в данные изображения, перед маркером конца.
    const small = phonePhoto();
    const big = Buffer.concat([small.subarray(0, -2), Buffer.alloc(3 * 1024 * 1024), small.subarray(-2)]);
    expect(big.length).toBeGreaterThan(3 * 1024 * 1024);
    await page.locator("#upload-photo").setInputFiles({ name: "IMG_BIG.jpg", mimeType: "image/jpeg", buffer: big });
    await page.getByRole("button", { name: "Загрузить" }).click();
    await expect(page.getByTestId("upload-form").locator(".adm-flash--ok")).toContainText(
      "Координаты и данные съёмки из него удалены",
    );
    const [file] = await admin.query<{ storage_key: string; bytes: string }>(
      "select storage_key, bytes::text from ops.files where created_by = $1",
      [`admin:${helper.id}`],
    );
    const saved = readFileSync(join(admin.filesDir, file?.storage_key ?? ""));
    expect(saved.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(saved.toString("latin1")).not.toContain("GPS-41.2995N");
  });

  test("файл больше 12 МБ отклоняется сообщением формы, а не сбоем страницы", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/files`);
    const huge = Buffer.alloc(12 * 1024 * 1024 + 1024, 1);
    await page.locator("#upload-photo").setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: huge });
    await page.getByRole("button", { name: "Загрузить" }).click();
    await expect(page.getByTestId("upload-form").locator(".adm-flash--error")).toContainText("Файл больше 12 МБ.");
    expect(await admin.query("select 1 from ops.files where created_by = $1", [`admin:${helper.id}`])).toHaveLength(0);
  });

  test("не снимок не принимается", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/files`);
    const before = (await admin.query("select 1 from ops.files")).length;
    await page
      .locator("#upload-photo")
      .setInputFiles({ name: "evil.jpg", mimeType: "image/jpeg", buffer: Buffer.from("MZ not a picture") });
    await page.getByRole("button", { name: "Загрузить" }).click();
    await expect(page.getByTestId("upload-form").locator(".adm-flash--error")).toContainText(
      "Нужен снимок в формате JPEG, PNG или WebP.",
    );
    expect(await admin.query("select 1 from ops.files")).toHaveLength(before);
  });

  test("вход и меню на узком экране телефона", async ({ page, admin }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    await expect(page.getByRole("navigation", { name: "Разделы" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
