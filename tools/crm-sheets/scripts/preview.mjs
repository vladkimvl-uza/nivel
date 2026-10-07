// Preview of the CRM: runs the setup and the demo data on the mock of Apps Script, evaluates the formulas, and draws the
// sheets, the tiles and the charts in both themes into preview/index.html.
// Usage: node scripts/preview.mjs [--out <file>]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { drawChart, drawSparkline } from "./chart-svg.mjs";
import { createComputer } from "./computed.mjs";
import { createProject } from "./env.mjs";
import { renderSheet } from "./preview-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const PREVIEW_NOW = new Date("2026-12-20T10:00:00+05:00");

/** Builds the book with demo data on the mock and bakes the computed values. Returns everything the renderer needs. */
export function buildPreviewProject(opts = {}) {
  const p = createProject({ now: opts.now || PREVIEW_NOW });
  p.call("nvSetup");
  p.call("nvInstallTriggers");
  p.call("nvDemoFill");
  const ss = p.env.ss;
  // Registration date of the sole proprietor: the proportional limit of 2026 (210 958 904)
  ss.getRangeByName("NV_REG_DATE").setValue(p.date("2026-10-15T00:00:00+05:00"));
  p.call("nvResetSettingsCache");
  // The panel shows the demo rows
  ss.getSheetByName("Панель").getRange("I3").setValue(true);
  // The calculator: an estimate for the conversation
  const calc = ss.getSheetByName("Калькулятор");
  calc.getRange("C6").setValue("ПК");
  calc.getRange("C7").setValue(25000000);
  calc.getRange("C8").setValue(0);
  calc.getRange("C9").setValue(0);
  calc.getRange("C10").setValue(25000000);
  calc.getRange("C11").setValue(6500000);
  calc.getRange("C12").setValue(false);
  calc.getRange("C13").setValue(false);
  calc.getRange("C23").setValue(40000000);
  p.call("nvSelfCheck");
  return p;
}

/** Computes the formulas and puts the values of the dashboard (from the model) into the cells. */
export function bakeValues(p) {
  const ss = p.env.ss;
  const computer = createComputer(p);
  p.run(`function __bundle() {
    const m = nvDashboardModel({ includeDemo: true, period: "Этот месяц" });
    return { kpis: m.kpis, tasks: m.tasks, series: nvChartSeries(m), weekly: nvWeeklySeries(m), threshold: m.threshold, bounds: m.bounds, year: m.year };
  }`);
  const bundle = p.callJson("__bundle");
  computer.computeTables();
  const keys = [
    "leads",
    "orders",
    "payments",
    "purchases",
    "warranty",
    "clients",
    "reserves",
    "promo",
    "history",
    "webhook",
    "selfcheck",
  ];
  [
    "Порог и налоги",
    "Резервы",
    "Калькулятор",
    ...keys.map((k) => JSON.parse(p.run(`JSON.stringify(NV_SCHEMA.${k}.title)`))),
  ].forEach((n) => {
    computer.computePlain(n);
  });
  // "Пройденные рубежи" is a FILTER over a named range, which the evaluator does not read: the value of the model
  const th = ss.getSheetByName("Порог и налоги")._cell(12, 3);
  th.v = bundle.threshold.crossedAlerts.length
    ? bundle.threshold.crossedAlerts.map((a) => `${a / 100} %`).join(", ")
    : "—";
  // The data sheet: the series under the sparklines
  const data = ss.getSheetByName("_Данные");
  const nd = JSON.parse(p.run("JSON.stringify(NV_ND)"));
  bundle.weekly.forEach((w, i) => {
    const r = nd.weeks + i;
    [w.fee, w.created, w.delivered, w.leads, w.conv, w.avgFee, w.reply].forEach((v, j) => {
      data.getRange(r, 2 + j).setValue(v);
    });
  });
  bundle.series.reserves.forEach((x, i) => {
    data.getRange(nd.res + i, 2).setValue(x.warranty);
    data.getRange(nd.res + i, 3).setValue(x.tax);
  });
  // The panel: the tiles
  const panel = ss.getSheetByName("Панель");
  const tiles = JSON.parse(p.run("JSON.stringify(NV_TILES)"));
  tiles.forEach((tile, i) => {
    const pos = JSON.parse(p.run(`JSON.stringify(nvTilePos(${i}))`));
    const flag = JSON.parse(p.run(`JSON.stringify(nvTileFlagCell(${i}))`));
    const k = bundle.kpis[tile.key];
    const setPlain = (r, c, v) => {
      const cell = panel._cell(r, c);
      cell.v = v === null || v === undefined ? "" : v;
      delete cell.f;
    };
    setPlain(pos.row + 1, pos.col, k.value);
    setPlain(pos.row + 2, pos.col, k.text);
    setPlain(flag.row, flag.col, k.worse === true);
  });
  const updated = panel._cell(2, 11);
  updated.v = "Обновлено 20.12.2026 10:00";
  delete updated.f;
  // "Сегодня": the list of tasks
  const today = ss.getSheetByName("Сегодня");
  const L = JSON.parse(p.run("JSON.stringify(NV_LAYOUT)"));
  const fmtDue = (d) => {
    const l = new Date(d.getTime() + 5 * 3600000);
    const pad = (x) => String(x).padStart(2, "0");
    const dateOnly = l.getUTCHours() === 0 && l.getUTCMinutes() === 0;
    return (
      `${pad(l.getUTCDate())}.${pad(l.getUTCMonth() + 1)}.${l.getUTCFullYear()}` +
      (dateOnly ? "" : ` ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`)
    );
  };
  const tasks = bundle.tasks.slice(0, 22);
  tasks.forEach((t, i) => {
    const r = L.firstRow + i;
    [fmtDue(t.due), t.what, t.num, t.sum || "", t.state, t.object, t.client, t.code, "", "Открыть"].forEach((v, j) => {
      const cell = today._cell(r, 2 + j);
      cell.v = v;
      delete cell.f;
    });
  });
  for (const c of [2, 11]) delete today._cell(L.firstRow, c).f;
  const cap = today._cell(3, 2);
  const count = (s) => tasks.filter((t) => t.state === s).length;
  cap.v = `${count("Просрочено")} просрочено · ${count("Сегодня")} на сегодня · ${count("Завтра")} на завтра · ${count("На неделе")} на неделе · ${count("Предупреждение")} предупреждений`;
  delete cap.f;
  // Manual tasks of the owner
  [
    ["25.12.2026", "Закупить расходники для сборки", "", false, "Фото чеков сложить в папку"],
    ["28.12.2026", "Подготовить акт для бухгалтера", "NV-2026-D003", false, ""],
    ["15.12.2026", "Сверить счёт с выпиской", "", true, "Сделано"],
  ].forEach((t, i) => {
    const r = L.firstRow + i;
    const toDate = (s) => p.date(`${s.split(".").reverse().join("-")}T00:00:00+05:00`);
    [toDate(t[0]), t[1], t[2], t[3], t[4]].forEach((v, j) => {
      const cell = today._cell(r, 13 + j);
      cell.v = v;
      if (j === 3) cell.dv = { type: "checkbox" };
    });
  });
  return { computer, bundle, tiles };
}

const lum = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Chart input for drawChart from the specification of the script and the series of the model. */
function chartInput(id, spec, series, T) {
  const o = spec.options;
  const col = (i) => (o.series?.[i] ? o.series[i].color : T.text);
  const dash = (i) => (o.series?.[i]?.lineDashStyle ? o.series[i].lineDashStyle.join(" ") : undefined);
  const base = { title: o.title, legend: o.legend && o.legend.position !== "none" };
  switch (id) {
    case "fee_by_month":
      return {
        ...base,
        kind: "combo",
        categories: series.fee_by_month.map((x) => x.label),
        series: [
          { name: "Плата за месяц", type: "bar", color: col(0), values: series.fee_by_month.map((x) => x.value) },
          { name: "С начала года", type: "line", color: col(1), values: series.fee_by_month.map((x) => x.cumulative) },
        ],
      };
    case "deals_vs_threshold":
      return {
        ...base,
        kind: "line",
        categories: series.deals.map((x) => x.label),
        areaOf: "Сделки нарастающим",
        series: [
          { name: "Сделки нарастающим", type: "line", color: col(0), values: series.deals.map((x) => x.fact) },
          {
            name: "С принятыми сметами",
            type: "line",
            color: col(1),
            dash: dash(1),
            values: series.deals.map((x) => x.forecast),
          },
          {
            name: "План 2026",
            type: "line",
            color: col(2),
            dash: dash(2),
            width: 1,
            values: series.deals.map((x) => x.plan),
          },
          {
            name: "Лимит года",
            type: "line",
            color: col(3),
            dash: dash(3),
            width: 1,
            values: series.deals.map((x) => x.limit),
          },
        ],
      };
    case "funnel": {
      const v = series.funnel.map((x) => x.value);
      return {
        ...base,
        integer: true,
        kind: "bar",
        stacked: true,
        categories: series.funnel.map((x) => x.label),
        series: [
          { name: "Этапы", type: "bar", color: col(0), values: v.map((x, i) => (i < 4 ? x : null)) },
          { name: "Сдан", type: "bar", color: col(1), values: v.map((x, i) => (i === 4 ? x : null)) },
        ],
      };
    }
    case "channels":
      return {
        ...base,
        integer: true,
        kind: "bar",
        categories: series.channels.map((x) => x.label),
        series: [
          { name: "Заявки", type: "bar", color: col(0), values: series.channels.map((x) => x.leads) },
          { name: "Заказы", type: "bar", color: col(1), values: series.channels.map((x) => x.orders) },
        ],
      };
    case "stages_now":
      return {
        ...base,
        integer: true,
        kind: "bar",
        stacked: true,
        categories: series.stages.map((x) => x.label),
        series: [
          { name: "В срок", type: "bar", color: col(0), values: series.stages.map((x) => x.inTime) },
          { name: "С просрочкой", type: "bar", color: col(1), values: series.stages.map((x) => x.overdue) },
        ],
      };
    case "reserves":
      return {
        ...base,
        kind: "line",
        categories: series.reserves.map((x) => x.label),
        series: [
          { name: "Гарантийный", type: "line", color: col(0), values: series.reserves.map((x) => x.warranty) },
          { name: "Налоговый", type: "line", color: col(1), values: series.reserves.map((x) => x.tax) },
        ],
      };
    case "cycle":
      return {
        ...base,
        integer: true,
        kind: "column",
        stacked: true,
        categories: series.cycle.map((x) => x.label.replace("NV-2026-", "")),
        series: [
          { name: "До цели", type: "bar", color: col(0), values: series.cycle.map((x) => x.inTarget) },
          { name: "Выше цели", type: "bar", color: col(1), values: series.cycle.map((x) => x.over) },
        ],
      };
    case "composition":
      return {
        ...base,
        kind: "percentbar",
        categories: ["Заказы"],
        series: series.composition.map((x, i) => ({
          name: x.label,
          type: "bar",
          color: o.colors[i],
          label: lum(o.colors[i]) > 140 ? (T.surface === "#262522" ? "#1D1D1B" : "#FBF9F4") : "#F1EFEA",
          values: [x.value],
        })),
      };
    default:
      return { ...base, kind: "column", categories: [], series: [] };
  }
}

function sparkHtml(formula, w, h, ctx) {
  const { p, computer, T } = ctx;
  const ss = p.env.ss;
  const type = /"charttype","(\w+)"/.exec(formula) || /"charttype"\s*,\s*"(\w+)"/.exec(formula);
  const kind = type ? type[1] : "column";
  const color = (/"color","(#[0-9A-Fa-f]{6})"/.exec(formula) || [])[1];
  // A colour option is a literal, or IF($flag=TRUE, orange, text) where the flag of the tile is a cell of the panel
  const optionColor = (key) => {
    const m = new RegExp(
      `"${key}",\\s*(?:IF\\(\\$([A-Z]+)(\\d+)=TRUE,\\s*"(#[0-9A-Fa-f]{6})",\\s*"(#[0-9A-Fa-f]{6})"\\)|"(#[0-9A-Fa-f]{6})")`,
    ).exec(formula);
    if (!m) return undefined;
    if (m[5]) return m[5];
    const col = m[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    const flag = ss.getSheetByName("Панель").cells.get(`${m[2]},${col}`);
    return flag?.v === true ? m[3] : m[4];
  };
  const lastColor = optionColor("lastcolor");
  if (kind === "bar") {
    const c1 = optionColor("color1");
    const c2 = (/"color2","(#[0-9A-Fa-f]{6})"/.exec(formula) || [])[1];
    const val = (n) => {
      const ref = computer.named(n);
      return Number(computer.cellValue(ref.sheet, ref.r1, ref.c1)) || 0;
    };
    return drawSparkline("bar", [val("TH_VOLUME"), val("TH_COMMITTED")], {
      w,
      h,
      color: c1,
      color2: c2,
      max: val("TH_LIMIT"),
      track: T.surface === "#262522" ? "#33302C" : "#E4DDD2",
    });
  }
  const m = /'_Данные'!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)/.exec(formula);
  if (!m) return "";
  const colIdx = m[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const values = [];
  for (let r = Number(m[2]); r <= Number(m[4]); r++) {
    const c = ss.getSheetByName("_Данные").cells.get(`${r},${colIdx}`);
    values.push(Number(c?.v) || 0);
  }
  return drawSparkline(kind, values, { w, h, color, lastColor: lastColor || color });
}

/** The HTML of all the sheets in the current theme of the book. */
export function createStyleRegistry() {
  const map = new Map();
  return {
    classOf(css) {
      if (!map.has(css)) map.set(css, `s${map.size.toString(36)}`);
      return map.get(css);
    },
    css() {
      return [...map].map(([css, cls]) => `table.sheet td.${cls}{${css}}`).join("\n");
    },
  };
}

export function renderTheme(p, baked, themeName, styles) {
  const { computer, bundle } = baked;
  const ss = p.env.ss;
  const T = JSON.parse(p.run(`JSON.stringify(NV_THEMES.${themeName})`));
  p.run("function __specs(){ return nvChartSpecs(nvThemeFor('panel')); }");
  const specs = p.callJson("__specs");
  const charts = specs.map((spec) => drawChart(chartInput(spec.id, spec, bundle.series, T), T));
  const sparkCtx = { p, computer, T };
  const sheets = [
    ["Панель", 82, { charts }],
    ["Сегодня", 22, {}],
    ["Телефон", 29, {}],
    ["Заявки", 20, {}],
    ["Заказы", 18, {}],
    ["Платежи", 28, {}],
    ["Закупки", 24, {}],
    ["Гарантия", 12, {}],
    ["Клиенты", 18, {}],
    ["Калькулятор", 36, {}],
    ["Порог и налоги", 20, {}],
    ["Резервы", 14, {}],
    ["Продвижение", 10, {}],
    ["История", 24, {}],
    ["Справочники", 22, {}],
    ["Настройки", 36, {}],
    ["Самопроверка", 24, {}],
  ];
  return sheets.map(([name, rows, extra]) => {
    const sheet = ss.getSheetByName(name);
    const pageBg = T.bg ?? "#fff";
    const r = renderSheet(sheet, {
      computer,
      rows,
      now: p.env.now,
      pageBg,
      charts: extra.charts,
      sparkline: (f, w, h) => sparkHtml(f, w, h, sparkCtx),
      styles,
    });
    return { name, theme: themeName, html: r.html, width: r.width, height: r.height };
  });
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#E9E6DF;font-family:'Fira Sans',Arial,sans-serif;color:#1D1D1B}
#bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #d6d2c8;padding:8px 14px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;font-size:13px}
#bar b{font-size:14px}
.themes button,.tabs button{font:inherit;background:none;border:0;border-bottom:2px solid transparent;padding:6px 10px;cursor:pointer;color:#5E574D}
.themes button.on{color:#1D1D1B;border-bottom-color:#D9501A;font-weight:600}
.tabs{display:flex;gap:0;flex-wrap:wrap}
.tabs button.on{color:#1D1D1B;border-bottom-color:#1D1D1B;font-weight:600}
.stage{padding:18px 14px;overflow:auto}
section{display:none}
section.on{display:block}
.frame{position:relative;box-shadow:0 1px 0 #d6d2c8,0 8px 24px rgba(29,29,27,.12);margin:0 auto}
table.sheet{border-collapse:collapse;table-layout:fixed}
table.sheet td{padding:0 7px;overflow:hidden;white-space:nowrap;text-overflow:clip;font-size:13px;line-height:1.15;color:#1D1D1B}
.cb{display:inline-block;width:12px;height:12px;border:1.5px solid currentColor;opacity:.7;border-radius:2px;vertical-align:middle}
.cb.on{background:currentColor;opacity:1}
.chart{line-height:0}
`;

export function buildHtml(passport, night, styles) {
  const names = passport.map((s) => s.name);
  const sections = [...passport, ...night]
    .map(
      (s) =>
        `<section data-theme="${s.theme}" data-sheet="${esc(s.name)}"><div class="stage">${s.html}</div></section>`,
    )
    .join("\n");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Nivel CRM — превью оформления</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600;700&display=swap&subset=cyrillic" rel="stylesheet">
<style>${CSS}
${styles.css()}</style></head><body>
<div id="bar"><b>Nivel · CRM</b><div class="themes"><button data-theme="passport" class="on">Паспорт</button><button data-theme="night">Ночная панель</button></div>
<div class="tabs">${names.map((n, i) => `<button data-sheet="${esc(n)}"${i === 0 ? ' class="on"' : ""}>${esc(n)}</button>`).join("")}</div></div>
${sections}
<script>
var theme='passport',sheet='${esc(names[0])}';
function show(){document.querySelectorAll('section').forEach(function(s){s.classList.toggle('on',s.dataset.theme===theme&&s.dataset.sheet===sheet);});
document.querySelectorAll('.themes button').forEach(function(b){b.classList.toggle('on',b.dataset.theme===theme);});
document.querySelectorAll('.tabs button').forEach(function(b){b.classList.toggle('on',b.dataset.sheet===sheet);});
document.body.style.background=theme==='night'?'#0F0F0E':'#E9E6DF';}
document.querySelectorAll('.themes button').forEach(function(b){b.onclick=function(){theme=b.dataset.theme;show();};});
document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){sheet=b.dataset.sheet;show();};});
var q=new URLSearchParams(location.search);if(q.get('theme'))theme=q.get('theme');if(q.get('sheet'))sheet=q.get('sheet');show();
</script></body></html>`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function generatePreview() {
  const p = buildPreviewProject();
  const baked = bakeValues(p);
  const styles = createStyleRegistry();
  const passport = renderTheme(p, baked, "passport", styles);
  p.call("nvSetTheme", "night", "all");
  const night = renderTheme(p, baked, "night", styles);
  return { html: buildHtml(passport, night, styles), errors: baked.computer.errors, project: p };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const out = values.out ? resolve(values.out) : join(here, "..", "preview", "index.html");
  const { html, errors } = generatePreview();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`preview: ${out} (${Math.round(html.length / 1024)} KB), formula errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log("  ", e);
}
