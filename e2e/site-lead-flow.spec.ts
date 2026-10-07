import { type SiteHarness, startSiteHarness } from "../apps/web/src/lead-form/e2e/harness.ts";
import { test as guarded, expect as guardedExpect } from "./fixtures.ts";

// WP-16, BUILD_PLAN: заявка с сайта доходит до базы. Сайт с настоящим сервисом заявок (роль web) и своей базой на воркер:
// заявка получает номер L-<год>-NNNN, рядом лежат согласие на обработку данных и задача для темы владельца в outbox,
// повторное нажатие не создаёт вторую заявку, а неверная форма не пишет ничего.
const test = guarded.extend<object, { site: SiteHarness }>({
  site: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies of a fixture from its first argument
    async ({}, use, workerInfo) => {
      const harness = await startSiteHarness(workerInfo.parallelIndex);
      try {
        await use(harness);
      } finally {
        await harness.stop();
      }
    },
    { scope: "worker", timeout: 20 * 60_000 },
  ],
});
const expect = guardedExpect.configure({ timeout: 20_000 });

test.describe.configure({ timeout: 90_000 });

const COPY = {
  uz: {
    submit: "Arizani yuborish",
    consent: "Shaxsiy maʼlumotlarni qayta ishlashga roziman",
    phone: "Telefon",
    scope: "Nima kerak",
    contact: "Telefon yoki Telegramni kiriting.",
    scopeNeeded: "Nima kerakligini tanlang.",
    consentNeeded: "rozilik boʻlmasa",
    phoneBad: "Telefon raqamiga oʻxshamaydi",
    ok: "Ariza qabul qilindi",
  },
  ru: {
    submit: "Отправить заявку",
    consent: "Согласен на обработку персональных данных",
    phone: "Телефон",
    scope: "Что нужно",
    contact: "Укажите телефон или Telegram.",
    scopeNeeded: "Выберите, что нужно.",
    consentNeeded: "Без согласия на обработку данных",
    phoneBad: "Не похоже на номер телефона",
    ok: "Заявка принята",
  },
} as const;

for (const locale of ["uz", "ru"] as const) {
  const t = COPY[locale];
  test(`заявка /${locale}: номер, согласие и задача для владельца в базе`, async ({ page, site }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "сквозная проверка идёт в профиле desktop");
    const phone = locale === "uz" ? "+998 90 111 22 33" : "+998 91 444 55 66";
    const e164 = phone.replace(/\s/g, "");
    await page.goto(`${site.baseURL}/${locale}#zayavka`);
    await page.getByLabel(t.phone, { exact: true }).fill(phone);
    await page.getByLabel(t.scope).selectOption("pc");
    await page.getByRole("checkbox", { name: t.consent }).check();
    await page.getByRole("button", { name: t.submit }).click();

    const ok = page.locator(".lead-ok");
    await expect(ok).toBeVisible();
    const number = (await ok.locator("h3").innerText()).match(/L-\d{4}-\d{4}/)?.[0];
    expect(number).toBeTruthy();

    const leads = await site.query<{ channel: string; scope: string; lang: string; phone_e164: string }>(
      "select l.channel, l.scope, l.lang, c.phone_e164 from sales.leads l join sales.customers c on c.id = l.customer_id where l.number = $1",
      [number],
    );
    expect(leads).toEqual([{ channel: "web", scope: "pc", lang: locale, phone_e164: e164 }]);

    const consents = await site.query<{
      kind: string;
      granted: boolean;
      evidence: { lead: string; textVersion: string };
      text_sha256: string | null;
    }>("select kind, granted, evidence, text_sha256 from ops.consents where evidence->>'lead' = $1", [number]);
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ kind: "pd_processing", granted: true });
    expect(consents[0]?.evidence.textVersion).toMatch(/^builtin-/);
    // the fingerprint of the text the visitor was shown (ARCHITECTURE 10.2)
    expect(consents[0]?.text_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(consents[0])).not.toContain(e164);

    const tasks = await site.query<{ payload: { target: string; templateKey: string } }>(
      "select payload from ops.outbox where payload->'params'->>'number' = $1",
      [number],
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.payload).toMatchObject({ target: "owner_topic", templateKey: "lead.created" });
  });
}

test("неверная форма ничего не пишет, повторное нажатие даёт тот же номер", async ({ page, site }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "сквозная проверка идёт в профиле desktop");
  const t = COPY.ru;
  const count = async () => Number((await site.query<{ n: string }>("select count(*) as n from sales.leads"))[0]?.n);
  const before = await count();
  await page.goto(`${site.baseURL}/ru#zayavka`);
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.locator(".lead-error")).toBeVisible();
  expect(await count()).toBe(before);

  let visit = 0;
  const fill = async () => {
    // another address each time: the same address with the same hash would not reload the page and the thanks would stay
    visit += 1;
    await page.goto(`${site.baseURL}/ru?visit=${visit}#zayavka`);
    await page.getByLabel(t.phone, { exact: true }).fill("+998 93 777 88 99");
    await page.getByLabel(t.scope).selectOption("setup");
    await page.getByRole("checkbox", { name: t.consent }).check();
    await page.getByRole("button", { name: t.submit }).click();
    await expect(page.locator(".lead-ok")).toBeVisible();
    return (await page.locator(".lead-ok h3").innerText()).match(/L-\d{4}-\d{4}/)?.[0];
  };
  const first = await fill();
  expect(first).toBeTruthy();
  expect(await count()).toBe(before + 1);

  // the same visitor presses again within half a minute: the same number, no second request
  expect(await fill()).toBe(first);
  expect(await count()).toBe(before + 1);
});

for (const locale of ["uz", "ru"] as const) {
  const t = COPY[locale];
  test.describe(`форма /${locale}`, () => {
    test.beforeEach(({ browserName: _ }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "сквозная проверка идёт в профиле desktop");
    });

    test("пустая форма: ответ сервера называет поля, согласие обязательно", async ({ page, site }) => {
      await page.goto(`${site.baseURL}/${locale}#zayavka`);
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.getByText(t.contact)).toBeVisible();
      await expect(page.getByText(t.scopeNeeded)).toBeVisible();
      await expect(page.getByText(new RegExp(t.consentNeeded))).toBeVisible();
      await expect(page.locator(".lead-error")).toBeVisible();
    });

    test("плохой телефон: ошибка у поля, введённое остаётся, отмеченное согласие не слетает", async ({
      page,
      site,
    }) => {
      await page.goto(`${site.baseURL}/${locale}#zayavka`);
      await page.getByLabel(t.phone, { exact: true }).fill("12345");
      await page.getByLabel(t.scope).selectOption("pc");
      await page.getByRole("checkbox", { name: t.consent }).check();
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.getByText(new RegExp(t.phoneBad))).toBeVisible();
      await expect(page.getByLabel(t.phone, { exact: true })).toHaveValue("12345");
      await expect(page.getByRole("checkbox", { name: t.consent })).toBeChecked();
    });

    test("ловушка для ботов: заполненное скрытое поле выглядит как успех, заявки нет", async ({ page, site }) => {
      const count = async () =>
        Number((await site.query<{ n: string }>("select count(*) as n from sales.leads"))[0]?.n);
      const before = await count();
      await page.goto(`${site.baseURL}/${locale}#zayavka`);
      await page.locator('input[name="website"]').evaluate((el) => {
        (el as HTMLInputElement).value = "http://spam.example";
      });
      await page.getByLabel(t.phone, { exact: true }).fill("+998 90 123 45 67");
      await page.getByLabel(t.scope).selectOption("pc");
      await page.getByRole("checkbox", { name: t.consent }).check();
      await page.getByRole("button", { name: t.submit }).click();
      await expect(page.getByRole("status")).toContainText(t.ok);
      expect(await count()).toBe(before);
    });
  });
}
