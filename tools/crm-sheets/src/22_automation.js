/**
 * Automation: the installable triggers, the hourly transitions, the daily digest (Telegram or mail), the weekly copy
 * and the monthly cleaning. Secrets (bot token, chat id, mail, webhook key) live only in Script Properties.
 */

const NV_TRIGGERS = [
  { handler: "nvOnEdit", kind: "edit" },
  { handler: "nvHourlyJob", kind: "hourly" },
  { handler: "nvDailyDigest", kind: "daily" },
  { handler: "nvWeeklyBackup", kind: "weekly" },
  { handler: "nvMonthlyJob", kind: "monthly" },
];

/** Installs exactly one trigger of each kind (the old ones of the project are removed first). */
function nvInstallTriggers() {
  const ss = nvSpreadsheet();
  nvScriptProps().setProperty(NV_PROP.spreadsheetId, ss.getId());
  const mine = NV_TRIGGERS.map((t) => t.handler);
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (mine.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  const installed = [];
  ScriptApp.newTrigger("nvOnEdit").forSpreadsheet(ss).onEdit().create();
  installed.push("onEdit");
  ScriptApp.newTrigger("nvHourlyJob").timeBased().everyHours(1).create();
  installed.push("ежечасно");
  ScriptApp.newTrigger("nvDailyDigest").timeBased().atHour(9).everyDays(1).inTimezone(NV_TZ).create();
  installed.push("сводка 09:00");
  ScriptApp.newTrigger("nvWeeklyBackup")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .inTimezone(NV_TZ)
    .create();
  installed.push("копия раз в неделю");
  ScriptApp.newTrigger("nvMonthlyJob").timeBased().onMonthDay(1).atHour(3).inTimezone(NV_TZ).create();
  installed.push("раз в месяц");
  return { installed: installed };
}

function nvTriggerCounts() {
  const counts = {};
  NV_TRIGGERS.forEach((t) => {
    counts[t.handler] = 0;
  });
  ScriptApp.getProjectTriggers().forEach((t) => {
    const h = t.getHandlerFunction();
    if (h in counts) counts[h] += 1;
  });
  return counts;
}

/* ---------------------------------------------------------------- Telegram and mail */

/** Sends text to the owner: Telegram first, mail if Telegram fails or is not set. Returns {ok, via}. */
function nvNotifyOwner(text) {
  const props = nvScriptProps();
  const token = props.getProperty(NV_PROP.telegramToken);
  const chat = props.getProperty(NV_PROP.telegramChat);
  const s = nvSettings();
  if (token && chat && s.digestChannel !== "Почта") {
    try {
      const res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() === 200) return { ok: true, via: "telegram" };
      Logger.log("Telegram: HTTP " + res.getResponseCode());
    } catch (e) {
      Logger.log("Telegram: " + (e?.message ? e.message : "ошибка отправки"));
    }
  }
  const mail = props.getProperty(NV_PROP.ownerEmail);
  if (mail) {
    try {
      MailApp.sendEmail(mail, "Nivel CRM", text);
      return { ok: true, via: "mail" };
    } catch (e) {
      Logger.log("Mail: " + (e?.message ? e.message : "ошибка отправки"));
    }
  }
  return { ok: false, via: "" };
}

/* ---------------------------------------------------------------- hourly transitions */

/**
 * Every hour of the response window (Monday to Saturday, not on holidays): the estimates that expired, the reports
 * accepted by the term, the orders closed, and the urgent reminders. opts.force ignores the window (menu).
 */
function nvHourlyJob(opts) {
  const o = opts || {};
  const now = nvNow();
  const s = nvSettings();
  const holidays = nvHolidays();
  const result = { expired: 0, deemed: 0, closed: 0, reminders: 0, skipped: false };
  if (!o.force && !nvIsResponseHours(now, holidays, s.responseFrom, s.responseTo)) {
    result.skipped = true;
    return result;
  }
  nvWithLock(() => {
    nvReadTable("orders").forEach((order) => {
      if (order.demo === true && !o.demo) return;
      const ctxOrder = order;
      if (ctxOrder.code === "estimate_sent") {
        const until = nvToDate(ctxOrder.validUntil);
        if (until && now.getTime() > until.getTime()) {
          const r = nvApplyOrderEvent(ctxOrder.num, "EXPIRE", { actor: "system", now: now });
          if (r.ok) result.expired += 1;
        }
      } else if (ctxOrder.code === "report_sent") {
        const until = nvToDate(ctxOrder.objectionUntil);
        const open = nvStr(ctxOrder.objection) !== "";
        const accepted = nvStr(ctxOrder.reportAccepted);
        if (until && now.getTime() > until.getTime() && !open && (accepted === "Нет" || accepted === "")) {
          const r = nvApplyOrderEvent(ctxOrder.num, "REPORT_DEEMED_ACCEPTED", { actor: "system", now: now });
          if (r.ok) result.deemed += 1;
        }
      } else if (ctxOrder.code === "handed_over") {
        const r = nvApplyOrderEvent(ctxOrder.num, "CLOSE", { actor: "system", now: now });
        if (r.ok) result.closed += 1;
      }
    });
    result.reminders = nvUrgentReminders(now, s, holidays);
  });
  return result;
}

/** Urgent reminders in Telegram: a lead without a reply, a report at the hard deadline, a warranty reply due today. Each once. */
function nvUrgentReminders(now, s, holidays) {
  const props = nvScriptProps();
  let sent = {};
  try {
    sent = JSON.parse(props.getProperty("NV_REMINDERS_SENT") || "{}");
  } catch (e) {
    sent = {};
  }
  const lines = [];
  const mark = (key, text) => {
    if (sent[key]) return;
    sent[key] = now.getTime();
    lines.push(text);
  };
  nvReadTable("leads").forEach((l) => {
    if (l.demo === true || l.status !== "Новая" || nvStr(l.firstReply) !== "") return;
    const created = nvToDate(l.created);
    if (created && nvWorkingHoursBetween(created, now, holidays, s.responseFrom, s.responseTo) > s.firstResponseHours)
      mark("lead:" + l.num, "Заявка " + l.num + " без ответа дольше " + s.firstResponseHours + " ч");
  });
  nvReadTable("orders").forEach((o) => {
    if (o.demo === true) return;
    if (o.code === "report_due") {
      const dl = nvToDate(o.reportDeadline);
      if (dl && dl.getTime() - now.getTime() <= 3600000)
        mark("report:" + o.num, "Заказ " + o.num + ": отчёт о закупке — крайний срок 48 ч в течение часа");
    }
  });
  nvReadTable("warranty").forEach((w) => {
    if (w.demo === true || w.status !== "Открыт") return;
    const by = nvToDate(w.replyBy);
    if (by && nvIsoDate(by) === nvIsoDate(now))
      mark("warranty:" + w.num, "Гарантийный случай " + w.num + ": ответить клиенту сегодня");
  });
  if (!lines.length) return 0;
  // Keep the memory of the reminders short: the last 300 keys.
  const keys = Object.keys(sent).sort((a, b) => sent[a] - sent[b]);
  keys.slice(0, Math.max(0, keys.length - 300)).forEach((k) => {
    delete sent[k];
  });
  props.setProperty("NV_REMINDERS_SENT", JSON.stringify(sent));
  nvNotifyOwner("Срочно:\n" + lines.join("\n"));
  return lines.length;
}

/* ---------------------------------------------------------------- daily digest */

/** Entries of the annual threshold: receipts of the purchases, the fee received, refunds of the fee, other income. Demo rows only when asked. */
function nvThresholdEntries(includeDemo) {
  const entries = [];
  const iso = (v) => {
    const d = nvToDate(v);
    return d ? nvIsoDate(d) : null;
  };
  nvReadTable("purchases").forEach((p) => {
    if (!includeDemo && p.demo === true) return;
    const d = iso(p.bought);
    if (d && Number(p.amount) > 0) entries.push({ kind: "receipt", amount: Number(p.amount), date: d });
  });
  nvReadTable("payments").forEach((p) => {
    if ((!includeDemo && p.demo === true) || p.status !== "Подтверждён") return;
    const k = nvPaymentKindByLabel(p.kind);
    const d = iso(p.date);
    if (!k || !d) return;
    if (k.group === "Плата") entries.push({ kind: "fee_in", amount: Number(p.amount), date: d });
    if (k.group === "Возврат платы") entries.push({ kind: "fee_refund", amount: Number(p.amount), date: d });
  });
  nvOtherIncomeRows().forEach((r) => {
    const d = iso(r.date);
    if (d && r.amount > 0) entries.push({ kind: "other_income", amount: r.amount, date: d });
  });
  return entries;
}

/** Rows of "Прочий доход ИП" on "Порог и налоги". */
function nvOtherIncomeRows() {
  let sh;
  try {
    sh = nvSheet("threshold");
  } catch (e) {
    return [];
  }
  const vals = sh.getRange(NV_TH.other.first, NV_TH.other.col, NV_TH.other.rows, 4).getValues();
  return vals
    .filter((r) => r[0] !== "" && Number(r[1]) > 0)
    .map((r) => ({ date: r[0], amount: Number(r[1]), kind: r[2], note: r[3] }));
}

/** Text of the digest: numbers, amounts and stages only; no names, no phones. */
function nvDigestText(now) {
  const when = now || nvNow();
  const s = nvSettings();
  const holidays = nvHolidays();
  const lines = [];
  lines.push("Nivel CRM · сводка на " + nvFormat(when, "dd.MM.yyyy"));
  // Tasks from the sheet "Сегодня" (the formulas collect them)
  const tasks = nvReadTodayList();
  const overdue = tasks.filter((t) => t.state === "Просрочено");
  const today = tasks.filter((t) => t.state === "Сегодня");
  const show = overdue.concat(today).slice(0, 10);
  lines.push("");
  lines.push("Просрочено: " + overdue.length + ", на сегодня: " + today.length);
  show.forEach((t) => {
    lines.push("• " + (t.num ? t.num + " " : "") + t.what + (t.sum ? " · " + nvMoneyText(t.sum) : ""));
  });
  // Expected payments
  const expected = nvReadTable("payments").filter((p) => p.demo !== true && p.status === "Ожидается");
  lines.push("");
  lines.push(
    "Ожидаемые платежи: " +
      expected.length +
      (expected.length ? " на " + nvMoneyText(expected.reduce((a, p) => a + (Number(p.amount) || 0), 0)) : ""),
  );
  expected.slice(0, 5).forEach((p) => {
    lines.push("• " + p.order + " " + p.kind + " · " + nvMoneyText(Number(p.amount) || 0));
  });
  // Orders by stages
  const orders = nvReadTable("orders").filter((o) => o.demo !== true);
  lines.push("");
  lines.push("Заказы по этапам:");
  NV_STAGES.forEach((st) => {
    const n = orders.filter((o) => nvStatusByCode(o.code)?.stage === st).length;
    if (n) lines.push("• " + st + ": " + n);
  });
  // Yesterday
  const y0 = nvMidnightDate(new Date(when.getTime() - NV_DAY_MS));
  const y1 = nvMidnightDate(when);
  const within = (v) => {
    const d = nvToDate(v);
    return d && d.getTime() >= y0.getTime() && d.getTime() < y1.getTime();
  };
  const newLeads = nvReadTable("leads").filter((l) => l.demo !== true && within(l.created)).length;
  const paid = nvReadTable("payments").filter(
    (p) => p.demo !== true && p.status === "Подтверждён" && within(p.confirmedAt || p.date),
  );
  const receipts = nvReadTable("purchases").filter((p) => p.demo !== true && within(p.bought));
  lines.push("");
  lines.push(
    "Вчера: новых заявок " +
      newLeads +
      ", подтверждённых платежей " +
      paid.length +
      " на " +
      nvMoneyText(paid.reduce((a, p) => a + (Number(p.amount) || 0), 0)) +
      ", чеков " +
      receipts.length +
      " на " +
      nvMoneyText(receipts.reduce((a, p) => a + (Number(p.amount) || 0), 0)),
  );
  // Threshold
  const year = nvYear(when);
  const committed = orders
    .filter((o) => o.code === "accepted")
    .reduce((a, o) => {
      const q = nvComputeQuote(nvOrderInputs(o), s);
      return a + q.purchaseLimit + q.feeTotal;
    }, 0);
  const th = nvThresholdStatus(nvThresholdEntries(false), committed, year, s);
  lines.push("");
  lines.push(
    "Порог " +
      year +
      ": " +
      nvMoneyText(th.volume) +
      " из " +
      nvMoneyText(th.limit) +
      " (" +
      nvPercentText(th.shareBp) +
      "), с принятыми сметами " +
      nvPercentText(th.projectedShareBp) +
      (th.crossedAlerts.length ? ", пройден рубеж " + th.crossedAlerts[th.crossedAlerts.length - 1] / 100 + " %" : ""),
  );
  // Tax deadlines of the week
  const day15 = nvLocalDate(Number(nvFormat(when, "yyyy")), Number(nvFormat(when, "MM")), 15, 0, 0);
  const days = Math.round((day15.getTime() - nvMidnight(when)) / NV_DAY_MS);
  if (days >= 0 && days <= 7)
    lines.push(
      "Налоги: до " +
        nvFormat(day15, "dd.MM.yyyy") +
        " — налог с оборота за прошлый месяц и социальный налог " +
        nvMoneyText(s.socialTax),
    );
  const lastWorking = nvLastWorkingDay(when, holidays);
  const toLast = Math.round((lastWorking.getTime() - nvMidnight(when)) / NV_DAY_MS);
  if (toLast >= 0 && toLast <= 7)
    lines.push("Сверка счёта «средства комитентов» — " + nvFormat(lastWorking, "dd.MM.yyyy"));
  return lines.join("\n");
}

function nvMoneyText(n) {
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " сум";
}

function nvPercentText(bp) {
  return (bp / 100).toFixed(1).replace(".", ",") + " %";
}

/** The last working day of the month of d (Monday to Saturday, no holidays). */
function nvLastWorkingDay(d, holidays) {
  const y = Number(nvFormat(d, "yyyy"));
  const m = Number(nvFormat(d, "MM"));
  let day = nvLocalDate(y, m + 1, 0, 0, 0);
  while (!nvIsWorkingDay(nvIsoDate(day), holidays)) day = new Date(day.getTime() - NV_DAY_MS);
  return day;
}

/** The list of "Сегодня" as read from the sheet (the spilled formula): [{due, state, what, object, num, sum}]. */
function nvReadTodayList() {
  let sh;
  try {
    sh = nvSheet("today");
  } catch (e) {
    return [];
  }
  const rows = Math.max(0, sh.getMaxRows() - NV_TODAY.first + 1);
  if (!rows) return [];
  const vals = sh.getRange(NV_TODAY.first, 2, rows, 8).getValues();
  const out = [];
  vals.forEach((r) => {
    if (nvStr(r[1]) === "") return;
    out.push({ due: r[0], state: r[1], what: r[2], object: r[3], num: nvStr(r[4]), sum: Number(r[6]) || 0 });
  });
  return out;
}

/** Sends the digest at 09:00, Monday to Saturday (Sunday only when the setting asks for it). Monday includes Sunday. */
function nvDailyDigest(opts) {
  const o = opts || {};
  const now = nvNow();
  const s = nvSettings();
  const weekday = Number(nvFormat(now, "u")) % 7; // 0 = Sunday
  if (!o.force && weekday === 0 && s.digestSunday !== true) return { sent: false, reason: "воскресенье" };
  const text = nvDigestText(now);
  const r = nvNotifyOwner(text);
  return { sent: r.ok, reason: r.ok ? "" : "не заданы Telegram и почта", via: r.via, text: text };
}

/* ---------------------------------------------------------------- weekly copy and monthly cleaning */

/** A copy of the book in the Drive folder «Nivel CRM — копии»; the last eight are kept. */
function nvWeeklyBackup() {
  const s = nvSettings();
  if (s.backupOn !== true) return { ok: false, reason: "выключено" };
  const ss = nvSpreadsheet();
  const folderName = "Nivel CRM — копии";
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  const name = "Nivel CRM " + nvFormat(nvNow(), "yyyy-MM-dd");
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  const files = [];
  const iter = folder.getFiles();
  while (iter.hasNext()) files.push(iter.next());
  files.sort((a, b) => a.getDateCreated().getTime() - b.getDateCreated().getTime());
  const keep = Math.max(1, Number(s.backupKeep) || 8);
  files.slice(0, Math.max(0, files.length - keep)).forEach((f) => {
    f.setTrashed(true);
  });
  return { ok: true, kept: Math.min(files.length, keep) };
}

/** On the first of the month: the journal of the webhook older than 12 months is cleaned; leads without an order are reminded. */
function nvMonthlyJob() {
  const cleaned = nvCleanWebhookJournal(nvNow());
  const stale = nvStaleLeads(nvNow());
  if (stale.length)
    nvNotifyOwner(
      "Обезличивание: заявок без заказа старше 12 месяцев — " +
        stale.length +
        " (" +
        stale.slice(0, 10).join(", ") +
        "). Меню «Nivel CRM → Настройка → Обезличить старые заявки» заменит имя и Telegram на «удалено»; номер и суммы остаются.",
    );
  return { cleaned: cleaned, stale: stale.length };
}

function nvStaleLeads(now) {
  const limit = nvAddMonths(now, -12);
  return nvReadTable("leads")
    .filter(
      (l) =>
        l.demo !== true &&
        !nvStr(l.order) &&
        nvToDate(l.created) &&
        nvToDate(l.created).getTime() < limit.getTime() &&
        nvStr(l.name) !== "удалено",
    )
    .map((l) => l.num);
}

/** Replaces the name and the Telegram of the old leads without an order by "удалено" (the number and the sums stay). */
function nvAnonymizeStaleLeads(now) {
  const nums = nvStaleLeads(now || nvNow());
  nvWithLock(() => {
    nvReadTable("leads")
      .filter((l) => nums.indexOf(l.num) >= 0)
      .forEach((l) => {
        nvWriteCells("leads", l._row, { name: "удалено", tg: "удалено", updated: nvNow() });
      });
  });
  return nums.length;
}

function nvCleanWebhookJournal(now) {
  const limit = nvAddMonths(now, -12);
  const rows = nvReadTable("webhook");
  const old = rows.filter((r) => nvToDate(r.received) && nvToDate(r.received).getTime() < limit.getTime());
  if (!old.length) return 0;
  const sh = nvSheet("webhook");
  // The journal is a plain table without formulas: the old rows are the first ones; remove them and keep the rest.
  const keep = rows.filter((r) => old.indexOf(r) < 0);
  const def = NV_SCHEMA.webhook;
  const first = NV_LAYOUT.firstRow;
  sh.getRange(first, NV_LAYOUT.firstCol, old.length + keep.length, def.cols.length).clearContent();
  if (keep.length)
    sh.getRange(first, NV_LAYOUT.firstCol, keep.length, def.cols.length).setValues(
      keep.map((r) => def.cols.map((c) => (r[c.key] === undefined ? "" : r[c.key]))),
    );
  return old.length;
}

/* ---------------------------------------------------------------- secrets (the dialogs never show a stored value) */

function nvSecretStatus(name) {
  return nvHasProp(name) ? "задано" : "не задано";
}

function nvSecretTelegramUi() {
  const token = nvPrompt(
    "Telegram: токен бота",
    "Токен служебного бота от @BotFather (не бота продукта). Сейчас: " +
      nvSecretStatus(NV_PROP.telegramToken) +
      ". Пустое поле — оставить как есть.",
  );
  if (token === null) return;
  const chat = nvPrompt(
    "Telegram: чат владельца",
    "Числовой id личного чата (узнать у @userinfobot). Сейчас: " +
      nvSecretStatus(NV_PROP.telegramChat) +
      ". Пустое поле — оставить как есть.",
  );
  if (chat === null) return;
  if (nvStr(token)) nvScriptProps().setProperty(NV_PROP.telegramToken, nvStr(token));
  if (nvStr(chat)) nvScriptProps().setProperty(NV_PROP.telegramChat, nvStr(chat));
  nvToast("Telegram: токен " + nvSecretStatus(NV_PROP.telegramToken) + ", чат " + nvSecretStatus(NV_PROP.telegramChat));
}

function nvSecretEmailUi() {
  const mail = nvPrompt(
    "Почта владельца",
    "Адрес для сводки и срочных сообщений, если Telegram не задан или не отвечает. Сейчас: " +
      nvSecretStatus(NV_PROP.ownerEmail),
  );
  if (mail === null || !nvStr(mail)) return;
  nvScriptProps().setProperty(NV_PROP.ownerEmail, nvStr(mail));
  nvToast("Почта владельца: " + nvSecretStatus(NV_PROP.ownerEmail));
}

/** A new webhook key: 32 random bytes in base64. The old key stays valid for seven days as the previous one. */
function nvGenerateHmacSecret() {
  const raw = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + String(nvNow().getTime());
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return Utilities.base64Encode(digest);
}

function nvSecretWebhookUi() {
  const props = nvScriptProps();
  const ok = nvAsk(
    "Ключ вебхука",
    "Ключ вебхука: " +
      nvSecretStatus(NV_PROP.hmacSecret) +
      ". Создать новый ключ? Прежний останется принимаемым 7 дней. Новый ключ будет показан один раз — перенесите его в .env платформы.",
  );
  if (ok !== "YES") return;
  const previous = props.getProperty(NV_PROP.hmacSecret);
  if (previous) {
    props.setProperty(NV_PROP.hmacSecretPrev, previous);
    props.setProperty("NIVEL_HMAC_SECRET_PREV_UNTIL", String(nvNow().getTime() + 7 * NV_DAY_MS));
  }
  const key = nvGenerateHmacSecret();
  props.setProperty(NV_PROP.hmacSecret, key);
  nvAsk(
    "Новый ключ вебхука",
    "Скопируйте ключ сейчас, второй раз он не показывается:\n\n" + key,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}
