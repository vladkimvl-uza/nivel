// The automation of the CRM on the mock of Google Sheets: numbers and stamps, the edit trigger, the automaton of the
// statuses with its checks, the flags of "Принят", the reserves, the cancellation, the history, the demo data.
import { beforeAll, describe, expect, it } from "vitest";
import { createWorkCalendar } from "../../packages/domain/src/calendar/index.ts";
import { settleCancellation } from "../../packages/domain/src/cancel/index.ts";
import { DEFAULT_FEE_SETTINGS as S } from "../../packages/domain/src/fee/index.ts";
import { bp, sum } from "../../packages/domain/src/money/index.ts";
import { orderTransitionTable } from "../../packages/domain/src/order/index.ts";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00"); // Wednesday
let p;
let ss;
const sheet = (n) => ss.getSheetByName(n);
const colOf = (key, col) =>
  2 + JSON.parse(p.run(`JSON.stringify(NV_SCHEMA.${key}.cols.map((c) => c.key))`)).indexOf(col);
const read = (key) => p.call("nvReadTable", key);
const find = (key, field, value) => read(key).find((r) => r[field] === value);
const history = (num) => read("history").filter((h) => h.num === num);

/** A user's edit of one cell: the cell gets the value and the installable trigger runs. */
function edit(sheetName, row, col, value, oldValue) {
  const sh = sheet(sheetName);
  const range = sh.getRange(row, col);
  const old = oldValue === undefined ? range.getValue() : oldValue;
  range.setValue(value);
  p.call("nvOnEdit", { range, value, oldValue: old === "" ? undefined : old, source: ss });
  return range;
}
const setNow = (iso) => {
  p.env.now = new Date(iso);
};
const answers = (alerts = [], prompts = []) => {
  p.env.alertAnswers.push(...alerts);
  p.env.promptAnswers.push(...prompts);
};

beforeAll(() => {
  p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
  ss = p.env.ss;
}, 120_000);

describe("the table of transitions is the one of the domain (ARCHITECTURE 4.9)", () => {
  it("every row of the domain table is in the sheet and the sheet has nothing else", () => {
    const mine = JSON.parse(p.run("JSON.stringify(NV_TRANSITIONS)"))
      .map((t) => `${t.from}|${t.event}|${t.to}`)
      .sort();
    const dom = orderTransitionTable()
      .map((t) => `${t.from}|${t.event}|${t.to}`)
      .sort();
    expect(mine).toEqual(dom);
  });

  it("the actors of the events and the 17 statuses are those of the domain", () => {
    const actors = Object.fromEntries(orderTransitionTable().map((t) => [t.event, [...t.actors].sort().join(",")]));
    const mine = JSON.parse(p.run("JSON.stringify(NV_EVENTS)"));
    for (const ev of mine) expect([...ev.actors].sort().join(","), ev.code).toBe(actors[ev.code]);
    expect(mine.map((e) => e.code).sort()).toEqual(Object.keys(actors).sort());
    expect(JSON.parse(p.run("JSON.stringify(NV_STATUSES.map((s) => s.code))"))).toHaveLength(17);
  });

  it("the money events are forbidden to the assistant, as in the domain", () => {
    expect(JSON.parse(p.run("JSON.stringify(NV_MONEY_EVENTS)")).sort()).toEqual(
      [
        "CANCEL",
        "CANCEL_SETTLED",
        "FEE_PREPAID",
        "FUNDS_RECEIVED",
        "HANDOVER",
        "REMAINDER_SETTLED",
        "SEND_ESTIMATE",
        "START_PURCHASE",
      ].sort(),
    );
  });
});

describe("numbers and stamps", () => {
  it("a lead typed by hand gets L-2026-0001, the time of creation, the status and a line of history", () => {
    edit("Заявки", 6, colOf("leads", "name"), "Алишер");
    const lead = read("leads")[0];
    expect(lead.num).toBe("L-2026-0001");
    expect(lead.status).toBe("Новая");
    expect(lead.src).toBe("Вручную");
    expect(lead.demo).toBe(false);
    expect(new Date(lead.created).getTime()).toBe(T0.getTime());
    expect(history("L-2026-0001").map((h) => h.event)).toEqual(["LEAD_CREATED"]);
    expect(p.env.scriptProps.get("COUNTER_L_2026")).toBe("1");
  });

  it("the second lead gets 0002 without a gap", () => {
    edit("Заявки", 7, colOf("leads", "tg"), "bobur");
    expect(read("leads").map((l) => l.num)).toEqual(["L-2026-0001", "L-2026-0002"]);
    expect(p.env.scriptProps.get("COUNTER_L_2026")).toBe("2");
  });

  it("a number cannot be typed or changed by hand: the edit is taken back", () => {
    edit("Заявки", 6, 2, "L-2026-9999", "L-2026-0001");
    expect(sheet("Заявки").getRange(6, 2).getValue()).toBe("L-2026-0001");
    edit("Заявки", 9, 2, "L-2026-5000");
    expect(sheet("Заявки").getRange(9, 2).getValue()).toBe("");
    expect(p.env.ss.toasts.at(-1).msg).toContain("Номер выдаёт скрипт");
  });

  it("an order typed by hand gets NV-2026-0001 in «Смета: черновик» with the list of the allowed events", () => {
    edit("Заказы", 6, colOf("orders", "basePc"), 20_000_000);
    const o = read("orders")[0];
    expect(o.num).toBe("NV-2026-0001");
    expect(o.code).toBe("estimate_draft");
    expect(o.status).toBe("Смета: черновик");
    expect(o.meetingDone).toBe(false);
    const dv = sheet("Заказы").getRange(6, colOf("orders", "action")).getCell(1, 1);
    const cell = sheet("Заказы")._cell(6, colOf("orders", "action"));
    expect(cell.dv.type).toBe("list");
    expect(cell.dv.list).toEqual(["Отправить смету", "Отмена по заявлению клиента"]);
    expect(dv).toBeTruthy();
    expect(history("NV-2026-0001").map((h) => h.event)).toEqual(["ORDER_CREATED"]);
  });

  it("a payment gets P-2026-0001; the kind sets the only allowed method; a flag gets its checkbox with the row", () => {
    edit("Платежи", 6, colOf("payments", "kind"), "Деньги на закупку");
    const pay = read("payments")[0];
    expect(pay.id).toBe("P-2026-0001");
    expect(pay.method).toBe("Перевод на счёт ИП");
    expect(pay.status).toBe("Ожидается");
    expect(sheet("Платежи")._cell(6, colOf("payments", "payerIsClient")).dv.type).toBe("checkbox");
    edit("Платежи", 6, colOf("payments", "kind"), "Возврат платы");
    expect(read("payments")[0].method).toBe("Исходящий перевод");
  });

  it("a payment cannot be confirmed without a fiscal receipt: the status goes back, the owner is told", () => {
    edit("Платежи", 7, colOf("payments", "kind"), "Аванс платы 30 %");
    const row = 7;
    sheet("Платежи").getRange(row, colOf("payments", "method")).setValue("QR Xolis");
    edit("Платежи", row, colOf("payments", "status"), "Подтверждён", "Ожидается");
    expect(find("payments", "id", "P-2026-0002").status).toBe("Ожидается");
    expect(p.env.ss.toasts.at(-1).msg).toContain("Нужен фискальный чек");
    sheet("Платежи").getRange(row, colOf("payments", "receipt")).setValue("FS-1");
    edit("Платежи", row, colOf("payments", "status"), "Подтверждён", "Ожидается");
    const pay = find("payments", "id", "P-2026-0002");
    expect(pay.status).toBe("Подтверждён");
    expect(pay.confirmedBy).toBe("Владелец");
    expect(new Date(pay.confirmedAt).getTime()).toBe(T0.getTime());
  });

  it("a void payment needs a reason", () => {
    edit("Платежи", 7, colOf("payments", "status"), "Аннулирован", "Подтверждён");
    expect(find("payments", "id", "P-2026-0002").status).toBe("Подтверждён");
    expect(p.env.ss.toasts.at(-1).msg).toContain("причину");
    edit("Платежи", 7, colOf("payments", "status"), "Подтверждён", "Подтверждён");
  });

  it("number after 9999 grows by a digit; the number of the platform raises the counter", () => {
    expect(p.call("nvFormatNumber", "L", 2026, 7, false)).toBe("L-2026-0007");
    expect(p.call("nvFormatNumber", "L", 2026, 10000, false)).toBe("L-2026-10000");
    expect(p.call("nvFormatNumber", "L", 2026, 7, true)).toBe("L-2026-D007");
    expect(p.call("nvFormatNumber", "K", 2026, 12, false)).toBe("K-0012");
    p.call("nvBumpCounter", "NV-2026-0050");
    expect(p.env.scriptProps.get("COUNTER_NV_2026")).toBe("50");
    p.call("nvBumpCounter", "NV-2026-0010");
    expect(p.env.scriptProps.get("COUNTER_NV_2026")).toBe("50");
    p.env.scriptProps.set("COUNTER_NV_2026", "1");
  });
});

describe("a lead becomes an order", () => {
  it("leaving «Новая» stamps the first reply; «В заказе» creates the client and the order with two lines of history", () => {
    setNow("2026-10-07T12:30:00+05:00");
    const row = 6;
    edit("Заявки", row, colOf("leads", "scope"), "Сетап");
    sheet("Заявки").getRange(row, colOf("leads", "tg")).setValue("@alisher");
    edit("Заявки", row, colOf("leads", "status"), "В работе", "Новая");
    let lead = find("leads", "num", "L-2026-0001");
    expect(new Date(lead.firstReply).getTime()).toBe(new Date("2026-10-07T12:30:00+05:00").getTime());
    edit("Заявки", row, colOf("leads", "status"), "В заказе", "В работе");
    lead = find("leads", "num", "L-2026-0001");
    expect(lead.order).toBe("NV-2026-0002");
    expect(lead.client).toBe("K-0001");
    const order = find("orders", "num", "NV-2026-0002");
    expect(order.kind).toBe("Сетап");
    expect(order.lead).toBe("L-2026-0001");
    expect(order.client).toBe("K-0001");
    const client = find("clients", "code", "K-0001");
    expect(client.name).toBe("Алишер");
    expect(client.tg).toBe("@alisher");
    const events = history("L-2026-0001").map((h) => h.event);
    expect(events).toEqual(["LEAD_CREATED", "LEAD_STATUS", "LEAD_CONVERTED"]);
    expect(history("NV-2026-0002").map((h) => h.event)).toEqual(["ORDER_CREATED"]);
  });

  it("a second conversion does not create a second order or client", () => {
    const r = p.call("nvConvertLead", "L-2026-0001");
    expect(r.existing).toBe(true);
    expect(read("orders").filter((o) => o.lead === "L-2026-0001")).toHaveLength(1);
    expect(read("clients")).toHaveLength(1);
  });

  it("the client is found by the Telegram nick, not duplicated", () => {
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Алишер (второй раз)", tg: "ALISHER" });
    p.call("nvConvertLead", num);
    expect(read("clients")).toHaveLength(1);
    expect(find("leads", "num", num).client).toBe("K-0001");
  });

  it("«Отказ» without a reason is flagged; the reason is written to the history", () => {
    const num = p.call("nvCreateLead", { channel: "Сайт", scope: "ПК", name: "Тест" });
    const row = find("leads", "num", num)._row;
    edit("Заявки", row, colOf("leads", "status"), "Отказ", "Новая");
    expect(p.env.ss.toasts.at(-1).msg).toContain("причину отказа");
    edit("Заявки", row, colOf("leads", "reason"), "Дорого");
    expect(history(num).map((h) => h.event)).toContain("LEAD_REASON");
  });
});

describe("a platform field of a row from the platform asks before a manual change", () => {
  it("keeps the old value when the owner says no", () => {
    const num = p.call(
      "nvCreateLead",
      { channel: "Telegram-бот", scope: "ПК", name: "От платформы" },
      { number: "L-2026-0300", src: "Платформа" },
    );
    const row = find("leads", "num", num)._row;
    answers(["NO"]);
    edit("Заявки", row, colOf("leads", "name"), "Другое имя", "От платформы");
    expect(find("leads", "num", num).name).toBe("От платформы");
    answers(["YES"]);
    edit("Заявки", row, colOf("leads", "name"), "Другое имя", "От платформы");
    expect(find("leads", "num", num).name).toBe("Другое имя");
    expect(p.env.scriptProps.get("COUNTER_L_2026")).toBe("300");
    p.env.scriptProps.set("COUNTER_L_2026", "5");
  });
});

/** A full cycle of a PC order through the column «Действие». */
describe("the cycle of an order: every step, every check, every date and the reserves", () => {
  let num;
  let clientCode;
  const row = () => find("orders", "num", num)._row;
  const act = (label, a = [], pr = []) => {
    answers(a, pr);
    edit("Заказы", row(), colOf("orders", "action"), label);
    return find("orders", "num", num);
  };
  const pay = (kind, amount, receipt = "", status = "Подтверждён", extra = {}) =>
    p.call("nvCreatePayment", {
      order: num,
      kind,
      amount,
      status,
      receipt,
      date: p.date("2026-10-07T00:00:00+05:00"),
      ...extra,
    });

  beforeAll(() => {
    clientCode = p.call("nvEnsureClient", { name: "Цикл", tg: "@cycle" });
    num = p.call("nvCreateOrder", {
      client: clientCode,
      kind: "ПК",
      basePc: 20_000_000,
      purchased: 20_000_000,
      memory: 3_000_000,
      nextStep: "Отправить смету",
    });
    setNow("2026-10-07T13:00:00+05:00");
  });

  it("the estimate: the limit 20 600 000, fee 3 000 000 (minimum at 20 mln), advance 900 000", () => {
    const s = JSON.parse(
      p.run(
        `JSON.stringify(nvOrderState(nvReadTable("orders").find((o) => o.num === "${num}"), [], [], [], nvSettings(), []))`,
      ),
    );
    expect(s.quote.feeTotal).toBe(3_000_000);
    expect(s.quote.reserveSum).toBe(600_000);
    expect(s.quote.purchaseLimit).toBe(20_600_000);
    expect(s.quote.advance).toBe(900_000);
    expect(s.quote.final).toBe(2_100_000);
  });

  it("SEND_ESTIMATE: «Смета отправлена», valid 24 hours, the date of the stage", () => {
    const o = act("Отправить смету");
    expect(o.code).toBe("estimate_sent");
    expect(new Date(o.validUntil).getTime()).toBe(new Date("2026-10-08T13:00:00+05:00").getTime());
    expect(new Date(o.dEstimate).getTime()).toBe(p.env.now.getTime());
    const cell = sheet("Заказы")._cell(row(), colOf("orders", "action"));
    expect(cell.dv.list).toEqual(["Пересмотреть смету", "Клиент принял", "Отмена по заявлению клиента"]);
    expect(cell.v).toBe("");
  });

  it("an event that the status does not allow is refused with the list of the allowed ones", () => {
    const r = p.call("nvApplyOrderEvent", num, "START_PURCHASE", { actor: "owner" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_transition");
    expect(r.text).toBe(
      "Из «Смета отправлена» доступно: Пересмотреть смету, Клиент принял, Отмена по заявлению клиента",
    );
  });

  it("ACCEPT in the name of the customer needs the link to the confirmation", () => {
    answers([], [null]);
    edit("Заказы", row(), colOf("orders", "action"), "Клиент принял");
    expect(find("orders", "num", num).code).toBe("estimate_sent");
    const o = act("Клиент принял", [], ["https://t.me/c/123/45"]);
    expect(o.code).toBe("accepted");
    expect(o.notes).toContain("https://t.me/c/123/45");
    expect(history(num).at(-1).reason).toBe("https://t.me/c/123/45");
  });

  it("START_PURCHASE is refused while the money is not there; the owner may cancel the action", () => {
    const o = act("Начать закупку", ["NO"]);
    expect(o.code).toBe("accepted");
    const alert = p.env.alerts.at(-1);
    expect(alert.title).toBe("Не выполнено");
    expect(alert.text).toContain("Нужны оба флага");
    expect(history(num).filter((h) => h.event === "START_PURCHASE")).toHaveLength(0);
  });

  it("the flags are set from the payments and written to the history once: advance, then the funds", () => {
    pay("Аванс платы 30 %", 900_000, "FS-100");
    expect(history(num).filter((h) => h.event === "FEE_PREPAID")).toHaveLength(1);
    expect(history(num).filter((h) => h.event === "FUNDS_RECEIVED")).toHaveLength(0);
    pay("Деньги на закупку", 20_600_000, "", "Подтверждён", { method: "Перевод на счёт ИП", bankDoc: "БД-1" });
    expect(history(num).filter((h) => h.event === "FUNDS_RECEIVED")).toHaveLength(1);
    p.call("nvSyncAcceptedFlags", num);
    expect(history(num).filter((h) => h.event === "FUNDS_RECEIVED")).toHaveLength(1);
    expect(history(num).filter((h) => h.event === "FEE_PREPAID")).toHaveLength(1);
    const list = sheet("Заказы")._cell(row(), colOf("orders", "action")).dv.list;
    expect(list).toEqual(["Встреча проведена", "Начать закупку", "Отмена по заявлению клиента"]);
  });

  it("the purchase is not allowed before the next working day 10:00 and without the meeting (first order from 15 mln)", () => {
    const first = p.call("nvApplyOrderEvent", num, "START_PURCHASE", { actor: "owner" });
    expect(first.needConfirm).toBe(true);
    const codes = first.violations.map((v) => v.code);
    expect(codes).toContain("purchase_too_early");
    expect(codes).toContain("meeting_required");
    expect(first.text).toContain("08.10.2026 10:00");
  });

  it("MEETING_DONE from the flag in the sheet; the time passes; START_PURCHASE goes through", () => {
    edit("Заказы", row(), colOf("orders", "meetingDone"), true, false);
    expect(history(num).filter((h) => h.event === "MEETING_DONE")).toHaveLength(1);
    setNow("2026-10-08T10:05:00+05:00");
    const o = act("Начать закупку");
    expect(o.code).toBe("purchasing");
    expect(new Date(o.dPurchase).getTime()).toBe(p.env.now.getTime());
  });

  it("receipts: the records are written; more than the money received is never allowed", () => {
    for (const [item, amount] of [
      ["Процессор", 6_200_000],
      ["Видеокарта", 9_000_000],
      ["Остальное", 4_800_000],
    ]) {
      p.call("nvCreatePurchase", {
        order: num,
        item,
        amount,
        category: "Другое",
        shop: "Магазин 1",
        docKind: "Фискальный чек",
        receipt: `ЧК-${amount}`,
      });
    }
    expect(history(num).filter((h) => h.event === "PURCHASE_RECORDED")).toHaveLength(3);
    expect(p.call("nvPurchaseWarnings", p.call("nvLoadOrderContext", num))).toEqual([]);
    // One receipt too many: more than the money received
    p.call("nvCreatePurchase", {
      order: num,
      item: "Лишнее",
      amount: 1_000_000,
      docKind: "Фискальный чек",
      receipt: "ЧК-X",
    });
    const ctx = p.call("nvLoadOrderContext", num);
    expect(p.call("nvPurchaseWarnings", ctx).join(" ")).toContain("Чеки больше полученных денег");
    const r = p.call("nvApplyOrderEvent", num, "PURCHASE_RECORDED", {
      actor: "owner",
      force: true,
      reason: "очень надо",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("funds_exceeded");
    // Take the extra receipt away again
    p.ctx.__rows = read("purchases").filter((x) => x.item !== "Лишнее");
    p.run('nvRewriteTable("purchases", __rows)');
    expect(p.call("nvPurchaseWarnings", p.call("nvLoadOrderContext", num))).toEqual([]);
  });

  it("PURCHASE_DONE: «Готовим отчёт», the report is due in 24 hours, the last term in 48 hours", () => {
    setNow("2026-10-08T17:00:00+05:00");
    const o = act("Закупка завершена");
    expect(o.code).toBe("report_due");
    expect(new Date(o.reportTarget).getTime()).toBe(new Date("2026-10-09T17:00:00+05:00").getTime());
    expect(new Date(o.reportDeadline).getTime()).toBe(new Date("2026-10-10T17:00:00+05:00").getTime());
  });

  it("SEND_REPORT: objections 3 working days, the return of the rest 5 working days, the time of the day is kept", () => {
    setNow("2026-10-09T12:00:00+05:00"); // Friday
    const o = act("Отчёт отправлен");
    expect(o.code).toBe("report_sent");
    expect(o.reportAccepted).toBe("Нет");
    const cal = createWorkCalendar([], { from: "10:00", to: "19:00" });
    expect(new Date(o.objectionUntil).getTime()).toBe(cal.addWorkingDays(p.env.now, 3).getTime());
    expect(new Date(o.refundDue).getTime()).toBe(cal.addWorkingDays(p.env.now, 5).getTime());
    expect(new Date(o.objectionUntil).getTime()).toBe(new Date("2026-10-13T12:00:00+05:00").getTime()); // Mon, Tue, Wed? Sat, Mon, Tue
  });

  it("an objection of the customer needs the text and stops the closing", () => {
    answers([], [null]);
    edit("Заказы", row(), colOf("orders", "action"), "Возражение клиента");
    expect(find("orders", "num", num).objection).toBe("");
    const o = act("Возражение клиента", [], ["Не та модель SSD"]);
    expect(o.objection).toBe("Не та модель SSD");
    expect(o.code).toBe("report_sent");
    const r = p.call("nvApplyOrderEvent", num, "REPORT_ACCEPTED", { actor: "customer", input: "" });
    expect(r.needConfirm).toBe(true);
    // The owner settles the objection: the text is removed by hand
    sheet("Заказы").getRange(row(), colOf("orders", "objection")).setValue("");
  });

  it("REMAINDER_SETTLED is refused while the report is not accepted and the rest is not returned", () => {
    let r = p.call("nvApplyOrderEvent", num, "REMAINDER_SETTLED", { actor: "owner" });
    expect(r.violations.map((v) => v.code).sort()).toEqual(["not_reconciled", "report_objection_open"]);
    act("Отчёт принят клиентом");
    expect(find("orders", "num", num).reportAccepted).toBe("Клиентом");
    r = p.call("nvApplyOrderEvent", num, "REMAINDER_SETTLED", { actor: "owner" });
    expect(r.violations.map((v) => v.code)).toEqual(["not_reconciled"]);
    expect(r.text).toContain("Остаток 600000 сум");
  });

  it("the rest is returned by an outgoing transfer; the sheet reconciles; the tax reserve gets 1 % of the receipts, up", () => {
    pay("Возврат остатка", 600_000, "", "Подтверждён", { method: "Исходящий перевод", bankDoc: "БД-2" });
    const o = act("Остаток возвращён, сверено");
    expect(o.code).toBe("settled");
    const tax = read("reserves").filter((r) => r.ref === num && r.fund === "Налоговый риск");
    expect(tax).toHaveLength(1);
    expect(tax[0].amount).toBe(200_000);
    expect(tax[0].basis).toBe("Взнос при сверке");
  });

  it("assembly, test, dispatch need their documents; the handover needs the confirmed final payment with a fiscal receipt", () => {
    setNow("2026-10-10T10:00:00+05:00");
    act("Акт приёма материала", [], [null]);
    expect(find("orders", "num", num).code).toBe("settled");
    expect(act("Акт приёма материала", [], ["АП-1"]).code).toBe("assembling");
    expect(act("Собрано").code).toBe("testing");
    act("Тест пройден, паспорт готов", ["NO"], [""]);
    expect(find("orders", "num", num).code).toBe("testing");
    expect(act("Тест пройден, паспорт готов", [], ["ПС-1"]).code).toBe("ready");
    expect(act("Отправлен клиенту").code).toBe("delivering");
    const blocked = p.call("nvApplyOrderEvent", num, "HANDOVER", { actor: "owner", input: "АС-1" });
    expect(blocked.violations.map((v) => v.code)).toEqual(["final_payment_missing"]);
  });

  it("HANDOVER: «Сдан», warranty 12 months, aftercare 7 and 30 days, the warranty reserve 2 % up (not below 150 000)", () => {
    pay("Финал платы 70 %", 2_100_000, "FS-101");
    setNow("2026-10-12T15:00:00+05:00");
    const o = act("Сдан по акту", [], ["АС-1"]);
    expect(o.code).toBe("handed_over");
    expect(new Date(o.warrantyUntil).getTime()).toBe(new Date("2027-10-12T00:00:00+05:00").getTime());
    expect(new Date(o.aftercare1).getTime()).toBe(p.env.now.getTime() + 7 * 86_400_000);
    expect(new Date(o.aftercare2).getTime()).toBe(p.env.now.getTime() + 30 * 86_400_000);
    const w = read("reserves").filter((r) => r.ref === num && r.fund === "Гарантийный");
    expect(w).toHaveLength(1);
    expect(w[0].amount).toBe(400_000); // 2 % of 20 000 000 of receipts
    expect(w[0].basis).toBe("Взнос при сдаче");
  });

  it("the system closes a handed-over, reconciled order: CLOSE by the hourly job", () => {
    setNow("2026-10-13T10:30:00+05:00");
    const r = p.call("nvHourlyJob");
    expect(r.closed).toBe(1);
    expect(find("orders", "num", num).code).toBe("closed");
    const events = history(num).map((h) => h.event);
    expect(events).toEqual(
      expect.arrayContaining([
        "ORDER_CREATED",
        "SEND_ESTIMATE",
        "ACCEPT",
        "FEE_PREPAID",
        "FUNDS_RECEIVED",
        "MEETING_DONE",
        "START_PURCHASE",
        "PURCHASE_RECORDED",
        "PURCHASE_DONE",
        "SEND_REPORT",
        "OBJECTION",
        "REPORT_ACCEPTED",
        "REMAINDER_SETTLED",
        "MATERIALS_ACCEPTED",
        "ASSEMBLED",
        "TESTS_PASSED",
        "DISPATCH",
        "HANDOVER",
        "CLOSE",
      ]),
    );
    expect(history(num).at(-1).actor).toBe("Система");
  });

  it("every step of the history has the status before and after, who and how", () => {
    for (const h of history(num)) {
      expect(["Владелец", "Помощник", "Клиент", "Система", "Платформа"]).toContain(h.actor);
      expect(["Вручную", "Платформа", "Принудительно", "Система"]).toContain(h.how);
      expect(h.eventLabel).not.toBe("");
    }
    const send = history(num).find((h) => h.event === "SEND_ESTIMATE");
    expect(send.from).toBe("Смета: черновик");
    expect(send.to).toBe("Смета отправлена");
  });
});

describe("a forced step is written down with its reason", () => {
  it("START_PURCHASE before the money: «Принудительно» with the broken rules in the history", () => {
    const client = p.call("nvEnsureClient", { name: "Принуд", tg: "@force" });
    const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 8_000_000, purchased: 8_000_000 });
    const patch = (set) => p.run(`nvWriteCells("orders", ${find("orders", "num", num)._row}, ${JSON.stringify(set)})`);
    patch({ status: "Принят: ждём оплату", code: "accepted" });
    const r1 = p.call("nvApplyOrderEvent", num, "START_PURCHASE", { actor: "owner" });
    expect(r1.needConfirm).toBe(true);
    const r2 = p.call("nvApplyOrderEvent", num, "START_PURCHASE", { actor: "owner", force: true });
    expect(r2.error).toBe("force_reason_missing");
    const r3 = p.call("nvApplyOrderEvent", num, "START_PURCHASE", {
      actor: "owner",
      force: true,
      reason: "клиент привёз детали, деньги придут завтра",
    });
    expect(r3.ok).toBe(true);
    expect(r3.forced).toBe(true);
    const h = history(num).at(-1);
    expect(h.how).toBe("Принудительно");
    expect(h.reason).toContain("клиент привёз детали");
    expect(h.reason).toContain("payments_incomplete");
  });

  it("the spending of the own money is never forced: funds_exceeded is a hard stop", () => {
    const client = p.call("nvEnsureClient", { name: "Жёсткий", tg: "@hard" });
    const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 8_000_000, purchased: 8_000_000 });
    p.run(`nvWriteCells("orders", ${find("orders", "num", num)._row}, { status: "Закупка", code: "purchasing" })`);
    p.call("nvCreatePurchase", {
      order: num,
      item: "Что-то",
      amount: 5_000_000,
      docKind: "Фискальный чек",
      receipt: "X",
    });
    const r = p.call("nvApplyOrderEvent", num, "PURCHASE_RECORDED", {
      actor: "owner",
      force: true,
      reason: "очень надо",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("funds_exceeded");
  });
});

describe("the assistant has no money events", () => {
  it("is refused START_PURCHASE and HANDOVER, may record an assembly step", () => {
    const client = p.call("nvEnsureClient", { name: "Помощник", tg: "@helper" });
    const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 8_000_000, purchased: 8_000_000 });
    p.run(`nvWriteCells("orders", ${find("orders", "num", num)._row}, { status: "Сборка", code: "assembling" })`);
    const r = p.call("nvApplyOrderEvent", num, "ASSEMBLED", { actor: "assistant" });
    expect(r.ok).toBe(true);
    expect(history(num).at(-1).actor).toBe("Помощник");
    p.run(
      `nvWriteCells("orders", ${find("orders", "num", num)._row}, { status: "Принят: ждём оплату", code: "accepted" })`,
    );
    const denied = p.call("nvApplyOrderEvent", num, "START_PURCHASE", { actor: "assistant" });
    expect(denied.error).toBe("actor_not_allowed");
  });

  it("is recognised by the account: another e-mail than OWNER_EMAIL", () => {
    expect(p.call("nvActor")).toBe("owner");
    p.env.userEmail = "helper@example.com";
    expect(p.call("nvActor")).toBe("assistant");
    p.env.userEmail = "owner@example.com";
  });
});

describe("cancellation by the price list of the stages", () => {
  const cal = createWorkCalendar([], { from: "10:00", to: "19:00" });
  const points = [
    ["accepted", "after_accept_before_purchase", undefined],
    ["purchasing", "after_purchase_before_assembly", undefined],
    ["report_sent", "after_purchase_before_assembly", undefined],
    ["assembling", "during_assembly", 4000],
    ["testing", "during_assembly", 10000],
    ["ready", "after_tests_before_handover", undefined],
    ["estimate_sent", "before_accept", undefined],
  ];
  it.each(points)("%s → %s: the settlement is the settleCancellation of the domain", (code, point, doneBp) => {
    const client = p.call("nvEnsureClient", { name: `Отмена ${code}`, tg: `@cancel_${code}` });
    const num = p.call("nvCreateOrder", {
      client,
      kind: "ПК",
      basePc: 12_000_000,
      purchased: 12_000_000,
      memory: 1_000_000,
    });
    const row = find("orders", "num", num)._row;
    p.run(`nvWriteCells("orders", ${row}, ${JSON.stringify({ status: "x", code, doneBp: doneBp ?? "" })})`);
    const paid = code === "estimate_sent" ? 0 : 1_080_000; // advance 30 % of 3 600 000? the real fee is computed below
    const state = JSON.parse(
      p.run(
        `JSON.stringify(nvOrderState(nvReadTable("orders").find((o) => o.num === "${num}"), [], [], [], nvSettings(), []))`,
      ),
    );
    const fee = state.quote.feeTotal;
    const limit = state.quote.purchaseLimit;
    const feePaid = code === "estimate_sent" ? 0 : state.quote.advance;
    void paid;
    if (code !== "estimate_sent")
      p.call("nvCreatePayment", {
        order: num,
        kind: "Аванс платы 30 %",
        amount: feePaid,
        status: "Подтверждён",
        receipt: "FS-C",
      });
    let received = 0;
    let receipts = 0;
    if (["purchasing", "report_sent", "assembling", "testing", "ready"].includes(code)) {
      received = limit;
      receipts = 9_000_000;
      p.call("nvCreatePayment", {
        order: num,
        kind: "Деньги на закупку",
        amount: limit,
        status: "Подтверждён",
        method: "Перевод на счёт ИП",
      });
      p.call("nvCreatePurchase", {
        order: num,
        item: "Детали",
        amount: receipts,
        docKind: "Фискальный чек",
        receipt: "Ч",
      });
    }
    setNow("2026-10-14T12:00:00+05:00");
    const res = p.call("nvApplyOrderEvent", num, "CANCEL", { actor: "owner", input: "Передумал" });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const o = find("orders", "num", num);
    expect(o.code).toBe("cancelling");
    const dom = settleCancellation(
      {
        point,
        fee: sum(fee),
        feePaid: sum(feePaid),
        fundsReceived: sum(received),
        receiptsTotal: sum(receipts),
        shopRefunds: sum(0),
        documentedLosses: sum(0),
        assemblyDoneBp: doneBp === undefined ? undefined : bp(doneBp),
      },
      S,
      p.env.now,
      cal,
    );
    expect(o.feeEarned).toBe(dom.feeEarned);
    expect(o.feeToRefund).toBe(dom.feeToRefund);
    expect(o.feeToInvoice).toBe(dom.feeToInvoice);
    expect(o.fundsToRefund).toBe(dom.fundsToRefund);
    expect(new Date(o.cancelDue).getTime()).toBe(dom.dueBy.getTime());
    expect(o.cancelReason).toBe("Передумал");
  });

  it("an assembly cancel without the share of the done work is refused as a hard error", () => {
    const client = p.call("nvEnsureClient", { name: "Без доли", tg: "@nodone" });
    const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 });
    p.run(`nvWriteCells("orders", ${find("orders", "num", num)._row}, { status: "x", code: "assembling" })`);
    const r = p.call("nvApplyOrderEvent", num, "CANCEL", { actor: "owner", input: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("assembly_done_missing");
  });

  it("the recalculation after the shop refunds and the losses; CANCEL_SETTLED needs the money back", () => {
    const client = p.call("nvEnsureClient", { name: "Пересчёт", tg: "@recalc" });
    const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 12_000_000, purchased: 12_000_000, memory: 0 });
    const row = find("orders", "num", num)._row;
    p.run(`nvWriteCells("orders", ${row}, { status: "x", code: "purchasing" })`);
    const state = JSON.parse(
      p.run(
        `JSON.stringify(nvOrderState(nvReadTable("orders").find((o) => o.num === "${num}"), [], [], [], nvSettings(), []))`,
      ),
    );
    p.call("nvCreatePayment", {
      order: num,
      kind: "Деньги на закупку",
      amount: state.quote.purchaseLimit,
      status: "Подтверждён",
      method: "Перевод на счёт ИП",
    });
    p.call("nvCreatePurchase", {
      order: num,
      item: "Детали",
      amount: 10_000_000,
      docKind: "Фискальный чек",
      receipt: "Ч",
    });
    setNow("2026-10-14T12:00:00+05:00");
    p.call("nvApplyOrderEvent", num, "CANCEL", { actor: "owner", input: "Передумал" });
    const before = find("orders", "num", num).fundsToRefund;
    p.run(`nvWriteCells("orders", ${row}, { shopRefunds: 4000000, losses: 500000 })`);
    const r = p.call("nvRecalculateCancel", num);
    expect(r.ok).toBe(true);
    const after = find("orders", "num", num).fundsToRefund;
    expect(after).toBe(before + 4_000_000 - 500_000);
    const blocked = p.call("nvApplyOrderEvent", num, "CANCEL_SETTLED", { actor: "owner" });
    expect(blocked.needConfirm).toBe(true);
    p.call("nvCreatePayment", {
      order: num,
      kind: "Возврат денег на закупку",
      amount: after,
      status: "Подтверждён",
      method: "Исходящий перевод",
      bankDoc: "БД",
    });
    const ok = p.call("nvApplyOrderEvent", num, "CANCEL_SETTLED", { actor: "owner" });
    expect(ok.ok).toBe(true);
    expect(find("orders", "num", num).code).toBe("cancelled");
  });
});

describe("the ledger of the reserves", () => {
  it("the start contribution of 3 000 000 is the first line, written once", () => {
    const rows = read("reserves");
    expect(rows[0]).toMatchObject({
      fund: "Гарантийный",
      amount: 3_000_000,
      basis: "Стартовый взнос",
      who: "Владелец",
      demo: false,
    });
    expect(p.call("nvEnsureStartContribution")).toBe(false);
    expect(read("reserves").filter((r) => r.basis === "Стартовый взнос")).toHaveLength(1);
  });

  it("a correction needs a fund, a whole sum that is not zero and a comment", () => {
    expect(() => p.call("nvLedgerAdjust", "Неизвестный", 100, "x")).toThrow();
    expect(() => p.call("nvLedgerAdjust", "Гарантийный", 0, "x")).toThrow();
    expect(() => p.call("nvLedgerAdjust", "Гарантийный", 10.5, "x")).toThrow();
    expect(() => p.call("nvLedgerAdjust", "Гарантийный", 100, "  ")).toThrow();
    p.call("nvLedgerAdjust", "Налоговый риск", -50_000, "Возврат после ответа налоговой, часть");
    const row = read("reserves").at(-1);
    expect(row).toMatchObject({
      fund: "Налоговый риск",
      amount: -50_000,
      basis: "Поправка",
      who: "Владелец",
      comment: "Возврат после ответа налоговой, часть",
    });
  });

  it("the menu asks for the three values and refuses an empty comment", () => {
    const before = read("reserves").length;
    p.env.promptAnswers.push("Гарантийный", "120000", "");
    expect(p.call("nvLedgerAdjustUi")).toBe(false);
    expect(read("reserves")).toHaveLength(before);
    p.env.promptAnswers.push("Гарантийный", "120 000", "Взнос владельца");
    expect(p.call("nvLedgerAdjustUi")).toBe(true);
    expect(read("reserves").at(-1).amount).toBe(120_000);
  });
});

describe("settings and the history of changes", () => {
  it("a changed setting is written to the history with the old and the new value, and used at once", () => {
    const layout = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())"));
    const row = layout.find((x) => x.def.name === "NV_PC_LOW_BP").row;
    edit("Настройки", row, 3, 1600, 1500);
    const h = read("history").filter((x) => x.object === "Настройки");
    expect(h).toHaveLength(1);
    expect(h[0].num).toBe("NV_PC_LOW_BP");
    expect(h[0].from).toBe("1500");
    expect(h[0].to).toBe("1600");
    expect(p.call("nvComputeFee", { basePc: 10_000_000 }, p.callJson("nvSettings", true)).total).toBe(1_600_000);
    edit("Настройки", row, 3, 1500, 1600);
    expect(p.call("nvComputeFee", { basePc: 10_000_000 }, p.callJson("nvSettings", true)).total).toBe(1_500_000);
  });

  it("stage shares that do not add up to 10 000 are flagged", () => {
    const layout = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())"));
    const row = layout.find((x) => x.def.name === "NV_STAGE_ASSEMBLY_BP").row;
    edit("Настройки", row, 3, 3000, 3500);
    expect(p.env.ss.toasts.at(-1).msg).toContain("10 000");
    edit("Настройки", row, 3, 3500, 3000);
  });
});

describe("demo data", () => {
  it("fills 12 leads, 8 orders in the key statuses, payments, receipts and 2 warranty cases with the demo flag and demo numbers", () => {
    const realOrders = read("orders").length;
    const realLeads = read("leads").length;
    const counters = Object.fromEntries([...p.env.scriptProps].filter(([k]) => !k.startsWith("COUNTER_DEMO_")));
    const r = p.call("nvDemoFill");
    expect(r.ok).toBe(true);
    expect(r.leads).toBe(12);
    expect(r.orders).toBe(8);
    expect(r.warranty).toBe(2);
    const demoOrders = read("orders").filter((o) => o.demo === true);
    expect(demoOrders.map((o) => o.num)).toEqual(Array.from({ length: 8 }, (_, i) => `NV-2026-D00${i + 1}`));
    expect(new Set(demoOrders.map((o) => o.code))).toEqual(
      new Set(["closed", "handed_over", "testing", "report_sent", "purchasing", "accepted", "estimate_sent"]),
    );
    expect(new Set(demoOrders.map((o) => o.kind))).toEqual(new Set(["ПК", "Сетап", "Апгрейд", "Подбор"]));
    const leads = read("leads").filter((l) => l.demo === true);
    expect(leads.map((l) => l.num)[0]).toBe("L-2026-D001");
    expect(
      read("clients")
        .filter((c) => c.demo === true)
        .every((c) => /^Демо-клиент \d+$/.test(c.name)),
    ).toBe(true);
    expect(read("payments").filter((x) => x.demo === true).length).toBeGreaterThan(15);
    expect(read("purchases").filter((x) => x.demo === true).length).toBeGreaterThan(15);
    expect(read("reserves").filter((x) => x.demo === true).length).toBeGreaterThan(5);
    expect(read("orders")).toHaveLength(realOrders + 8);
    expect(read("leads")).toHaveLength(realLeads + 12);
    // The real counters did not move
    for (const [k, v] of Object.entries(counters)) expect(p.env.scriptProps.get(k)).toBe(v);
    expect(p.env.scriptProps.get("COUNTER_DEMO_NV_2026")).toBe("8");
  });

  it("a second fill does nothing; the money of the demo is consistent (reconciled orders reconcile)", () => {
    expect(p.call("nvDemoFill").ok).toBe(false);
    const orders = read("orders").filter((o) => o.demo === true);
    const payments = read("payments");
    const purchases = read("purchases");
    for (const o of orders.filter((x) => ["closed", "handed_over", "testing"].includes(x.code))) {
      const st = JSON.parse(
        JSON.stringify(p.call("nvOrderState", o, payments, purchases, read("orders"), p.callJson("nvSettings"), [])),
      );
      expect(st.recon, o.num).toBe("Сходится");
    }
  });

  it("the clearing removes the rows with the demo flag, their history and reserves, and nothing else; the count is shown first", () => {
    const real = {
      orders: read("orders").filter((o) => !o.demo).length,
      history: read("history").filter((h) => !/-D\d{3}/.test(h.num)).length,
    };
    const count = p.call("nvDemoCount");
    expect(count).toBeGreaterThan(150);
    answers(["YES"]);
    p.call("nvMenuDemoClear");
    expect(p.env.alerts.at(-1).text).toContain(String(count));
    expect(p.call("nvDemoCount")).toBe(0);
    expect(read("orders").filter((o) => !o.demo)).toHaveLength(real.orders);
    expect(read("orders").every((o) => !o.demo)).toBe(true);
    expect(read("history").filter((h) => !/-D\d{3}/.test(h.num))).toHaveLength(real.history);
    expect([...p.env.scriptProps.keys()].some((k) => k.startsWith("COUNTER_DEMO_"))).toBe(false);
    expect(p.env.scriptProps.get("COUNTER_NV_2026")).toBeTruthy();
    // The checkboxes of the freed rows are gone with the rows
    expect(sheet("Заказы")._cell(read("orders").length + 6, 9).dv).toBeUndefined();
  });
});
