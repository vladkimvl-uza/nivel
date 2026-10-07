/**
 * Setup: builds the whole book from the declarations, and applies the look. It never clears data, so it can be run
 * again at any time ("Применить оформление"). The work is split into steps: if a run comes near the six-minute limit
 * of Apps Script, it saves the step and a timer continues it a minute later.
 */

/**
 * The time after which a run saves its step and hands the rest to a timer. Google stops a run at six minutes, and one step
 * ("Лист Заказы": 98 columns with checks, rules and protection) can take up to about 90 seconds, so the budget leaves it room.
 */
const NV_SETUP_BUDGET_MS = 180000;
/** A saved step older than this is a trace of an old stopped run, not something to continue. */
const NV_SETUP_RESUME_MS = 30 * 60000;

/** Sheets of the book in order; the default empty sheet of a new book is removed. */
function nvEnsureSheets() {
  const ss = nvSpreadsheet();
  NV_SHEET_ORDER.forEach((key) => {
    const name = NV_SN[key];
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });
  ss.getSheets().forEach((sh) => {
    const known = Object.keys(NV_SN).some((k) => NV_SN[k] === sh.getName());
    if (!known && ss.getSheets().length > 1 && sh.getLastRow() <= 1) ss.deleteSheet(sh);
  });
  NV_SHEET_ORDER.forEach((key, i) => {
    const sh = ss.getSheetByName(NV_SN[key]);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(ss.getSheetByName(NV_SN.panel));
}

/**
 * The theme of the book: the brand colours (the new charts never take the default rainbow) and Fira Sans.
 * setConcreteColor takes a Color object (or three integers), never a text like "#D9501A". The font of the theme is
 * limited to a list of Google; if it is refused, the cells still carry Fira Sans one by one, so the failure is only logged.
 */
function nvApplyBookTheme() {
  const ss = nvSpreadsheet();
  ss.setSpreadsheetTimeZone(NV_TZ);
  ss.setSpreadsheetLocale(NV_LOCALE);
  // Every 60 minutes: TODAY() and NOW() of the formulas ("Сегодня", the panel) are then never older than an hour
  ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR);
  const theme = ss.getSpreadsheetTheme();
  try {
    theme.setFontFamily(NV_FONT_TEXT);
  } catch (e) {
    Logger.log("Шрифт темы не принят: " + (e?.message ? e.message : e));
  }
  Object.keys(NV_BOOK_THEME).forEach((k) => {
    theme.setConcreteColor(
      SpreadsheetApp.ThemeColorType[k],
      SpreadsheetApp.newColor().setRgbColor(NV_BOOK_THEME[k]).build(),
    );
  });
}

/** A basic filter over the header and the body of a table. */
function nvApplyFilter(sheetKey) {
  const def = NV_SCHEMA[sheetKey];
  const sh = nvSheet(sheetKey);
  const old = sh.getFilter();
  if (old) old.remove();
  const rows = sh.getMaxRows() - NV_LAYOUT.headerRow + 1;
  sh.getRange(NV_LAYOUT.headerRow, NV_LAYOUT.firstCol, rows, def.cols.length).createFilter();
}

/** Filter views through the advanced Sheets service, when it is enabled; the basic filter stays without it. */
function nvFilterViews() {
  if (typeof Sheets === "undefined") return { created: 0, reason: "служба Sheets не включена" };
  const ss = nvSpreadsheet();
  const id = ss.getId();
  const views = [
    { sheet: "orders", title: "В работе", col: "group", values: ["В работе", "Ждёт клиента"] },
    { sheet: "orders", title: "Сроки", col: "nextDate", sort: true },
    { sheet: "orders", title: "Архив", col: "code", values: ["closed", "cancelled", "podbor_delivered"] },
    { sheet: "history", title: "Принудительные", col: "how", values: ["Принудительно"] },
    { sheet: "history", title: "За неделю", col: "time", sort: true },
  ];
  const requests = [];
  const existing = Sheets.Spreadsheets.get(id, {
    fields: "sheets(properties(sheetId),filterViews(filterViewId,title))",
  });
  (existing.sheets || []).forEach((s) => {
    (s.filterViews || []).forEach((fv) => {
      if (views.some((v) => v.title === fv.title)) requests.push({ deleteFilterView: { filterId: fv.filterViewId } });
    });
  });
  views.forEach((v) => {
    const sh = nvSheet(v.sheet);
    const def = NV_SCHEMA[v.sheet];
    const colIdx = nvColIndex(v.sheet, v.col) - 1;
    const view = {
      title: v.title,
      range: {
        sheetId: sh.getSheetId(),
        startRowIndex: NV_LAYOUT.headerRow - 1,
        startColumnIndex: NV_LAYOUT.firstCol - 1,
        endColumnIndex: NV_LAYOUT.firstCol - 1 + def.cols.length,
      },
    };
    if (v.values)
      view.criteria = {
        [String(colIdx)]: {
          condition: { type: "ONE_OF_LIST", values: v.values.map((x) => ({ userEnteredValue: x })) },
        },
      };
    if (v.sort) view.sortSpecs = [{ dimensionIndex: colIdx, sortOrder: v.col === "time" ? "DESCENDING" : "ASCENDING" }];
    requests.push({ addFilterView: { filter: view } });
  });
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, id);
  return { created: views.length };
}

/** Protections of the special sheets: a warning, nothing is locked. */
function nvProtectSpecial() {
  const ss = nvSpreadsheet();
  const lock = (key, text, open) => {
    const sh = ss.getSheetByName(NV_SN[key]);
    if (!sh) return;
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach((p) => {
      p.remove();
    });
    const p = sh.protect();
    p.setDescription("Nivel: " + text).setWarningOnly(true);
    if (open?.length) p.setUnprotectedRanges(open.map((a1) => sh.getRange(a1)));
  };
  lock("dict", "справочники правит только владелец", []);
  lock("settings", "настройки правит только владелец; каждое изменение пишется в «Историю»", [
    "C6:C" + (NV_LAYOUT.firstRow + NV_SETTINGS.length),
  ]);
  lock("threshold", "формулы порога и налогов", [
    "M6:M17",
    "O6:P17",
    "R6:U" + (NV_TH.other.first + NV_TH.other.rows - 1),
  ]);
  lock("calc", "ввод только в светлые ячейки", ["C6:C13", "C23:C24"]);
  lock("today", "список собирают формулы; мои задачи справа", ["M6:Q" + 305]);
  lock("phone", "только чтение: цифры берутся из тех же ячеек, что и на панели", []);
  lock("data", "служебный лист", []);
  lock("tasks", "служебный лист", []);
}

/**
 * The named cells that other sheets use before their own sheet is built (P_*, ND_*, TH_*, NV_RES_*): their addresses are
 * fixed, so they are defined first and every formula finds its names whatever the order of the steps.
 */
function nvDefineNames() {
  const ss = nvSpreadsheet();
  const panel = nvSheet("panel");
  nvSetName(ss, "P_PERIOD", panel.getRange("C3"));
  nvSetName(ss, "P_YEAR", panel.getRange("F3"));
  nvSetName(ss, "P_DEMO", panel.getRange("I3"));
  const data = nvSheet("data");
  nvDataNames().forEach((n) => {
    nvSetName(ss, n[0], data.getRange(n[1] + n[2]));
  });
  const th = nvSheet("threshold");
  nvThresholdYearRows().forEach((r, i) => {
    nvSetName(ss, r[2], th.getRange(NV_TH.year.first + i, 3));
  });
  nvSetName(ss, "TH_MONTHS", th.getRange("E6:E17"));
  nvSetName(ss, "TH_DEALS", th.getRange("J6:J17"));
  nvSetName(ss, "TH_CUM", th.getRange("K6:K17"));
  nvSetName(ss, "TH_TAX_EST", th.getRange("L6:L17"));
  nvSetName(ss, "TH_PAID", th.getRange("O6:O17"));
  const rs = nvSheet("reserves");
  ["NV_RES_BAL_W", "NV_RES_BAL_T", "NV_RES_CLOSED", "NV_RES_LOSS_BP", "NV_RES_RATE", "NV_RES_MATURE"].forEach(
    (name, i) => {
      nvSetName(ss, name, rs.getRange(NV_RES_SUMMARY.first + i, NV_RES_SUMMARY.col + 1));
    },
  );
}

/** The steps of the setup. Each is a function without arguments. */
function nvSetupSteps() {
  const steps = [];
  steps.push([
    "Книга и листы",
    () => {
      nvApplyBookTheme();
      nvEnsureSheets();
    },
  ]);
  steps.push(["Настройки", () => nvBuildSettings()]);
  steps.push(["Имена", () => nvDefineNames()]);
  steps.push(["Справочники", () => nvBuildDict()]);
  NV_TABLE_SHEETS.forEach((key) => {
    steps.push([
      "Лист «" + NV_SCHEMA[key].title + "»",
      () => {
        nvBuildTable(key);
        nvStyleTable(key);
        nvApplyFilter(key);
        nvProtectTable(key);
      },
    ]);
  });
  steps.push([
    "Резервы: сводка",
    () => {
      nvBuildReservesSummary();
      nvStyleReservesSummary();
    },
  ]);
  steps.push([
    "Порог и налоги",
    () => {
      nvBuildThreshold();
      nvStyleThreshold();
    },
  ]);
  steps.push([
    "Калькулятор",
    () => {
      nvBuildCalc();
      nvStyleCalc();
    },
  ]);
  steps.push(["Панель: структура", () => nvBuildPanel()]);
  steps.push(["Данные для панели", () => nvBuildData()]);
  steps.push([
    "Задачи и «Сегодня»",
    () => {
      nvBuildTasks();
      nvBuildToday();
      nvStyleToday();
    },
  ]);
  steps.push([
    "Справочники и настройки: вид",
    () => {
      nvStyleDict();
      nvStyleSettings();
    },
  ]);
  steps.push([
    "Панель: вид и графики",
    () => {
      nvStylePanel();
      nvBuildCharts();
    },
  ]);
  steps.push([
    "Телефон",
    () => {
      nvBuildPhone();
      nvStylePhone();
    },
  ]);
  steps.push([
    "Защита",
    () => {
      nvProtectPanel();
      nvProtectSpecial();
    },
  ]);
  steps.push(["Представления фильтров", () => nvFilterViews()]);
  steps.push([
    "Завершение",
    () => {
      nvEnsureStartContribution();
      nvDocProps().setProperty("NV_SCHEMA_VERSION", String(NV_SCHEMA_VERSION));
      nvDocProps().setProperty("NV_SETUP_AT", String(nvNow().getTime()));
      nvScriptProps().setProperty(NV_PROP.spreadsheetId, nvSpreadsheet().getId());
      nvResetSettingsCache();
      nvSpreadsheet().setActiveSheet(nvSheet("panel"));
    },
  ]);
  return steps;
}

/** Arms exactly one timer that continues the setup after ms (the old ones of the same kind are removed). */
function nvArmSetupTimer(ms) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "nvSetupContinue") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("nvSetupContinue").timeBased().after(ms).create();
}

function nvDisarmSetupTimer() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "nvSetupContinue") ScriptApp.deleteTrigger(t);
  });
}

/**
 * Builds the book. opts.budgetMs: the time after which the run saves its step and a timer continues it; opts.resume:
 * go on from the saved step. The number of a step is saved BEFORE the step starts and a timer is armed for after the
 * six minutes of Google: if the run is cut in the middle of a step, the timer repeats that step (every step can be
 * repeated without harm).
 */
function nvSetup(opts) {
  const o = opts || {};
  nvResetNamedCache();
  const budget = o.budgetMs === undefined ? NV_SETUP_BUDGET_MS : o.budgetMs;
  const started = Date.now();
  const props = nvDocProps();
  const steps = nvSetupSteps();
  let i = o.resume ? Number(props.getProperty("NV_SETUP_STEP") || 0) : 0;
  const log = [];
  const pause = (at) => {
    props.setProperty("NV_SETUP_STEP", String(at));
    props.setProperty("NV_SETUP_STEP_AT", String(Date.now()));
    nvArmSetupTimer(60000);
    nvToast("Оформление продолжится само через минуту: шаг " + (at + 1) + " из " + steps.length);
    return { done: false, step: at, total: steps.length, log: log };
  };
  nvArmSetupTimer(8 * 60000);
  while (i < steps.length) {
    if (i > 0 && Date.now() - started >= budget) return pause(i);
    const step = steps[i];
    // Before the step: where we are (the timer armed at the start repeats this step if Google stops the run inside it)
    props.setProperty("NV_SETUP_STEP", String(i));
    props.setProperty("NV_SETUP_STEP_AT", String(Date.now()));
    nvToast(step[0], "Оформление " + (i + 1) + "/" + steps.length, 3);
    try {
      nvWithLock(() => step[1](), 60000);
    } catch (err) {
      // The book is busy for a minute: the same step is tried again by the timer
      if (nvIsLockError(err)) return pause(i);
      throw err;
    }
    log.push(step[0]);
    i += 1;
  }
  props.deleteProperty("NV_SETUP_STEP");
  props.deleteProperty("NV_SETUP_STEP_AT");
  nvDisarmSetupTimer();
  nvToast("Книга построена. Проверьте: Nivel CRM → Самопроверка", "Оформление");
  return { done: true, step: steps.length, total: steps.length, log: log };
}

/** A start from the menu: continues from the saved step when it is fresh, otherwise builds from the first step. */
function nvSetupFromMenu() {
  const props = nvDocProps();
  const at = Number(props.getProperty("NV_SETUP_STEP_AT") || 0);
  const saved = props.getProperty("NV_SETUP_STEP");
  const fresh = saved !== null && saved !== undefined && at > 0 && Date.now() - at < NV_SETUP_RESUME_MS;
  if (!fresh) {
    props.deleteProperty("NV_SETUP_STEP");
    props.deleteProperty("NV_SETUP_STEP_AT");
  }
  return nvSetup({ resume: fresh });
}

/** The timer after a paused setup. */
function nvSetupContinue() {
  nvDisarmSetupTimer();
  return nvSetup({ resume: true });
}

/* ---------------------------------------------------------------- themes */

/** Switches the look. scope: "panel" (the sheet "Панель" only) or "all". Data is not touched. */
function nvSetTheme(name, scope) {
  if (!NV_THEMES[name]) throw new Error("Нет темы " + name);
  const props = nvDocProps();
  if (scope === "panel") {
    props.setProperty(NV_PROP.themePanel, name);
  } else {
    props.setProperty(NV_PROP.themePanel, name);
    props.setProperty(NV_PROP.themeData, name);
  }
  nvWithLock(() => {
    nvRestyle(scope === "panel" ? ["panel"] : null);
  }, 60000);
  nvToast("Тема: " + NV_THEMES[name].name + (scope === "panel" ? " (лист «Панель»)" : " (все листы)"), "Оформление");
}

/** Applies the look to the sheets (only the look; the structure and the data stay). */
function nvRestyle(only) {
  const all = !only;
  if (all) {
    NV_TABLE_SHEETS.forEach((key) => {
      nvStyleTable(key);
    });
    nvStyleReservesSummary();
    nvStyleThreshold();
    nvStyleCalc();
    nvStyleToday();
    nvStyleDict();
    nvStyleSettings();
  }
  nvStylePanel();
  nvStylePhone();
  nvBuildCharts();
}
