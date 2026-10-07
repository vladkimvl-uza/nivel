// The setup of the CRM book on the mock of Google Sheets: sheets, columns, widths, fonts, validations, rules, charts,
// protection, themes; and that a second run changes nothing and never touches the data.
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const NOW = new Date("2026-10-06T12:00:00+05:00");
let p;
let ss;
const schema = () => JSON.parse(p.run("JSON.stringify(NV_SCHEMA)"));
const sheet = (name) => ss.getSheetByName(name);
const snapshot = () => {
  const out = {};
  for (const sh of ss.sheets) {
    const cells = {};
    for (const [k, c] of sh.cells) cells[k] = JSON.stringify([c.v instanceof Date ? c.v.getTime() : c.v, c.f]);
    out[sh.name] = cells;
  }
  return out;
};

beforeAll(() => {
  p = createProject({ now: NOW });
  p.call("nvSetup");
  ss = p.env.ss;
}, 120_000);

describe("sheets", () => {
  it("builds all 20 sheets in the order of the book, without the default one", () => {
    expect(ss.sheets.map((s) => s.name)).toEqual([
      "Панель",
      "Сегодня",
      "Телефон",
      "Заявки",
      "Заказы",
      "Платежи",
      "Закупки",
      "Гарантия",
      "Клиенты",
      "Калькулятор",
      "Порог и налоги",
      "Резервы",
      "Продвижение",
      "История",
      "Журнал вебхука",
      "Справочники",
      "Настройки",
      "Самопроверка",
      "_Данные",
      "_Задачи",
    ]);
  });

  it("hides the two service sheets and sets the time zone and the locale", () => {
    expect(sheet("_Данные").hidden).toBe(true);
    expect(sheet("_Задачи").hidden).toBe(true);
    expect(ss.getSpreadsheetTimeZone()).toBe("Asia/Tashkent");
    expect(ss.getSpreadsheetLocale()).toBe("ru_RU");
  });

  it("sets the theme of the book: Fira Sans and the brand accents", () => {
    expect(ss.themeFont).toBe("Fira Sans");
    expect(ss.themeColors.ACCENT1).toBe("#D9501A");
    expect(ss.themeColors.ACCENT2).toBe("#1D1D1B");
    expect(ss.themeColors.ACCENT3).toBe("#6B6862");
    expect(ss.themeColors.ACCENT4).toBe("#A9A59C");
    expect(ss.themeColors.ACCENT5).toBe("#D6D2C8");
    expect(ss.themeColors.ACCENT6).toBe("#F06A30");
  });

  it("the only coloured tabs are the asphalt Панель and the orange Сегодня; service sheets are grey", () => {
    expect(sheet("Панель").tabColor).toBe("#1D1D1B");
    expect(sheet("Сегодня").tabColor).toBe("#D9501A");
    for (const n of ["_Данные", "_Задачи", "Справочники", "Настройки", "История", "Журнал вебхука", "Самопроверка"]) {
      expect(sheet(n).tabColor).toBe("#A9A59C");
    }
    for (const n of [
      "Заявки",
      "Заказы",
      "Платежи",
      "Закупки",
      "Гарантия",
      "Клиенты",
      "Калькулятор",
      "Порог и налоги",
      "Резервы",
      "Продвижение",
    ]) {
      expect(sheet(n).tabColor).toBeNull();
    }
  });
});

describe("columns by the structure", () => {
  const expected = {
    leads: 26,
    orders: 101,
    payments: 21,
    purchases: 26,
    warranty: 25,
    history: 12,
    webhook: 11,
    selfcheck: 4,
  };
  it.each(Object.entries(expected))("%s has %i columns, in the header row, in order", (key, n) => {
    const def = schema()[key];
    expect(def.cols).toHaveLength(n);
    const sh = sheet(def.title);
    const heads = sh.getRange(5, 2, 1, n).getValues()[0];
    const forms = sh.getRange(5, 2, 1, n).getFormulas()[0];
    def.cols.forEach((c, i) => {
      if (c.calc) expect(forms[i].startsWith(`={"${c.title}"; MAP(`)).toBe(true);
      else expect(heads[i]).toBe(c.title);
    });
  });

  it("the documented additions: clients with the reference of the platform, promotion and reserves with the demo flag", () => {
    const s = schema();
    expect(s.clients.cols).toHaveLength(20);
    expect(s.promo.cols.map((c) => c.key)).toContain("demo");
    expect(s.reserves.cols.map((c) => c.key)).toEqual([
      "date",
      "fund",
      "ref",
      "amount",
      "basis",
      "who",
      "comment",
      "demo",
    ]);
  });

  it("orders: the key columns, in the order of the structure", () => {
    const keys = schema().orders.cols.map((c) => c.key);
    expect(keys.slice(0, 9)).toEqual([
      "num",
      "created",
      "lead",
      "client",
      "clientName",
      "kind",
      "slot",
      "complex",
      "furn",
    ]);
    expect(keys).toContain("feeTotal");
    expect(keys.at(-1)).toBe("demo");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("layout and look of a table sheet", () => {
  it("gutter 16 px, title row 44, header 32, data 28, frozen header and the number column, no gridlines", () => {
    const sh = sheet("Заказы");
    expect(sh.colW.get(1)).toBe(16);
    expect(sh.rowH.get(1)).toBe(12);
    expect(sh.rowH.get(2)).toBe(44);
    expect(sh.rowH.get(3)).toBe(20);
    expect(sh.rowH.get(5)).toBe(32);
    expect(sh.rowH.get(6)).toBe(28);
    expect(sh.frozenRows).toBe(5);
    expect(sh.frozenCols).toBe(2);
    expect(sh.hiddenGrid).toBe(true);
  });

  it("widths follow the types: numbers 128, dates 104-128, sums 132, flags narrow", () => {
    const sh = sheet("Заказы");
    expect(sh.colW.get(2)).toBe(128);
    expect(sh.colW.get(3)).toBe(128);
    const keys = schema().orders.cols.map((c) => c.key);
    expect(sh.colW.get(2 + keys.indexOf("basePc"))).toBe(132);
    expect(sh.colW.get(2 + keys.indexOf("complex"))).toBeLessThanOrEqual(70);
  });

  it("headers: Fira Sans 9 bold, calculated columns darker, bottom rule 2 px", () => {
    const sh = sheet("Заявки");
    const head = sh._cell(5, 2);
    expect(head.ff).toBe("Fira Sans");
    expect(head.fs).toBe(9);
    expect(head.fw).toBe("bold");
    expect(head.bg).toBe("#E4DDD2");
    expect(head.fc).toBe("#1D1D1B");
    expect(head.borders.bottom).toEqual({ color: "#1D1D1B", style: "SOLID_MEDIUM" });
    const calcHead = sh._cell(5, 2 + schema().leads.cols.findIndex((c) => c.key === "replyH"));
    expect(calcHead.bg).toBe("#D9D2C5");
  });

  it("numbers, dates and money in IBM Plex Mono; text in Fira Sans; formats as in the visual system", () => {
    const sh = sheet("Заказы");
    const keys = schema().orders.cols.map((c) => c.key);
    const at = (k) => sh._cell(6, 2 + keys.indexOf(k));
    expect(at("num").ff).toBe("IBM Plex Mono");
    expect(at("num").nf).toBe("@");
    expect(at("created").ff).toBe("IBM Plex Mono");
    expect(at("created").nf).toBe("dd.mm.yyyy hh:mm");
    expect(at("basePc").nf).toBe('#,##0" сум";-#,##0" сум";"—"');
    expect(at("basePc").ha).toBe("right");
    expect(at("feeRate").nf).toBe("0.00%");
    expect(at("clientName").ff).toBe("Fira Sans");
    expect(at("kind").ff).toBe("Fira Sans");
  });

  it("row bands and row lines come from the theme; the title carries the orange mark", () => {
    const sh = sheet("Заказы");
    expect(sh.bandings).toHaveLength(1);
    expect(sh.bandings[0].first).toBe("#FBF9F4");
    expect(sh.bandings[0].second).toBe("#F4F0E8");
    expect(sh._cell(6, 2).borders.bottom).toEqual({ color: "#DDD5C8", style: "SOLID" });
    const title = sh._cell(2, 2).rich;
    expect(title.getText()).toBe("▼ Заказы");
    expect(title.runs[0].style.color).toBe("#D9501A");
    expect(title.runs[1].style.color).toBe("#1D1D1B");
  });

  it("hidden columns: the code of the status, the group, the last seq; the groups are collapsed", () => {
    const sh = sheet("Заказы");
    const keys = schema().orders.cols.map((c) => c.key);
    for (const k of ["code", "group", "seq"]) expect(sh.hiddenCols.has(2 + keys.indexOf(k))).toBe(true);
    for (const g of ["reserveBp", "reportTarget", "dEstimate", "cancelPoint", "taxEst"]) {
      expect(sh.collapsedCols.has(2 + keys.indexOf(g))).toBe(true);
    }
    expect(sh.collapsedCols.has(2 + keys.indexOf("feeTotal"))).toBe(false);
    expect(sh.collapsedCols.has(2 + keys.indexOf("basePc"))).toBe(false);
  });

  it("totals sit above the header and use SUBTOTAL, so a filter changes them", () => {
    const sh = sheet("Заказы");
    const keys = schema().orders.cols.map((c) => c.key);
    const f = sh._cell(4, 2 + keys.indexOf("purchaseLimit")).f;
    expect(f).toMatch(/^=SUBTOTAL\(109,/);
  });

  it("a basic filter is set on the header and the body", () => {
    expect(sheet("Заказы").filter).not.toBeNull();
    expect(sheet("Заказы").filter.range.row).toBe(5);
  });
});

describe("validations", () => {
  const def = () => schema();
  it("lists come from named ranges of the dictionary sheet and reject other values", () => {
    const sh = sheet("Заявки");
    const keys = def().leads.cols.map((c) => c.key);
    const dv = sh._cell(6, 2 + keys.indexOf("channel")).dv;
    expect(dv.type).toBe("range");
    expect(dv.rangeSheet).toBe("Справочники");
    expect(dv.allowInvalid).toBe(false);
    for (const k of ["status", "scope", "band", "reason", "lang", "district"]) {
      expect(sh._cell(6, 2 + keys.indexOf(k)).dv.type).toBe("range");
    }
  });

  it("money inputs are whole numbers not below zero; the memory share is at most the purchase", () => {
    const sh = sheet("Заказы");
    const keys = def().orders.cols.map((c) => c.key);
    const letter = (k) => p.call("nvColLetter", "orders", k);
    const base = sh._cell(6, 2 + keys.indexOf("basePc")).dv;
    const b = `${letter("basePc")}6`;
    expect(base.type).toBe("formula");
    expect(base.formula).toBe(`=AND(ISNUMBER(${b}), ${b}=INT(${b}), ${b}>=0)`);
    const mem = sh._cell(6, 2 + keys.indexOf("memory")).dv;
    const m = `${letter("memory")}6`;
    expect(mem.formula).toBe(`=AND(ISNUMBER(${m}), ${m}=INT(${m}), ${m}>=0, ${m}<=${letter("purchased")}6)`);
  });

  it("payments: the amount is above zero, the order must exist; purchases: quantity 1 or more", () => {
    const pay = sheet("Платежи");
    const keys = def().payments.cols.map((c) => c.key);
    expect(pay._cell(6, 2 + keys.indexOf("amount")).dv.formula).toContain(">0)");
    const order = pay._cell(6, 2 + keys.indexOf("order")).dv;
    expect(order.type).toBe("range");
    expect(order.rangeSheet).toBe("Заказы");
    const pk = def().purchases.cols.map((c) => c.key);
    expect(sheet("Закупки")._cell(6, 2 + pk.indexOf("qty")).dv.formula).toContain(">=1");
  });

  it("checkboxes appear only on the rows that hold data (an empty row shows no boxes)", () => {
    expect(sheet("Заказы")._cell(6, 9).dv).toBeUndefined();
  });

  it("settings: basis points 0..10 000, sums whole and not negative, flags are checkboxes", () => {
    const sh = sheet("Настройки");
    const layout = JSON.parse(p.run("JSON.stringify(nvSettingsLayout())"));
    const row = (name) => layout.find((x) => x.def.name === name).row;
    // Whole numbers are a formula about the cell: the number rules of Sheets do not ask for a whole number
    const lowBp = sh._cell(row("NV_PC_LOW_BP"), 3).dv;
    expect(lowBp.type).toBe("formula");
    expect(lowBp.formula).toContain("<=10000");
    expect(sh._cell(row("NV_PC_THRESHOLD"), 3).dv.type).toBe("formula");
    expect(sh._cell(row("NV_TAX_RISK_ACTIVE"), 3).dv.type).toBe("checkbox");
  });

  it("the panel: period, year and the demo flag", () => {
    const sh = sheet("Панель");
    expect(sh._cell(3, 3).dv.type).toBe("range");
    expect(sh._cell(3, 6).dv.type).toBe("range");
    expect(sh._cell(3, 9).dv.type).toBe("checkbox");
    expect(sh._cell(3, 3).v).toBe("Этот месяц");
    expect(sh._cell(3, 6).v).toBe(2026);
    expect(sh._cell(3, 9).v).toBe(false);
  });
});

describe("named ranges", () => {
  it("every setting is a named cell NV_*, the alerts form one range, the holidays are a range", () => {
    const rows = JSON.parse(p.run("JSON.stringify(nvSettingRows().map((r) => r.name))"));
    for (const n of rows) expect(ss.getRangeByName(n), n).toBeTruthy();
    expect(ss.getRangeByName("NV_ALERTS_BP").numRows).toBe(5);
    expect(ss.getRangeByName("NV_HOLIDAYS")).toBeTruthy();
  });

  it("every dictionary column is a named range NVD_*; the codes of the statuses are 17", () => {
    expect(
      ss
        .getRangeByName("NVD_STATUS_CODE")
        .getValues()
        .filter((r) => r[0] !== ""),
    ).toHaveLength(17);
    expect(ss.getRangeByName("NVD_STATUS_LABEL").getValues()[3][0]).toBe("Принят: ждём оплату");
  });

  it("the defaults of the settings are the documented ones", () => {
    const v = (n) => ss.getRangeByName(n).getValue();
    expect(v("NV_PC_LOW_BP")).toBe(1500);
    expect(v("NV_PC_HIGH_BP")).toBe(1000);
    expect(v("NV_PC_THRESHOLD")).toBe(20_000_000);
    expect(v("NV_PC_HIGH_MIN_FEE")).toBe(3_000_000);
    expect(v("NV_RESERVE_STEP")).toBe(10_000);
    expect(v("NV_ANNUAL_LIMIT")).toBe(1_000_000_000);
    expect(v("NV_PLAN_CAP_2026")).toBe(200_000_000);
    expect(v("NV_FIRST_RESPONSE_HOURS")).toBe(2);
    expect(v("NV_PROPORTION")).toBe("Без дня регистрации");
    expect(ss.getRangeByName("NV_COMMISSION_BP").getFormula()).toBe("=NV_STAGE_SELECTION_BP+NV_STAGE_PURCHASE_BP");
    expect(
      ss
        .getRangeByName("NV_ALERTS_BP")
        .getValues()
        .map((r) => r[0]),
    ).toEqual([6000, 7000, 8000, 9000, 10000]);
  });
});

describe("conditional formatting uses two accents only", () => {
  it("status rules of the orders: ten tones, the stamp of handover is asphalt on paper", () => {
    const sh = sheet("Заказы");
    const statusCol = 2 + schema().orders.cols.findIndex((c) => c.key === "status");
    const statusRules = sh.cf.filter((r) => r.ranges[0].col === statusCol);
    expect(statusRules).toHaveLength(10);
    const stamp = statusRules[0];
    expect(stamp.background).toBe("#1D1D1B");
    expect(stamp.fontColor).toBe("#F1EFEA");
    expect(stamp.bold).toBe(true);
    expect(stamp.formula).toContain('"handed_over"');
  });

  it("only the colours of the theme appear in the rules (the orange only for action, grey for done)", () => {
    // Every colour of a rule is one of the colours of the theme of the paper: nothing is typed into a rule by hand
    const allowed = new Set(
      JSON.stringify(JSON.parse(p.run("JSON.stringify(NV_THEMES.passport)"))).match(/#[0-9A-F]{6}/g),
    );
    for (const n of [
      "Заказы",
      "Заявки",
      "Платежи",
      "Закупки",
      "Гарантия",
      "Клиенты",
      "Продвижение",
      "История",
      "Журнал вебхука",
      "Самопроверка",
      "Сегодня",
    ]) {
      for (const r of sheet(n).cf) {
        for (const c of [r.background, r.fontColor]) if (c) expect(allowed.has(c), `${n}: ${c}`).toBe(true);
      }
    }
  });

  it("every formula of a rule is in the US notation and balanced", () => {
    for (const sh of ss.sheets) {
      for (const r of sh.cf) {
        expect(r.formula.startsWith("=")).toBe(true);
        expect(p.call("nvFormulaBalance", r.formula), `${sh.name}: ${r.formula}`).toBe(0);
        expect(r.formula).not.toMatch(/;/);
      }
    }
  });
});

describe("protection warns, never locks", () => {
  it("formula and script columns are protected with a warning only", () => {
    const prots = sheet("Заказы").protections;
    expect(prots.length).toBeGreaterThan(5);
    for (const pr of prots) {
      expect(pr.warningOnly).toBe(true);
      expect(pr.description.startsWith("Nivel:")).toBe(true);
    }
  });

  it("the panel is protected except the period, the year and the demo flag", () => {
    const pr = sheet("Панель").sheetProtection;
    expect(pr.warningOnly).toBe(true);
    expect(pr.unprotected.map((r) => r.getA1Notation()).sort()).toEqual(["C3:D3", "F3", "I3"]);
  });

  it("history, reserves and the webhook journal are protected as script-only", () => {
    for (const n of ["История", "Резервы", "Журнал вебхука"]) {
      expect(
        sheet(n).protections.some((x) => x.description === "Nivel: заполняет скрипт"),
        n,
      ).toBe(true);
    }
  });
});

describe("the panel", () => {
  it("grid: gutter 16, twelve columns of 96, gutter 16; helper columns hidden", () => {
    const sh = sheet("Панель");
    expect(sh.colW.get(1)).toBe(16);
    for (let c = 2; c <= 13; c++) expect(sh.colW.get(c)).toBe(96);
    expect(sh.colW.get(14)).toBe(16);
    for (let c = 15; c <= 20; c++) expect(sh.hiddenCols.has(c)).toBe(true);
    expect(sh.hiddenGrid).toBe(true);
  });

  it("twelve tiles of three columns, four rows each, with a label, a figure, a line and a trend", () => {
    const sh = sheet("Панель");
    const tiles = JSON.parse(p.run("JSON.stringify(NV_TILES)"));
    expect(tiles).toHaveLength(12);
    tiles.forEach((t, i) => {
      const pos = JSON.parse(p.run(`JSON.stringify(nvTilePos(${i}))`));
      expect(sh._cell(pos.row, pos.col).v).toBe(t.label);
      expect(sh._cell(pos.row + 1, pos.col).f).toMatch(/^='_Данные'!\$B\$\d+$/);
      expect(sh._cell(pos.row + 2, pos.col).f).toMatch(/^='_Данные'!\$D\$\d+$/);
      expect(sh._cell(pos.row + 1, pos.col).ff).toBe("IBM Plex Mono");
      expect(sh._cell(pos.row + 1, pos.col).fs).toBe(22);
      expect(sh._cell(pos.row, pos.col).fs).toBe(9);
      expect(sh.merges.some((m) => m.row === pos.row + 1 && m.col === pos.col && m.numCols === 3)).toBe(true);
    });
    expect(sh._cell(8, 2).f).toMatch(/^=SPARKLINE\(/);
  });

  it("the threshold tile carries the stacked bar in the colours of the theme", () => {
    const sh = sheet("Панель");
    const pos = JSON.parse(p.run("JSON.stringify(nvTilePos(4))"));
    const f = sh._cell(pos.row + 3, pos.col).f;
    expect(f).toContain('"charttype","bar"');
    expect(f).toContain("TH_LIMIT");
    expect(f).toContain("#D9501A");
    expect(f).toContain("#6E695F");
  });

  it("the logo is placed over B2 at 40 px", () => {
    const img = sheet("Панель").images[0];
    expect(img.col).toBe(2);
    expect(img.row).toBe(2);
    expect(img.height).toBe(40);
    expect(img.blob.type).toBe("image/png");
  });

  it("eight charts in the colours of the theme: orange on three lines only, no rainbow", () => {
    const charts = sheet("Панель").charts;
    expect(charts).toHaveLength(8);
    // Every colour of a chart is a colour of the theme or of the palette of the book
    const allowed = new Set(
      JSON.stringify(JSON.parse(p.run("JSON.stringify([NV_THEMES.passport, NV_BOOK_THEME])"))).match(/#[0-9A-F]{6}/g),
    );
    for (const ch of charts) {
      const o = ch.spec.options;
      expect(o.fontName).toBe("Fira Sans");
      expect(o.backgroundColor).toBe("#FBF9F4");
      const colours = [...Object.values(o.series || {}).map((s) => s.color), ...(o.colors || [])];
      for (const c of colours) expect(allowed.has(c), c).toBe(true);
      expect(o["vAxis.gridlines.color"]).toBe("#E4DDD2");
      expect(JSON.stringify(o)).not.toMatch(/is3D|vAxes|targetAxisIndex/);
    }
    expect(charts[0].spec.type).toBe("COMBO");
    expect(charts[3].spec.type).toBe("BAR");
    expect(charts[7].spec.options.isStacked).toBe("percent");
  });
});

describe("the sheet Сегодня and the tasks", () => {
  it("the list is one formula that sorts and labels the tasks; the manual tasks are separate", () => {
    const f = sheet("Сегодня")._cell(6, 2).f;
    expect(f).toContain("SORT(FILTER('_Задачи'!$A$2:$H");
    expect(f).toContain("Просрочено");
    expect(f).toContain("На неделе");
    expect(sheet("Сегодня")._cell(5, 13).v).toBe("Дата");
  });

  it("_Задачи is a VSTACK of the rule blocks (20 rules)", () => {
    const f = sheet("_Задачи")._cell(2, 1).f;
    expect(f.startsWith("=VSTACK(")).toBe(true);
    const rules = JSON.parse(p.run("JSON.stringify(nvTaskRules().map((r) => r.code))"));
    expect(rules).toHaveLength(20);
    expect(new Set(rules).size).toBe(20);
    for (const code of [
      "lead_no_reply",
      "next_step",
      "estimate_expiring",
      "no_advance",
      "no_funds",
      "meeting",
      "can_purchase",
      "report",
      "objection_expired",
      "refund_due",
      "esf_due",
      "aftercare",
      "order_warranty_end",
      "shop_warranty_end",
      "warranty_case",
      "podbor_credit",
      "cancel_due",
      "taxes",
      "threshold_alert",
      "webhook_silent",
    ]) {
      expect(rules).toContain(code);
    }
    expect(f.length).toBeLessThan(50_000);
  });
});

describe("a second run changes nothing and keeps the data", () => {
  it("is idempotent: the same cells, formulas, rules, bandings, protections and charts", () => {
    const before = snapshot();
    const counts = () =>
      ss.sheets.map((s) => [
        s.name,
        s.cf.length,
        s.bandings.length,
        s.protections.length,
        s.charts.length,
        s.images.length,
        s.merges.length,
      ]);
    const c1 = counts();
    p.call("nvSetup");
    expect(snapshot()).toEqual(before);
    expect(counts()).toEqual(c1);
  });

  it("a second run does not create or move a named range, and its writes stay in a fixed budget", () => {
    let named = 0;
    let writes = 0;
    const orig = ss.setNamedRange.bind(ss);
    ss.setNamedRange = (...a) => {
      named += 1;
      return orig(...a);
    };
    const Range = Object.getPrototypeOf(sheet("Панель").getRange(1, 1));
    const counted = ["setValue", "setValues", "setFormula", "setNote", "setNotes"].map((k) => {
      const f = Range[k];
      Range[k] = function (...a) {
        writes += 1;
        return f.apply(this, a);
      };
      return [k, f];
    });
    p.call("nvSetup");
    ss.setNamedRange = orig;
    for (const [k, f] of counted) Range[k] = f;
    expect(named).toBe(0);
    expect(writes).toBeLessThan(900);
  });

  it("keeps the rows of data, the values the owner changed in the settings and the labels of the dictionaries", () => {
    p.call("nvDemoFill");
    ss.getRangeByName("NV_PC_LOW_BP").setValue(1600);
    ss.getRangeByName("NVD_REJECT").getCell(1, 1).setValue("Слишком дорого");
    const orders = p.call("nvReadTable", "orders").map((o) => o.num);
    p.call("nvSetup");
    expect(p.call("nvReadTable", "orders").map((o) => o.num)).toEqual(orders);
    expect(ss.getRangeByName("NV_PC_LOW_BP").getValue()).toBe(1600);
    expect(ss.getRangeByName("NVD_REJECT").getValues()[0][0]).toBe("Слишком дорого");
    ss.getRangeByName("NV_PC_LOW_BP").setValue(1500);
    ss.getRangeByName("NVD_REJECT").getCell(1, 1).setValue("Ниже минимальной сметы");
    p.call("nvDemoClear");
    expect(p.call("nvDemoCount")).toBe(0);
  }, 60_000);

  it("pauses at the time limit and continues by a timer", () => {
    const q = createProject({ now: NOW });
    const r1 = q.call("nvSetup", { budgetMs: 0 });
    expect(r1.done).toBe(false);
    expect(q.env.triggers.some((t) => t.handler === "nvSetupContinue")).toBe(true);
    let guard = 0;
    let r = r1;
    while (!r.done && guard++ < 40) r = q.call("nvSetupContinue");
    expect(r.done).toBe(true);
    expect(q.env.triggers.some((t) => t.handler === "nvSetupContinue")).toBe(false);
    expect(q.env.ss.sheets.map((s) => s.name)).toContain("Панель");
  }, 120_000);
});

describe("themes", () => {
  it("switching to the night theme restyles every sheet and loses no data", () => {
    p.call("nvDemoFill");
    ss.getSheetByName("Панель").getRange("I3").setValue(true);
    const before = snapshot();
    p.call("nvSetTheme", "night", "all");
    const after = snapshot();
    for (const name of Object.keys(before)) {
      for (const [k, v] of Object.entries(before[name])) {
        const f = JSON.parse(v)[1];
        // The sparklines carry the colours of the theme: only they may change
        if (f?.startsWith("=SPARKLINE(")) continue;
        expect(after[name][k], `${name}!${k}`).toBe(v);
      }
    }
    expect(sheet("Панель")._cell(1, 1).bg).toBe("#1D1D1B");
    expect(sheet("Заказы")._cell(5, 2).bg).toBe("#33302C");
    expect(sheet("Заказы").bandings[0].first).toBe("#262522");
    expect(sheet("Панель").charts[0].spec.options.backgroundColor).toBe("#262522");
    expect(sheet("Панель").charts[0].spec.options.series[1].color).toBe("#8F8A80");
  }, 60_000);

  it("the night theme for the panel only keeps the data sheets in the paper theme; and back", () => {
    p.call("nvSetTheme", "passport", "all");
    p.call("nvSetTheme", "night", "panel");
    expect(sheet("Панель")._cell(1, 1).bg).toBe("#1D1D1B");
    expect(sheet("Заказы")._cell(5, 2).bg).toBe("#E4DDD2");
    p.call("nvSetTheme", "passport", "all");
    expect(sheet("Панель")._cell(1, 1).bg).toBe("#F1EFEA");
    expect(sheet("Панель").charts[0].spec.options.backgroundColor).toBe("#FBF9F4");
    p.call("nvDemoClear");
  }, 60_000);

  it("rejects an unknown theme", () => {
    expect(() => p.call("nvSetTheme", "rainbow", "all")).toThrow();
  });
});

describe("triggers", () => {
  it("installs exactly one of each, and a second install replaces them", () => {
    p.call("nvInstallTriggers");
    p.call("nvInstallTriggers");
    const counts = p.call("nvTriggerCounts");
    expect(JSON.parse(JSON.stringify(counts))).toEqual({
      nvOnEdit: 1,
      nvHourlyJob: 1,
      nvDailyDigest: 1,
      nvWeeklyBackup: 1,
      nvMonthlyJob: 1,
    });
    const daily = p.env.triggers.find((t) => t.handler === "nvDailyDigest");
    expect(daily.params.atHour).toBe(9);
    expect(daily.params.tz).toBe("Asia/Tashkent");
    const edit = p.env.triggers.find((t) => t.handler === "nvOnEdit");
    expect(edit.event).toBe("ON_EDIT");
  });

  it("no simple onEdit exists: the trigger is an installable one", () => {
    expect(p.run("typeof onEdit")).toBe("undefined");
    expect(p.run("typeof nvOnEdit")).toBe("function");
    expect(p.run("typeof doPost")).toBe("function");
    expect(p.run("typeof onOpen")).toBe("function");
  });
});

describe("the menu", () => {
  it("builds the menu Nivel CRM with the items of the structure", () => {
    p.call("nvBuildMenu");
    const menu = p.env.menus.find((m) => m.title === "Nivel CRM");
    const labels = menu.items.filter((i) => i.label).map((i) => i.label);
    for (const l of [
      "Новая заявка",
      "Заявку в заказ",
      "Действие по заказу",
      "Записать платёж",
      "Записать чек закупки",
      "Открыть гарантийный случай",
      "Рассчитать отмену",
      "Обновить «Сегодня»",
      "Отправить сводку сейчас",
      "Самопроверка",
      "Применить оформление",
      "О версии",
    ]) {
      expect(labels).toContain(l);
    }
    const subs = menu.items.filter((i) => i.sub).map((i) => i.sub.title);
    expect(subs).toEqual(expect.arrayContaining(["Оформление", "Демо-данные", "Настройка"]));
    const settings = menu.items.find((i) => i.sub && i.sub.title === "Настройка").sub.items.map((i) => i.label);
    expect(settings).toEqual(expect.arrayContaining(["Установить триггеры", "Журнал вебхука"]));
  });
});
