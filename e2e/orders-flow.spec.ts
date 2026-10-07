import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  botLead,
  customerAcceptsEstimate,
  customerAcceptsReport,
  expect,
  onlyPhone,
  signIn,
  tashkentToday,
  test,
  workerCloses,
} from "../apps/admin/src/orders/e2e/fixtures.ts";
import { heicPhoto, phonePhoto, plainSum } from "../apps/admin/src/orders/e2e/photo.ts";
import { formatSum, toTashkentLocal } from "../apps/admin/src/orders/format.ts";
import { PC_CATALOG } from "../apps/admin/src/orders/test-support/world.ts";

// WP-11, BUILD_PLAN: a whole order from the estimate to the end, on the profile of a phone (Pixel 7): the owner takes a
// request of the bot, makes the estimate, the customer accepts in the bot (the part the admin does not do), the owner
// confirms the money, buys with photos of receipts shot "on the phone", reports, settles, draws and signs acts, fills
// the passport, hands over; the worker closes it. Every status is read on the screen, every sum is compared with the
// database.

const sumText = (n: number) => plainSum(formatSum(n));

async function ok(form: Locator, text: string | RegExp): Promise<void> {
  await expect(form.locator(".adm-flash--ok")).toContainText(text);
}

async function statusIs(page: Page, status: string): Promise<void> {
  await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", status);
}

/** Opens a `<details>` whose summary has this text, inside `scope`. */
async function open(scope: Locator, summary: string): Promise<void> {
  const details = scope.locator("details", { hasText: summary }).first();
  if ((await details.getAttribute("open")) === null) await details.locator("summary").first().click();
}

test.describe("заказ от сметы до закрытия, с телефона", () => {
  onlyPhone();

  test("владелец проводит заказ с фото чеков, акты подписываются фото, закрывает система", async ({ page, admin, world }) => {
    test.setTimeout(540_000);
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const lead = await botLead(world, "Азиз Каримов");
    let orderId = "";
    let number = "";
    const card = () => page.goto(`${admin.baseURL}/orders/${orderId}`);
    const total = PC_CATALOG.reduce((n, p) => n + p.price, 0);

    await test.step("заявка бота: «Взять в работу» делает заказ", async () => {
      await page.goto(`${admin.baseURL}/leads`);
      const row = page.locator(`[data-lead="${lead.number}"]`);
      await expect(row).toContainText("Азиз Каримов");
      await row.getByRole("button", { name: "Взять в работу" }).click();
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
      orderId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      await statusIs(page, "estimate_draft");
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toContainText("Азиз Каримов");
      number = ((await heading.textContent()) ?? "").split(" · ")[0] ?? "";
      expect(number).toMatch(/^NV-\d{4}-\d{4}$/);
    });

    await test.step("смета: позиции каталога и строка вручную, итоги считает сервер", async () => {
      await page.getByTestId("open-quote-editor").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Смета NV-");
      await page.getByLabel("Игры").check();
      await page.getByRole("button", { name: "Запомнить задачи" }).click();
      const results = page.getByTestId("catalog-results");
      let lines = 0;
      for (const p of PC_CATALOG) {
        await results.locator("tr", { hasText: `${p.brand} ${p.model}` }).getByRole("button", { name: "Добавить" }).click();
        lines += 1;
        await expect(page.getByTestId("quote-lines").locator("tbody tr")).toHaveCount(lines);
      }
      const manual = page.getByTestId("add-manual-line");
      await manual.getByLabel("Название").fill("Сборка и тест");
      await manual.getByLabel("Группа платы").selectOption({ label: "Монтаж и работы" });
      await manual.getByLabel("Цена за штуку, сумов").fill("300 000");
      await manual.getByLabel("Это работа исполнителя").check();
      await manual.getByRole("button", { name: "Добавить строку" }).click();
      await expect(page.getByTestId("quote-lines").locator("tbody tr")).toHaveCount(lines + 1);
      await expect(page.getByTestId("quote-verdict")).toBeVisible();

      const stored = (
        await admin.query<{ purchase_limit: string; fee_total: string; fee_advance: string; fee_final: string }>(
          `select q.purchase_limit::text, q.fee_total::text, q.fee_advance::text, q.fee_final::text
             from sales.orders o join sales.quotes q on q.id = o.current_quote_id where o.id = $1`,
          [orderId],
        )
      )[0];
      expect(stored).toBeDefined();
      const totals = page.getByTestId("quote-totals");
      await expect(page.getByTestId("quote-limit")).toHaveText(sumText(Number(stored?.purchase_limit)));
      await expect(page.getByTestId("quote-fee")).toHaveText(sumText(Number(stored?.fee_total)));
      await expect(totals).toContainText(sumText(Number(stored?.fee_advance)));
      await expect(totals).toContainText(sumText(Number(stored?.fee_final)));
      // The services have written the draft: no sum was added up by the page.
      expect(Number(stored?.fee_advance) + Number(stored?.fee_final)).toBe(Number(stored?.fee_total));
    });

    await test.step("смета уходит клиенту только с отметкой «проверено вручную»", async () => {
      const send = page.getByTestId("send-quote");
      await send.getByRole("button", { name: "Отправить смету клиенту" }).click();
      await expect(send.locator(".adm-flash--error")).toContainText("Проверено вручную");
      await send.getByLabel("Проверено вручную").check();
      await send.getByRole("button", { name: "Отправить смету клиенту" }).click();
      await expect(send.locator(".adm-flash--ok")).toContainText("Смета отправлена");
      await card();
      await statusIs(page, "estimate_sent");
      await expect(page.getByTestId("no-steps")).toContainText("Ждём клиента");
    });

    await test.step("клиент принимает смету в боте: деньги ожидаются двумя разными путями", async () => {
      await customerAcceptsEstimate(world, orderId);
      await card();
      await statusIs(page, "accepted");
      await expect(page.getByTestId("payment-fee_advance")).toContainText("QR Xolis с чеком");
      await expect(page.getByTestId("payment-purchase_funds")).toContainText("Перевод на счёт ИП");
      await expect(page.getByTestId("payment-fee_advance")).toHaveAttribute("data-status", "expected");
    });

    await test.step("плата подтверждается номером чека, деньги на закупку — документом банка", async () => {
      const advance = page.getByTestId("payment-fee_advance");
      await open(advance, "Подтвердить или аннулировать");
      const confirmAdvance = advance.locator('[data-testid^="confirm-"]');
      await confirmAdvance.getByRole("button", { name: "Подтвердить платёж" }).click();
      await expect(confirmAdvance.locator(".adm-flash--error")).toContainText("номер");
      await confirmAdvance.getByLabel("Номер фискального чека").fill("FR-2026-0001");
      await confirmAdvance.getByRole("button", { name: "Подтвердить платёж" }).click();
      await ok(confirmAdvance, "Платёж подтверждён");

      const funds = page.getByTestId("payment-purchase_funds");
      await open(funds, "Подтвердить или аннулировать");
      const confirmFunds = funds.locator('[data-testid^="confirm-"]');
      await confirmFunds.getByLabel("Номер платёжного документа банка").fill("PP-2026-0001");
      await confirmFunds.getByRole("button", { name: "Подтвердить платёж" }).click();
      await ok(confirmFunds, "Платёж подтверждён");
      await expect(page.getByTestId("payment-fee_advance")).toHaveAttribute("data-status", "confirmed");
      await expect(page.getByTestId("payment-purchase_funds")).toHaveAttribute("data-status", "confirmed");
    });

    await test.step("флаги аванса и денег, затем начало закупки", async () => {
      const prepaid = page.getByTestId("event-FEE_PREPAID");
      await prepaid.getByRole("button", { name: "Аванс платы получен" }).click();
      await ok(prepaid, "Готово");
      const received = page.getByTestId("event-FUNDS_RECEIVED");
      // The money came five days ago: the purchase may start at once.
      await received.getByLabel("Когда деньги поступили").fill(toTashkentLocal(new Date(Date.now() - 5 * 86_400_000)));
      await received.getByRole("button", { name: "Деньги на закупку получены" }).click();
      await ok(received, "Готово");
      await page.getByTestId("event-START_PURCHASE").getByRole("button", { name: "Начать закупку" }).click();
      await statusIs(page, "purchasing");
    });

    await test.step("закупки: снимок HEIC не принимается с подсказкой, снимок с телефона сохраняется без геопозиции", async () => {
      const form = page.getByTestId("record-purchase");
      const picker = form.getByTestId("receipt-picker");
      await expect(picker).toContainText("HEIC");
      await picker.locator('input[type="file"]').setInputFiles({ name: "IMG_0001.heic", mimeType: "image/heic", buffer: heicPhoto() });
      await expect(picker.getByTestId("receipt-picker-message")).toContainText("HEIC");
      await expect(picker.getByTestId("receipt-picker-message")).toHaveClass(/adm-flash--error/);
    });

    await test.step("восемь покупок с чеками и фото; индикатор «потрачено / лимит / получено»", async () => {
      let n = 0;
      for (const [i, p] of PC_CATALOG.entries()) {
        const form = page.getByTestId("record-purchase");
        await form.getByLabel("Магазин").selectOption({ label: "Test shop-e2e" });
        await form.getByLabel("Строка сметы").selectOption({ label: `${p.brand} ${p.model}` });
        await form.getByLabel("Сумма по чеку, сумов").fill(formatSum(p.price).replace(/ сум$/, "").replace(/ /g, " "));
        await form.getByLabel("Номер чека").fill(`CH-${2026_100 + i}`);
        if (i === 0) await form.getByLabel("Серийные номера").fill("SN-CPU-0001");
        const picker = form.getByTestId("receipt-picker");
        await picker
          .locator('input[type="file"]')
          .setInputFiles({ name: `IMG_${100 + i}.jpg`, mimeType: "image/jpeg", buffer: phonePhoto(`GPS-41.2995N-69.2401E-${i}`) });
        await expect(picker.getByTestId("receipt-picker-message")).toContainText("Файл загружен");
        await form.getByRole("button", { name: "Записать покупку" }).click();
        await ok(form, "Покупка записана");
        n += 1;
        await expect(page.getByTestId("purchases-table").getByTestId("purchase-row")).toHaveCount(n);
      }
      await expect(page.getByTestId("money-spent")).toHaveText(sumText(total));
      await expect(page.getByTestId("spend-meter")).toContainText(sumText(total));
      // The photo of the receipt is on the screen and in the folder of files without the place of the shooting.
      const first = page.getByTestId("receipt-photo").first();
      const href = (await first.getAttribute("href")) ?? "";
      const answer = await page.request.get(`${admin.baseURL}${href}`);
      expect(answer.status()).toBe(200);
      expect(answer.headers()["content-type"]).toBe("image/jpeg");
      const files = await admin.query<{ storage_key: string }>(
        "select storage_key from ops.files where kind = 'receipt' order by created_at",
      );
      expect(files).toHaveLength(PC_CATALOG.length);
      for (const f of files) {
        const saved = readFileSync(join(admin.filesDir, f.storage_key)).toString("latin1");
        expect(saved).not.toContain("GPS-41.2995N");
      }
      await page.getByTestId("event-PURCHASE_DONE").getByRole("button", { name: "Закупки закрыты" }).click();
      await statusIs(page, "report_due");
    });

    await test.step("отчёт собирается из закупок и уходит клиенту", async () => {
      await page.getByTestId("generate-report").getByRole("button", { name: "Сформировать отчёт" }).click();
      await expect(page.getByTestId("report-table").locator("tbody tr")).toHaveCount(1);
      await page.getByTestId("send-report").getByRole("button", { name: "Отправить отчёт клиенту" }).click();
      await statusIs(page, "report_sent");
      await expect(page.getByTestId("report-table")).toContainText(sumText(total));
    });

    await test.step("клиент принял отчёт; остаток возвращён и подтверждён; сверка сходится", async () => {
      await customerAcceptsReport(world, orderId);
      await card();
      const refund = page.getByTestId("payment-remainder_refund");
      await expect(refund).toHaveAttribute("data-status", "expected");
      await open(refund, "Подтвердить или аннулировать");
      const confirm = refund.locator('[data-testid^="confirm-"]');
      await confirm.getByLabel("Номер платёжного документа банка").fill("PP-2026-0002");
      await confirm.getByRole("button", { name: "Подтвердить платёж" }).click();
      await ok(confirm, "Платёж подтверждён");
      const settle = page.getByTestId("event-REMAINDER_SETTLED");
      await settle.getByLabel("Платёж возврата остатка").selectOption({ index: 1 });
      await settle.getByRole("button", { name: "Свести остаток" }).click();
      await statusIs(page, "settled");
    });

    await test.step("акт приёма материала клиента подписывается фото бумажного акта", async () => {
      await open(page.getByTestId("acts"), "Составить акт");
      const generate = page.getByTestId("generate-act");
      await generate.getByLabel("Вид акта").selectOption("material_acceptance");
      await generate.getByLabel("Состав").fill("SSD Samsung 1 ТБ × 2");
      await generate.getByRole("button", { name: "Составить акт" }).click();
      await ok(generate, "Акт составлен");
      const sign = page.getByTestId("sign-act");
      const picker = sign.getByTestId("act-picker");
      await picker.locator('input[type="file"]').setInputFiles({ name: "act.jpg", mimeType: "image/jpeg", buffer: phonePhoto("GPS-ACT") });
      await expect(picker.getByTestId("act-picker-message")).toContainText("Файл загружен");
      await sign.getByRole("button", { name: "Записать подпись" }).click();
      await ok(sign, "Акт подписан");
      await expect(page.getByTestId("act-material_acceptance")).toHaveAttribute("data-signed", "yes");
      const accepted = page.getByTestId("event-MATERIALS_ACCEPTED");
      await accepted.getByRole("button", { name: "Материал клиента принят" }).click();
      await statusIs(page, "assembling");
    });

    await test.step("сборка, паспорт с тестом на семь часов, готово", async () => {
      await page.getByTestId("event-ASSEMBLED").getByRole("button", { name: "Сборка закончена" }).click();
      await statusIs(page, "testing");
      const passport = page.getByTestId("passport-form");
      await passport.getByLabel("Серийные номера").fill("Процессор: SN-CPU-0001\nВидеокарта: SN-GPU-0001");
      await passport.getByLabel("Длительность теста, минут").fill("420");
      await passport.getByLabel("Чем тестировали").fill("OCCT + FurMark");
      await passport.getByRole("button", { name: "Сохранить паспорт" }).click();
      await ok(passport, "Паспорт сборки сохранён");
      await expect(page.getByTestId("passport-tests")).toContainText("420 мин");
      await page.getByTestId("event-TESTS_PASSED").getByRole("button", { name: "Тесты пройдены" }).click();
      await statusIs(page, "ready");
    });

    await test.step("доставка: окончательная плата только через QR с чеком, акт сдачи, передача клиенту", async () => {
      await page.getByTestId("event-DISPATCH").getByRole("button", { name: "Передать в доставку" }).click();
      await statusIs(page, "delivering");
      const final = page.getByTestId("payment-fee_final");
      await expect(final).toHaveAttribute("data-status", "expected");
      await open(final, "Подтвердить или аннулировать");
      const confirm = final.locator('[data-testid^="confirm-"]');
      await confirm.getByLabel("Номер фискального чека").fill("FR-2026-0002");
      await confirm.getByRole("button", { name: "Подтвердить платёж" }).click();
      await ok(confirm, "Платёж подтверждён");

      await open(page.getByTestId("acts"), "Составить акт");
      const generate = page.getByTestId("generate-act");
      await generate.getByLabel("Вид акта").selectOption("handover");
      await generate.getByRole("button", { name: "Составить акт" }).click();
      await ok(generate, "Акт составлен");
      const sign = page.getByTestId("sign-act");
      const picker = sign.getByTestId("act-picker");
      await picker.locator('input[type="file"]').setInputFiles({ name: "handover.jpg", mimeType: "image/jpeg", buffer: phonePhoto("GPS-HANDOVER") });
      await expect(picker.getByTestId("act-picker-message")).toContainText("Файл загружен");
      await sign.getByRole("button", { name: "Записать подпись" }).click();
      await ok(sign, "Акт подписан");

      await page.getByTestId("event-HANDOVER").getByRole("button", { name: "Передать клиенту" }).click();
      await statusIs(page, "handed_over");
    });

    await test.step("закрывает система после сверки; в реестре расхождения нет", async () => {
      const closed = await workerCloses(world, orderId);
      expect(closed).toEqual({ ok: true, status: "closed" });
      await card();
      await statusIs(page, "closed");
      await expect(page.getByTestId("timeline")).toContainText("Заказ закрыт");

      await page.goto(`${admin.baseURL}/registry`);
      const row = page.locator(`[data-testid="registry-row"][data-number="${number}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Закрыт");
      await expect(row.getByTestId("registry-diff")).toHaveText(sumText(0));
      const year = Number(tashkentToday().slice(0, 4));
      const deals = (
        await admin.query<{ deals_sum: string }>("select deals_sum::text from sales.v_deal_volume_by_year where year = $1", [year])
      )[0];
      await expect(page.getByTestId("deals-total")).toHaveText(sumText(Number(deals?.deals_sum)));
      const csv = await page.request.get(`${admin.baseURL}/registry/export`);
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-type"]).toContain("text/csv");
      expect(csv.headers()["content-disposition"]).toContain(`registry-${year}.csv`);
      const body = await csv.text();
      const line = body.split(/\r?\n/).find((l) => l.includes(number)) ?? "";
      expect(line.split(";")[0]).toBe("Заказ");
      expect(line.split(";")[7]).toBe("0");
    });

    await test.step("на узком экране телефона страница заказа не уходит за край", async () => {
      await card();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
