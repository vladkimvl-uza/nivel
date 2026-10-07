// Timers, the digest, Telegram and mail, the copy of the book, the monthly cleaning, the self-check, the secrets,
// the forms of the sidebars and the growth of the sheets.
import vm from "node:vm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const TOKEN = "123456:TEST-token-not-a-real-one"; // gitleaks:allow test value, not a secret
const CHAT = "424242";
let p;
const read = (k) => p.call("nvReadTable", k);
const find = (key, field, value) => read(key).find((r) => r[field] === value);
const sheet = (n) => p.env.ss.getSheetByName(n);
const setNow = (iso) => {
  p.env.now = new Date(iso);
};
const WED = "2026-11-04T11:00:00+05:00";
const patch = (key, num, set) => {
  const def = key === "orders" ? "num" : "num";
  const row = find(key, def, num)._row;
  p.ctx.__set = set;
  p.run(`nvWriteCells(${JSON.stringify(key)}, ${row}, __set)`);
};
const mkOrder = (fields, set) => {
  const client = p.call("nvEnsureClient", { name: `Клиент ${fields.n}`, tg: `@c_${fields.n}` });
  const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 10_000_000, purchased: 10_000_000, memory: 0 });
  if (set) patch("orders", num, set);
  return num;
};

beforeAll(() => {
  p = createProject({
    now: new Date(WED),
    scriptProps: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, OWNER_EMAIL: "owner@example.com" },
  });
  p.call("nvSetup");
  p.call("nvInstallTriggers");
}, 120_000);

beforeEach(() => {
  setNow(WED);
  p.env.fetches.length = 0;
  p.env.mails.length = 0;
  p.env.fetchHandler = null;
});

describe("the hourly job", () => {
  it("works only inside the response hours of a working day (10:00-19:00, Monday to Saturday, not on holidays)", () => {
    setNow("2026-11-04T09:30:00+05:00");
    expect(p.call("nvHourlyJob").skipped).toBe(true);
    setNow("2026-11-04T19:00:00+05:00");
    expect(p.call("nvHourlyJob").skipped).toBe(true);
    setNow("2026-11-08T12:00:00+05:00"); // Sunday
    expect(p.call("nvHourlyJob").skipped).toBe(true);
    setNow("2026-11-07T12:00:00+05:00"); // Saturday
    expect(p.call("nvHourlyJob").skipped).toBe(false);
    // A holiday in the dictionary
    sheet("Справочники").getRange("A1").getValue();
    p.env.ss.getRangeByName("NV_HOLIDAYS").getCell(1, 1).setValue(p.date("2026-11-09T00:00:00+05:00"));
    setNow("2026-11-09T12:00:00+05:00");
    expect(p.call("nvHourlyJob").skipped).toBe(true);
    expect(p.call("nvHourlyJob", { force: true }).skipped).toBe(false);
    p.env.ss.getRangeByName("NV_HOLIDAYS").getCell(1, 1).setValue("");
  });

  it("an estimate that has expired becomes «Смета истекла» by the system; one that is still valid does not", () => {
    const old = mkOrder(
      { n: 1 },
      { status: "Смета отправлена", code: "estimate_sent", validUntil: p.date("2026-11-04T10:00:00+05:00") },
    );
    const live = mkOrder(
      { n: 2 },
      { status: "Смета отправлена", code: "estimate_sent", validUntil: p.date("2026-11-05T10:00:00+05:00") },
    );
    const r = p.call("nvHourlyJob");
    expect(r.expired).toBe(1);
    expect(find("orders", "num", old).code).toBe("estimate_expired");
    expect(find("orders", "num", live).code).toBe("estimate_sent");
    const h = read("history")
      .filter((x) => x.num === old)
      .at(-1);
    expect(h).toMatchObject({ event: "EXPIRE", actor: "Система", to: "Смета истекла" });
  });

  it("a report with no objection after its term is accepted «по сроку»; an open objection stops it; the end moment itself is still inside the term", () => {
    const base = { status: "Отчёт отправлен", code: "report_sent", reportAccepted: "Нет" };
    const late = mkOrder({ n: 3 }, { ...base, objectionUntil: p.date("2026-11-04T10:59:59+05:00") });
    const exact = mkOrder({ n: 4 }, { ...base, objectionUntil: p.date("2026-11-04T11:00:00+05:00") });
    const objected = mkOrder(
      { n: 5 },
      { ...base, objectionUntil: p.date("2026-11-04T09:00:00+05:00"), objection: "Не та модель" },
    );
    expect(p.call("nvHourlyJob").deemed).toBe(1);
    expect(find("orders", "num", late).reportAccepted).toBe("По сроку");
    expect(find("orders", "num", exact).reportAccepted).toBe("Нет");
    expect(find("orders", "num", objected).reportAccepted).toBe("Нет");
  });

  it("a handed-over order that reconciles is closed; one that does not stays", () => {
    const rec = mkOrder({ n: 6 }, { status: "Сдан", code: "handed_over" });
    const bad = mkOrder({ n: 7 }, { status: "Сдан", code: "handed_over" });
    p.call("nvCreatePayment", {
      order: bad,
      kind: "Деньги на закупку",
      amount: 10_300_000,
      status: "Подтверждён",
      method: "Перевод на счёт ИП",
    });
    expect(p.call("nvHourlyJob").closed).toBeGreaterThanOrEqual(1);
    expect(find("orders", "num", rec).code).toBe("closed");
    expect(find("orders", "num", bad).code).toBe("handed_over");
  });
});

describe("urgent reminders go to Telegram once", () => {
  it("a new lead without a reply longer than 2 working hours: one message, not repeated; the token is not in the text", () => {
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Срочный" });
    patch("leads", num, { created: p.date("2026-11-04T10:05:00+05:00") });
    setNow("2026-11-04T12:30:00+05:00");
    expect(p.call("nvHourlyJob").reminders).toBeGreaterThanOrEqual(1);
    const sent = p.env.fetches.filter((f) => f.url.includes("api.telegram.org"));
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0].options.payload);
    expect(body.chat_id).toBe(CHAT);
    expect(body.text).toContain(num);
    expect(body.text).not.toContain("Срочный");
    expect(body.text).not.toContain(TOKEN);
    expect(sent[0].options.muteHttpExceptions).toBe(true);
    p.env.fetches.length = 0;
    setNow("2026-11-04T13:30:00+05:00");
    p.call("nvHourlyJob");
    expect(p.env.fetches).toHaveLength(0);
  });

  it("the time of the lead counts only the working hours: created after the close of Saturday, not late on Monday morning", () => {
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Ночной" });
    patch("leads", num, { created: p.date("2026-11-07T18:00:00+05:00") }); // Saturday evening
    setNow("2026-11-09T10:30:00+05:00"); // Monday morning: 1 hour of Saturday + 0.5 of Monday
    p.call("nvHourlyJob");
    expect(p.env.fetches.filter((f) => JSON.parse(f.options.payload).text.includes(num))).toHaveLength(0);
    setNow("2026-11-09T12:10:00+05:00");
    p.call("nvHourlyJob");
    expect(p.env.fetches.filter((f) => JSON.parse(f.options.payload).text.includes(num))).toHaveLength(1);
  });
});

describe("the owner is told by Telegram, and by mail if Telegram fails", () => {
  it("sends through the Bot API with the token from the properties", () => {
    const r = p.call("nvNotifyOwner", "Проверка");
    expect(r).toEqual({ ok: true, via: "telegram" });
    expect(p.env.fetches[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
  });

  it("falls back to the mail when Telegram answers with an error", () => {
    p.env.fetchHandler = () => ({ code: 502, body: "bad gateway" });
    expect(p.call("nvNotifyOwner", "Проверка")).toEqual({ ok: true, via: "mail" });
    expect(p.env.mails[0].to).toBe("owner@example.com");
    p.env.fetchHandler = () => {
      throw new Error("network down");
    };
    expect(p.call("nvNotifyOwner", "Проверка").via).toBe("mail");
  });

  it("with neither of them set it reports that nothing was sent", () => {
    const keep = [...p.env.scriptProps];
    p.env.scriptProps.clear();
    expect(p.call("nvNotifyOwner", "Проверка")).toEqual({ ok: false, via: "" });
    for (const [k, v] of keep) p.env.scriptProps.set(k, v);
  });

  it("the setting «Почта» as the channel skips Telegram", () => {
    const row = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())")).find(
      (x) => x.def.name === "NV_DIGEST_CHANNEL",
    ).row;
    sheet("Настройки").getRange(row, 3).setValue("Почта");
    p.call("nvResetSettingsCache");
    expect(p.call("nvNotifyOwner", "Проверка").via).toBe("mail");
    expect(p.env.fetches).toHaveLength(0);
    sheet("Настройки").getRange(row, 3).setValue("Telegram");
    p.call("nvResetSettingsCache");
  });
});

describe("the daily digest", () => {
  beforeAll(() => {
    // Rows of the sheet «Сегодня» as the formulas would give them
    const sh = sheet("Сегодня");
    [
      [
        "03.11.2026",
        "Просрочено",
        "Отправить отчёт о закупке (цель 24 ч)",
        "Заказ",
        "NV-2026-0900",
        "Тайный Клиент",
        5_000_000,
        "report_due",
      ],
      [
        "04.11.2026",
        "Сегодня",
        "Можно начинать закупку",
        "Заказ",
        "NV-2026-0901",
        "Другой Имя",
        20_600_000,
        "can_purchase",
      ],
    ].forEach((row, i) => {
      row.forEach((v, j) => {
        sh._cell(6 + i, 2 + j).v = v;
      });
    });
    p.call("nvCreatePayment", {
      order: "NV-2026-0901",
      kind: "Аванс платы 30 %",
      amount: 900_000,
      status: "Ожидается",
      date: p.date("2026-11-04T00:00:00+05:00"),
    });
  });

  it("holds the overdue and today's tasks, the expected payments, the orders by stages, yesterday, the threshold and the tax terms", () => {
    const text = p.call("nvDigestText");
    expect(text).toContain("сводка на 04.11.2026");
    expect(text).toContain("Просрочено: 1, на сегодня: 1");
    expect(text).toContain("NV-2026-0900 Отправить отчёт о закупке");
    expect(text).toContain("Ожидаемые платежи: 1");
    expect(text).toContain("Заказы по этапам:");
    expect(text).toContain("Вчера: новых заявок");
    expect(text).toContain("Порог 2026:");
    expect(text).toContain("из 1 000 000 000 сум");
  });

  it("has numbers, sums and stages only: no names, no phones, no nicknames", () => {
    const text = p.call("nvDigestText");
    for (const bad of ["Тайный Клиент", "Другой Имя", "@c_", "Клиент 1", "+998"]) expect(text).not.toContain(bad);
  });

  it("the tax term of the 15th and the reconciliation of the last working day appear in the week before", () => {
    setNow("2026-11-12T09:00:00+05:00");
    expect(p.call("nvDigestText")).toContain("Налоги: до 15.11.2026");
    setNow("2026-11-28T09:00:00+05:00");
    expect(p.call("nvDigestText")).toContain("Сверка счёта «средства комитентов» — 30.11.2026");
    setNow("2026-11-20T09:00:00+05:00");
    const text = p.call("nvDigestText");
    expect(text).not.toContain("Налоги: до");
    expect(text).not.toContain("Сверка счёта");
  });

  it("goes out Monday to Saturday, not on Sunday unless asked; the menu item sends it at once", () => {
    setNow("2026-11-08T09:00:00+05:00"); // Sunday
    expect(p.call("nvDailyDigest")).toMatchObject({ sent: false, reason: "воскресенье" });
    expect(p.env.fetches).toHaveLength(0);
    setNow("2026-11-09T09:00:00+05:00"); // Monday
    const r = p.call("nvDailyDigest");
    expect(r.sent).toBe(true);
    expect(r.via).toBe("telegram");
    expect(JSON.parse(p.env.fetches[0].options.payload).text).toContain("сводка на 09.11.2026");
    setNow("2026-11-08T09:00:00+05:00");
    expect(p.call("nvDailyDigest", { force: true }).sent).toBe(true);
  });

  it("is plain business Russian without emoji", () => {
    const text = p.call("nvDigestText");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the weekly copy and the monthly cleaning", () => {
  it("makes a copy in the folder «Nivel CRM — копии» and keeps the last eight", () => {
    for (let i = 0; i < 11; i++) {
      setNow(new Date(Date.parse("2026-11-01T03:00:00+05:00") + i * 7 * 86_400_000).toISOString());
      p.call("nvWeeklyBackup");
    }
    const folder = p.env.folders.get("Nivel CRM — копии");
    expect(folder).toBeTruthy();
    const alive = p.env.files.filter((f) => !f.trashed);
    expect(alive).toHaveLength(8);
    expect(p.env.files.filter((f) => f.trashed)).toHaveLength(3);
    expect(p.env.files.every((f) => f.name.startsWith("Nivel CRM 20"))).toBe(true);
  });

  it("can be switched off in the settings", () => {
    const row = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())")).find((x) => x.def.name === "NV_BACKUP_ON").row;
    sheet("Настройки").getRange(row, 3).setValue(false);
    p.call("nvResetSettingsCache");
    expect(p.call("nvWeeklyBackup").ok).toBe(false);
    sheet("Настройки").getRange(row, 3).setValue(true);
    p.call("nvResetSettingsCache");
  });

  it("cleans the journal of the webhook older than 12 months and tells about the old leads without an order", () => {
    setNow("2026-12-01T03:00:00+05:00");
    p.call("nvAppendRows", "webhook", [
      {
        received: p.date("2025-10-01T10:00:00+05:00"),
        eventId: "old-1",
        type: "lead.created",
        result: "Применено",
        hash: "a".repeat(16),
      },
      {
        received: p.date("2026-11-20T10:00:00+05:00"),
        eventId: "new-1",
        type: "lead.created",
        result: "Применено",
        hash: "b".repeat(16),
      },
    ]);
    const stale = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Давний", tg: "@old" });
    patch("leads", stale, { created: p.date("2025-10-10T10:00:00+05:00") });
    const r = p.call("nvMonthlyJob");
    expect(r.cleaned).toBe(1);
    expect(read("webhook").map((x) => x.eventId)).toEqual(["new-1"]);
    expect(r.stale).toBeGreaterThanOrEqual(1);
    const msg = p.env.fetches.map((f) => JSON.parse(f.options.payload).text).join("\n");
    expect(msg).toContain(stale);
    expect(msg).not.toContain("Давний");
    // "Обезличить": the name and the nick become «удалено», the number and the sums stay
    expect(p.call("nvAnonymizeStaleLeads")).toBeGreaterThanOrEqual(1);
    const lead = find("leads", "num", stale);
    expect(lead.name).toBe("удалено");
    expect(lead.tg).toBe("удалено");
    expect(lead.num).toBe(stale);
  });
});

describe("the self-check", () => {
  it("passes on a built book: no errors; the missing optional secrets are only warnings with «не задано» / «задано»", () => {
    p.env.scriptProps.set("NIVEL_HMAC_SECRET", "x".repeat(40));
    const r = p.call("nvSelfCheck");
    const rows = JSON.parse(JSON.stringify(r.rows));
    const bad = rows.filter((x) => x.result === "Ошибка");
    expect(bad).toEqual([]);
    expect(r.errors).toBe(0);
    const names = rows.map((x) => x.check);
    for (const c of [
      "Листы на месте",
      "Заголовки колонок",
      "Формулы в заголовках не стёрты",
      "Именованные диапазоны",
      "Доли этапов",
      "Контрольные случаи платы",
      "Порог года",
      "Резерв гарантии",
      "Пары платежей",
      "Статусы заказа",
      "Триггеры",
      "Часовой пояс и локаль",
      "Шрифты",
      "Вебхук",
      "Счётчики номеров",
    ]) {
      expect(names).toContain(c);
    }
    const secrets = rows.filter((x) =>
      ["Токен Telegram", "Чат Telegram", "Почта владельца", "Ключ вебхука"].includes(x.check),
    );
    for (const s of secrets) expect(["задано", "не задано"]).toContain(s.details);
    expect(sheet("Самопроверка").tabColor).toBe("#A9A59C");
  });

  it("writes the report to the sheet and never the value of a secret", () => {
    const all = JSON.stringify([...sheet("Самопроверка").cells.values()].map((c) => c.v));
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(CHAT);
    expect(all).not.toContain("owner@example.com");
    expect(all).not.toContain("x".repeat(40));
  });

  it("finds a header formula that was erased, a missing sheet, a trigger gone, shares that do not add up; the tab turns orange", () => {
    const orders = sheet("Заказы");
    const col = 2 + JSON.parse(p.run("JSON.stringify(NV_SCHEMA.orders.cols.map((c) => c.key))")).indexOf("feeTotal");
    const saved = orders.getRange(5, col).getFormula();
    orders.getRange(5, col).setValue("Плата итого");
    let r = p.call("nvSelfCheck");
    expect(r.errors).toBeGreaterThanOrEqual(1);
    expect(r.rows.find((x) => x.check === "Формулы в заголовках не стёрты").details).toContain("Заказы!Плата итого");
    expect(sheet("Самопроверка").tabColor).toBe("#D9501A");
    orders.getRange(5, col).setFormula(saved);

    p.env.triggers = p.env.triggers.filter((t) => t.handler !== "nvDailyDigest");
    r = p.call("nvSelfCheck");
    expect(r.rows.find((x) => x.check === "Триггеры").result).toBe("Ошибка");
    p.call("nvInstallTriggers");

    const row = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())")).find(
      (x) => x.def.name === "NV_STAGE_ASSEMBLY_BP",
    ).row;
    sheet("Настройки").getRange(row, 3).setValue(3000);
    p.call("nvResetSettingsCache");
    expect(p.call("nvSelfCheck").rows.find((x) => x.check === "Доли этапов").result).toBe("Ошибка");
    sheet("Настройки").getRange(row, 3).setValue(3500);
    p.call("nvResetSettingsCache");

    const lone = p.env.ss.getSheetByName("Самопроверка");
    p.env.ss.deleteSheet(lone);
    r = p.call("nvSelfCheckRows");
    expect(r[0].result).toBe("Ошибка");
    p.env.ss.insertSheet("Самопроверка");
    p.call("nvSetup");
    expect(p.call("nvSelfCheck").errors).toBe(0);
  }, 90_000);

  it("a counter below the largest number in the sheet is a warning; and the next number never repeats one that exists", () => {
    p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Счёт" });
    const last = read("leads").at(-1).num;
    p.env.scriptProps.set("COUNTER_L_2026", "1");
    const row = p.call("nvSelfCheckRows").find((x) => x.check === "Счётчики номеров");
    expect(row.result).toBe("Предупреждение");
    const next = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "После потери счётчика" });
    expect(next).not.toBe(last);
    expect(new Set(read("leads").map((l) => l.num)).size).toBe(read("leads").length);
  });

  it("the webhook check: silent for more than 48 hours when the integration is on", () => {
    const row = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())")).find((x) => x.def.name === "NV_WEBHOOK_ON").row;
    sheet("Настройки").getRange(row, 3).setValue(true);
    p.call("nvResetSettingsCache");
    p.env.scriptProps.set("NV_LAST_WEBHOOK_AT", String(p.env.now.getTime() - 49 * 3600000));
    expect(p.call("nvSelfCheckRows").find((x) => x.check === "Вебхук").result).toBe("Предупреждение");
    p.env.scriptProps.set("NV_LAST_WEBHOOK_AT", String(p.env.now.getTime() - 3600000));
    expect(p.call("nvSelfCheckRows").find((x) => x.check === "Вебхук").result).toBe("ОК");
    sheet("Настройки").getRange(row, 3).setValue(false);
    p.call("nvResetSettingsCache");
  });
});

describe("secrets", () => {
  it("are asked in dialogs, kept only in the script properties, never written to a sheet, a toast or the log", () => {
    p.env.scriptProps.clear();
    p.env.promptAnswers.push(TOKEN, CHAT);
    p.call("nvSecretTelegramUi");
    expect(p.env.scriptProps.get("TELEGRAM_BOT_TOKEN")).toBe(TOKEN);
    expect(p.env.scriptProps.get("TELEGRAM_CHAT_ID")).toBe(CHAT);
    p.env.promptAnswers.push("owner@example.com");
    p.call("nvSecretEmailUi");
    p.env.alertAnswers.push("YES");
    p.call("nvSecretWebhookUi");
    const key = p.env.scriptProps.get("NIVEL_HMAC_SECRET");
    expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(p.env.alerts.at(-1).text).toContain(key);
    p.env.alertAnswers.push("YES");
    p.call("nvSecretWebhookUi");
    expect(p.env.scriptProps.get("NIVEL_HMAC_SECRET_PREV")).toBe(key);
    expect(p.env.scriptProps.get("NIVEL_HMAC_SECRET")).not.toBe(key);
    const everything =
      JSON.stringify([...p.env.ss.sheets].flatMap((s) => [...s.cells.values()].map((c) => [c.v, c.f]))) +
      JSON.stringify(p.env.ss.toasts) +
      p.env.logs.join("\n");
    for (const secret of [TOKEN, CHAT, "owner@example.com", key, p.env.scriptProps.get("NIVEL_HMAC_SECRET")])
      expect(everything).not.toContain(secret);
  });

  it("an empty answer keeps what was set; a cancelled dialog changes nothing", () => {
    p.env.promptAnswers.push("", "");
    p.call("nvSecretTelegramUi");
    expect(p.env.scriptProps.get("TELEGRAM_BOT_TOKEN")).toBe(TOKEN);
    p.env.promptAnswers.push(null);
    p.call("nvSecretTelegramUi");
    expect(p.env.scriptProps.get("TELEGRAM_BOT_TOKEN")).toBe(TOKEN);
  });
});

describe("the forms of the sidebars", () => {
  const kinds = ["lead", "convert", "action", "payment", "purchase", "warranty"];
  it.each(kinds)("the form «%s» is HTML with a script that is valid JavaScript, and every value is escaped", (kind) => {
    const html = p.call("nvFormHtml", kind);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new vm.Script(code)).not.toThrow();
    expect(html).toContain("Fira Sans");
    expect(html).not.toMatch(/<img|onerror|javascript:/i);
  });

  it("the text of a dictionary is escaped in the HTML", () => {
    p.env.ss.getRangeByName("NVD_CATEGORY").getCell(1, 1).setValue('<b onmouseover="x()">Хак & "кавычки"</b>');
    const html = p.call("nvFormHtml", "purchase");
    expect(html).not.toContain('<b onmouseover="x()">');
    expect(html).toContain("&lt;b onmouseover=&quot;x()&quot;&gt;");
    p.env.ss.getRangeByName("NVD_CATEGORY").getCell(1, 1).setValue("Процессор");
  });

  it("a new lead from the form: the number, the channel and the scope are required", () => {
    expect(p.call("nvFormSubmit", "lead", { name: "Без канала" }).ok).toBe(false);
    const r = p.call("nvFormSubmit", "lead", {
      channel: "Сайт",
      scope: "Сетап",
      name: "Форма",
      tg: "@forma",
      budget: "25000000",
      wanted: "2026-12-01",
    });
    expect(r.ok).toBe(true);
    const lead = read("leads").find((l) => r.text.includes(l.num));
    expect(lead.budget).toBe(25_000_000);
    expect(lead.scope).toBe("Сетап");
    expect(lead.tg).toBe("@forma");
  });

  it("a payment from the form: the pair is checked, a confirmed fee needs a receipt, the amount is above zero", () => {
    const num = mkOrder({ n: 9 });
    expect(
      p.call("nvFormSubmit", "payment", { order: num, kind: "Аванс платы 30 %", method: "QR Xolis", amount: "0" }).ok,
    ).toBe(false);
    const noReceipt = p.call("nvFormSubmit", "payment", {
      order: num,
      kind: "Аванс платы 30 %",
      method: "QR Xolis",
      amount: "900000",
      status: "Подтверждён",
    });
    expect(noReceipt).toMatchObject({ ok: false, text: "Нужен фискальный чек" });
    const wrongPair = p.call("nvFormSubmit", "payment", {
      order: num,
      kind: "Деньги на закупку",
      method: "QR Xolis",
      amount: "900000",
      status: "Подтверждён",
    });
    expect(wrongPair.text).toBe("Неверная пара: закупка только на счёт ИП");
    const ok = p.call("nvFormSubmit", "payment", {
      order: num,
      kind: "Аванс платы 30 %",
      method: "QR Xolis",
      amount: "900000",
      status: "Подтверждён",
      receipt: "FS-9",
      payerIsClient: true,
    });
    expect(ok.ok).toBe(true);
    expect(read("payments").some((x) => x.order === num && x.amount === 900_000 && x.receipt === "FS-9")).toBe(true);
  });

  it("a receipt from the form: needs a number of a receipt or ESF, and warns when above the limit", () => {
    const num = mkOrder({ n: 10 }, { status: "Закупка", code: "purchasing" });
    expect(
      p.call("nvFormSubmit", "purchase", { order: num, item: "SSD", amount: "1000000", docKind: "Фискальный чек" }).ok,
    ).toBe(false);
    const r = p.call("nvFormSubmit", "purchase", {
      order: num,
      item: "SSD",
      amount: "1000000",
      docKind: "Фискальный чек",
      receipt: "Ч-1",
    });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Чеки больше полученных денег");
  });

  it("a warranty case from the form", () => {
    const num = mkOrder({ n: 11 });
    const r = p.call("nvFormSubmit", "warranty", {
      order: num,
      desc: "Не включается",
      channel: "Бот",
      fixType: "Работа",
    });
    expect(r.ok).toBe(true);
    expect(read("warranty").some((w) => r.text.includes(w.num) && w.order === num)).toBe(true);
  });

  it("the panel of an order lists the allowed events with the checks that would fail now", () => {
    const num = mkOrder({ n: 12 }, { status: "Принят: ждём оплату", code: "accepted" });
    const info = JSON.parse(JSON.stringify(p.call("nvOrderPanelInfo", num)));
    expect(info.status).toBe("Принят: ждём оплату");
    const start = info.events.find((e) => e.code === "START_PURCHASE");
    expect(start.violations.length).toBeGreaterThan(0);
    expect(info.events.map((e) => e.code)).toContain("CANCEL");
    const res = JSON.parse(JSON.stringify(p.call("nvOrderPanelRun", num, "START_PURCHASE", "", false, "")));
    expect(res.needConfirm).toBe(true);
  });

  it("the menu action «Создать заказ из калькулятора» takes the input of the calculator", () => {
    const calc = sheet("Калькулятор");
    calc.getRange("C6").setValue("Сетап");
    calc.getRange("C7").setValue(17_500_000);
    calc.getRange("C8").setValue(7_500_000);
    calc.getRange("C10").setValue(17_500_000);
    calc.getRange("C12").setValue(true);
    const num = p.call("nvOrderFromCalculator");
    const o = find("orders", "num", num);
    expect(o).toMatchObject({
      kind: "Сетап",
      basePc: 17_500_000,
      baseMount: 7_500_000,
      complex: true,
      code: "estimate_draft",
    });
    expect(o.notes).toBe("Создан из калькулятора");
  });
});

describe("the sheets grow without a seam", () => {
  it("rows are added to a table that is full, and the new rows get the format and the lines of the body", () => {
    const sh = sheet("Заявки");
    const max = sh.maxRows;
    p.call("nvEnsureCapacity", "leads", max - 5);
    expect(sh.maxRows).toBeGreaterThan(max);
    expect(sh._cell(max + 1, 3).nf).toBe("dd.mm.yyyy hh:mm");
    expect(sh.rowH.get(max + 1)).toBe(28);
  });

  it("the lock is re-entrant and is always released, also after an error", () => {
    expect(p.call("nvWithLock", () => p.run("nvWithLock(() => 7)"))).toBe(7);
    expect(p.env.locked).toBe(false);
    expect(() => p.run("nvWithLock(() => { throw new Error('boom'); })")).toThrow("boom");
    expect(p.env.locked).toBe(false);
  });
});
