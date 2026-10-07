/**
 * The webhook of the platform: Apps Script web app, doPost. The protection is the signature, not the address.
 *
 * Request: POST {URL}?v=1&ts=<unix seconds>&sig=<hex>, body is JSON (UTF-8, up to 50 KB).
 * sig = hex(HMAC-SHA256(secret, ts + "." + raw body)); the key is the secret string as it is stored (UTF-8).
 * Order of the checks: size, ts is fresh (300 s at most), signature (constant time); a request that fails any of these is
 * only counted (nothing is read from a sheet, nothing is written to one). Then JSON and envelope (id of 8-64 safe
 * characters), the stricter freshness of the settings (60-300 s), environment, type, lock, idempotency by the id of the
 * event, apply and the row of the journal under the same lock. The answer is always HTTP 200; the result is in the JSON.
 * Errors: bad_signature, stale, bad_payload, wrong_env, unknown_type (do not repeat); locked, internal (repeat the same id).
 */

function doPost(e) {
  return nvWebhookHandle(e);
}

/** Length of a string in UTF-8 bytes. */
function nvUtf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function nvToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += nvPad((bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16), 2);
  return s;
}

/** hex(HMAC-SHA256(key, message)). */
function nvHmacHex(key, message) {
  return nvToHex(Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8));
}

/** Comparison over all characters, without an early exit. */
function nvConstantTimeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** Keys that are accepted now: the current one and, for seven days after a change, the previous one. */
function nvWebhookKeys(now) {
  const props = nvScriptProps();
  const keys = [];
  const cur = props.getProperty(NV_PROP.hmacSecret);
  if (cur) keys.push(cur);
  const prev = props.getProperty(NV_PROP.hmacSecretPrev);
  const until = Number(props.getProperty("NIVEL_HMAC_SECRET_PREV_UNTIL") || 0);
  if (prev && until > now.getTime()) keys.push(prev);
  return keys;
}

function nvSha256Hex16(text) {
  return nvToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)).slice(
    0,
    16,
  );
}

/** The id of an event: letters, digits, "_" and "-", 8 to 64 characters (a uuid of the platform fits). */
const NV_WEBHOOK_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Limits of the texts that go to the journal and to the cache. */
const NV_WEBHOOK_LIMITS = { type: 40, number: 24, summary: 200 };

/** Was the event seen: the cache (6 h), then the journal. */
function nvWebhookSeen(id) {
  const cache = CacheService.getScriptCache();
  if (cache.get("nv_evt_" + id)) return true;
  try {
    const rows = nvReadTable("webhook");
    return rows.slice(-2000).some((r) => r.eventId === id && (r.result === "Применено" || r.result === "Устарело"));
  } catch (e) {
    return false;
  }
}

/** Appends a row of the journal; the body of the event is never stored. */
function nvWebhookJournal(entry) {
  try {
    const row = Object.assign({}, entry);
    row.type = String(row.type || "").slice(0, NV_WEBHOOK_LIMITS.type);
    row.num = String(row.num || "").slice(0, NV_WEBHOOK_LIMITS.number);
    row.summary = String(row.summary || "").slice(0, NV_WEBHOOK_LIMITS.summary);
    nvAppendRows("webhook", [row]);
  } catch (e) {
    Logger.log("journal: " + nvScrub(e?.message ? e.message : e));
  }
}

function nvJsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------- requests without a valid signature */

/**
 * A request that did not pass the signature (or was too big, or stale) is only counted: it never reaches a sheet, so a
 * flood of them cannot fill the book (10 million cells) or take the lock. The counters live in the cache by the hour; once
 * an hour the job writes one summary row per hour that had refusals.
 */
function nvWebhookCount(now, error) {
  try {
    const cache = CacheService.getScriptCache();
    const key = "nv_rej_" + nvFormat(now, "yyyyMMddHH");
    let c = { total: 0, by: {} };
    try {
      c = JSON.parse(cache.get(key) || "") || c;
    } catch (e) {
      c = { total: 0, by: {} };
    }
    c.total += 1;
    c.by[error] = (c.by[error] || 0) + 1;
    cache.put(key, JSON.stringify(c), 21600);
  } catch (e) {
    // counting is a courtesy, never a reason to fail
  }
}

/** The counters of one hour: {total, by}. */
function nvWebhookRejections(hourKey) {
  try {
    return JSON.parse(CacheService.getScriptCache().get("nv_rej_" + hourKey) || "") || { total: 0, by: {} };
  } catch (e) {
    return { total: 0, by: {} };
  }
}

/** One row of the journal for each finished hour with refusals; the owner is told if there were many. */
function nvWebhookHourlySummary(now) {
  const props = nvScriptProps();
  const current = nvFormat(now, "yyyyMMddHH");
  const last = String(props.getProperty("NV_WH_SUMMED") || "");
  const labels = { bad_signature: "подпись", stale: "метка времени", bad_payload: "формат" };
  let written = 0;
  for (let back = 1; back <= 6; back++) {
    const when = new Date(now.getTime() - back * 3600000);
    const key = nvFormat(when, "yyyyMMddHH");
    if (key >= current || key <= last) continue;
    const c = nvWebhookRejections(key);
    if (!c.total) continue;
    const parts = Object.keys(c.by).map((k) => (labels[k] || k) + " " + c.by[k]);
    nvWebhookJournal({
      received: nvLocalDate(
        Number(key.slice(0, 4)),
        Number(key.slice(4, 6)),
        Number(key.slice(6, 8)),
        Number(key.slice(8, 10)),
        0,
      ),
      eventId: "",
      type: "",
      num: "",
      seq: "",
      sentAt: "",
      result: "Отклонено",
      error: Object.keys(c.by).sort((a, b) => c.by[b] - c.by[a])[0],
      hash: "",
      summary: "за час без верной подписи: " + c.total + " (" + parts.join(", ") + ")",
      ms: 0,
    });
    written += 1;
    if (c.total >= 50)
      nvNotifyOwner(
        "Вебхук: за час " +
          c.total +
          " запросов без верной подписи (" +
          parts.join(", ") +
          "). Проверьте адрес и ключ.",
      );
  }
  const newest = nvFormat(new Date(now.getTime() - 3600000), "yyyyMMddHH");
  if (newest > last) props.setProperty("NV_WH_SUMMED", newest);
  return written;
}

/** The whole path of a request. `now` is for the tests. Returns the text output. */
function nvWebhookHandle(e, nowOverride) {
  const now = nowOverride || nvNow();
  const started = now.getTime();
  const answer = (error, id) => nvJsonOut({ ok: false, id: id || null, result: null, error: error });
  // A request without a valid signature is only counted: nothing is read from a sheet and nothing is written to one.
  const refuse = (error) => {
    nvWebhookCount(now, error);
    return answer(error, null);
  };

  const body = e?.postData && typeof e.postData.contents === "string" ? e.postData.contents : "";
  if (body === "" || nvUtf8Length(body) > NV_WEBHOOK.maxBodyBytes) return refuse("bad_payload");
  const params = e?.parameter || {};
  const tsRaw = String(params.ts || "");
  const ts = Number(tsRaw);
  // The widest accepted gap is a constant; the owner can only make it narrower (after the signature, below)
  if (!/^\d{9,11}$/.test(tsRaw) || Math.abs(now.getTime() / 1000 - ts) > NV_WEBHOOK.freshnessSec)
    return refuse("stale");
  const keys = nvWebhookKeys(now);
  const sig = String(params.sig || "");
  const message = tsRaw + "." + body;
  let valid = false;
  keys.forEach((k) => {
    if (nvConstantTimeEqual(nvHmacHex(k, message), sig)) valid = true;
  });
  if (!valid) return refuse("bad_signature");

  // From here on the sender holds the key: what it sends may be written to the journal (at most 30 refusals a minute).
  const hash = nvSha256Hex16(body);
  const journalBase = {
    received: now,
    eventId: "",
    type: "",
    num: "",
    seq: "",
    sentAt: "",
    result: "Отклонено",
    error: "",
    hash: hash,
    summary: "",
    ms: 0,
  };
  const elapsed = () => Math.max(0, (nowOverride ? now : nvNow()).getTime() - started);
  const writeRow = (entry) => {
    const row = Object.assign({}, journalBase, entry);
    row.ms = elapsed();
    nvWebhookJournal(row);
  };
  const finish = (res, entry) => {
    if (res.error === "locked") return nvJsonOut(res); // a busy lock: nothing is written, the platform repeats the event
    if (entry.result === "Отклонено") {
      const cache = CacheService.getScriptCache();
      const bucket = "nv_rej_" + nvFormat(now, "yyyyMMddHHmm");
      const n = Number(cache.get(bucket) || 0) + 1;
      cache.put(bucket, String(n), 120);
      if (n > 30) return nvJsonOut(res);
    }
    try {
      nvWithLock(() => writeRow(entry), 5000);
    } catch (err) {
      Logger.log("journal lock: " + nvScrub(err?.message ? err.message : err));
    }
    return nvJsonOut(res);
  };
  const reject = (error, id, summary, extra) =>
    finish(
      { ok: false, id: id || null, result: null, error: error },
      Object.assign({ error: error, eventId: id || "", summary: summary || "" }, extra || {}),
    );

  let ev;
  try {
    ev = JSON.parse(body);
  } catch (err) {
    return reject("bad_payload", "", "не JSON");
  }
  const idOk = ev && typeof ev.id === "string" && NV_WEBHOOK_ID_RE.test(ev.id);
  const id = idOk ? ev.id : "";
  const typeText = ev && typeof ev.type === "string" ? ev.type.slice(0, NV_WEBHOOK_LIMITS.type) : "";
  const bad = (field) => reject("bad_payload", id, "поле " + field, { type: typeText });
  if (!ev || typeof ev !== "object" || ev.v !== NV_WEBHOOK.version) return bad("v");
  if (!idOk) return bad("id");
  if (typeof ev.type !== "string" || ev.type.length > NV_WEBHOOK_LIMITS.type) return bad("type");
  const sent = Date.parse(String(ev.sent_at || ""));
  if (!Number.isFinite(sent) || Math.abs(sent / 1000 - ts) > 1.5) return bad("sent_at");
  if (typeof ev.env !== "string") return bad("env");
  // The stricter gap of the settings, kept between 60 and 300 seconds
  const skew = Math.min(
    NV_WEBHOOK.freshnessSec,
    Math.max(60, Number(nvSettings().hmacSkewSec) || NV_WEBHOOK.freshnessSec),
  );
  if (Math.abs(now.getTime() / 1000 - ts) > skew)
    return reject("stale", id, "метка времени " + tsRaw, { type: typeText });
  if (ev.env !== nvSettings().webhookEnv)
    return reject("wrong_env", id, "среда " + String(ev.env).slice(0, 20), { type: typeText });
  if (NV_WEBHOOK_TYPES.indexOf(ev.type) < 0) return reject("unknown_type", id, "тип " + typeText, { type: typeText });
  if (!ev.data || typeof ev.data !== "object") return bad("data");

  // The event is applied and marked as handled by one lock: the row of the journal is the memory of the idempotency,
  // and it is written before the lock is released (the cache is only an accelerator, it is not guaranteed).
  let outcome;
  try {
    outcome = nvCached(() =>
      nvWithLock(() => {
        if (nvWebhookSeen(id)) {
          writeRow({ result: "Повтор", error: "", eventId: id, type: ev.type, sentAt: new Date(sent) });
          return { result: "duplicate" };
        }
        const r = nvWebhookApply(ev, now);
        const label =
          { applied: "Применено", duplicate: "Повтор", ignored: "Повтор", stale_seq: "Устарело" }[r.result] ||
          "Применено";
        writeRow({
          result: label,
          error: "",
          eventId: id,
          type: ev.type,
          num: r.num || "",
          seq: r.seq === undefined ? "" : r.seq,
          sentAt: new Date(sent),
          summary: r.summary || "",
        });
        try {
          CacheService.getScriptCache().put("nv_evt_" + id, "1", NV_WEBHOOK.cacheSeconds);
        } catch (cacheErr) {
          // the journal already knows the id
        }
        r.journaled = true;
        return r;
      }, NV_WEBHOOK.lockWaitMs),
    );
  } catch (err) {
    // 1. A busy lock: the platform repeats the same event.
    if (nvIsLockError(err)) return answer("locked", id);
    // 2. A field that cannot be mapped: the event is wrong, repeating it will not help.
    if (err?.nvField) return bad(err.nvField);
    // 3. Anything else (a timeout of Sheets, a failure in the middle of a write) is on our side: the platform repeats it,
    //    and the same id is safe to apply again (every writer of an event is idempotent).
    const msg = nvScrub(err?.message ? err.message : err).slice(0, NV_WEBHOOK_LIMITS.summary);
    Logger.log("webhook internal: " + msg);
    return reject("internal", id, msg, { type: typeText });
  }
  nvScriptProps().setProperty(NV_PROP.lastWebhookAt, String(now.getTime()));
  return nvJsonOut({ ok: true, id: id, result: outcome.result, error: null });
}

/** A field that cannot be mapped: the webhook answers bad_payload and names the field. */
function nvFieldError(field, detail) {
  const err = new Error("поле " + field + (detail ? ": " + detail : ""));
  err.nvField = field + (detail ? " (" + detail + ")" : "");
  return err;
}

function nvWebhookApply(ev, now) {
  switch (ev.type) {
    case "lead.created":
      return nvApplyLeadCreated(ev, now);
    case "order.status_changed":
      return nvApplyOrderStatusChanged(ev, now);
    case "payment.confirmed":
      return nvApplyPaymentConfirmed(ev, now);
    case "purchase.recorded":
      return nvApplyPurchaseRecorded(ev, now);
    case "warranty.case_opened":
      return nvApplyWarrantyOpened(ev, now);
    default:
      throw nvFieldError("type", ev.type);
  }
}

/* ---------------------------------------------------------------- mapping of codes */

function nvMapScope(code) {
  const s = NV_SCOPES.find((x) => x.code === code);
  if (!s) throw nvFieldError("scope", String(code));
  return s;
}

function nvMapChannel(code) {
  const label = NV_CHANNEL_BY_PLATFORM[String(code || "").toLowerCase()];
  if (!label) throw nvFieldError("channel", String(code));
  return label;
}

function nvMapBand(code) {
  if (code === null || code === undefined || code === "") return "";
  const b = NV_BUDGET_BANDS.find((x) => x.code === code);
  if (!b) throw nvFieldError("budget_band", String(code));
  return b.label;
}

function nvMapKind(code) {
  const k = NV_KINDS.find((x) => x.code === code);
  if (!k) throw nvFieldError("kind", String(code));
  return k.label;
}

function nvMapStatus(code, field) {
  const s = nvStatusByCode(code);
  if (!s) throw nvFieldError(field || "status", String(code));
  return s;
}

/** A text field of the event: not empty, not longer than max (64 by default: numbers, ids, codes). */
function nvRequireString(v, field, max) {
  if (typeof v !== "string" || v === "") throw nvFieldError(field);
  if (v.length > (max || 64)) throw nvFieldError(field, "длиннее " + (max || 64));
  return v;
}

/** An optional text: cut to max characters (names, titles, notes); anything but a string is empty. */
function nvOptionalText(v, max) {
  return typeof v === "string" ? v.slice(0, max || 200) : "";
}

function nvIsoToDate(v, field) {
  if (v === null || v === undefined || v === "") return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw nvFieldError(field, "дата");
  return d;
}

/** The client of the platform by customer.ref (found, or created with only the reference and the display name). */
function nvClientFromRef(customer, extra, demo) {
  if (!customer || typeof customer !== "object") return "";
  return nvEnsureClient(
    {
      ref: customer.ref,
      name: customer.display_name || "",
      tg: customer.telegram_username || "",
      lang: extra?.lang,
      district: extra?.district,
      channel: extra?.channel,
    },
    { demo: demo },
  );
}

/* ---------------------------------------------------------------- the five events */

function nvApplyLeadCreated(ev, now) {
  const d = ev.data;
  const num = nvRequireString(d.number, "number", NV_WEBHOOK_LIMITS.number);
  if (nvParseNumber(num)?.prefix !== "L") throw nvFieldError("number", num);
  const existing = nvReadTable("leads").find((l) => l.num === num);
  if (existing) return { result: "ignored", num: num, summary: "заявка уже есть" };
  const scope = nvMapScope(d.scope);
  const channel = nvMapChannel(d.channel);
  const utm = d.utm?.campaign ? "utm:" + nvOptionalText(d.utm.campaign, 60) : "";
  const lang = d.lang === "uz" || d.lang === "ru" ? d.lang : "";
  const raw = d.customer || {};
  const customer = {
    ref: nvOptionalText(raw.ref, 64),
    display_name: nvOptionalText(raw.display_name, 100),
    telegram_username: nvOptionalText(raw.telegram_username, 64),
  };
  const district = nvOptionalText(d.district, 60);
  const clientCode = nvClientFromRef(customer, { lang: lang, district: district, channel: channel }, false);
  nvCreateLead(
    {
      created: nvIsoToDate(d.created_at, "created_at") || now,
      channel: channel,
      source: nvOptionalText(d.source_code, 60) || utm,
      client: clientCode,
      name: customer.display_name || "",
      tg: customer.telegram_username || "",
      lang: lang,
      district: district,
      scope: scope.label,
      band: nvMapBand(d.budget_band),
      wanted: d.wanted_by ? nvIsoToDate(d.wanted_by, "wanted_by") : "",
      config: nvOptionalText(d.configuration_code, 16),
      note: [
        d.admin_url ? "Админка: " + nvOptionalText(d.admin_url, 300) : "",
        d.tg_topic_url ? "Тема: " + nvOptionalText(d.tg_topic_url, 300) : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { number: num, src: "Платформа", how: "Платформа", actorLabel: "Платформа", eventId: ev.id, now: now },
  );
  return { result: "applied", num: num, summary: "заявка " + scope.label + ", " + channel };
}

/**
 * order.status_changed. Everything the event says is read and checked FIRST (no write happens until all of it is valid),
 * then the writes go in an order that makes a repeat safe: the client, the row, the reserves (once each), the history
 * (once per event id) and, last, the cells with the status and the new seq. If a write fails in the middle, the row still
 * holds the old seq, so the platform's repeat of the same event is applied again in full and not taken for a stale one.
 */
function nvApplyOrderStatusChanged(ev, now) {
  const d = ev.data;
  const num = nvRequireString(d.number, "number", NV_WEBHOOK_LIMITS.number);
  const parsed = nvParseNumber(num);
  if (parsed?.prefix !== "NV") throw nvFieldError("number", num);
  const seq = Number(d.seq);
  if (!Number.isInteger(seq) || seq < 0) throw nvFieldError("seq");
  const to = nvMapStatus(d.to, "to");
  const from = d.from ? nvMapStatus(d.from, "from") : null;
  const kind = nvMapKind(d.kind);
  const evInfo = nvEventByCode(d.event);
  if (d.event && !evInfo) throw nvFieldError("event", String(d.event).slice(0, 40));
  const at = nvIsoToDate(d.at, "at") || now;
  const leadNumber = d.lead_number ? nvRequireString(d.lead_number, "lead_number", NV_WEBHOOK_LIMITS.number) : "";
  const customerRef = d.customer_ref ? nvRequireString(d.customer_ref, "customer_ref") : "";

  const q = d.quote || null;
  const set = {};
  if (q) {
    const sumOf = (v, name) => {
      if (v === undefined || v === null) return 0;
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0) throw nvFieldError("quote." + name, "целая сумма");
      return x;
    };
    set.basePc =
      q.pc_base !== undefined
        ? sumOf(q.pc_base, "pc_base")
        : Math.max(0, sumOf(q.components_sum, "components_sum") - sumOf(q.mount_base, "mount_base"));
    set.baseMount = sumOf(q.mount_base, "mount_base");
    set.outside = sumOf(q.outside_scale_sum, "outside_scale_sum");
    set.purchased =
      q.purchased_by_ip !== undefined
        ? sumOf(q.purchased_by_ip, "purchased_by_ip")
        : Math.max(0, sumOf(q.purchase_limit, "purchase_limit") - sumOf(q.reserve_sum, "reserve_sum"));
    set.memory = sumOf(q.memory_ssd, "memory_ssd");
    if (q.valid_until) set.validUntil = nvIsoToDate(q.valid_until, "quote.valid_until");
    if (q.eligibility === "free_window_only") set.slot = "Свободное окно";
  }
  const dates = d.dates || {};
  const dmap = {
    report_due_at: "reportTarget",
    objection_until: "objectionUntil",
    refund_due_at: "refundDue",
    podbor_credit_until: "podborUntil",
  };
  Object.keys(dmap).forEach((k) => {
    if (dates[k]) set[dmap[k]] = nvIsoToDate(dates[k], "dates." + k);
  });
  if (dates.report_due_at && !set.reportDeadline)
    set.reportDeadline = new Date(set.reportTarget.getTime() + 24 * 3600000);
  if (dates.warranty_until)
    set.warrantyUntil = nvMidnightDate(nvIsoToDate(dates.warranty_until, "dates.warranty_until"));
  if (d.report) {
    set.objection = d.report.objection_open === true ? "Возражение открыто (см. платформу)" : "";
    if (d.report.accepted === true) set.reportAccepted = d.actor === "system" ? "По сроку" : "Клиентом";
    else if (to.code === "report_sent") set.reportAccepted = "Нет";
  }
  if (d.cancel) {
    const p = NV_CANCEL_POINTS.find((x) => x.code === d.cancel.point);
    if (!p) throw nvFieldError("cancel.point", String(d.cancel.point).slice(0, 40));
    set.cancelPoint = p.label;
    set.cancelReason = nvOptionalText(d.cancel.reason, 500);
    const st = d.cancel.settlement || {};
    set.feeEarned = Number(st.fee_earned) || 0;
    set.feeToRefund = Number(st.fee_to_refund) || 0;
    set.feeToInvoice = Number(st.fee_to_invoice) || 0;
    set.fundsToRefund = Number(st.funds_to_refund) || 0;
    const parts = NV_CANCEL_PARTS.find((x) => x.code === st.parts_go_to);
    if (parts) set.partsTo = parts.label;
    if (st.due_by) set.cancelDue = nvIsoToDate(st.due_by, "cancel.settlement.due_by");
  }
  if (d.flags && d.flags.first_order_meeting_done === true) set.meetingDone = true;
  if (leadNumber) set.lead = leadNumber;
  // The reserves of the event: the fund and the amount are checked here, before any write
  const ledger = (Array.isArray(d.ledger) ? d.ledger : []).map((l) => {
    const fund = l && l.fund === "warranty" ? "Гарантийный" : l && l.fund === "tax_risk" ? "Налоговый риск" : null;
    if (!fund) throw nvFieldError("ledger.fund", String(l?.fund).slice(0, 40));
    const amount = Number(l.amount);
    if (!Number.isInteger(amount)) throw nvFieldError("ledger.amount");
    return { fund: fund, amount: amount, basis: l.fund === "warranty" ? "Взнос при сдаче" : "Взнос при сверке" };
  });

  // All of it is valid. Reads, then writes.
  let row = nvReadTable("orders").find((o) => o.num === num);
  if (row && nvStr(row.seq) !== "" && seq <= Number(row.seq))
    return { result: "stale_seq", num: num, seq: seq, summary: "seq " + seq + " не новее " + row.seq };
  const clientCode = customerRef ? nvClientFromRef({ ref: customerRef }, {}, false) : "";
  if (clientCode) set.client = clientCode;
  const stampKey = to.dateKey;
  if (stampKey && (!row || row.code !== to.code)) set[stampKey] = at;
  set.status = to.label;
  set.code = to.code;
  set.kind = kind;
  set.seq = seq;
  set.src = "Платформа";
  set.updated = now;
  let created = false;
  if (!row) {
    // No seq here: it is written last, together with the status
    nvCreateOrder(
      { lead: leadNumber, client: clientCode, kind: kind },
      { number: num, src: "Платформа", now: at, how: "Платформа", actorLabel: "Платформа" },
    );
    created = true;
    row = nvReadTable("orders").find((o) => o.num === num);
  }
  const previousLabel = row.status;
  const reserves = nvReadTable("reserves");
  ledger.forEach((l) => {
    if (
      reserves.some((r) => r.ref === num && r.fund === l.fund && r.basis === l.basis && Number(r.amount) === l.amount)
    )
      return;
    nvLedgerAppend({ date: at, fund: l.fund, ref: num, amount: l.amount, basis: l.basis, who: "Платформа" });
  });
  const logged = nvReadTable("history").some((h) => h.eventId === ev.id && h.num === num);
  if (!logged)
    nvHistoryAppend({
      time: at,
      object: "Заказ",
      num: num,
      from: from ? from.label : created ? "" : previousLabel,
      to: to.label,
      event: d.event || "",
      eventLabel: evInfo ? evInfo.label : "",
      actor:
        { owner: "Владелец", customer: "Клиент", system: "Система", assistant: "Помощник" }[d.actor] || "Платформа",
      how: "Платформа",
      eventId: ev.id,
      seq: seq,
    });
  nvWriteCells("orders", row._row, set);
  nvRefreshOrderActions(num);
  // A check of the platform's amounts against the formulas of the sheet
  let note = created ? "заказ создан" : "статус " + to.label;
  if (q && q.fee_total !== undefined) {
    const mine = nvComputeQuote(
      {
        kind: kind,
        basePc: set.basePc,
        baseMount: set.baseMount,
        outside: set.outside,
        purchased: set.purchased,
        memory: set.memory,
        complex: false,
        freeWindow: false,
      },
      nvSettings(),
    );
    if (mine.feeTotal !== Number(q.fee_total) || mine.purchaseLimit !== Number(q.purchase_limit)) {
      note +=
        "; расхождение со сметой платформы: плата " +
        q.fee_total +
        " / таблица " +
        mine.feeTotal +
        ", лимит " +
        q.purchase_limit +
        " / " +
        mine.purchaseLimit;
    }
  }
  return { result: "applied", num: num, seq: seq, summary: note };
}

function nvApplyPaymentConfirmed(ev, now) {
  const d = ev.data;
  const id = nvRequireString(d.payment_id, "payment_id");
  const orderNum = nvRequireString(d.order_number, "order_number", NV_WEBHOOK_LIMITS.number);
  const kind = NV_PAYMENT_KINDS.find((k) => k.code === d.kind);
  if (!kind) throw nvFieldError("kind", String(d.kind).slice(0, 40));
  const method = NV_PAYMENT_METHODS.find((m) => m.code === d.method);
  if (!method) throw nvFieldError("method", String(d.method).slice(0, 40));
  const wanted = d.status === "confirmed" ? "Подтверждён" : d.status === "void" ? "Аннулирован" : null;
  if (!wanted) throw nvFieldError("status", String(d.status).slice(0, 40));
  const amount = Number(d.amount_sum);
  if (!Number.isInteger(amount) || amount <= 0) throw nvFieldError("amount_sum");
  const direction = d.direction === "in" ? "Входящий" : d.direction === "out" ? "Исходящий" : null;
  if (!direction) throw nvFieldError("direction", String(d.direction).slice(0, 40));
  const receipt = nvOptionalText(d.fiscal_receipt_no, 64);
  // The red line of the money: a pair of kind and method that is not allowed, or a fee without a fiscal receipt, is never
  // written as "Подтверждён" (the sheet would count it as received). It is kept as "Ожидается" and the owner is told.
  const check = nvCheckPayment(kind.label, method.label, wanted, receipt);
  const pairBad = direction !== kind.direction;
  const refused = wanted === "Подтверждён" && (check !== "ОК" || pairBad);
  const status = refused ? "Ожидается" : wanted;
  const fields = {
    order: orderNum,
    kind: kind.label,
    method: method.label,
    amount: amount,
    status: status,
    date: nvIsoToDate(d.occurred_at, "occurred_at") || now,
    receipt: receipt,
    bankDoc: nvOptionalText(d.bank_doc_no, 64),
    payerIsClient: d.payer_is_customer !== false,
    confirmedBy: status === "Подтверждён" ? "Платформа" : "",
    confirmedAt: status === "Подтверждён" ? nvIsoToDate(d.confirmed_at, "confirmed_at") || now : "",
    reversal: nvOptionalText(d.reversal_of, 64),
    voidReason: status === "Аннулирован" ? "Аннулирован платформой" : "",
  };
  const existing = nvReadTable("payments").find((p) => p.id === id);
  if (existing) {
    const set = {};
    [
      "order",
      "kind",
      "method",
      "amount",
      "status",
      "receipt",
      "bankDoc",
      "payerIsClient",
      "confirmedBy",
      "confirmedAt",
      "reversal",
      "voidReason",
    ].forEach((k) => {
      set[k] = fields[k];
    });
    set.date = fields.date;
    set.src = "Платформа";
    nvWriteCells("payments", existing._row, set);
    nvSyncAcceptedFlags(orderNum, { how: "Платформа" });
  } else {
    nvCreatePayment(fields, { number: id, src: "Платформа", how: "Платформа", now: now });
  }
  let summary = kind.label + " " + amount + " сум, " + status;
  if (refused || check !== "ОК") {
    const problem = pairBad ? "направление не совпало с видом" : check;
    summary += "; ПРОВЕРКА: " + problem + (refused ? " (записан как «Ожидается», в деньги не засчитан)" : "");
    nvNotifyOwner("Платёж платформы " + id + " по заказу " + orderNum + ": " + problem);
  }
  return { result: "applied", num: orderNum, summary: summary };
}

/** Category codes of the catalog of the platform (packages/domain CategoryCode) -> the label of the dictionary of the sheet. */
const NV_CATEGORY_BY_CODE = {
  cpu: "Процессор",
  mb: "Материнская плата",
  ram: "Память",
  ssd: "SSD / накопитель",
  gpu: "Видеокарта",
  psu: "Блок питания",
  case: "Корпус",
  cooler_air: "Охлаждение",
  aio: "Охлаждение",
  fan: "Охлаждение",
  monitor: "Монитор",
  arm: "Периферия",
  desk: "Мебель",
  desk_frame: "Мебель",
  desk_top: "Мебель",
  chair: "Мебель",
  keyboard: "Периферия",
  mouse: "Периферия",
  mousepad: "Периферия",
  headset: "Периферия",
  microphone: "Периферия",
  webcam: "Периферия",
  light: "Свет и декор",
  decor: "Свет и декор",
  speakers: "Акустика",
  acoustic_panel: "Акустика",
  cable_mgmt: "Кабели и мелочи",
  ups: "Кабели и мелочи",
  os_license: "Лицензии",
};

/** The label of a category of the sheet by the code of the platform; a label of the sheet itself is kept; anything else is «Другое». */
function nvCategoryLabel(code) {
  if (typeof code !== "string") return "";
  if (NV_CATEGORY_BY_CODE[code]) return NV_CATEGORY_BY_CODE[code];
  return NV_CATEGORIES.indexOf(code) >= 0 ? code : "Другое";
}

function nvApplyPurchaseRecorded(ev, now) {
  const d = ev.data;
  const id = nvRequireString(d.purchase_id, "purchase_id");
  const orderNum = nvRequireString(d.order_number, "order_number", NV_WEBHOOK_LIMITS.number);
  const amount = Number(d.amount_sum);
  if (!Number.isInteger(amount) || amount < 0) throw nvFieldError("amount_sum");
  const paid = { corp_card: "Корпоративная карта", bank_transfer: "Перевод" }[d.paid_via];
  if (!paid) throw nvFieldError("paid_via", String(d.paid_via));
  const doc = { fiscal: "Фискальный чек", esf: "ЭСФ", none_with_consent: "Без чека с согласием" }[d.receipt_kind];
  if (!doc) throw nvFieldError("receipt_kind", String(d.receipt_kind));
  const fields = {
    order: orderNum,
    item: nvOptionalText(d.title, 200),
    category: nvCategoryLabel(d.category_code),
    // The name of the shop is free text: the list "Магазин 1-3" is only a hint of the owner's, never a rule
    shop: nvOptionalText(d.vendor_name, 100),
    qty: Number(d.qty) || 1,
    amount: amount,
    paidWith: paid,
    docKind: doc,
    receipt: nvOptionalText(d.receipt_no, 64),
    esf: nvOptionalText(d.esf_no, 64),
    esfStatus: d.esf_no || doc === "ЭСФ" ? "Ожидается" : "",
    discount: Number(d.discount_sum) || 0,
    bonus: nvOptionalText(d.bonus_note, 200),
    serials: Array.isArray(d.serials)
      ? d.serials
          .filter((x) => typeof x === "string")
          .join(", ")
          .slice(0, 500)
      : "",
    warrantyMonths: d.vendor_warranty_months || "",
    bought: nvIsoToDate(d.bought_at, "bought_at") || nvToday(),
    boughtBy: "Владелец",
  };
  const existing = nvReadTable("purchases").find((p) => p.id === id);
  if (existing) {
    nvWriteCells("purchases", existing._row, Object.assign({}, fields, { src: "Платформа" }));
  } else {
    nvCreatePurchase(fields, { number: id, src: "Платформа", how: "Платформа", now: now });
  }
  let summary = "чек " + amount + " сум";
  const t = d.totals;
  if (t && Number.isFinite(Number(t.receipts_total))) {
    const mine = nvReadTable("purchases")
      .filter((p) => p.order === orderNum)
      .reduce((a, p) => a + (Number(p.amount) || 0), 0);
    if (mine !== Number(t.receipts_total))
      summary += "; ПРЕДУПРЕЖДЕНИЕ: чеки по заказу в таблице " + mine + ", у платформы " + t.receipts_total;
  }
  return { result: "applied", num: orderNum, summary: summary };
}

function nvApplyWarrantyOpened(ev, now) {
  const d = ev.data;
  const num = nvRequireString(d.number, "number", NV_WEBHOOK_LIMITS.number);
  const parsed = nvParseNumber(num);
  if (parsed?.prefix !== "G") throw nvFieldError("number", num);
  const orderNum = nvRequireString(d.order_number, "order_number", NV_WEBHOOK_LIMITS.number);
  if (nvReadTable("warranty").some((w) => w.num === num))
    return { result: "ignored", num: num, summary: "случай уже есть" };
  const opened = nvIsoToDate(d.opened_at, "opened_at") || now;
  const channelMap = { bot: "Бот", telegram: "Telegram", call: "Звонок", in_person: "Лично" };
  nvCreateWarranty(
    {
      order: orderNum,
      purchase: nvOptionalText(d.purchase_id, 64),
      opened: opened,
      channel: channelMap[d.channel] || "",
      desc: nvOptionalText(d.summary, 500),
      deadlines: d.deadlines || {},
    },
    { number: num, src: "Платформа", how: "Платформа", actorLabel: "Платформа", eventId: ev.id },
  );
  const row = nvReadTable("warranty").find((w) => w.num === num);
  nvNotifyOwner(
    "Гарантийный случай " +
      num +
      " по заказу " +
      orderNum +
      ": ответить до " +
      (row ? nvFormat(nvToDate(row.replyBy), "dd.MM.yyyy HH:mm") : "—"),
  );
  return { result: "applied", num: num, summary: "случай по заказу " + orderNum };
}
