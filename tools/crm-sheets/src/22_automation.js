/**
 * Automation: the installable triggers, the hourly transitions, the daily digest (Telegram or mail) and the monthly
 * cleaning. Secrets (bot token, chat id, mail, webhook key) live only in Script Properties. The project does not touch
 * the Google Drive at all (the weekly copy of the book was removed on 07.10.2026 at the owner's word).
 */

const NV_TRIGGERS = [
  { handler: "nvOnEdit", kind: "edit" },
  { handler: "nvHourlyJob", kind: "hourly" },
  { handler: "nvDailyDigest", kind: "daily" },
  { handler: "nvMonthlyJob", kind: "monthly" },
];

/**
 * A trigger runs as the account that created it, and getProjectTriggers shows an account only its own triggers. If an
 * assistant installed them, the owner's set would stay invisible and a second one would appear next to it: every edit
 * handled twice. So with OWNER_EMAIL set, only that account installs.
 */
function nvAssertTriggerOwner() {
  const owner = nvScriptProps().getProperty(NV_PROP.ownerEmail);
  if (!owner) return;
  let me = "";
  try {
    me = Session.getEffectiveUser().getEmail();
  } catch (e) {
    me = "";
  }
  if (me && me.toLowerCase() !== owner.toLowerCase())
    throw new Error(
      "Триггеры ставит только владелец книги: войдите под его учётной записью (адрес в свойстве OWNER_EMAIL) и повторите. Триггеры помощника дублировали бы работу владельца.",
    );
}

/**
 * A trigger of ours (a handler named nv…) whose function the script no longer has: an earlier version had one more
 * handler and left its trigger in the book (the weekly copy, removed on 07.10.2026). Such a trigger can only fail, and
 * Google sends the owner a notice about it. A handler of another name is not ours and is never touched.
 */
function nvIsDeadTrigger(trigger) {
  const handler = trigger.getHandlerFunction();
  return /^nv[A-Z]/.test(handler) && typeof globalThis[handler] !== "function";
}

/** Handlers of the dead triggers among the triggers of the current user (getProjectTriggers shows only his own). */
function nvDeadTriggers() {
  return ScriptApp.getProjectTriggers()
    .filter(nvIsDeadTrigger)
    .map((t) => t.getHandlerFunction());
}

/**
 * Installs exactly one trigger of each kind: the old ones of the project are removed first, and the dead ones with
 * them. Returns the labels of what was installed and the handlers of the dead triggers that were taken out.
 */
function nvInstallTriggers() {
  const ss = nvSpreadsheet();
  nvScriptProps().setProperty(NV_PROP.spreadsheetId, ss.getId());
  nvAssertTriggerOwner();
  const mine = NV_TRIGGERS.map((t) => t.handler);
  const removed = [];
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (mine.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    } else if (nvIsDeadTrigger(t)) {
      removed.push(t.getHandlerFunction());
      ScriptApp.deleteTrigger(t);
    }
  });
  const installed = [];
  ScriptApp.newTrigger("nvOnEdit").forSpreadsheet(ss).onEdit().create();
  installed.push("onEdit");
  ScriptApp.newTrigger("nvHourlyJob").timeBased().everyHours(1).create();
  installed.push("ежечасно");
  ScriptApp.newTrigger("nvDailyDigest").timeBased().atHour(9).everyDays(1).inTimezone(NV_TZ).create();
  // The time of a daily trigger is chosen by Google within the hour: not 09:00 sharp
  installed.push("сводка с 9 до 10");
  ScriptApp.newTrigger("nvMonthlyJob").timeBased().onMonthDay(1).atHour(3).inTimezone(NV_TZ).create();
  installed.push("раз в месяц (1-го числа, с 3 до 4)");
  return { installed: installed, removed: removed };
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
      // The text of a network error carries the address, and the address carries the token of the bot
      Logger.log("Telegram: " + nvScrub(e?.message ? e.message : "ошибка отправки", [token]));
    }
  }
  const mail = props.getProperty(NV_PROP.ownerEmail);
  if (mail) {
    try {
      MailApp.sendEmail(mail, "Nivel CRM", text);
      return { ok: true, via: "mail" };
    } catch (e) {
      Logger.log("Mail: " + nvScrub(e?.message ? e.message : "ошибка отправки", [token]));
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
  const result = { expired: 0, deemed: 0, closed: 0, reminders: 0, skipped: false, busy: false };
  // The refusals of the webhook counted in the cache are written first, at any hour (it reads no sheet when there are none)
  try {
    nvWebhookFlush(now);
  } catch (err) {
    if (!nvIsLockError(err)) throw err;
  }
  // The cheap exit: Sunday and the hours outside the window are decided without reading a sheet (the window is
  // remembered in a document property each time the settings are read). Holidays can only shorten it, so a "no" here is final.
  if (!o.force) {
    const w = nvRememberedWindow();
    if (!nvIsResponseHours(now, [], w.from, w.to)) {
      result.skipped = true;
      return result;
    }
  }
  try {
    return nvCached(() => {
      const s = nvSettings();
      const holidays = nvHolidays();
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
    });
  } catch (err) {
    if (!nvIsLockError(err)) throw err;
    // Another execution holds the book: the next hour does the same work
    result.busy = true;
    return result;
  }
}

/** The window of the response hours as it was when the settings were last read; the defaults before that. */
function nvRememberedWindow() {
  let from = NV_DEFAULTS.responseFrom;
  let to = NV_DEFAULTS.responseTo;
  try {
    const v = String(nvDocProps().getProperty("NV_RESP_WINDOW") || "");
    const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(v);
    if (m) {
      from = m[1];
      to = m[2];
    }
  } catch (e) {
    // the defaults stay
  }
  return { from: from, to: to };
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
  nvRememberReminders(props, sent, now);
  nvNotifyOwner("Срочно:\n" + lines.join("\n"));
  return lines.length;
}

/** The memory of the reminders is one property: a value is at most 9 KB, so it is kept far below that. */
const NV_REMINDERS_MAX_BYTES = 8000;
const NV_REMINDERS_MAX_AGE_MS = 30 * 86400000;

/**
 * Forgets what is older than 30 days, then the oldest ones until the text is short enough, and stores it. A failure to
 * store is only logged: the message to the owner goes out anyway (a reminder repeated is better than one lost).
 */
function nvRememberReminders(props, sent, now) {
  Object.keys(sent).forEach((k) => {
    if (now.getTime() - sent[k] > NV_REMINDERS_MAX_AGE_MS) delete sent[k];
  });
  const keys = Object.keys(sent).sort((a, b) => sent[a] - sent[b]);
  let text = JSON.stringify(sent);
  while (keys.length && nvUtf8Length(text) > NV_REMINDERS_MAX_BYTES) {
    delete sent[keys.shift()];
    text = JSON.stringify(sent);
  }
  try {
    props.setProperty("NV_REMINDERS_SENT", text);
  } catch (e) {
    Logger.log("Память напоминаний не записана: " + (e?.message ? e.message : e));
  }
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
    if ((!includeDemo && p.demo === true) || !nvPaymentCounts(p)) return;
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
    // The text of a step is the owner's own words (it can hold a name or a phone): the digest only says that a term is due
    const what = t.code === "next_step" ? "срок следующего шага" : t.what;
    lines.push("• " + (t.num ? t.num + " " : "") + what + (t.sum ? " · " + nvMoneyText(t.sum) : ""));
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
    (p) => p.demo !== true && nvPaymentCounts(p) && within(p.confirmedAt || p.date),
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

/**
 * The list of "Сегодня" as read from the sheet (the spilled formula): [{due, what, num, sum, state, object, client, code}].
 * The rows of the demo (numbers with the letter D: L-2026-D001) are not in it, whatever the switch of the panel says.
 */
function nvReadTodayList() {
  let sh;
  try {
    sh = nvSheet("today");
  } catch (e) {
    return [];
  }
  const rows = Math.max(0, sh.getMaxRows() - NV_TODAY.first + 1);
  if (!rows) return [];
  const vals = sh.getRange(NV_TODAY.first, NV_TODAY_COL.due, rows, 8).getValues();
  const out = [];
  vals.forEach((r) => {
    if (nvStr(r[4]) === "") return;
    const num = nvStr(r[2]);
    if (/-D\d{3,}$/.test(num)) return;
    out.push({
      due: r[0],
      what: r[1],
      num: num,
      sum: Number(r[3]) || 0,
      state: r[4],
      object: r[5],
      client: r[6],
      code: nvStr(r[7]),
    });
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

/* ---------------------------------------------------------------- monthly cleaning */

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
  // The kept rows are read back as values: text that started with = + - or @ lost its apostrophe on the way, so it is
  // written through the same escape as every other text from outside (setValues reads a leading = as a formula)
  if (keep.length) nvWriteRowsMatrix("webhook", first, keep);
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
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
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
