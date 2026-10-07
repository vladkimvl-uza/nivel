// The formulas of the CRM book: the notation, the lint of every formula, and the values of the calculated columns,
// computed by an evaluator of Sheets formulas, against the functions of packages/domain and the script code.
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeQuote,
  partsBudgetFromTotal,
  podborFee,
  DEFAULT_FEE_SETTINGS as S,
} from "../../packages/domain/src/fee/index.ts";
import { bp, sum, validatePayment } from "../../packages/domain/src/money/index.ts";
import {
  DEFAULT_THRESHOLD_SETTINGS,
  thresholdForYear,
  thresholdStatus,
} from "../../packages/domain/src/threshold/index.ts";
import { createComputer } from "../crm-sheets/scripts/computed.mjs";
import { createProject } from "../crm-sheets/scripts/env.mjs";
import { calc, FormulaError, parse } from "../crm-sheets/scripts/formula-eval.mjs";

const NOW = new Date("2026-12-20T10:00:00+05:00");
let p;
let ss;
const sheet = (n) => ss.getSheetByName(n);
const schema = () => JSON.parse(p.run("JSON.stringify(NV_SCHEMA)"));

beforeAll(() => {
  p = createProject({ now: NOW });
  p.call("nvSetup");
  ss = p.env.ss;
}, 120_000);

describe("notation: the ru_RU interface to the setFormula notation", () => {
  const conv = (f) => p.call("nvApiFormula", f);
  it("arguments get commas, rows of a literal keep the semicolon, columns of a literal get commas", () => {
    expect(conv("=IF(A1>0; 1; 2)")).toBe("=IF(A1>0, 1, 2)");
    expect(conv('=SPARKLINE(B2:B5; {"charttype"\\"bar"; "max"\\10})')).toBe(
      '=SPARKLINE(B2:B5, {"charttype","bar"; "max",10})',
    );
    expect(conv('={"Title"; MAP(A1:A9; LAMBDA(x; x*2))}')).toBe('={"Title"; MAP(A1:A9, LAMBDA(x, x*2))}');
  });

  it("text inside quotes is never touched", () => {
    expect(conv('=IF(A1="a;b"; "x\\y"; "p;q")')).toBe('=IF(A1="a;b", "x\\y", "p;q")');
    expect(conv('=TEXT(A1; "+0%;-0%;0%")')).toBe('=TEXT(A1, "+0%;-0%;0%")');
    expect(conv('="He said ""hi; there"""')).toBe('="He said ""hi; there"""');
  });

  it("nested literals and functions in a literal", () => {
    expect(conv("={SUM(1;2)\\MAX(3;4); 5\\6}")).toBe("={SUM(1,2),MAX(3,4); 5,6}");
  });

  it("keeps a decimal point and an empty argument", () => {
    expect(conv("=ROUND(1.5; 0)")).toBe("=ROUND(1.5, 0)");
    expect(conv("=INDEX(t;;1)")).toBe("=INDEX(t,,1)");
  });
});

describe("lint of every formula of the book", () => {
  const KNOWN = new Set(
    (
      "IF IFS IFERROR SUMIFS COUNTIFS AVERAGEIFS MAXIFS MINIFS XLOOKUP FILTER SORT ARRAYFORMULA MAP LAMBDA VSTACK HSTACK " +
      "SEQUENCE TEXT TEXTJOIN EOMONTH EDATE DATE TODAY NOW YEAR MONTH DAY INT MOD ROUND QUOTIENT CEILING MAX MIN SUM " +
      "AVERAGE MEDIAN COUNT COUNTA COUNTIF SUMPRODUCT AND OR NOT ISNUMBER REGEXMATCH LEFT LEN HYPERLINK SPARKLINE " +
      "WORKDAY.INTL NETWORKDAYS.INTL TIME TIMEVALUE SWITCH ROW INDEX SUBTOTAL TO_TEXT LET CHOOSECOLS ARRAY_CONSTRAIN " +
      "INDIRECT SEARCH NA TRUE FALSE WEEKDAY ROWS MATCH"
    ).split(" "),
  );
  const forms = [];
  beforeAll(() => {
    for (const sh of ss.sheets) {
      for (const [k, c] of sh.cells) if (c.f) forms.push({ where: `${sh.name}!${k}`, f: c.f });
      for (const r of sh.cf) forms.push({ where: `${sh.name} CF`, f: r.formula });
    }
  });

  it("there are formulas to check", () => {
    expect(forms.length).toBeGreaterThan(800);
  });

  it("brackets and quotes are balanced, no ru_RU separators are left outside literals and strings", () => {
    for (const { where, f } of forms) {
      expect(p.call("nvFormulaBalance", f), `${where}: ${f.slice(0, 120)}`).toBe(0);
      const outside = p.call("nvFormulaOutsideStrings", f);
      // a ";" may only separate the rows of a literal; check that every ";" sits inside braces
      let depthBrace = 0;
      for (const ch of outside) {
        if (ch === "{") depthBrace++;
        if (ch === "}") depthBrace--;
        if (ch === ";") expect(depthBrace > 0, `${where}: ';' outside a literal: ${f.slice(0, 160)}`).toBe(true);
        expect(ch === "\\" && depthBrace > 0, `${where}: backslash in a literal`).toBe(false);
      }
    }
  });

  it("only known functions are used", () => {
    const bad = [];
    for (const { where, f } of forms) {
      const outside = p.call("nvFormulaOutsideStrings", f);
      for (const m of outside.matchAll(/([A-Za-z][A-Za-z0-9_.]*)\(/g)) {
        const name = m[1].toUpperCase();
        if (!KNOWN.has(name) && !["NIVEL_PARTS_FROM_BUDGET"].includes(name)) bad.push(`${where}: ${name}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("every sheet named in a formula exists, every NV_ / NVD_ / TH_ / ND_ / P_ name is defined", () => {
    const names = new Set(ss.sheets.map((s) => s.name));
    const missing = [];
    for (const { where, f } of forms) {
      const outside = p.call("nvFormulaOutsideStrings", f);
      for (const m of f.matchAll(/'([^']+)'!/g)) if (!names.has(m[1])) missing.push(`${where}: sheet ${m[1]}`);
      for (const m of outside.matchAll(/\b((?:NV|NVD|TH|ND|P|CALC)_[A-Z0-9_]+)\b/g)) {
        if (!ss.getRangeByName(m[1])) missing.push(`${where}: name ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("every calculated column is one MAP in the header cell, driven by the key column", () => {
    const def = schema();
    for (const key of Object.keys(def)) {
      const sh = sheet(def[key].title);
      def[key].cols.forEach((c, i) => {
        if (!c.calc) return;
        const f = sh._cell(5, 2 + i).f;
        expect(f.startsWith(`={"${c.title}"; MAP(`), `${key}.${c.key}`).toBe(true);
        expect(f).toContain("LAMBDA(");
        expect(f).toContain(`IF(${def[key].keyCol}_="", "",`);
        // the open-ended ranges start at the first data row
        expect(f).toMatch(/\$[A-Z]+\$6:\$[A-Z]+/);
      });
    }
  });

  it("no formula of the body refers to a column that does not exist", () => {
    const def = schema();
    for (const key of Object.keys(def)) {
      const keys = new Set(def[key].cols.map((c) => c.key));
      for (const c of def[key].cols) {
        if (!c.calc) continue;
        for (const m of c.calc.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g))
          expect(keys.has(m[1]), `${key}.${c.key} -> ${m[1]}`).toBe(true);
        for (const m of c.calc.matchAll(/\{([a-z]+)\.([A-Za-z0-9]+)\}/g)) {
          expect(def[m[1]], `${key}.${c.key} -> ${m[1]}`).toBeTruthy();
          expect(
            def[m[1]].cols.some((x) => x.key === m[2]),
            `${key}.${c.key} -> ${m[1]}.${m[2]}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("the evaluator itself", () => {
  const ctx = {
    sheetName: "T",
    getCell: () => null,
    maxRows: () => 100,
    named: () => null,
    now: NOW,
    rowRef: () => null,
  };
  const v = (f) => calc(f, ctx);
  it("arithmetic, text, comparison, blank handling", () => {
    expect(v("=1+2*3")).toBe(7);
    expect(v('="a"&"b"')).toBe("ab");
    expect(v('=IF(1<2; "да"; "нет")')).toBe("да");
    expect(v("=QUOTIENT(7; 2)")).toBe(3);
    expect(v("=CEILING(10001; 10000)")).toBe(20000);
    expect(v("=MAX(1; 5; 3)")).toBe(5);
    expect(v('=IFERROR(1/0; "x")')).toBe("x");
    expect(v('=IFS(1>2; "a"; TRUE; "b")')).toBe("b");
    expect(() => v("=1/0")).toThrow(FormulaError);
    expect(v('=TEXT(1234567; "#,##0")')).toBe("1 234 567");
    expect(v('=TEXT(0.126; "0.0%")')).toBe("12,6%");
  });
  it("dates: workdays skip Sunday and the holidays", () => {
    // 2026-10-09 is a Friday: one working day later is Saturday (Monday-to-Saturday week), two is Monday
    const serial = v("=DATE(2026; 10; 9)");
    expect(v('=WORKDAY.INTL(DATE(2026;10;9); 1; "0000001")')).toBe(serial + 1);
    expect(v('=WORKDAY.INTL(DATE(2026;10;9); 2; "0000001")')).toBe(serial + 3);
    expect(v('=NETWORKDAYS.INTL(DATE(2026;10;5); DATE(2026;10;11); "0000001")')).toBe(6);
    expect(v("=EDATE(DATE(2026;1;31); 1)")).toBe(v("=DATE(2026;2;28)"));
    expect(v("=EOMONTH(DATE(2026;2;10); 0)")).toBe(v("=DATE(2026;2;28)"));
  });
  it("parses the notations of both kinds", () => {
    expect(parse('=IF(A1>0, "x", "y")')).toEqual(parse('=IF(A1>0; "x"; "y")'));
  });
});

/** Puts synthetic orders on the sheet and evaluates the calculated columns. */
function ordersWithInputs(list) {
  const q = createProject({ now: NOW });
  q.call("nvSetup");
  for (const [i, o] of list.entries()) {
    q.call("nvAppendRow", "orders", {
      num: `NV-2026-${String(i + 1).padStart(4, "0")}`,
      created: q.date("2026-12-01T10:00:00+05:00"),
      client: `K-${i + 1}`,
      kind: o.kind,
      slot: o.slot || "Обычный",
      complex: !!o.complex,
      status: "Смета: черновик",
      code: "estimate_draft",
      basePc: o.basePc,
      baseMount: o.baseMount || 0,
      outside: o.outside || 0,
      purchased: o.purchased,
      memory: o.memory || 0,
    });
  }
  const c = createComputer(q);
  c.computeTables();
  return { q, rows: q.call("nvReadTable", "orders"), errors: c.errors };
}

const line = (key, group, unitSum, o = {}) => ({
  key,
  group,
  qty: 1,
  unitSum: sum(unitSum),
  isRamOrSsd: false,
  isFurnitureLike: false,
  customerOwned: false,
  purchasedByIp: true,
  ...o,
});

describe("calculated columns of the orders against packages/domain", () => {
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const cases = [];
  for (let i = 0; i < 160; i++) {
    const kind = ["ПК", "Сетап", "Апгрейд", "Подбор"][Math.floor(rnd() * 4)];
    const basePc = Math.floor(rnd() ** 2 * 70_000_000);
    const baseMount = rnd() < 0.3 ? Math.floor(rnd() * 14_000_000) : 0;
    const outside = rnd() < 0.2 ? Math.floor(rnd() * 3_000_000) : 0;
    const memory = Math.floor(basePc * rnd() * 0.5);
    cases.push({
      kind,
      basePc,
      baseMount,
      outside,
      purchased: basePc + baseMount + outside,
      memory,
      complex: rnd() < 0.15,
      slot: rnd() < 0.5 ? "Свободное окно" : "Обычный",
    });
  }
  // The edges of the scale
  for (const b of [
    0, 1, 19_999_999, 20_000_000, 29_999_999, 30_000_000, 6_699_999, 6_700_000, 4_499_999, 4_500_000, 13_299_999,
    13_300_000,
  ]) {
    cases.push({ kind: b >= 13_300_000 ? "Сетап" : "ПК", basePc: b, purchased: b, memory: 0 });
  }
  let run;
  beforeAll(() => {
    run = ordersWithInputs(cases);
  }, 180_000);

  it("evaluates without errors", () => {
    expect(run.errors).toEqual([]);
    expect(run.rows).toHaveLength(cases.length);
  });

  it("fee, reserve, limit, advance, final, grand total and the fee of «Подбор» are those of computeQuote", () => {
    run.rows.forEach((row, i) => {
      const c = { baseMount: 0, outside: 0, memory: 0, ...cases[i] };
      const lines = [
        line("pc", "pc", c.basePc - Math.min(c.memory, c.basePc)),
        line("mem", "pc", Math.min(c.memory, c.basePc), { isRamOrSsd: true }),
        line("mount", "mount", c.baseMount),
        line("out", "outside_scale", c.outside),
      ];
      const dom = computeQuote(lines, S, {
        now: NOW,
        kind: c.kind === "Сетап" ? "setup" : "pc",
        complexBuild: !!c.complex,
        freeWindowAvailable: c.slot === "Свободное окно",
        confirmed: false,
      });
      const memory = Math.min(c.memory, c.basePc);
      const at = `case ${i} ${JSON.stringify(c)}`;
      // the sheet takes the memory share of the purchase, as the domain does
      expect(row.reserveBp, at).toBe(dom.reserveBp);
      expect(row.reserveSum, at).toBe(dom.reserveSum);
      expect(row.purchaseLimit, at).toBe(dom.purchaseLimit);
      expect(row.feeTotal, at).toBe(dom.fee.total);
      expect(row.commission, at).toBe(dom.fee.commissionLine);
      expect(row.works, at).toBe(dom.fee.worksLine);
      expect(row.advance, at).toBe(dom.advance);
      expect(row.final, at).toBe(dom.final);
      expect(row.advance + row.final, at).toBe(row.feeTotal);
      expect(row.podborFee, at).toBe(podborFee(dom.fee, S));
      expect(row.grand, at).toBe(c.kind === "Подбор" ? podborFee(dom.fee, S) : dom.grandTotal);
      expect(row.feeRate, at).toBeCloseTo(dom.fee.effectiveRateBp / 10_000, 10);
      if (dom.eligibility.mode === "full_cycle")
        expect(row.eligibility, at).toBe(c.kind === "Подбор" ? "«Подбор»" : "Полный цикл");
      if (dom.eligibility.mode === "setup_below_min" && c.kind === "Сетап")
        expect(row.eligibility, at).toBe("Сетап ниже минимума");
      void memory;
    });
  });

  it("the eligibility column follows the scale (the sheet takes the kind from the column «Вид»)", () => {
    const e = (k, b, slot) => {
      const i = cases.findIndex((c) => c.kind === k && c.basePc === b && (slot === undefined || c.slot === slot));
      return i < 0 ? null : run.rows[i].eligibility;
    };
    expect(e("ПК", 6_700_000)).toBe("Полный цикл");
    expect(e("ПК", 4_500_000)).toMatch(/^Только/);
    expect(e("ПК", 4_499_999)).toBe("Только «Подбор»");
    expect(e("Сетап", 13_300_000)).toBe("Полный цикл");
  });
});

describe("the money columns of the demo orders against the script code", () => {
  let q;
  let computer;
  let rows;
  let state;
  beforeAll(() => {
    q = createProject({ now: NOW });
    q.call("nvSetup");
    q.call("nvDemoFill");
    computer = createComputer(q);
    computer.computeTables();
    rows = q.call("nvReadTable", "orders");
    const payments = q.call("nvReadTable", "payments");
    const purchases = q.call("nvReadTable", "purchases");
    // The state of every order as the script computes it (not from the formulas)
    q.run(
      "function __states() { const o = nvReadTable('orders'), pay = nvReadTable('payments'), pur = nvReadTable('purchases'); return o.map((x) => ({ num: x.num, st: nvOrderState(x, pay, pur, o, nvSettings(), nvHolidays()) })); }",
    );
    state = Object.fromEntries(q.callJson("__states").map((x) => [x.num, x.st]));
    void payments;
    void purchases;
  }, 120_000);

  it("evaluates without errors", () => {
    expect(computer.errors).toEqual([]);
  });

  it("money of every order: sheet formulas equal the functions of the script", () => {
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      const s = state[r.num];
      expect(r.purchaseLimit, r.num).toBe(s.quote.purchaseLimit);
      expect(r.feeTotal, r.num).toBe(s.quote.feeTotal);
      expect(r.grand, r.num).toBe(s.quote.grandTotal);
      expect(r.fundsGot, r.num).toBe(s.fundsGot);
      expect(r.receipts, r.num).toBe(s.receipts);
      expect(r.refunded, r.num).toBe(s.refunded);
      expect(r.remainder, r.num).toBe(s.remainder);
      expect(r.feeNet, r.num).toBe(s.feeNet);
      expect(r.feePaid, r.num).toBe(s.feePaid ? "Да" : "Нет");
      expect(r.fundsOk, r.num).toBe(s.fundsOk ? "Да" : "Нет");
      expect(r.meetingNeeded, r.num).toBe(s.meetingNeeded ? "Да" : "Нет");
      expect(r.recon, r.num).toBe(
        s.recon.startsWith("Остаток")
          ? `Остаток ${new Intl.NumberFormat("ru-RU").format(s.remainder).replace(/[  ]/g, " ")} сум`
          : s.recon,
      );
      if (s.notBefore) expect(new Date(r.notBefore).getTime(), r.num).toBe(new Date(s.notBefore).getTime());
      else expect(r.notBefore, r.num).toBe("");
    }
  });

  it("the money of a reconciled order is exact: received = receipts + refunded", () => {
    for (const r of rows.filter((x) => ["closed", "handed_over", "testing"].includes(x.code))) {
      expect(r.recon, r.num).toBe("Сходится");
      expect(r.fundsGot).toBe(r.receipts + r.refunded);
    }
  });

  it("the warranty and the tax reserve of an order come from the ledger", () => {
    const ledger = q.call("nvReadTable", "reserves");
    for (const r of rows) {
      const tax = ledger
        .filter((x) => x.ref === r.num && x.fund === "Налоговый риск")
        .reduce((a, x) => a + x.amount, 0);
      const warranty = ledger
        .filter((x) => x.ref === r.num && x.fund === "Гарантийный" && x.basis === "Взнос при сдаче")
        .reduce((a, x) => a + x.amount, 0);
      expect(r.taxReserve, r.num).toBe(tax);
      expect(r.warrantyContribution, r.num).toBe(warranty);
    }
  });

  it("the status, the group and the projection for the customer by the dictionary", () => {
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by.closed.forClient).toBe("Сдано");
    expect(by.closed.group).toBe("Сдан");
    expect(by.accepted.forClient).toBe("Предоплата получена");
    expect(by.estimate_sent.forClient).toBe("Смета");
    expect(by.estimate_sent.group).toBe("Ждёт клиента");
    expect(by.purchasing.group).toBe("В работе");
    expect(by.testing.forClient).toBe("Сборка и тест");
  });

  it("the sums above the table (SUBTOTAL) add the column", () => {
    const sh = q.env.ss.getSheetByName("Заказы");
    const keys = schema().orders.cols.map((c) => c.key);
    const col = 2 + keys.indexOf("purchaseLimit");
    const total = sh._cell(4, col);
    computer.computePlain("Заказы");
    expect(total.v).toBe(rows.reduce((a, r) => a + r.purchaseLimit, 0));
  });
});

describe("payments, purchases, warranty, clients and promotion columns", () => {
  let q;
  let computer;
  beforeAll(() => {
    q = createProject({ now: NOW });
    q.call("nvSetup");
    q.call("nvDemoFill");
    computer = createComputer(q);
    computer.computeTables();
  }, 120_000);

  it("the check of a payment is the check of the domain for every pair, status and receipt", () => {
    const kinds = JSON.parse(q.run("JSON.stringify(NV_PAYMENT_KINDS)"));
    const methods = JSON.parse(q.run("JSON.stringify(NV_PAYMENT_METHODS)"));
    const dirs = { Входящий: "in", Исходящий: "out" };
    for (const k of kinds) {
      for (const m of methods) {
        for (const status of ["Ожидается", "Подтверждён"]) {
          for (const receipt of ["", "FS-1"]) {
            const mine = q.call("nvCheckPayment", k.label, m.label, status, receipt);
            const dom = validatePayment({
              kind: k.code,
              direction: dirs[k.direction],
              method: m.code,
              status: status === "Подтверждён" ? "confirmed" : "expected",
              fiscalReceiptNo: receipt,
            });
            expect(mine === "ОК", `${k.code} ${m.code} ${status} ${receipt}`).toBe(dom.ok);
          }
        }
      }
    }
  });

  it("the sheet column «Проверка» gives the same text as the script function", () => {
    const rows = q.call("nvReadTable", "payments");
    for (const r of rows) expect(r.check, r.id).toBe(q.call("nvCheckPayment", r.kind, r.method, r.status, r.receipt));
  });

  it("the group and the direction of a payment come from its kind", () => {
    const rows = q.call("nvReadTable", "payments");
    for (const r of rows) {
      const k = JSON.parse(q.run("JSON.stringify(NV_PAYMENT_KINDS)")).find((x) => x.label === r.kind);
      expect(r.group, r.id).toBe(k.group);
      expect(r.direction, r.id).toBe(k.direction);
    }
  });

  it("purchases: the deadline of ESF +10 days, the warranty of the shop, the running total of the order, the limit check", () => {
    const rows = q.call("nvReadTable", "purchases");
    const orders = q.call("nvReadTable", "orders");
    const run = {};
    for (const r of rows) {
      run[r.order] = (run[r.order] || 0) + r.amount;
      expect(r.cumul, r.id).toBe(run[r.order]);
      const o = orders.find((x) => x.num === r.order);
      expect(["ОК", "Больше полученных денег — нельзя", "Выше лимита — нужно согласие клиента"]).toContain(
        r.limitCheck,
      );
      expect(r.limitCheck, r.id).toBe(
        run[r.order] > o.fundsGot
          ? "Больше полученных денег — нельзя"
          : run[r.order] > o.purchaseLimit
            ? "Выше лимита — нужно согласие клиента"
            : "ОК",
      );
      if (r.esf) expect(new Date(r.esfDue).getTime() - new Date(r.bought).getTime()).toBe(10 * 86_400_000);
      if (r.warrantyMonths) expect(new Date(r.warrantyUntil).getTime()).toBeGreaterThan(new Date(r.bought).getTime());
    }
  });

  it("warranty: the client, in or out of the warranty, the overdue mark", () => {
    const rows = q.call("nvReadTable", "warranty");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.client).toMatch(/^K-/);
      expect(r.inWarranty).toBe("Да");
    }
    expect(rows.find((r) => r.status === "Диагностика").overdue).toBe("");
  });

  it("clients: the counters of leads, orders, deals and the fee", () => {
    const rows = q.call("nvReadTable", "clients");
    const withOrder = rows.filter((c) => c.ordersN > 0);
    expect(withOrder).toHaveLength(8);
    expect(rows.reduce((a, c) => a + c.leadsN, 0)).toBe(12);
    const delivered = rows.filter((c) => c.delivered > 0);
    expect(delivered).toHaveLength(3);
    const orders = q.call("nvReadTable", "orders");
    for (const c of withOrder) {
      const own = orders.filter((o) => o.client === c.code);
      expect(c.feeAll, c.code).toBe(own.reduce((a, o) => a + o.feeNet, 0));
      expect(c.dealsSum, c.code).toBe(own.filter((o) => o.group === "Сдан").reduce((a, o) => a + o.grand, 0));
    }
  });

  it("promotion: the price of a lead and of a client by the channel", () => {
    const rows = q.call("nvReadTable", "promo");
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      if (r.leadsN > 0) expect(r.leadCost).toBe(Math.floor(r.spend / r.leadsN));
      else expect(r.leadCost).toBe("—");
      if (r.ordersN > 0) expect(r.clientCost).toBe(Math.floor(r.spend / r.ordersN));
    }
  });

  it("leads: the estimate of the reply time", () => {
    const rows = q.call("nvReadTable", "leads");
    const replied = rows.filter((r) => r.firstReply !== "");
    expect(replied.length).toBeGreaterThan(5);
    for (const r of replied) expect(typeof r.replyH).toBe("number");
  });
});

describe("the calculator against the domain", () => {
  let q;
  let computer;
  const setInputs = (o) => {
    const sh = q.env.ss.getSheetByName("Калькулятор");
    sh.getRange("C6").setValue(o.kind);
    sh.getRange("C7").setValue(o.basePc);
    sh.getRange("C8").setValue(o.baseMount || 0);
    sh.getRange("C9").setValue(o.outside || 0);
    sh.getRange("C10").setValue(o.purchased);
    sh.getRange("C11").setValue(o.memory || 0);
    sh.getRange("C12").setValue(!!o.complex);
    sh.getRange("C13").setValue(!!o.free);
    computer = createComputer(q);
    computer.computePlain("Калькулятор");
    return (a1) => sh.getRange(a1).getValue();
  };
  beforeAll(() => {
    q = createProject({ now: NOW });
    q.call("nvSetup");
  }, 120_000);

  it("a quote for a PC: fee 3 000 000 at 25 mln, advance 900 000, final 2 100 000, reserve 5 % at the memory share", () => {
    const get = setInputs({ kind: "ПК", basePc: 25_000_000, purchased: 25_000_000, memory: 6_500_000 });
    expect(get("F8")).toBe(3_000_000);
    expect(get("F9")).toBe(0.12);
    expect(get("F12")).toBe(900_000);
    expect(get("F13")).toBe(2_100_000);
    expect(get("F14")).toBe(500);
    expect(get("F15")).toBe(1_250_000);
    expect(get("F16")).toBe(26_250_000);
    expect(get("F17")).toBe(29_250_000);
    expect(get("F18")).toBe("Полный цикл");
    expect(get("F19")).toBe(600_000);
  });

  it("matches the domain on a grid of inputs", () => {
    for (const basePc of [
      0, 4_000_000, 5_000_000, 6_700_000, 10_000_000, 19_999_999, 20_000_000, 33_333_333, 60_000_000,
    ]) {
      for (const baseMount of [0, 7_500_000]) {
        const kind = baseMount ? "Сетап" : "ПК";
        const memory = Math.floor(basePc / 3);
        const get = setInputs({ kind, basePc, baseMount, purchased: basePc + baseMount, memory });
        const lines = [
          line("a", "pc", basePc - memory),
          line("m", "pc", memory, { isRamOrSsd: true }),
          line("mt", "mount", baseMount),
        ];
        const dom = computeQuote(lines, S, {
          now: NOW,
          kind: kind === "Сетап" ? "setup" : "pc",
          complexBuild: false,
          freeWindowAvailable: false,
          confirmed: false,
        });
        expect(get("F8"), `${kind} ${basePc}`).toBe(dom.fee.total);
        expect(get("F16"), `${kind} ${basePc}`).toBe(dom.purchaseLimit);
        expect(get("F17"), `${kind} ${basePc}`).toBe(dom.grandTotal);
        expect(get("F12") + get("F13")).toBe(get("F8"));
      }
    }
  });

  it("the check of the scale gives «ОК» in every row, the sums are those of the owner's documents", () => {
    setInputs({ kind: "ПК", basePc: 1, purchased: 1 });
    const sh = q.env.ss.getSheetByName("Калькулятор");
    const expected = [750_000, 3_000_000, 4_000_000, 3_750_000];
    expected.forEach((e, i) => {
      expect(sh.getRange(32 + i, 3).getValue()).toBe(e);
      expect(sh.getRange(32 + i, 5).getValue()).toBe(e);
      expect(sh.getRange(32 + i, 6).getValue()).toBe("ОК");
    });
  });

  it("the reverse calculation (budget → parts) is partsBudgetFromTotal and re-quotes within the budget", () => {
    for (const budget of [4_000_000, 10_000_000, 17_345_678, 40_000_000, 99_999_999]) {
      const sh = q.env.ss.getSheetByName("Калькулятор");
      sh.getRange("C23").setValue(budget);
      computer = createComputer(q);
      computer.computePlain("Калькулятор");
      const parts = sh.getRange("C25").getValue();
      expect(parts).toBe(partsBudgetFromTotal(sum(budget), S, bp(300)));
      expect(sh.getRange("C28").getValue()).toBeLessThanOrEqual(budget);
      expect(sh.getRange("C28").getValue()).toBe(parts + sh.getRange("C26").getValue() + sh.getRange("C27").getValue());
    }
  });

  it("the input cells reject a budget above the limit", () => {
    const dv = q.env.ss.getSheetByName("Калькулятор").getRange("C23").getCell(1, 1);
    expect(dv).toBeTruthy();
    expect(() =>
      q.call("nvPartsFromBudget", 1_000_000_000_001, JSON.parse(q.run("JSON.stringify(nvSettings())")), 300),
    ).toThrow();
  });
});

describe("the threshold block against the domain", () => {
  let thq;
  const th = (regDate, proportion) => {
    if (!thq) {
      thq = createProject({ now: NOW });
      thq.call("nvSetup");
    }
    const q = thq;
    const set = (n, v) => q.env.ss.getRangeByName(n).setValue(v);
    set("NV_REG_DATE", regDate ? q.date(`${regDate}T00:00:00+05:00`) : "");
    set("NV_PROPORTION", proportion);
    const c = createComputer(q);
    c.computePlain("Порог и налоги");
    return q.env.ss.getSheetByName("Порог и налоги").getRange("C7").getValue();
  };
  it("limit of the year: the documented values and the domain on a grid of registration dates", {
    timeout: 120_000,
  }, () => {
    expect(th("2026-10-15", "Без дня регистрации")).toBe(210_958_904);
    expect(th("2026-10-15", "С днём регистрации")).toBe(213_698_630);
    expect(th("2026-11-01", "Без дня регистрации")).toBe(164_383_561);
    expect(th("2026-11-01", "С днём регистрации")).toBe(167_123_287);
    expect(th(null, "Без дня регистрации")).toBe(1_000_000_000);
    for (const d of ["2026-01-01", "2026-02-28", "2026-07-01", "2026-12-31"]) {
      for (const [label, code] of [
        ["Без дня регистрации", "without_registration_day"],
        ["С днём регистрации", "with_registration_day"],
      ]) {
        expect(th(d, label), `${d} ${code}`).toBe(
          thresholdForYear(2026, { ...DEFAULT_THRESHOLD_SETTINGS, registrationDate: d, proportion: code }),
        );
      }
    }
  });

  it("volume, shares and the alerts of the year from the demo: deals = receipts + fee − refunds", () => {
    const q = createProject({ now: NOW });
    q.call("nvSetup");
    q.call("nvDemoFill");
    q.env.ss.getSheetByName("Панель").getRange("I3").setValue(true);
    q.env.ss.getRangeByName("NV_REG_DATE").setValue(q.date("2026-10-15T00:00:00+05:00"));
    const c = createComputer(q);
    c.computeTables();
    c.computePlain("Порог и налоги");
    const sh = q.env.ss.getSheetByName("Порог и налоги");
    const entries = q
      .callJson("nvThresholdEntries", true)
      .map((e) => ({ kind: e.kind, amount: sum(e.amount), date: e.date }));
    const orders = q.call("nvReadTable", "orders");
    const committed = orders.filter((o) => o.code === "accepted").reduce((a, o) => a + o.purchaseLimit + o.feeTotal, 0);
    const dom = thresholdStatus(entries, sum(committed), 2026, {
      ...DEFAULT_THRESHOLD_SETTINGS,
      registrationDate: "2026-10-15",
    });
    expect(sh.getRange("C7").getValue()).toBe(dom.limit);
    expect(sh.getRange("C8").getValue()).toBe(dom.volume);
    expect(sh.getRange("C9").getValue()).toBe(dom.committed);
    expect(Math.round(sh.getRange("C10").getValue() * 10_000)).toBe(dom.shareBp);
    expect(Math.round(sh.getRange("C11").getValue() * 10_000)).toBe(dom.projectedShareBp);
    expect(sh.getRange("C14").getValue()).toBe(dom.remaining);
    expect(dom.crossedAlerts.length).toBeGreaterThan(0);
  });

  it("the tax by month: 1 % of the fee, up, and the due date is the 15th of the next month", () => {
    const q = createProject({ now: NOW });
    q.call("nvSetup");
    q.call("nvDemoFill");
    q.env.ss.getSheetByName("Панель").getRange("I3").setValue(true);
    const c = createComputer(q);
    c.computeTables();
    c.computePlain("Порог и налоги");
    const sh = q.env.ss.getSheetByName("Порог и налоги");
    for (let r = 6; r <= 17; r++) {
      const fee = sh.getRange(r, 7).getValue() - sh.getRange(r, 8).getValue();
      expect(sh.getRange(r, 12).getValue()).toBe(Math.ceil(Math.max(0, fee) / 100));
      const due = new Date(sh.getRange(r, 14).getValue());
      expect(due.getUTCDate()).toBe(due.getUTCHours() >= 19 ? 14 : 15);
    }
  });
});
