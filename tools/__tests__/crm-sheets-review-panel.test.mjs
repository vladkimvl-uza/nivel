// Review round 2, the panel: orange only where it is worse than the norm, the same figures in every place, the tax and the
// threshold told as the decisions say (Xolis holds the tax; 2026 is limited by the plan of 200 million), a sheet for a phone.
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../crm-sheets/scripts/env.mjs";

const T0 = new Date("2026-10-07T11:00:00+05:00");
let p;
const sheet = (n) => p.env.ss.getSheetByName(n);
const read = (k) => p.call("nvReadTable", k);
const themes = () => JSON.parse(p.run("JSON.stringify(NV_THEMES)"));

beforeAll(() => {
  p = createProject({ now: T0, scriptProps: { OWNER_EMAIL: "owner@example.com" } });
  p.call("nvSetup");
}, 60_000);

const hsl = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
};
/** A colour of the orange family: warm hue, noticeably saturated. */
const isOrange = (hex) => {
  const c = hsl(hex);
  return c.h >= 8 && c.h <= 32 && c.s >= 0.5 && c.l > 0.2 && c.l < 0.8;
};

describe("orange is only for what is worse than the norm", () => {
  it("the stages of an order are drawn in graphite and asphalt, not in an orange ladder", () => {
    const T = themes();
    for (const name of ["passport", "night"]) {
      for (const [tone, st] of Object.entries(T[name].status)) {
        if (st.fill) expect(isOrange(st.fill), `${name} ${tone} fill ${st.fill}`).toBe(false);
        expect(isOrange(st.text), `${name} ${tone} text ${st.text}`).toBe(false);
      }
    }
  });

  it("the order stays a ladder: each stage is darker (paper) or lighter (night) than the one before", () => {
    const T = themes().passport.status;
    const l = (t) => hsl(T[t].fill).l;
    expect(l("s1")).toBeGreaterThan(l("s2"));
    expect(l("s2")).toBeGreaterThan(l("s3"));
    expect(l("s3")).toBeGreaterThan(l("s4"));
    expect(l("s4")).toBeGreaterThan(l("s5"));
    expect(l("s5")).toBeGreaterThan(l("s6"));
    expect(l("s6")).toBeGreaterThan(l("s7"));
  });

  it("the orange of the charts is on three series only: the plan line, the overdue stages, the cycle above the target", () => {
    for (const name of ["passport", "night"]) {
      const T = themes()[name];
      const specs = JSON.parse(p.run(`JSON.stringify(nvChartSpecs(NV_THEMES.${name}))`));
      const orange = [];
      for (const s of specs) {
        const text = JSON.stringify(s.options);
        const hits = text.split(T.accent).length - 1;
        if (hits) orange.push(`${s.id}:${hits}`);
      }
      expect(orange.sort(), name).toEqual(["cycle:1", "deals_vs_threshold:1", "stages_now:1"].sort());
    }
  });

  it("the composition of the orders has no orange category", () => {
    const night = JSON.parse(p.run("JSON.stringify(nvCompositionColors(NV_THEMES.night))"));
    const day = JSON.parse(p.run("JSON.stringify(nvCompositionColors(NV_THEMES.passport))"));
    for (const c of [...night, ...day]) expect(isOrange(c), c).toBe(false);
    expect(new Set(day).size).toBe(4);
  });

  it("the sparklines mark only the last bar, and in orange only when the tile is worse", () => {
    const sh = sheet("Панель");
    const tiles = JSON.parse(
      p.run("JSON.stringify(NV_TILES.map((t, i) => ({ key: t.key, trend: t.trend, pos: nvTilePos(i) })))"),
    );
    let seen = 0;
    for (const t of tiles) {
      if (!t.trend) continue;
      const f = sh._cell(t.pos.row + 3, t.pos.col).f;
      expect(f, t.key).not.toContain("highcolor");
      if (t.trend.type === "column") {
        expect(f, t.key).toContain('"lastcolor"');
        expect(f, t.key).toMatch(/IF\(\$[A-Z]+\d+/);
        seen += 1;
      }
      // A line has no "lastcolor" (only column and winloss have): the whole line takes the colour of the state
      if (t.trend.type === "line") {
        expect(f, t.key).not.toContain("lastcolor");
        expect(f, t.key).toMatch(/"color",IF\(\$[A-Z]+\d+=TRUE/);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6);
  });

  it("the sheet «Сегодня»: the link is in the colour of the text", () => {
    const T = themes().passport;
    expect(sheet("Сегодня")._cell(6, 11).fc).toBe(T.text);
  });
});

describe("the tax tile", () => {
  const tile = () => JSON.parse(p.run("JSON.stringify(NV_TILES.find((t) => t.key === 'taxdue'))"));
  it("is an estimate, not a bill: the label says so", () => {
    expect(tile().label).toBe("Налог 1 % (оценка)");
  });

  it("the setting «Xolis удерживает налог» is there and is on until the tax office says otherwise (R-10)", () => {
    expect(p.call("nvSettings").xolisWithholds).toBe(true);
    expect(JSON.parse(p.run("JSON.stringify(nvSettingDef('xolisWithholds'))")).name).toBe("NV_XOLIS_WITHHOLDS");
  });

  it("with the setting on, the line under the figure says Xolis holds it, never «к уплате», and the reserve is not mixed in", () => {
    const f = p.run("nvKpiDefs().taxdue.sub");
    expect(f).toContain("NV_XOLIS_WITHHOLDS");
    expect(f).toContain("удерживает Xolis");
    expect(f).not.toContain("NV_RES_BAL_T");
    const model = JSON.parse(p.run("JSON.stringify(nvDashboardModel({}).kpis.taxdue)"));
    expect(model.text).toContain("удерживает Xolis");
    expect(model.text).not.toContain("резерв");
    expect(model.worse).toBe(false);
  });

  it("with the setting off, the tax is the owner's: the term and the task «Уплатить налог» are back", () => {
    const layout = JSON.parse(p.run("JSON.stringify(nvSettingsLayout().map((x) => ({ k: x.def.key, row: x.row })))"));
    const row = layout.find((x) => x.k === "xolisWithholds").row;
    sheet("Настройки").getRange(row, 3).setValue(false);
    p.call("nvResetSettingsCache");
    const model = JSON.parse(p.run("JSON.stringify(nvDashboardModel({}).kpis.taxdue)"));
    expect(model.text).toContain("до 15.10.2026");
    p.env.now = new Date("2026-10-14T11:00:00+05:00");
    const tasks = JSON.parse(p.run("JSON.stringify(nvTaskList(nvToday(), false).map((t) => t.what))"));
    expect(tasks.some((w) => w.startsWith("Уплатить налог с оборота"))).toBe(true);
    sheet("Настройки").getRange(row, 3).setValue(true);
    p.call("nvResetSettingsCache");
    const again = JSON.parse(p.run("JSON.stringify(nvTaskList(nvToday(), false).map((t) => t.what))"));
    expect(again.some((w) => w.startsWith("Уплатить налог с оборота"))).toBe(false);
    expect(again.some((w) => w.startsWith("Сверить налог 1 %, удержанный Xolis"))).toBe(true);
    p.env.now = T0;
  });

  it("the tile has no sparkline of the tax reserve: it points to the sheet of the threshold and the taxes", () => {
    const pos = JSON.parse(p.run("JSON.stringify(nvTilePos(NV_TILES.findIndex((t) => t.key === 'taxdue')))"));
    expect(sheet("Панель")._cell(pos.row + 3, pos.col).f).toBeUndefined();
    expect(String(sheet("Панель")._cell(pos.row + 3, pos.col).v)).toContain("Порог и налоги");
  });
});

describe("the fee tile and the commission of Xolis", () => {
  it("the setting of the commission for the withdrawal is 1 % of the fee, and the line shows what is left in hand", () => {
    expect(p.call("nvSettings").xolisWithdrawBp).toBe(100);
    const f = p.run("nvKpiDefs().fee.sub");
    expect(f).toContain("NV_XOLIS_WITHDRAW_BP");
    expect(f).toContain("на руки");
  });

  it("the model says the same: 10 000 000 of the fee is 9 900 000 in hand", () => {
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    q.call("nvAppendRow", "orders", {
      num: "NV-2026-0001",
      created: T0,
      status: "Сдан",
      code: "handed_over",
      kind: "ПК",
    });
    q.call("nvAppendRow", "payments", {
      id: "P-2026-0001",
      order: "NV-2026-0001",
      kind: "Финал платы 70 %",
      method: "QR Xolis",
      amount: 10_000_000,
      status: "Подтверждён",
      receipt: "FS-1",
      date: T0,
    });
    const m = JSON.parse(q.run("JSON.stringify(nvDashboardModel({}).kpis.fee)"));
    expect(m.value).toBe(10_000_000);
    expect(m.text).toContain("на руки ≈ 9,9 млн");
  });
});

describe("the threshold tile counts by the plan of 2026", () => {
  it("the line says how much is left to the plan of the year, and the figure turns «worse» only above the plan", () => {
    const f = p.run("nvKpiDefs().threshold");
    expect(f.sub).toContain("до плана 2026 осталось");
    expect(f.sub).toContain("NV_PLAN_CAP_2026");
    expect(f.worse).toContain('TH_OVER="Да"');
  });

  it("the model: 150 million of 200 is not worse; with the accepted estimates above 200 it is", () => {
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    q.call("nvAppendRow", "purchases", {
      id: "Z-2026-0001",
      item: "x",
      amount: 150_000_000,
      bought: q.date("2026-09-01T00:00:00+05:00"),
    });
    let m = JSON.parse(q.run("JSON.stringify(nvDashboardModel({}).kpis.threshold)"));
    expect(m.text).toContain("до плана 2026 осталось 50,0 млн");
    expect(m.worse).toBe(false);
    q.call("nvAppendRow", "orders", {
      num: "NV-2026-0002",
      created: T0,
      status: "Принят: ждём оплату",
      code: "accepted",
      kind: "ПК",
      basePc: 60_000_000,
      purchased: 60_000_000,
    });
    m = JSON.parse(q.run("JSON.stringify(nvDashboardModel({}).kpis.threshold)"));
    expect(m.worse).toBe(true);
  });
});

describe("the same figures in every place", () => {
  it("«Заявки» counts without spam, as the funnel and the conversion do", () => {
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    for (let i = 0; i < 8; i++)
      q.call("nvAppendRow", "leads", {
        num: `L-2026-${String(i + 1).padStart(4, "0")}`,
        created: T0,
        status: i === 0 ? "Спам" : "Новая",
        channel: "Сайт",
      });
    const model = JSON.parse(
      q.run(
        "JSON.stringify((() => { const m = nvDashboardModel({}); return { leads: m.kpis.leads, funnel: nvChartSeries(m).funnel[0].value, conv: m.kpis.conv.text }; })())",
      ),
    );
    expect(model.leads.value).toBe(7);
    expect(model.funnel).toBe(7);
    expect(model.conv).toContain("из 7 заявок");
    expect(model.leads.text).toContain("спам 1");
    const tile = JSON.parse(q.run("JSON.stringify(NV_TILES.find((t) => t.key === 'leads').label)"));
    expect(tile).toBe("Заявки без спама");
    const f = q.run("nvKpiDefs().leads.v");
    expect(f).toContain("<>Спам");
  });

  it("«В работе» names its stages, and the chart of the stages leaves out an expired estimate", () => {
    const tile = JSON.parse(p.run("JSON.stringify(NV_TILES.find((t) => t.key === 'wip').label)"));
    expect(tile).toBe("Заказы в работе (закупка – доставка)");
    const q = createProject({ now: T0 });
    q.call("nvSetup");
    const add = (n, code, status) =>
      q.call("nvAppendRow", "orders", {
        num: `NV-2026-000${n}`,
        created: T0,
        code,
        status,
        kind: "ПК",
        basePc: 8_000_000,
        purchased: 8_000_000,
      });
    add(1, "estimate_expired", "Смета истекла");
    add(2, "estimate_sent", "Смета отправлена");
    add(3, "purchasing", "Закупка");
    const stages = JSON.parse(q.run("JSON.stringify(nvChartSeries(nvDashboardModel({})).stages)"));
    const total = stages.reduce((a, s) => a + s.inTime + s.overdue, 0);
    expect(total).toBe(2);
    const text = q.run("nvChartSpecs(NV_THEMES.passport).find((s) => s.id === 'stages_now').options.title");
    expect(text).toBe("Открытые заказы по этапам сейчас");
    const f = sheet("_Данные").getRange(128, 4).getFormula();
    expect(f).toContain("estimate_expired");
  });
});

describe("the sheet «Телефон»", () => {
  const sh = () => sheet("Телефон");
  it("exists after «Сегодня», shows six figures one under another and fits 412 px", () => {
    const names = p.env.ss.getSheets().map((s) => s.getName());
    expect(names.indexOf("Телефон")).toBe(names.indexOf("Сегодня") + 1);
    const w = (c) => sh().colW.get(c);
    expect(w(1) + w(2) + w(3)).toBeLessThanOrEqual(412);
    const formulas = [];
    for (let r = 1; r <= sh().getMaxRows(); r++)
      for (let c = 1; c <= 6; c++) if (sh()._cell(r, c).f) formulas.push(sh()._cell(r, c).f);
    const keys = ["fee", "wip", "leads", "funds", "overdue", "threshold"];
    const rows = JSON.parse(p.run(`JSON.stringify(${JSON.stringify(keys)}.map((k) => nvKpiRow(k)))`));
    for (const row of rows)
      expect(
        formulas.some((f) => f.includes(`'_Данные'!$B$${row}`)),
        `row ${row}`,
      ).toBe(true);
    expect(sh().hiddenGrid).toBe(true);
  });

  it("every figure is in the same colours and fonts as the panel, and the tab has no colour of its own", () => {
    expect(sh().tabColor).toBeNull();
    const fonts = new Set();
    for (let r = 1; r <= sh().getMaxRows(); r++) fonts.add(sh()._cell(r, 2).ff);
    expect([...fonts].filter(Boolean).every((f) => ["Fira Sans", "IBM Plex Mono"].includes(f))).toBe(true);
  });

  it("is rebuilt with the theme (the night theme of the panel changes it too)", () => {
    p.call("nvSetTheme", "night", "panel");
    const night = JSON.parse(p.run("JSON.stringify(NV_THEMES.night)"));
    expect(sh()._cell(1, 1).bg).toBe(night.bg);
    p.call("nvSetTheme", "passport", "all");
  });
});

describe("the recalculation of the formulas", () => {
  it("is every hour, so «Сегодня» is never a day old at 09:00", () => {
    expect(p.env.ss.getRecalculationInterval()).toBe("HOUR");
  });

  it("the self-check looks at it", () => {
    const rows = p.call("nvSelfCheckRows");
    const row = rows.find((r) => r.check === "Пересчёт формул");
    expect(row.result).toBe("ОК");
    p.env.ss.setRecalculationInterval("ON_CHANGE");
    const bad = p.call("nvSelfCheckRows").find((r) => r.check === "Пересчёт формул");
    expect(bad.result).toBe("Предупреждение");
    p.env.ss.setRecalculationInterval("HOUR");
  });
});

describe("an upgrade is an order from 4 million by the same scale", () => {
  it("the setting is there and the estimate of an upgrade of 5 million is a full cycle", () => {
    expect(p.call("nvSettings").minUpgrade).toBe(4_000_000);
    const s = p.call("nvSettings");
    const q = p.call("nvComputeQuote", { kind: "Апгрейд", basePc: 5_000_000, purchased: 5_000_000 }, s);
    expect(q.eligibility).toBe("Полный цикл");
    expect(p.call("nvComputeQuote", { kind: "Апгрейд", basePc: 3_999_999, purchased: 3_999_999 }, s).eligibility).toBe(
      "Только «Подбор»",
    );
    // the same estimate of a PC is not a full cycle (from 6.7 million, or 4.5 in a free window)
    expect(p.call("nvComputeQuote", { kind: "ПК", basePc: 5_000_000, purchased: 5_000_000 }, s).eligibility).toMatch(
      /^Только/,
    );
  });

  it("SEND_ESTIMATE of such an upgrade does not need to be forced", () => {
    const client = p.call("nvEnsureClient", { name: "Апгрейд", tg: "@upg" });
    const num = p.call("nvCreateOrder", { client, kind: "Апгрейд", basePc: 5_000_000, purchased: 5_000_000 });
    const r = p.call("nvApplyOrderEvent", num, "SEND_ESTIMATE", { actor: "owner" });
    expect(r.ok).toBe(true);
    expect(read("orders").find((o) => o.num === num).code).toBe("estimate_sent");
  });
});
