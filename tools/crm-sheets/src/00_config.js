/**
 * Nivel CRM for Google Sheets. Apps Script (V8), no modules: every top-level name is global.
 * Files are loaded in the order of their numeric prefix (the bundle keeps the same order).
 *
 * Money rules live in 01_money.js (pure functions, mirrored from packages/domain), the sheet structure in
 * 02_schema.js and 03_dicts.js, everything that touches SpreadsheetApp in the files after them.
 */

const NV_VERSION = "1.0.0";
const NV_SCHEMA_VERSION = 1;
const NV_TZ = "Asia/Tashkent";
const NV_LOCALE = "ru_RU";
/** Asia/Tashkent is UTC+5 all year round (no daylight saving), so local time is plain arithmetic. */
const NV_TZ_OFFSET_MS = 5 * 3600000;
const NV_DAY_MS = 86400000;

/** Layout of every table sheet: gutter column A, title block in rows 1-4, header in row 5, data from row 6. */
const NV_LAYOUT = {
  gutterCol: 1,
  firstCol: 2,
  headerRow: 5,
  firstRow: 6,
  gutterWidth: 16,
  rowHeights: { top: 12, title: 44, caption: 20, gap: 12, header: 32, data: 28 },
  /** Rows kept ready under the data (the sheet is trimmed to this size so the grid does not look endless). */
  spareRows: 400,
};

const NV_FONT_TEXT = "Fira Sans";
const NV_FONT_MONO = "IBM Plex Mono";

/** Brand nivel-1 "Level mark" (DECISIONS R-17). */
const NV_BRAND = {
  asphalt: "#1D1D1B",
  orange: "#D9501A",
  orangeOnDark: "#F06A30",
  paper: "#F1EFEA",
};

/** Names of the sheets (Russian, they are what the owner sees). */
const NV_SN = {
  panel: "Панель",
  today: "Сегодня",
  leads: "Заявки",
  orders: "Заказы",
  payments: "Платежи",
  purchases: "Закупки",
  warranty: "Гарантия",
  clients: "Клиенты",
  calc: "Калькулятор",
  threshold: "Порог и налоги",
  reserves: "Резервы",
  promo: "Продвижение",
  history: "История",
  webhook: "Журнал вебхука",
  dict: "Справочники",
  settings: "Настройки",
  selfcheck: "Самопроверка",
  data: "_Данные",
  tasks: "_Задачи",
};
/** Order of the sheets in the book. */
const NV_SHEET_ORDER = [
  "panel",
  "today",
  "leads",
  "orders",
  "payments",
  "purchases",
  "warranty",
  "clients",
  "calc",
  "threshold",
  "reserves",
  "promo",
  "history",
  "webhook",
  "dict",
  "settings",
  "selfcheck",
  "data",
  "tasks",
];

/** Number formats. Patterns are locale independent; the ru_RU locale supplies the spaces and the decimal comma. */
const NV_FMT = {
  sum: '#,##0" сум";-#,##0" сум";"—"',
  sumPlain: '#,##0;-#,##0;"—"',
  mln: '#,##0.0,," млн"',
  int: "#,##0",
  pct: "0.0%",
  pct2: "0.00%",
  date: "dd.mm.yyyy",
  dateTime: "dd.mm.yyyy hh:mm",
  dateTimeSec: "dd.mm.yyyy hh:mm:ss",
  text: "@",
};

/**
 * Two themes. "passport" is a document form (printing, PDF, accountant); "night" is an instrument panel.
 * Every colour of the sheets comes from here; nothing else in the code carries a raw colour.
 */
const NV_THEMES = {
  passport: {
    name: "Паспорт",
    bg: "#F1EFEA",
    surface: "#FBF9F4",
    band: "#F4F0E8",
    head: "#E4DDD2",
    headText: "#1D1D1B",
    headRule: "#1D1D1B",
    headCalc: "#D9D2C5",
    rowLine: "#DDD5C8",
    totalBg: "#E9E5DD",
    totalRule: "#1D1D1B",
    text: "#1D1D1B",
    text2: "#5E574D",
    muted: "#8A867E",
    accent: "#D9501A",
    accentText: "#A53F17",
    overdueFill: "#C2481A",
    overdueText: "#FFFFFF",
    missingBg: "#F6E3D6",
    missingText: "#A53F17",
    compare: "#6E695F",
    grid: "#E4DDD2",
    tileRule: "#1D1D1B",
    tileRuleOn: true,
    input: "#FFFFFF",
    // Ordinal scale of the stages, light to dark.
    ordinal: ["#D49874", "#D9773F", "#C2481A", "#8E3511", "#4A2414"],
    status: {
      s1: { fill: "#EEE7DC", text: "#5E574D", bold: false },
      s2: { fill: "#F0D9C4", text: "#6B2E12", bold: false },
      s3: { fill: "#E8BF9C", text: "#4A2414", bold: false },
      s4: { fill: "#DFA27A", text: "#3A1C10", bold: false },
      s5: { fill: "#8C4A2B", text: "#FFFFFF", bold: true },
      s6: { fill: "#5C3220", text: "#F6E4D6", bold: true },
      s7: { fill: "#1D1D1B", text: "#F1EFEA", bold: true },
      archive: { fill: null, text: "#5E574D", bold: false },
      cancelling: { fill: "#E4DDD2", text: "#5E574D", bold: false },
      cancelled: { fill: null, text: "#8A867E", bold: false },
    },
  },
  night: {
    name: "Ночная панель",
    bg: "#1D1D1B",
    surface: "#262522",
    band: "#2B2926",
    head: "#33302C",
    headText: "#F1EFEA",
    headRule: "#5A544C",
    headCalc: "#3A3631",
    rowLine: "#34312D",
    totalBg: "#2E2B27",
    totalRule: "#8F8A80",
    text: "#F1EFEA",
    text2: "#A39C90",
    muted: "#7A746B",
    accent: "#F06A30",
    accentText: "#F06A30",
    overdueFill: "#F06A30",
    overdueText: "#1D1D1B",
    missingBg: "#3A2A20",
    missingText: "#F39A6E",
    compare: "#8F8A80",
    grid: "#34312D",
    tileRule: "#262522",
    tileRuleOn: false,
    input: "#2B2926",
    ordinal: ["#82401F", "#B04B22", "#F06A30", "#F39A6E", "#F6C9AE"],
    status: {
      s1: { fill: "#2E2B27", text: "#A39C90", bold: false },
      s2: { fill: "#3A2A20", text: "#E8B595", bold: false },
      s3: { fill: "#4E3020", text: "#F0C2A3", bold: false },
      s4: { fill: "#6A3A22", text: "#F6D3BE", bold: false },
      s5: { fill: "#8C4625", text: "#FFF1E8", bold: true },
      s6: { fill: "#B4582C", text: "#FFFFFF", bold: true },
      s7: { fill: "#F1EFEA", text: "#1D1D1B", bold: true },
      archive: { fill: null, text: "#A39C90", bold: false },
      cancelling: { fill: "#33302C", text: "#A39C90", bold: false },
      cancelled: { fill: null, text: "#7A746B", bold: false },
    },
  },
};

/** Spreadsheet theme colours (ACCENT1-6): the default rainbow of new charts never appears. */
const NV_BOOK_THEME = {
  ACCENT1: "#D9501A",
  ACCENT2: "#1D1D1B",
  ACCENT3: "#6B6862",
  ACCENT4: "#A9A59C",
  ACCENT5: "#D6D2C8",
  ACCENT6: "#F06A30",
  TEXT: "#1D1D1B",
  BACKGROUND: "#FFFFFF",
};

/** Document properties (not secrets): the chosen themes. Secrets live only in Script Properties. */
const NV_PROP = {
  themePanel: "NV_THEME_PANEL",
  themeData: "NV_THEME_DATA",
  spreadsheetId: "NV_SPREADSHEET_ID",
  hmacSecret: "NIVEL_HMAC_SECRET",
  hmacSecretPrev: "NIVEL_HMAC_SECRET_PREV",
  telegramToken: "TELEGRAM_BOT_TOKEN",
  telegramChat: "TELEGRAM_CHAT_ID",
  ownerEmail: "OWNER_EMAIL",
  lastWebhookAt: "NV_LAST_WEBHOOK_AT",
};

/** Prefix of the counters in Script Properties: COUNTER_L_2026, COUNTER_NV_2026, COUNTER_G_2026, COUNTER_K, COUNTER_P_2026. */
const NV_COUNTER_PREFIX = "COUNTER_";

/** Webhook limits. */
const NV_WEBHOOK = {
  version: 1,
  maxBodyBytes: 50 * 1024,
  freshnessSec: 300,
  lockWaitMs: 20000,
  cacheSeconds: 21600,
  source: "nivel-platform",
};
