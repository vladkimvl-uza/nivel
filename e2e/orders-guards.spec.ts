import {
  botLead,
  customerAcceptsReport,
  expect,
  onlyDesktop,
  signIn,
  siteLeadWithoutCustomer,
  tashkentToday,
  test,
  workerCloses,
} from "../apps/admin/src/orders/e2e/fixtures.ts";
import type { AdminHarness, OrdersWorld, TestUser } from "../apps/admin/src/orders/e2e/fixtures.ts";
import { phonePhoto, plainSum } from "../apps/admin/src/orders/e2e/photo.ts";
import { formatSum } from "../apps/admin/src/orders/format.ts";
import { GUARD_TEXT } from "../apps/admin/src/orders/messages.ts";
import {
  acceptedOrder,
  draftOrder,
  type FlowWorld,
  handedOverOrder,
  paidOrder,
  purchasingOrder,
  reportSentOrder,
  sentOrder,
} from "../apps/admin/src/orders/test-support/flow.ts";
import { PC_CATALOG } from "../apps/admin/src/orders/test-support/world.ts";

// WP-11, BUILD_PLAN: the refusals seen from the card of an order, in Russian, as the owner and the assistant meet them:
// a purchase over the limit without the consent, money for purchases through the QR, closing without the reconciliation,
// money buttons that the assistant does not have. Every refusal is checked in the database: nothing was written.

const sumText = (n: number) => plainSum(formatSum(n));

function flowOf(world: OrdersWorld, owner: TestUser): FlowWorld {
  return {
    admin: world.admin,
    bot: world.bot,
    db: world.db,
    products: world.catalog.products,
    vendorId: world.catalog.vendorId,
    owner: { id: owner.id },
  };
}

async function fillPurchase(
  page: import("@playwright/test").Page,
  o: { line: string; amount: string; receipt: string },
): Promise<void> {
  const form = page.getByTestId("record-purchase");
  await form.getByLabel("Магазин").selectOption({ label: "Test shop-e2e" });
  await form.getByLabel("Строка сметы").selectOption({ label: o.line });
  await form.getByLabel("Сумма по чеку, сумов").fill(o.amount);
  await form.getByLabel("Номер чека").fill(o.receipt);
  const picker = form.getByTestId("receipt-picker");
  await picker.locator('input[type="file"]').setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: phonePhoto() });
  await expect(picker.getByTestId("receipt-picker-message")).toContainText("Файл загружен");
}

test.describe("отказы автомата в карточке заказа", () => {
  onlyDesktop();

  test("закупка сверх лимита: без согласия клиента отказ, с согласием — всё равно не своими деньгами", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const o = await purchasingOrder(flowOf(world, owner), "Лимит Лимитов");
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    const form = page.getByTestId("record-purchase");
    const over = o.totals.purchaseLimit + 1_000_000;
    await fillPurchase(page, { line: "Gigabyte RTX 5060", amount: String(over), receipt: "CH-OVER-1" });
    await form.getByRole("button", { name: "Записать покупку" }).click();
    await expect(form.locator(".adm-flash--error")).toContainText(GUARD_TEXT.limit_exceeded);

    // The customer agreed to the overrun by phone: the owner notes it. The money of the customer is still the limit of what was sent.
    const consent = page.getByTestId("consent-details");
    await consent.locator("summary").click();
    await consent.getByLabel("На что согласен клиент").selectOption("limit_overrun");
    await consent.getByRole("button", { name: "Записать согласие клиента" }).click();
    await expect(consent.locator(".adm-flash--ok")).toContainText("Согласие клиента записано");
    await form.getByRole("button", { name: "Записать покупку" }).click();
    await expect(form.locator(".adm-flash--error")).toContainText(GUARD_TEXT.funds_exceeded);

    const rows = await admin.query("select 1 from sales.purchases where order_id = $1", [o.orderId]);
    expect(rows).toHaveLength(0);
    const given = await admin.query("select 1 from ops.consents where order_id = $1 and kind = 'limit_overrun'", [o.orderId]);
    expect(given).toHaveLength(1);
  });

  test("деньги на закупку через QR не принимаются, плата без номера чека — тоже", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const o = await acceptedOrder(flowOf(world, owner), "Деньги Путь");
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);

    const expectBlock = page.getByTestId("expect-details");
    await expectBlock.locator("summary").click();
    const form = expectBlock.getByTestId("expect-payment");
    await form.getByLabel("Вид платежа").selectOption("purchase_funds");
    await form.getByLabel("Способ").selectOption({ label: "QR Xolis с чеком" });
    await form.getByRole("button", { name: "Поставить ожидание" }).click();
    await expect(form.locator(".adm-flash--error")).toContainText("только переводом на счёт ИП");
    const qr = await admin.query(
      "select 1 from sales.payments where order_id = $1 and kind = 'purchase_funds' and method = 'xolis_qr'",
      [o.orderId],
    );
    expect(qr).toHaveLength(0);

    const advance = page.getByTestId("payment-fee_advance");
    await advance.locator("summary", { hasText: "Подтвердить или аннулировать" }).click();
    const confirm = advance.locator('[data-testid^="confirm-"]');
    await confirm.getByRole("button", { name: "Подтвердить платёж" }).click();
    await expect(confirm.locator(".adm-flash--error")).toContainText("Номер фискального чека");
    const still = await admin.query("select status from sales.payments where order_id = $1 and kind = 'fee_advance'", [o.orderId]);
    expect(still.map((r) => r.status)).toEqual(["expected"]);
  });

  test("закупка раньше следующего рабочего дня после поступления денег не начинается", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const o = await paidOrder(flowOf(world, owner), { name: "Спешка Спешкин" });
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    const step = page.getByTestId("event-START_PURCHASE");
    await step.getByRole("button", { name: "Начать закупку" }).click();
    await expect(step.locator(".adm-flash--error")).toContainText(GUARD_TEXT.purchase_too_early);
    const row = await admin.query("select status from sales.orders where id = $1", [o.orderId]);
    expect(row[0]?.status).toBe("accepted");
  });

  test("закрытие без сверки: остаток не возвращён — «Свести остаток» отказывает, закрывает только система", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const flow = flowOf(world, owner);
    const o = await reportSentOrder(flow, "Сверка Сверкина");
    await customerAcceptsReport(world, o.orderId);
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    const settle = page.getByTestId("event-REMAINDER_SETTLED");
    // The refund of the remainder is not confirmed: received != purchased + returned.
    await settle.getByRole("button", { name: "Свести остаток" }).click();
    await expect(settle.locator(".adm-flash--error")).toContainText(GUARD_TEXT.not_reconciled);
    expect((await admin.query("select status from sales.orders where id = $1", [o.orderId]))[0]?.status).toBe("report_sent");
    const registry = await admin.query("select 1 from sales.payments where order_id = $1 and kind = 'remainder_refund' and status = 'confirmed'", [
      o.orderId,
    ]);
    expect(registry).toHaveLength(0);
  });

  test("у переданного заказа нет кнопки «Закрыть»: закрытие — дело системы после сверки", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    await signIn(page, admin, owner);
    const o = await handedOverOrder(flowOf(world, owner), "Закрытие Закрытов");
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "handed_over");
    await expect(page.getByTestId("no-steps")).toContainText("закроется автоматически");
    await expect(page.getByRole("button", { name: /Закрыть заказ/ })).toHaveCount(0);
    expect(await workerCloses(world, o.orderId)).toEqual({ ok: true, status: "closed" });
    await page.reload();
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "closed");
  });

  test("смета не меняется после отправки и не уходит помощником", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    const helper = await admin.createUser("assistant");
    const o = await sentOrder(flowOf(world, owner), "Смета Сметина");
    await signIn(page, admin, owner);
    await page.goto(`${admin.baseURL}/orders/${o.orderId}/quote`);
    await expect(page.getByTestId("quote-readonly")).toContainText("Смету можно менять, пока заказ");
    await expect(page.getByTestId("catalog-results")).toHaveCount(0);
    await expect(page.getByTestId("send-quote")).toHaveCount(0);

    const draft = await draftOrder(flowOf(world, owner), "Смета Черновая");
    await page.context().clearCookies();
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/orders/${draft.orderId}/quote`);
    await expect(page.getByTestId("quote-readonly")).toBeVisible();
    await expect(page.getByTestId("send-quote")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Добавить" })).toHaveCount(0);
  });
});

test.describe("помощник и бухгалтер", () => {
  onlyDesktop();

  test("кнопок денег у помощника нет ни на одном шаге заказа, а закупки он записывает", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    const helper = await admin.createUser("assistant");
    const flow = flowOf(world, owner);
    const accepted = await acceptedOrder(flow, "Помощник Принят");
    const buying = await purchasingOrder(flow, "Помощник Закупка");
    await signIn(page, admin, helper);

    await page.goto(`${admin.baseURL}/orders/${accepted.orderId}`);
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "accepted");
    for (const name of [
      "Подтвердить платёж",
      "Начать закупку",
      "Аванс платы получен",
      "Деньги на закупку получены",
      "Отменить заказ",
      "Поставить ожидание",
      "Записать согласие клиента",
      "Сформировать отчёт",
    ]) {
      await expect(page.getByRole("button", { name }), name).toHaveCount(0);
    }
    await expect(page.getByText("Подтвердить или аннулировать")).toHaveCount(0);
    await expect(page.getByText("Ожидать платёж")).toHaveCount(0);
    await expect(page.getByTestId("no-steps")).toContainText("Сейчас по этому заказу шагов нет");

    await page.goto(`${admin.baseURL}/orders/${buying.orderId}`);
    await expect(page.getByRole("button", { name: "Закупки закрыты" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Отправить отчёт клиенту" })).toHaveCount(0);
    await expect(page.getByTestId("consent-details")).toHaveCount(0);
    const form = page.getByTestId("record-purchase");
    await fillPurchase(page, { line: "Ryzen 5 7600", amount: formatSum(2_800_000).replace(/ сум$/, ""), receipt: "CH-HELPER-1" });
    await form.getByRole("button", { name: "Записать покупку" }).click();
    await expect(form.locator(".adm-flash--ok")).toContainText("Покупка записана");
    const by = await admin.query<{ bought_by: string }>("select bought_by from sales.purchases where order_id = $1", [buying.orderId]);
    expect(by[0]?.bought_by).toBe(helper.id);
  });

  test("помощник не открывает порог и выгрузку; бухгалтер читает порог и выгружает, но не вносит и не видит заказы", async ({ page, admin }) => {
    const helper = await admin.createUser("assistant");
    const accountant = await admin.createUser("accountant");
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/registry`);
    await expect(page).toHaveURL(/\/forbidden/);
    const blocked = await page.request.get(`${admin.baseURL}/registry/export`);
    expect(blocked.status()).toBe(403);
    await page.goto(`${admin.baseURL}/dashboard`);
    await expect(page.getByTestId("threshold")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Порог и учёт" })).toHaveCount(0);

    await page.context().clearCookies();
    await signIn(page, admin, accountant);
    await page.goto(`${admin.baseURL}/registry`);
    await expect(page.getByTestId("threshold")).toBeVisible();
    await expect(page.getByTestId("registry-export")).toBeVisible();
    await expect(page.getByTestId("income-form")).toHaveCount(0);
    const csv = await page.request.get(`${admin.baseURL}/registry/export`);
    expect(csv.status()).toBe(200);
    await page.goto(`${admin.baseURL}/orders`);
    await expect(page).toHaveURL(/\/forbidden/);
  });
});

test.describe("заявки, порог, доска", () => {
  onlyDesktop();

  test("заявка сайта без клиента: помощник привязывает клиента, телефон видит только владелец", async ({ page, admin, world }) => {
    const helper = await admin.createUser("assistant");
    const owner = await admin.createUser("owner");
    const phone = `+99893${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const lead = await siteLeadWithoutCustomer(world, "Сайтов Клиент", phone);
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/leads`);
    const row = page.locator(`[data-lead="${lead.number}"]`);
    await expect(row).toContainText("клиент не привязан");
    await expect(row).toContainText("Сайтов Клиент");
    await expect(row).not.toContainText(phone);
    await expect(row.getByRole("button", { name: "Взять в работу" })).toHaveCount(0);

    await row.getByTestId("bind-open").click();
    const section = page.getByTestId("bind-section");
    await section.getByLabel("Имя, Telegram или телефон клиента").fill("Существующий Сайтов");
    await section.getByRole("button", { name: "Найти" }).click();
    await section.getByTestId("customer-results").getByRole("button", { name: "Привязать" }).click();
    await expect(section.locator(".adm-flash--ok")).toContainText("Заявка привязана к клиенту");
    const bound = await admin.query("select customer_id from sales.leads where id = $1", [lead.leadId]);
    expect(bound[0]?.customer_id).toBe(lead.existingCustomerId);

    await page.goto(`${admin.baseURL}/leads`);
    await page.locator(`[data-lead="${lead.number}"]`).getByRole("button", { name: "Взять в работу" }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);

    await page.context().clearCookies();
    await signIn(page, admin, owner);
    const second = await siteLeadWithoutCustomer(world, "Сайтов Второй", `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
    await page.goto(`${admin.baseURL}/leads`);
    await expect(page.locator(`[data-lead="${second.number}"]`)).toContainText("+99890");
  });

  test("порог: доход другой деятельности входит в сделки года, выгрузка и доска показывают заказы", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    const flow = flowOf(world, owner);
    const reported = await reportSentOrder(flow, "Реестр Реестров");
    const lead = await botLead(world, "Заявка Заявкина");
    await signIn(page, admin, owner);
    const year = Number(tashkentToday().slice(0, 4));

    await page.goto(`${admin.baseURL}/registry`);
    const row = page.locator(`[data-testid="registry-row"]`).filter({ hasText: reported.number });
    await expect(row).toHaveCount(1);
    // The remainder is still to be returned: the difference is what the customer is owed.
    await expect(row.getByTestId("registry-diff")).not.toHaveText(sumText(0));

    const income = page.getByTestId("income-form");
    await income.getByLabel("Месяц (ГГГГ-ММ)").fill(`${year}-09`);
    await income.getByLabel("Сумма, сумов").fill("12 000 000");
    await income.getByLabel("Примечание").fill("Другая деятельность ИП");
    await income.getByRole("button", { name: "Внести доход" }).click();
    await expect(income.locator(".adm-flash--ok")).toContainText("Доход другой деятельности записан");
    await expect(page.getByTestId("deals-other")).toHaveText(sumText(12_000_000));
    const view = await admin.query<{ deals_sum: string }>(
      "select deals_sum::text from sales.v_deal_volume_by_year where year = $1",
      [year],
    );
    await expect(page.getByTestId("deals-total")).toHaveText(sumText(Number(view[0]?.deals_sum)));
    await expect(page.getByTestId("threshold-volume")).toHaveText(sumText(Number(view[0]?.deals_sum)));

    await income.getByLabel("Месяц (ГГГГ-ММ)").fill("осень");
    await income.getByLabel("Сумма, сумов").fill("1");
    await income.getByRole("button", { name: "Внести доход" }).click();
    await expect(income.locator(".adm-flash--error")).toContainText("Период");

    await page.goto(`${admin.baseURL}/dashboard`);
    await expect(page.getByTestId("dash-leads")).toContainText(lead.number);
    await expect(page.getByTestId("dash-refunds")).toContainText(reported.number);
    await expect(page.getByTestId("threshold-share")).toBeVisible();

    await page.goto(`${admin.baseURL}/orders?q=${encodeURIComponent("Реестр Реестров")}`);
    await expect(page.getByTestId("board-row")).toHaveCount(1);
    await expect(page.getByTestId("board-row")).toContainText(reported.number);
    await page.goto(`${admin.baseURL}/orders?status=report_sent`);
    await expect(page.getByTestId("stage-report_sent")).toContainText(reported.number);
  });
});

test.describe("гарантия, паспорт и кнопки PDF", () => {
  onlyDesktop();

  test("гарантийный случай по переданному заказу открывает помощник; PDF-кнопки появляются только с флагом", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    const helper = await admin.createUser("assistant");
    const o = await handedOverOrder(flowOf(world, owner), "Гарантия Гарантова");
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    await expect(page.getByTestId("pdf")).toHaveCount(0);

    const warranty = page.getByTestId("warranty");
    await warranty.locator("summary", { hasText: "Открыть гарантийный случай" }).click();
    const open = page.getByTestId("open-warranty");
    await open.getByLabel("Что случилось").fill("Артефакты на экране под нагрузкой");
    await open.getByRole("button", { name: "Открыть случай" }).click();
    await expect(open.locator(".adm-flash--ok")).toContainText("открыт");
    const kase = warranty.locator('[data-testid^="warranty-G-"]');
    await expect(kase).toContainText("Артефакты на экране");
    await kase.locator("summary", { hasText: "Следующий шаг" }).click();
    await kase.getByLabel("Действие").selectOption("START_DIAGNOSIS");
    await kase.getByRole("button", { name: "Выполнить" }).click();
    await expect(kase.locator(".adm-flash--ok")).toContainText("диагностика");

    await page.goto(`${admin.baseURL}/dashboard`);
    await expect(page.getByTestId("dash-warranty")).toContainText("G-");

    // The switch of the PDF documents (WP-12 does not exist yet): off, the card has no such block; on, it asks the worker.
    await world.db.$client.query(
      "insert into ops.settings (key, value, updated_by) values ('feature.pdf', 'true'::jsonb, 'e2e') on conflict (key) do update set value = excluded.value",
    );
    try {
      await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
      await expect(page.getByTestId("pdf")).toBeVisible();
      await page.getByTestId("render-quote").getByRole("button", { name: "Сформировать заново" }).click();
      await expect(page.getByTestId("render-quote").locator(".adm-flash--ok")).toContainText("поставлен в очередь");
      const jobs = await admin.query<{ payload: { doc: string; orderId: string } }>(
        "select payload from ops.outbox where payload->>'job' = 'pdf.render' and payload->>'orderId' = $1",
        [o.orderId],
      );
      expect(jobs.some((j) => j.payload.doc === "quote")).toBe(true);
    } finally {
      await world.db.$client.query("update ops.settings set value = 'false'::jsonb where key = 'feature.pdf'");
    }
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    await expect(page.getByTestId("pdf")).toHaveCount(0);
  });

  test("в таблице платежей у помощника нет колонки действий, а цены сметы видны", async ({ page, admin, world }) => {
    const owner = await admin.createUser("owner");
    const helper = await admin.createUser("assistant");
    const o = await paidOrder(flowOf(world, owner), { name: "Платежи Платёжев" });
    await signIn(page, admin, helper);
    await page.goto(`${admin.baseURL}/orders/${o.orderId}`);
    const payments = page.getByTestId("payments");
    await expect(payments.getByRole("columnheader", { name: "Действия" })).toHaveCount(0);
    await expect(payments).toContainText("FR-");
    await expect(page.getByTestId("quote-lines").locator("tbody tr")).toHaveCount(PC_CATALOG.length);
  });
});

export type { AdminHarness };
