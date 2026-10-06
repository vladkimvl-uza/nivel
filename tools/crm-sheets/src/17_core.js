/**
 * Core services: numbers (L-, NV-, G-, K-, P-, Z-), history, clients, the ledger of the reserves.
 * Every write happens under the document lock; the calling code holds it (the lock is re-entrant).
 */

/* ---------------------------------------------------------------- numbers */

/** Key of the counter in Script Properties: COUNTER_L_2026, COUNTER_K (clients have no year), COUNTER_DEMO_L_2026. */
function nvCounterKey(prefix, year, demo) {
  const p = NV_COUNTER_PREFIX + (demo ? "DEMO_" : "") + prefix;
  return prefix === "K" ? p : p + "_" + year;
}

/** Formats a number: L-2026-0007, after 9999 the number grows by a digit (L-2026-10000); K-0001; demo: L-2026-D001. */
function nvFormatNumber(prefix, year, n, demo) {
  if (demo) return prefix === "K" ? "K-D" + nvPad(n, 3) : prefix + "-" + year + "-D" + nvPad(n, 3);
  return prefix === "K" ? "K-" + nvPad(n, 4) : prefix + "-" + year + "-" + nvPad(n, 4);
}

/** Parses a number into {prefix, year, n, demo}; null if it is not a number of the system. */
function nvParseNumber(text) {
  const s = String(text || "").trim();
  let m = /^(L|NV|G|P|Z)-(\d{4})-(D?)(\d{3,})$/.exec(s);
  if (m) return { prefix: m[1], year: Number(m[2]), n: Number(m[4]), demo: m[3] === "D" };
  m = /^K-(D?)(\d{3,})$/.exec(s);
  if (m) return { prefix: "K", year: 0, n: Number(m[2]), demo: m[1] === "D" };
  return null;
}

/** Issues the next number without gaps: the counter moves only after the callback has written the row. */
function nvIssueNumber(prefix, opts, write) {
  return nvWithLock(() => {
    const o = opts || {};
    const year = o.year || nvYear(o.date);
    const props = nvScriptProps();
    const key = nvCounterKey(prefix, year, o.demo);
    const current = Number(props.getProperty(key) || 0);
    const next = current + 1;
    const number = nvFormatNumber(prefix, year, next, o.demo);
    const result = write(number);
    props.setProperty(key, String(next));
    return result === undefined ? number : result;
  });
}

/** Raises the counter to the largest number seen (a number of the platform is always the senior one). */
function nvBumpCounter(number) {
  const p = nvParseNumber(number);
  if (!p) return false;
  return nvWithLock(() => {
    const props = nvScriptProps();
    const key = nvCounterKey(p.prefix, p.year, p.demo);
    const current = Number(props.getProperty(key) || 0);
    if (p.n > current) props.setProperty(key, String(p.n));
    return p.n > current;
  });
}

/** Largest sequence number among the existing numbers of a prefix and year; used by the self-check. */
function nvMaxNumber(sheetKey, prefix, year) {
  const def = NV_SCHEMA[sheetKey];
  let max = 0;
  nvReadTable(sheetKey).forEach((r) => {
    const p = nvParseNumber(r[def.keyCol]);
    if (p && p.prefix === prefix && !p.demo && (prefix === "K" || p.year === year) && p.n > max) max = p.n;
  });
  return max;
}

/* ---------------------------------------------------------------- history */

/** One row of the history; time defaults to now. */
function nvHistoryRow(o) {
  return {
    time: o.time || nvNow(),
    object: o.object || "Заказ",
    num: o.num || "",
    from: o.from || "",
    to: o.to || "",
    event: o.event || "",
    eventLabel: o.eventLabel || "",
    actor: o.actor || "Владелец",
    how: o.how || "Вручную",
    reason: o.reason || "",
    eventId: o.eventId || "",
    seq: o.seq === undefined ? "" : o.seq,
  };
}

function nvHistoryAppend(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length) nvAppendRows("history", list.map(nvHistoryRow));
}

const NV_ACTOR_LABEL = {
  owner: "Владелец",
  assistant: "Помощник",
  customer: "Клиент",
  system: "Система",
  platform: "Платформа",
};

/* ---------------------------------------------------------------- clients */

function nvNormalizeTg(tg) {
  const s = nvStr(tg);
  if (!s) return "";
  return (s.charAt(0) === "@" ? s : "@" + s).toLowerCase();
}

function nvNormalizePhone(phone) {
  const digits = nvStr(phone).replace(/\D/g, "");
  return digits ? "+" + digits : "";
}

/** The client by the Telegram nick, then by the phone, or null. */
function nvFindClient(fields, clients) {
  const list = clients || nvReadTable("clients");
  const tg = nvNormalizeTg(fields.tg);
  const phone = nvNormalizePhone(fields.phone);
  if (fields.ref) {
    const byRef = list.find((c) => c.ref && String(c.ref) === String(fields.ref));
    if (byRef) return byRef;
  }
  if (tg) {
    const byTg = list.find((c) => nvNormalizeTg(c.tg) === tg);
    if (byTg) return byTg;
  }
  if (phone) {
    const byPhone = list.find((c) => nvNormalizePhone(c.phone) === phone);
    if (byPhone) return byPhone;
  }
  return null;
}

/** Finds or creates a client and returns its code (K-0001). Nothing but the code, the name, the nick and the district is stored by default. */
function nvEnsureClient(fields, opts) {
  const o = opts || {};
  return nvWithLock(() => {
    const found = nvFindClient(fields);
    if (found) return found.code;
    const nick = nvNormalizeTg(fields.tg);
    if (!nick && !nvStr(fields.name) && !fields.ref) return "";
    return nvIssueNumber("K", { demo: o.demo }, (code) => {
      nvAppendRow("clients", {
        code: code,
        name: fields.name || "",
        tg: nick,
        phone: fields.phone ? nvNormalizePhone(fields.phone) : "",
        lang: fields.lang || "",
        district: fields.district || "",
        firstContact: nvToday(),
        firstChannel: fields.channel || "",
        referral: fields.referral || "",
        adminUrl: fields.adminUrl || "",
        ref: fields.ref || "",
        notes: "",
        demo: !!o.demo,
      });
      return code;
    });
  });
}

/* ---------------------------------------------------------------- reserves ledger */

/** Appends an entry to the ledger of the reserves; the sums are values, so the history never changes. */
function nvLedgerAppend(entry) {
  if (!entry.amount) return;
  nvAppendRow("reserves", {
    date: entry.date || nvToday(),
    fund: entry.fund,
    ref: entry.ref || "",
    amount: entry.amount,
    basis: entry.basis,
    who: entry.who || "Скрипт",
    comment: entry.comment || "",
    demo: !!entry.demo,
  });
}

/** State of the warranty fund for the contribution rule: balance, closed orders, losses of 12 months in bp. */
function nvWarrantyFundState(demo, now) {
  const when = now || nvNow();
  const since = nvAddMonths(when, -12);
  let balance = 0;
  let expenses = 0;
  nvReadTable("reserves").forEach((r) => {
    if (!!r.demo !== !!demo || r.fund !== "Гарантийный") return;
    balance += Number(r.amount) || 0;
    const d = nvToDate(r.date);
    if (r.basis === "Расход на гарантийный случай" && d && d.getTime() >= since.getTime())
      expenses += -(Number(r.amount) || 0);
  });
  const orders = nvReadTable("orders").filter((o) => !!o.demo === !!demo);
  const closed = orders.filter((o) => o.code === "closed").length;
  let receipts12 = 0;
  const purchases = nvReadTable("purchases");
  orders.forEach((o) => {
    const d = nvToDate(o.dHandover);
    if (d && d.getTime() >= since.getTime()) {
      receipts12 += purchases.filter((p) => p.order === o.num).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    }
  });
  return { balance: balance, closedOrders: closed, lossesBp: nvLossesBp(expenses, receipts12) };
}
