/**
 * The eight charts of "Панель". They are built and rebuilt by the script from the series of "_Данные", in the colours of
 * the chosen theme: asphalt and warm graphite, no rainbow, no legend with many colours, no 3D. Orange is on three lines
 * only, the ones that mark a limit or a miss: the plan of the year, the stages with an overdue step, the cycle above the target.
 * Colours per bar are not available in Apps Script charts, so stages are split into two series (in time / overdue).
 */

/** Options every chart shares. */
function nvChartCommon(T, title, legend) {
  return {
    title: title,
    titleTextStyle: { color: T.text, fontSize: 11, bold: true },
    fontName: NV_FONT_TEXT,
    backgroundColor: T.surface,
    "chartArea.backgroundColor": T.surface,
    legend: legend ? { position: "top", textStyle: { color: T.text2, fontSize: 9 } } : { position: "none" },
    "hAxis.textStyle": { color: T.text2, fontSize: 8 },
    "vAxis.textStyle": { color: T.text2, fontSize: 8 },
    "hAxis.baselineColor": T.text2,
    "vAxis.baselineColor": T.text2,
    "bar.groupWidth": "56%",
    lineWidth: 2,
    pointSize: 0,
    width: 576,
    height: 300,
  };
}

/**
 * Gridlines only on the axis of values: that is the continuous axis (gridlines are not supported for a discrete one). In
 * a horizontal bar chart the axis of values is hAxis and vAxis lists the categories; in the others it is the other way.
 */
function nvChartGridlines(type, options, T) {
  const axis = type === "BAR" ? "hAxis" : "vAxis";
  options[axis + ".gridlines.color"] = T.grid;
  options[axis + ".minorGridlines.color"] = T.surface;
  return options;
}

/** Composition palette: four shades of asphalt and paper. A kind of an order is a category, not a deviation: no orange. */
function nvCompositionColors(T) {
  const night = T === NV_THEMES.night;
  // Order of the series: ПК, Сетап, Подбор, Апгрейд
  return night ? ["#F1EFEA", "#A9A59C", "#6B6862", "#46423C"] : ["#1D1D1B", "#6E695F", "#A9A59C", "#D6D2C8"];
}

/** Specification of the eight charts: type, ranges in "_Данные", options. */
function nvChartSpecs(T) {
  const D = NV_ND;
  const c = (title, legend, extra) => Object.assign(nvChartCommon(T, title, legend), extra || {});
  const specs = [
    {
      id: "fee_by_month",
      type: "COMBO",
      ranges: ["A" + D.monthHead + ":C" + (D.months + 11)],
      options: c("Плата по месяцам, млн сум", true, {
        series: { 0: { type: "bars", color: T.text }, 1: { type: "line", color: T.compare, lineWidth: 2 } },
        "vAxis.format": "0.#",
      }),
    },
    {
      id: "deals_vs_threshold",
      type: "LINE",
      ranges: ["A" + D.dealHead + ":E" + (D.deals + 11)],
      options: c("Сделки года против порога, млн сум", true, {
        series: {
          0: { color: T.text, lineWidth: 2 },
          1: { color: T.compare, lineWidth: 2, lineDashStyle: [4, 4] },
          2: { color: T.accent, lineWidth: 1, lineDashStyle: [2, 3] },
          3: { color: T.compare, lineWidth: 1, lineDashStyle: [6, 3] },
        },
        "vAxis.format": "0",
      }),
    },
    {
      id: "funnel",
      type: "BAR",
      ranges: ["A" + D.funnelHead + ":C" + (D.funnel + 4)],
      options: c("Воронка за период", false, {
        isStacked: true,
        series: { 0: { color: T.compare }, 1: { color: T.text } },
        "vAxis.textStyle": { color: T.text, fontSize: 9 },
      }),
    },
    {
      id: "channels",
      type: "BAR",
      ranges: ["A" + D.topHead + ":C" + (D.top + 7)],
      options: c("Заявки и заказы по каналам", true, {
        series: { 0: { color: T.compare }, 1: { color: T.text } },
        "vAxis.textStyle": { color: T.text, fontSize: 9 },
      }),
    },
    {
      id: "stages_now",
      type: "BAR",
      ranges: ["A" + D.stageHead + ":C" + (D.stages + 5)],
      options: c("Открытые заказы по этапам сейчас", true, {
        isStacked: true,
        series: { 0: { color: T.text }, 1: { color: T.accent } },
        "vAxis.textStyle": { color: T.text, fontSize: 9 },
      }),
    },
    {
      id: "reserves",
      type: "LINE",
      ranges: ["A" + D.resHead + ":C" + (D.res + 11)],
      options: c("Резервы по месяцам, млн сум", true, {
        series: { 0: { color: T.text, lineWidth: 2 }, 1: { color: T.compare, lineWidth: 2 } },
        "vAxis.format": "0.#",
      }),
    },
    {
      id: "cycle",
      type: "COLUMN",
      ranges: ["A" + D.cycleHead + ":A" + (D.cycle + 11), "D" + D.cycleHead + ":E" + (D.cycle + 11)],
      options: c("Цикл последних заказов «принят → сдан», дней", true, {
        isStacked: true,
        series: { 0: { color: T.compare }, 1: { color: T.accent } },
        "vAxis.format": "0",
      }),
    },
    {
      id: "composition",
      type: "BAR",
      ranges: ["A" + D.compHead + ":E" + D.comp],
      options: c("Состав заказов за период", true, {
        isStacked: "percent",
        colors: nvCompositionColors(T),
        "vAxis.textStyle": { color: T.text, fontSize: 9 },
      }),
    },
  ];
  specs.forEach((spec) => {
    nvChartGridlines(spec.type, spec.options, T);
  });
  return specs;
}

function nvChartType(name) {
  return Charts.ChartType[name];
}

const NV_CHART_IDS_PROP = "NV_CHART_IDS";

function nvChartAtOurAnchor(ch) {
  const at = ch.getContainerInfo();
  return NV_PANEL.charts.some((a) => a.row === at.getAnchorRow() && a.col === at.getAnchorColumn());
}

/**
 * The charts of the panel that this script built: the ids it remembered, or a chart sitting at one of its anchors (the
 * ones of an older run). A chart the owner added to the panel is not touched.
 */
function nvOwnCharts(sh) {
  let ids = [];
  try {
    ids = JSON.parse(nvDocProps().getProperty(NV_CHART_IDS_PROP) || "[]");
  } catch (e) {
    ids = [];
  }
  return sh.getCharts().filter((ch) => ids.indexOf(ch.getChartId()) >= 0 || nvChartAtOurAnchor(ch));
}

/** The keys of the options that the self-check reads back from a chart (setOption never says whether Sheets took a key). */
const NV_CHART_WATCH = ["isStacked", "bar.groupWidth", "fontName", "chartArea.backgroundColor", "series", "colors"];

/** What the charts of the panel did not keep: [] when every watched option is read back from every chart. */
function nvChartOptionProblems() {
  const sh = nvSheet("panel");
  const own = nvOwnCharts(sh);
  const problems = [];
  nvChartSpecs(nvThemeFor("panel")).forEach((spec, i) => {
    const a = NV_PANEL.charts[i];
    const ch = own.find((c) => {
      const at = c.getContainerInfo();
      return at.getAnchorRow() === a.row && at.getAnchorColumn() === a.col;
    });
    if (!ch) {
      problems.push(spec.id + ": графика нет");
      return;
    }
    const lost = NV_CHART_WATCH.filter((k) => {
      if (spec.options[k] === undefined) return false;
      const got = ch.getOptions().get(k);
      return got === null || got === undefined;
    });
    if (lost.length) problems.push(spec.id + ": " + lost.join(", "));
  });
  return problems;
}

/** Builds the eight charts again (the charts of this script are removed first; the owner's own are left). */
function nvBuildCharts() {
  const sh = nvSheet("panel");
  const data = nvSheet("data");
  const T = nvThemeFor("panel");
  nvOwnCharts(sh).forEach((ch) => {
    sh.removeChart(ch);
  });
  const specs = nvChartSpecs(T);
  specs.forEach((spec, i) => {
    const anchor = NV_PANEL.charts[i];
    let b = sh.newChart().setChartType(nvChartType(spec.type));
    spec.ranges.forEach((a1) => {
      b = b.addRange(data.getRange(a1));
    });
    b = b.setNumHeaders(1).setPosition(anchor.row, anchor.col, 0, 0);
    Object.keys(spec.options).forEach((k) => {
      b = b.setOption(k, spec.options[k]);
    });
    sh.insertChart(b.build());
  });
  // Remember the ids of what was inserted: a chart that the owner moves is still ours next time
  const ids = sh
    .getCharts()
    .filter((ch) => nvChartAtOurAnchor(ch))
    .map((ch) => ch.getChartId());
  nvDocProps().setProperty(NV_CHART_IDS_PROP, JSON.stringify(ids));
  return specs.length;
}
