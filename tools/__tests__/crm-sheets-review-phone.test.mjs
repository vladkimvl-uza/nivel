// Review round 2, the phone: in the app of Google Sheets there are no menus, no side forms and no dialogs. Every action
// of the row works without a window, and its result is written in the row (the toast is not shown there).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
let p;
const sheet = (n) => p.env.ss.getSheetByName(n);
const read = (k) => p.call("nvReadTable", k);
const colOf = (key, col) =>
  2 + JSON.parse(p.run(`JSON.stringify(NV_SCHEMA.${key}.cols.map((c) => c.key))`)).indexOf(col);
const find = (key, f, v) => read(key).find((r) => r[f] === v);

function edit(sheetName, row, col, value, oldValue) {
  const range = sheet(sheetName).getRange(row, col);
  const old = oldValue === undefined ? range.getValue() : oldValue;
  range.setValue(value);
  p.call("nvOnEdit", { range, value, oldValue: old === "" ? undefined : old, source: p.env.ss });
}

beforeAll(() => {
  p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
}, 60_000);

beforeEach(() => {
  p.env.now = T0;
  p.env.uiAvailable = false; // the phone
  p.env.alerts.length = 0;
  p.env.prompts.length = 0;
});

const order = (tag, set) => {
  const client = p.call("nvEnsureClient", { name: `Тел ${tag}`, tg: `@ph_${tag}` });
  const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 });
  const row = find("orders", "num", num)._row;
  p.run(`nvWriteCells("orders", ${row}, ${JSON.stringify(set)})`);
  p.call("nvRefreshOrderActions", num);
  return { num, row };
};

describe("an action of an order without a window", () => {
  it("the result of an action without a text is written to «Итог действия», and the cell of the action is cleared", () => {
    const { num, row } = order("a", {});
    p.env.now = T0;
    edit("Заказы", row, colOf("orders", "action"), "Отправить смету");
    const o = find("orders", "num", num);
    expect(o.code).toBe("estimate_sent");
    expect(o.action).toBe("");
    expect(o.lastResult).toContain("Отправить смету");
    expect(o.lastResult).toContain("выполнено → Смета отправлена");
    expect(p.env.prompts).toHaveLength(0);
  });

  it("an action that needs a text takes it from «Текст к действию»: no window is needed", () => {
    const { num, row } = order("b", {
      status: "Смета отправлена",
      code: "estimate_sent",
      validUntil: new Date(T0.getTime() + 3600000),
    });
    sheet("Заказы").getRange(row, colOf("orders", "actionText")).setValue("https://t.me/c/1/2");
    edit("Заказы", row, colOf("orders", "action"), "Клиент принял");
    const o = find("orders", "num", num);
    expect(o.code).toBe("accepted");
    expect(o.notes).toContain("https://t.me/c/1/2");
    expect(o.actionText).toBe("");
    expect(o.lastResult).toContain("выполнено → Принят: ждём оплату");
  });

  it("without the text and without a window the owner is told what to do, in the row, and nothing changes", () => {
    const { num, row } = order("c", {
      status: "Смета отправлена",
      code: "estimate_sent",
      validUntil: new Date(T0.getTime() + 3600000),
    });
    edit("Заказы", row, colOf("orders", "action"), "Клиент принял");
    const o = find("orders", "num", num);
    expect(o.code).toBe("estimate_sent");
    expect(o.action).toBe("");
    expect(o.lastResult).toContain("Нужен текст");
    expect(o.lastResult).toContain("Текст к действию");
  });

  it("a rule that is not met is explained in the row; forcing it is for the computer only", () => {
    const { num, row } = order("d", { status: "Принят: ждём оплату", code: "accepted", dAccepted: T0 });
    edit("Заказы", row, colOf("orders", "action"), "Начать закупку");
    const o = find("orders", "num", num);
    expect(o.code).toBe("accepted");
    expect(o.lastResult).toContain("Не выполнено");
    expect(o.lastResult).toContain("только на компьютере");
    expect(
      read("history")
        .filter((h) => h.num === num)
        .every((h) => h.how !== "Принудительно"),
    ).toBe(true);
  });

  it("the assistant on a phone is told that the money events are closed", () => {
    p.env.userEmail = "helper@example.com";
    const { num, row } = order("e", {});
    edit("Заказы", row, colOf("orders", "action"), "Отправить смету");
    const o = find("orders", "num", num);
    expect(o.code).toBe("estimate_draft");
    expect(o.lastResult).toContain("Денежные события недоступны помощнику");
    p.env.userEmail = "owner@example.com";
  });
});

describe("a warranty case without a window", () => {
  it("the result of the event is in the row of the case", () => {
    const o = order("g", { status: "Закрыт", code: "closed", warrantyUntil: new Date(T0.getTime() + 200 * 86400000) });
    const g = p.call("nvCreateWarranty", { order: o.num, desc: "Шум кулера", channel: "Бот" });
    const row = find("warranty", "num", g)._row;
    edit("Гарантия", row, colOf("warranty", "action"), "Начать диагностику");
    const w = find("warranty", "num", g);
    expect(w.status).toBe("Диагностика");
    expect(w.action).toBe("");
    expect(w.lastResult).toContain("выполнено → Диагностика");
    edit("Гарантия", row, colOf("warranty", "action"), "Отказать: вина клиента");
    expect(find("warranty", "num", g).lastResult).toContain("Отказ только с виной клиента");
  });
});

describe("the sheets for a phone", () => {
  it("«Итог действия» is a visible column next to «Действие»; «Текст к действию» is before it", () => {
    const keys = JSON.parse(p.run("JSON.stringify(NV_SCHEMA.orders.cols.map((c) => c.key))"));
    const i = keys.indexOf("action");
    expect(keys.slice(i, i + 3)).toEqual(["action", "actionText", "lastResult"]);
    expect(
      JSON.parse(p.run("JSON.stringify(NV_SCHEMA.orders.cols.find((c) => c.key === 'actionText').hidden || false)")),
    ).toBe(false);
  });
});

describe("the weekly copy does not stop the book when the Drive is closed", () => {
  it("a refusal of the Drive is told to the owner, and the job ends without an error", () => {
    p.env.uiAvailable = true;
    const drive = p.gas.globals.DriveApp;
    const real = drive.getFileById;
    drive.getFileById = () => {
      throw new Error("Exception: Нет доступа: https://www.googleapis.com/auth/drive");
    };
    p.env.mails.length = 0;
    const r = p.call("nvWeeklyBackup");
    drive.getFileById = real;
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Диск");
    expect(p.env.mails.length + p.env.fetches.length).toBeGreaterThan(0);
  });
});
