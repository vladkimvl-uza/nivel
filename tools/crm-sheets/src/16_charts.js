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
    "hAxis.gridlines.color": T.surface,
    "vAxis.gridlines.color": T.grid,
    "vAxis.minorGridlines.color": T.surface,
    "bar.groupWidth": "56%",
    lineWidth: 2,
    pointSize: 0,
    width: 576,
    height: 300,
  };
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
  return [
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
}

function nvChartType(name) {
  return Charts.ChartType[name];
}

/** Builds the eight charts again (the old ones of the panel are removed first). */
function nvBuildCharts() {
  const sh = nvSheet("panel");
  const data = nvSheet("data");
  const T = nvThemeFor("panel");
  sh.getCharts().forEach((ch) => {
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
  return specs.length;
}
