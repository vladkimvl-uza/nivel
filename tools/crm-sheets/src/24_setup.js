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
  // The reference: SpreadsheetTheme or null ("null if no theme is applied")
  const theme = ss.getSpreadsheetTheme();
  if (!theme) {
    Logger.log("Тема книги не применена: цвета темы пропущены");
    return;
  }
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

/**
 * Notes of the setup: things that could not be done (the Sheets service is off or refused a request) and must not stop
 * the setup or loop it. They are kept in the document properties and shown by the self-check.
 */
const NV_SETUP_NOTES_PROP = "NV_SETUP_NOTES";

function nvSetupNotes() {
  try {
    return JSON.parse(nvDocProps().getProperty(NV_SETUP_NOTES_PROP) || "{}");
  } catch (e) {
    return {};
  }
}

/** Remembers (or, with an empty text, forgets) a note of the setup under a name. */
function nvSetupNote(name, text) {
  const notes = nvSetupNotes();
  if (text) notes[name] = String(text).slice(0, 400);
  else delete notes[name];
  nvDocProps().setProperty(NV_SETUP_NOTES_PROP, JSON.stringify(notes));
}

/**
 * The views of the filter, as data. keep: the values the view shows. One value is the condition TEXT_EQ; several values
 * are the dictionary without them in hiddenValues (ONE_OF_LIST is a condition of data validation, filters refuse it);
 * since: only the last week (DATE_AFTER with a relative date).
 */
const NV_FILTER_VIEWS = [
  { sheet: "orders", title: "В работе", col: "group", keep: ["В работе", "Ждёт клиента"], dict: "NVD_STATUS_GROUP" },
  { sheet: "orders", title: "Сроки", col: "nextDate", sort: "ASCENDING" },
  {
    sheet: "orders",
    title: "Архив",
    col: "code",
    keep: ["closed", "cancelled", "podbor_delivered"],
    dict: "NVD_STATUS_CODE",
  },
  { sheet: "history", title: "Принудительные", col: "how", keep: ["Принудительно"] },
  { sheet: "history", title: "За неделю", col: "time", week: true, sort: "DESCENDING" },
];

/** The criteria of one view (FilterSpec.filterCriteria), or null when the view only sorts. */
function nvFilterCriteria(v) {
  if (v.week) return { condition: { type: "DATE_AFTER", values: [{ relativeDate: "PAST_WEEK" }] } };
  if (!v.keep) return null;
  if (v.keep.length === 1) return { condition: { type: "TEXT_EQ", values: [{ userEnteredValue: v.keep[0] }] } };
  const hidden = [];
  nvDictValues(v.dict).forEach((x) => {
    const t = String(x);
    if (v.keep.indexOf(t) < 0 && hidden.indexOf(t) < 0) hidden.push(t);
  });
  // The empty string is how the API names the blank rows of the column
  hidden.push("");
  return { hiddenValues: hidden };
}

function nvFilterViewRequest(v) {
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
  const criteria = nvFilterCriteria(v);
  if (criteria) view.filterSpecs = [{ columnIndex: colIdx, filterCriteria: criteria }];
  if (v.sort) view.sortSpecs = [{ dimensionIndex: colIdx, sortOrder: v.sort }];
  return { addFilterView: { filter: view } };
}

/**
 * Filter views through the advanced Sheets service. It never throws: a refusal of the service (a batch is all or nothing)
 * is retried view by view, and what still fails is written to the notes of the setup (the self-check shows it). A step
 * that threw would be repeated by the timer of the setup every eight minutes and the book would never be finished.
 */
function nvFilterViews() {
  const name = "Представления фильтров";
  if (typeof Sheets === "undefined") {
    nvSetupNote(name, "служба Sheets не включена: виды фильтра не созданы (работает обычный фильтр)");
    return { created: 0, reason: "служба Sheets не включена" };
  }
  const failed = [];
  let created = 0;
  try {
    const id = nvSpreadsheet().getId();
    const existing = Sheets.Spreadsheets.get(id, {
      fields: "sheets(properties(sheetId),filterViews(filterViewId,title))",
    });
    const oldIds = (title) => {
      const ids = [];
      (existing.sheets || []).forEach((s) => {
        (s.filterViews || []).forEach((fv) => {
          if (fv.title === title) ids.push(fv.filterViewId);
        });
      });
      return ids;
    };
    const items = [];
    NV_FILTER_VIEWS.forEach((v) => {
      try {
        const requests = oldIds(v.title).map((fid) => ({ deleteFilterView: { filterId: fid } }));
        requests.push(nvFilterViewRequest(v));
        items.push({ title: v.title, requests: requests });
      } catch (e) {
        failed.push(v.title + ": " + (e?.message ? e.message : e));
      }
    });
    const all = [];
    items.forEach((it) => {
      it.requests.forEach((r) => all.push(r));
    });
    let batchOk = false;
    if (!failed.length) {
      try {
        Sheets.Spreadsheets.batchUpdate({ requests: all }, id);
        batchOk = true;
        created = items.length;
      } catch (e) {
        Logger.log("Виды фильтра одним запросом не созданы: " + (e?.message ? e.message : e));
      }
    }
    if (!batchOk) {
      items.forEach((it) => {
        try {
          Sheets.Spreadsheets.batchUpdate({ requests: it.requests }, id);
          created += 1;
        } catch (e) {
          failed.push(it.title + ": " + (e?.message ? e.message : e));
        }
      });
    }
  } catch (e) {
    failed.push(e?.message ? e.message : String(e));
  }
  nvSetupNote(
    name,
    failed.length ? "не созданы (" + (NV_FILTER_VIEWS.length - created) + "): " + failed.join(" | ") : "",
  );
  return { created: created, failed: failed };
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
