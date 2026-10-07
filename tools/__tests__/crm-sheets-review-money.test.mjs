// Review round 2, the red line of the money: only a payment whose pair «вид × способ» is allowed (the column «Проверка» is
// «ОК») counts as received, in the formulas of the sheets and in the script code, and a confirmed payment is checked again
// when its kind, method or amount changes.
import { beforeAll, describe, expect, it } from "vitest";
import { createComputer } from "../crm-sheets/scripts/computed.mjs";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
let p;
const sheet = (n) => p.env.ss.getSheetByName(n);
const read = (k) => p.call("nvReadTable", k);
const colOf = (key, col) =>
  2 + JSON.parse(p.run(`JSON.stringify(NV_SCHEMA.${key}.cols.map((c) => c.key))`)).indexOf(col);

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

/** One order with the estimate 12 000 000 and the given raw payments (written as they are, without the checks of the trigger). */
function orderWith(payments) {
  const client = p.call("nvEnsureClient", { name: "Деньги", tg: `@money_${Math.random().toString(36).slice(2, 8)}` });
  const num = p.call("nvCreateOrder", { client, kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 });
  const row = read("orders").find((o) => o.num === num)._row;
  p.run(`nvWriteCells("orders", ${row}, { status: "Принят: ждём оплату", code: "accepted", dAccepted: new Date() })`);
  payments.forEach((x, i) => {
    p.call("nvAppendRow", "payments", {
      id: `P-2026-9${String(read("payments").length + i + 1).padStart(3, "0")}`,
      order: num,
      status: "Подтверждён",
      date: T0,
      confirmedAt: T0,
      payerIsClient: true,
      ...x,
    });
  });
  return num;
}

describe("formulas of «Заказы»", () => {
  const compute = () => {
    const c = createComputer(p);
    c.computeTables();
    return c.errors;
  };

  it("money for the purchase through QR Xolis is not money received: «Деньги получены» stays «Нет»", () => {
    const quote = p.call(
      "nvComputeQuote",
      { kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 },
      p.call("nvSettings"),
    );
    const num = orderWith([{ kind: "Деньги на закупку", method: "QR Xolis", amount: quote.purchaseLimit }]);
    expect(compute()).toEqual([]);
    const o = read("orders").find((x) => x.num === num);
    expect(o.fundsGot).toBe(0);
    expect(o.fundsOk).toBe("Нет");
    // the same in the script code that runs the automaton
    const st = JSON.parse(
      p.run(
        `JSON.stringify(nvOrderState(nvReadTable("orders").find((o) => o.num === "${num}"), nvReadTable("payments"), nvReadTable("purchases"), nvReadTable("orders"), nvSettings(), []))`,
      ),
    );
    expect(st.fundsGot).toBe(0);
    expect(st.fundsOk).toBe(false);
  });

  it("the same sum by a transfer to the account of the IP is received", () => {
    const quote = p.call(
      "nvComputeQuote",
      { kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 },
      p.call("nvSettings"),
    );
    const num = orderWith([{ kind: "Деньги на закупку", method: "Перевод на счёт ИП", amount: quote.purchaseLimit }]);
    compute();
    const o = read("orders").find((x) => x.num === num);
    expect(o.fundsGot).toBe(quote.purchaseLimit);
    expect(o.fundsOk).toBe("Да");
  });

  it("an advance of the fee by a transfer to the IP is not an advance; with QR and a receipt it is", () => {
    const quote = p.call(
      "nvComputeQuote",
      { kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 },
      p.call("nvSettings"),
    );
    const bad = orderWith([
      { kind: "Аванс платы 30 %", method: "Перевод на счёт ИП", amount: quote.advance, receipt: "FS-1" },
    ]);
    const good = orderWith([{ kind: "Аванс платы 30 %", method: "QR Xolis", amount: quote.advance, receipt: "FS-2" }]);
    compute();
    const rows = read("orders");
    expect(rows.find((x) => x.num === bad).feePaid).toBe("Нет");
    expect(rows.find((x) => x.num === bad).feeNet).toBe(0);
    expect(rows.find((x) => x.num === good).feePaid).toBe("Да");
    expect(rows.find((x) => x.num === good).feeNet).toBe(quote.advance);
  });

  it("a refund by a wrong method is not counted as returned", () => {
    const num = orderWith([
      { kind: "Деньги на закупку", method: "Перевод на счёт ИП", amount: 12_360_000 },
      { kind: "Возврат остатка", method: "Перевод на счёт ИП", amount: 1_000_000 },
    ]);
    compute();
    expect(read("orders").find((x) => x.num === num).refunded).toBe(0);
  });

  it("the task «Можно начинать закупку» does not appear for such an order (the condition is the column «Деньги получены»)", () => {
    const quote = p.call(
      "nvComputeQuote",
      { kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 },
      p.call("nvSettings"),
    );
    const num = orderWith([
      { kind: "Аванс платы 30 %", method: "QR Xolis", amount: quote.advance, receipt: "FS-3" },
      { kind: "Деньги на закупку", method: "QR Xolis", amount: quote.purchaseLimit },
    ]);
    compute();
    const o = read("orders").find((x) => x.num === num);
    expect(o.feePaid).toBe("Да");
    expect(o.fundsOk).toBe("Нет");
    expect(o.notBefore).toBe("");
  });
});

describe("the script code counts the same", () => {
  it("the threshold and the digest do not take a fee paid by a wrong method", () => {
    const num = orderWith([
      { kind: "Аванс платы 30 %", method: "Перевод на счёт ИП", amount: 900_000, receipt: "FS-9" },
      { kind: "Аванс платы 30 %", method: "QR Xolis", amount: 100_000, receipt: "FS-10" },
    ]);
    void num;
    const entries = JSON.parse(p.run("JSON.stringify(nvThresholdEntries(false))")).filter((e) => e.kind === "fee_in");
    expect(entries.reduce((a, e) => a + e.amount, 0)).toBe(
      read("payments")
        .filter((x) => x.status === "Подтверждён" && x.method === "QR Xolis" && x.kind === "Аванс платы 30 %")
        .reduce((a, x) => a + x.amount, 0),
    );
  });

  it("the fee of the dashboard is the sum of the right pairs only", () => {
    const f = p.run("nvFeeIn('ND_FROM', 'ND_TO_X')");
    expect(f).toContain('"ОК"');
  });
});

describe("a confirmed payment is checked again when it is edited", () => {
  const confirmedAdvance = () => {
    const quote = p.call(
      "nvComputeQuote",
      { kind: "ПК", basePc: 12_000_000, purchased: 12_000_000 },
      p.call("nvSettings"),
    );
    const num = orderWith([{ kind: "Аванс платы 30 %", method: "QR Xolis", amount: quote.advance, receipt: "FS-77" }]);
    const row = read("payments").filter((x) => x.order === num)[0]._row;
    return { num, row };
  };

  it("another kind with the same method: the status goes back to «Ожидается» and the owner is told why", () => {
    const { row } = confirmedAdvance();
    edit("Платежи", row, colOf("payments", "kind"), "Деньги на закупку", "Аванс платы 30 %");
    const pay = read("payments").find((x) => x._row === row);
    expect(pay.status).toBe("Ожидается");
    expect(p.env.ss.toasts.at(-1).msg).toContain("Неверная пара");
  });

  it("another method: the same", () => {
    const { row } = confirmedAdvance();
    edit("Платежи", row, colOf("payments", "method"), "Перевод на счёт ИП", "QR Xolis");
    expect(read("payments").find((x) => x._row === row).status).toBe("Ожидается");
  });

  it("another amount of a right payment stays confirmed, and the flags of the order are written again", () => {
    const { num, row } = confirmedAdvance();
    edit("Платежи", row, colOf("payments", "amount"), 1_234_567, 1_000_000);
    expect(read("payments").find((x) => x._row === row).status).toBe("Подтверждён");
    expect(read("orders").find((o) => o.num === num)).toBeTruthy();
  });

  it("a payment that is still waiting changes its kind with the usual choice of the method", () => {
    const num = orderWith([{ kind: "Аванс платы 30 %", method: "QR Xolis", amount: 100_000, status: "Ожидается" }]);
    const row = read("payments").filter((x) => x.order === num)[0]._row;
    edit("Платежи", row, colOf("payments", "kind"), "Деньги на закупку", "Аванс платы 30 %");
    const pay = read("payments").find((x) => x._row === row);
    expect(pay.method).toBe("Перевод на счёт ИП");
    expect(pay.status).toBe("Ожидается");
  });
});
